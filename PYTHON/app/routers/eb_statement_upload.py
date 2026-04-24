from app.utils.auth_utils import get_current_user
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Query
from typing import Optional, Any
import os
import shutil
from uuid import uuid4
from app.schemas.eb_statement_schema import EBStatementUploadResponse, EBStatementSaveRequest
from app.utils.validation import validate_windmill
from app.database import get_connection, DB_NAME_WINDMILL
import pdfplumber
import pymysql
import re

router = APIRouter(prefix="/eb", tags=["EB Statements"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
UPLOAD_DIR_LEGACY = os.path.join(BASE_DIR, "uploads", "eb_statements")

def normalize_month(month_val):
    month_names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    if str(month_val).isdigit():
        idx = int(month_val)
        if 1 <= idx <= 12:
            return month_names[idx-1]
    return str(month_val).capitalize()

def extract_eb_statement_data(pdf_path, expected_windmill_no, expected_year=None, expected_month=None):
    data = {
        "company_name": None,
        "windmill_number": None,
        "slots": {"C1": "0", "C2": "0", "C4": "0", "C5": "0"},
        "banking_slots": {"C1": "0", "C2": "0", "C4": "0", "C5": "0"},
        "banking_units": "0",
        "charges": [],
        "month": expected_month,
        "year": expected_year
    }

    with pdfplumber.open(pdf_path) as pdf:
        full_text = ""
        for page in pdf.pages:
            full_text += (page.extract_text() or "") + "\n"

        # 1. Company Name (Handles "Generation Date" being on the same line)
        m_company = re.search(r"Company Name\s+(.+?)(?=\s+Generation Date|$)", full_text, re.IGNORECASE)
        if m_company:
            data["company_name"] = m_company.group(1).strip()

        # 2. Windmill/Service No
        m_wm = re.search(r"Service Number/isRec\s+([\d]+)", full_text, re.IGNORECASE)
        if not m_wm:
            m_wm = re.search(r"Service Number\s*[:]*\s*([\d]+)", full_text, re.IGNORECASE)
        
        if m_wm:
            data["windmill_number"] = m_wm.group(1).strip()
        else:
            m_alt = re.search(r"\b(\d{12})\b", full_text)
            if m_alt:
                data["windmill_number"] = m_alt.group(1)
            else:
                # One last try: sequence of 12 digits anywhere
                m_dig = re.search(r"(\d{10,12})", full_text)
                if m_dig:
                    data["windmill_number"] = m_dig.group(1)

        # 3. Net Units (Slot-wise) - Target the "Net Units" or "Slot Wise Net Generation" summary line
        # Using a more flexible regex to handle spacing and optional colons
        m_nets = re.search(r"(?:Net Units|Slot\s*Wise\s*Net\s*Generation)\s*.*?(?:C1|C 1)[:\s]+([\d,.]+)\s+(?:C2|C 2)[:\s]+([\d,.]+)\s+(?:C3|C 3)[:\s]+([\d,.]+)\s+(?:C4|C 4)[:\s]+([\d,.]+)\s+(?:C5|C 5)[:\s]+([\d,.]+)", full_text, re.IGNORECASE | re.DOTALL)
        if m_nets:
            data["slots"]["C1"] = m_nets.group(1).replace(",", "")
            data["slots"]["C2"] = m_nets.group(2).replace(",", "")
            # C3 is intentionally ignored as per request
            data["slots"]["C4"] = m_nets.group(4).replace(",", "")
            data["slots"]["C5"] = m_nets.group(5).replace(",", "")
        else:
            # Fallback: Try to find slot values anywhere if the specific line format differs
            for slot in ["C1", "C2", "C4", "C5"]:
                pat = rf"{slot}[:\s]+([\d.]+)"
                # Search for the one specifically under "Net Units" context if possible, 
                # but if the line regex failed, we search the whole text for the last occurence 
                # which is usually the summary.
                matches = re.findall(pat, full_text, re.IGNORECASE)
                if matches:
                    data["slots"][slot] = matches[-1]

        # 4. Banking Units (Slot-wise & Total)
        m_bank_slots = re.search(r"(?:Banking Units|Slot\s*Wise\s*Banking\s*Units)\s*.*?(?:C1|C 1)[:\s]+([\d,.]+)\s+(?:C2|C 2)[:\s]+([\d,.]+)\s+(?:C3|C 3)[:\s]+([\d,.]+)\s+(?:C4|C 4)[:\s]+([\d,.]+)\s+(?:C5|C 5)[:\s]+([\d,.]+)", full_text, re.IGNORECASE | re.DOTALL)
        if m_bank_slots:
            data["banking_slots"]["C1"] = m_bank_slots.group(1).replace(",", "")
            data["banking_slots"]["C2"] = m_bank_slots.group(2).replace(",", "")
            # C3 captured but we'll remove it from display
            data["banking_slots"]["C4"] = m_bank_slots.group(4).replace(",", "")
            data["banking_slots"]["C5"] = m_bank_slots.group(5).replace(",", "")

        m_bank_total = re.search(r"Total\s*Banking\s*Units\s*[:\s]+([\d,.]+)", full_text, re.IGNORECASE)
        if m_bank_total:
            data["banking_units"] = m_bank_total.group(1).replace(",", "")

        # 5. Applicable Charges Table
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                if not table or len(table) < 2: continue
                # Look for table with "Charge Code" / "Charge Description" / "Total Charges"
                header_row = [str(c or "").lower() for c in table[0]]
                has_desc = "charge description" in header_row or "description" in header_row
                has_total = "total charges" in header_row or "amount" in header_row or "amount(rs)" in header_row or "amount (rs)" in header_row or "amount (r)" in header_row

                if has_desc and has_total:
                    idx_desc = header_row.index("charge description") if "charge description" in header_row else header_row.index("description")
                    if "total charges" in header_row:
                        idx_total = header_row.index("total charges")
                    elif "amount" in header_row:
                        idx_total = header_row.index("amount")
                    elif "amount(rs)" in header_row:
                        idx_total = header_row.index("amount(rs)")
                    elif "amount (rs)" in header_row:
                        idx_total = header_row.index("amount (rs)")
                    else:
                        # Find index that contains "amount"
                        idx_total = next(i for i, h in enumerate(header_row) if "amount" in h)
                    
                    idx_code = header_row.index("charge code") if "charge code" in header_row else None

                    for row in table[1:]:
                        if not row or len(row) <= max(idx_desc, idx_total):
                            continue

                        desc = str(row[idx_desc] or "").strip()
                        raw_amount = str(row[idx_total] or "").strip()
                        # Remove currency, commas, and other non-numeric chars except .
                        amount = re.sub(r'[^\d.]', '', raw_amount)
                        
                        code = None
                        if idx_code is not None and len(row) > idx_code:
                            code = str(row[idx_code] or "").strip()

                        # If amount is valid but desc is missing, use a fallback
                        if amount and amount.replace(".", "").isdigit():
                            if not desc:
                                # Look in other columns just in case
                                possible_desc = [str(c or "").strip() for c in row if c and str(c).strip() and not re.search(r'[\d.]', str(c))]
                                desc = possible_desc[0] if possible_desc else "Miscellaneous Charge"

                            charge_item = {
                                "name": desc,
                                "amount": amount,
                            }
                            if code:
                                charge_item["code"] = code
                            data["charges"].append(charge_item)


    # 6. Extract Month/Year from specific "Statement Showing..." line
    m_period = re.search(
        r"Statement\s+Showing\s+.*?Energy\s+Generated\s+for\s+([A-Za-z]+)[\s,]+(\d{4})",
        full_text,
        re.IGNORECASE
    )
    extracted_month = None
    extracted_year = None
    if m_period:
        extracted_month = m_period.group(1).strip()
        extracted_year = m_period.group(2).strip()
        data["month"] = normalize_month(extracted_month)
        data["year"] = int(extracted_year)
    elif not expected_month or not expected_year:
        # Fallback: Try to extract from filename if present in path
        fname = os.path.basename(pdf_path)
        m_file = re.search(r"_([A-Za-z]+)_(\d{4})", fname)
        if m_file:
            data["month"] = normalize_month(m_file.group(1))
            data["year"] = int(m_file.group(2))

    # Validation
    if data["windmill_number"] and expected_windmill_no:
        pdf_wm = re.sub(r"\D", "", str(data["windmill_number"]))
        expected_wm = re.sub(r"\D", "", str(expected_windmill_no))
        if pdf_wm != expected_wm:
            if pdf_wm not in expected_wm and expected_wm not in pdf_wm:
                raise Exception(f"Mismatch: PDF Windmill No ({data['windmill_number']}) does not match selected ({expected_windmill_no})")
                
    if expected_month:
        month_names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        if str(expected_month).isdigit() and 1 <= int(expected_month) <= 12:
            idx = int(expected_month) - 1
            long_names = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
            short_month = month_names[idx]
            long_month = long_names[idx]
            display_name = long_month.capitalize()
        else:
            long_month = str(expected_month).lower()
            short_month = long_month[:3]
            display_name = str(expected_month).capitalize()
            
        # Validate specifically using the extracted month if available
        if extracted_month:
            if extracted_month.lower()[:3] != short_month:
                raise Exception(f"You've selected a wrong month '{display_name}' but the pdf is of '{extracted_month}' data")
        else:
            # Fallback to generic text search
            if not re.search(rf"\b({short_month}|{long_month})\b", full_text.lower()):
                raise Exception(f"Mismatch: PDF does not appear to be for Month '{display_name}'")
                
    if expected_year:
        if extracted_year:
            if str(extracted_year) != str(expected_year):
                raise Exception(f"You've selected a wrong year '{expected_year}' but the pdf is of '{extracted_year}' data")
        else:
            # Fallback to generic text search
            if not re.search(rf"\b{expected_year}\b", full_text):
                raise Exception(f"Mismatch: PDF does not appear to be for Year '{expected_year}'")

    if expected_month:
        data["month"] = normalize_month(expected_month)
    if expected_year:
        data["year"] = expected_year

    return data



@router.post("/upload", response_model=EBStatementUploadResponse)
async def upload_eb_statement(
    windmill_id: int = Form(...),
    year: int = Form(...),
    month: str = Form(...),
    file: UploadFile = File(...)
):

    filename = getattr(file, "filename", "") or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files allowed")

    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()

    try:
        # Validate windmill
        validate_windmill(cursor, windmill_id)

        # Check for duplicate upload (same windmill, month, and year)
        cursor.callproc("windmill.sp_check_eb_statement_duplicate", (windmill_id, month, year))
        existing_record = cursor.fetchone()
        if existing_record:
            raise HTTPException(
                status_code=409, 
                detail=f"EB Statement for this windmill already exists for {month} {year}."
            )

        # Get Windmill Number for validation and naming
        cursor.callproc("masters.sp_get_windmill_number_by_id_or_val", (str(windmill_id),))
        wm_row = cursor.fetchone()
        windmill_number = wm_row[0] if wm_row else str(windmill_id)
        
        # Normalize month for folder and filename
        month_name = normalize_month(month)
        
        # New Structured Path: uploads/eb_statements_windmill/year/month
        year_str = str(year)
        target_dir = os.path.join(BASE_DIR, "uploads", "eb_statements_windmill", year_str, month_name)
        os.makedirs(target_dir, exist_ok=True)

        # Filename: Windmill_number_month_year.pdf
        clean_wm = re.sub(r'[^a-zA-Z0-9]', '_', windmill_number)
        unique_name = f"{clean_wm}_{month_name}_{year_str}.pdf"
        file_path = os.path.join(target_dir, unique_name)

        # Save PDF
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Parse PDF Data
        try:
            parsed_data = extract_eb_statement_data(file_path, windmill_number, year, month)
        except Exception as pe:
            if os.path.exists(file_path):
                os.remove(file_path)
            raise HTTPException(status_code=400, detail=str(pe))

        # Use direct INSERT instead of SP to ensure only the header is created.
        # This prevents premature saving of detail values.
        header_id = None
        try:
            cursor.callproc(
                "windmill.sp_create_eb_statement_header",
                (windmill_id, month_name, year, file_path, 1)
            )
            conn.commit()
            result = cursor.fetchone()
            header_id = result[0] if result else None
        except Exception as direct_exc:
            print(f"Error: Direct INSERT failed: {direct_exc}")
            raise HTTPException(status_code=500, detail="Failed to create header record")

        return {
            "message": "EB Statement uploaded and header created",
            "filename": unique_name,
            "parsed_data": parsed_data,
            "header_id": header_id
        }

    except Exception as e:
        print(f"Error in upload_eb_statement: {e}")
        if not isinstance(e, HTTPException):
            raise HTTPException(status_code=500, detail=str(e))
        raise e
    finally:
        cursor.close()
        conn.close()
    
@router.get("/list")
async def get_eb_statement_list(
    windmill_number: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[str] = None,
    keyword: Optional[str] = None
):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()

    try:
        cursor.callproc("windmill.sp_get_eb_statement_list", (windmill_number, year, month))
        result = cursor.fetchall()

        data = []
        for row in result:
            data.append({
                "id": row[0],
                "month": row[1],
                "year": row[2],
                "windmill_number": row[3],
                "pdf": row[4],
                "is_submitted": row[5],
                "submitted_time": row[6],
                "submitted_by": row[7]
            })

        return {
            "status": "success",
            "data": data
        }

    finally:
        cursor.close()
        conn.close()


@router.get("/read-metadata")
async def read_eb_statement_metadata(filename: str, user: dict = Depends(get_current_user)):
    # Validate filename to prevent path traversal
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()

    try:
        # 1. Get header ID, month, and year from db
        cursor.callproc("windmill.sp_get_eb_statement_metadata_by_filename", (filename,))
        h_row = cursor.fetchone()
        header_id = h_row[0] if h_row else None
        db_month = h_row[1] if h_row else None
        db_year = h_row[2] if h_row else None

        # 2. Extract windmill_id from filename (format: {windmill_number}_{month}_{year}.pdf)
        # Note: parts[0] is clean_wm (number)
        parts = filename.split("_")
        windmill_number_from_file = parts[0]
        
        # Resolve windmill_number for PDF parsing validation
        cursor.callproc("masters.sp_get_windmill_number_by_id_or_val", (str(windmill_number_from_file),))
        wm_row = cursor.fetchone()
        expected_wm_no = wm_row[0] if wm_row else windmill_number_from_file

        # 3. Determine file path
        if os.path.isabs(filename):
            file_path = filename
        else:
            file_path = None
            if db_month and db_year:
                month_folder = normalize_month(db_month)
                file_path = os.path.join(BASE_DIR, "uploads", "eb_statements_windmill", str(db_year), month_folder, filename)
            
            if not file_path or not os.path.exists(file_path):
                file_path = os.path.join(BASE_DIR, "uploads", "eb_statements_windmill", filename)
            if not os.path.exists(file_path):
                file_path = os.path.join(UPLOAD_DIR_LEGACY, filename)
            if not os.path.exists(file_path):
                file_path = os.path.join(BASE_DIR, "uploads", "eb_bills", filename)

        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {filename}")

        # 4. Parse PDF Data
        parsed_data = extract_eb_statement_data(file_path, expected_wm_no, db_year, db_month)
        
        # Merge DB month/year into parsed_data if missing
        if isinstance(parsed_data, dict):
            if db_month: parsed_data["month"] = db_month
            if db_year: parsed_data["year"] = db_year

        return {
            "status": "success",
            "data": parsed_data,
            "header_id": header_id
        }
    except Exception as e:
        print(f"Error in read_eb_statement_metadata: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()

@router.get("/details/{header_id}")
async def get_eb_statement_details(header_id: int, user: dict = Depends(get_current_user)):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()
    try:
        # 1. Fetch slots and banking units
        cursor.callproc("windmill.sp_get_eb_statement_details_slots", (header_id,))
        details_rows = cursor.fetchall()
        
        slots = {}
        banking_slots = {}
        for row in details_rows:
            s_key = f"C{row[0]}"
            slots[s_key] = str(row[1])
            banking_slots[s_key] = str(row[2])

        # 2. Fetch total banking units
        cursor.callproc("windmill.sp_get_eb_statement_total_banking", (header_id,))
        tb_row = cursor.fetchone()
        banking_units = str(tb_row[0]) if tb_row else "0"

        # 3. Fetch charges (join with master table if possible, otherwise use stored description)
        cursor.callproc("windmill.sp_get_eb_statement_charges", (header_id,))
        charges_rows = cursor.fetchall()
        
        charges = []
        for row in charges_rows:
            # use master name if exists, else stored description
            name = row[3] if row[3] else row[1]
            charges.append({
                "name": name,
                "amount": str(row[2]),
                "code": row[4] if row[4] else None
            })

        return {
            "status": "success",
            "data": {
                "slots": slots,
                "banking_slots": banking_slots,
                "banking_units": banking_units,
                "charges": charges
            }
        }
    except Exception as e:
        print(f"Error in get_eb_statement_details: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()


@router.get("/windmills")
async def get_windmills(user: dict = Depends(get_current_user)):

    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()

    try:
        # Filter by type = 'windmill' and posted status to show only active windmill type records
        cursor.callproc("masters.sp_get_windmill_dropdown_standard")

        rows = cursor.fetchall()

        data = []

        for row in rows:
            data.append({
                "id": row[0],
                "windmill_number": row[1]
            })

        return {
            "status": "success",
            "data": data
        }

    finally:
        cursor.close()
        conn.close()
        
@router.delete("/delete/{id}")
async def delete_eb_statement(id: int, user: dict = Depends(get_current_user)):

    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()

    try:
        # get pdf path before deleting
        cursor.callproc("windmill.sp_get_eb_statement_file_path_for_delete", (id,))

        row = cursor.fetchone()
        if not row:
            print(f"Delete failed: Record {id} not found in windmill.eb_statements")
            return {"status": "error", "message": "Record not found"}

        pdf_path = row[0]

        # call stored procedure
        print(f"Calling delete_eb_statement for id={id}")
        cursor.callproc("delete_eb_statement", (id,))
        conn.commit()

        # delete file from folder
        if pdf_path and os.path.exists(pdf_path):
            try:
                os.remove(pdf_path)
                print(f"Deleted file: {pdf_path}")
            except Exception as fe:
                print(f"Warning: Could not delete physical file {pdf_path}: {fe}")

        return {
            "status": "success",
            "message": "EB Statement deleted successfully"
        }
    except Exception as e:
        print(f"Error in delete_eb_statement: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()

@router.get("/{id}")
async def get_eb_statement(id: int, user: dict = Depends(get_current_user)):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()
    try:
        cursor.callproc("windmill.sp_get_eb_statement_by_id", (id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="EB Statement not found")
        
        return {
            "status": "success",
            "data": {
                "id": row[0],
                "month": row[1],
                "windmill_id": row[2],
                "pdf": row[3],
                "is_submitted": row[4]
            }
        }
    finally:
        cursor.close()
        conn.close()

@router.put("/update/{id}")
async def update_eb_statement(
    id: int,
    windmill_id: int = Form(...),
    month: str = Form(...),
    file: Optional[UploadFile] = File(None)
):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()
    try:
        # Get existing file path
        cursor.callproc("windmill.sp_get_eb_statement_by_id", (id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="EB Statement not found")
        
        old_pdf_path = row[0]
        new_pdf_path = old_pdf_path

        if file:
            filename = getattr(file, "filename", "") or ""
            if not filename.lower().endswith(".pdf"):
                raise HTTPException(status_code=400, detail="Only PDF files allowed")
            
            # Normalize month for folder and filename
            month_name = normalize_month(month)
            year_res = __import__('datetime').datetime.now().year # Fallback year
            
            # Directory structure: uploads/eb_statements_windmill/year/month
            target_dir = os.path.join(BASE_DIR, "uploads", "eb_statements_windmill", str(year_res), month_name)
            os.makedirs(target_dir, exist_ok=True)
            
            # Create unique filename
            unique_name = f"{windmill_id}_{month_name}_{uuid4().hex}.pdf"
            new_pdf_path = os.path.join(target_dir, unique_name)

            # Save New PDF
            with open(new_pdf_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            # Delete old PDF
            if old_pdf_path and os.path.exists(old_pdf_path):
                try:
                    os.remove(old_pdf_path)
                    print(f"Deleted old file: {old_pdf_path}")
                except Exception as fe:
                    print(f"Warning: Could not delete old file {old_pdf_path}: {fe}")
        
        # Update Record
        cursor.callproc("windmill.sp_update_eb_statement_header", (id, windmill_id, month, new_pdf_path))
        conn.commit()

        return {"status": "success", "message": "EB Statement updated successfully"}
    except Exception as e:
        print(f"Error in update_eb_statement: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()

@router.post("/save-details")
async def save_eb_statement_details(
    payload: EBStatementSaveRequest,
    user: dict = Depends(get_current_user)
):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()
    user_id = user.get("id")
    
    try:
        # 0. Delete existing records for this header to allow update/overwrite
        print(f"Cleaning existing records for eb_header_id {payload.eb_header_id}")
        cursor.callproc("windmill.sp_clear_eb_statement_child_records", (payload.eb_header_id,))

        # 1. Insert into eb_statements_details for EACH slot (Net + Banking per slot)
        for slot_key, net_val_str in payload.slots.items():
            # Extract number from "C1", "C2", etc.
            slot_num_str = slot_key.replace("C", "")
            slot_id = int(slot_num_str) if slot_num_str.isdigit() else None
            
            net_val = float(net_val_str) if net_val_str else 0
            # Map corresponding banking slot value
            banking_val_str = payload.banking_slots.get(slot_key, "0")
            banking_val = float(banking_val_str) if banking_val_str else 0

            cursor.callproc(
                "windmill.sp_insert_eb_statement_detail",
                (
                    payload.eb_header_id,
                    payload.company_name,
                    payload.windmill_id,
                    slot_id,
                    net_val,
                    banking_val,
                    user_id
                )
            )

        # 2. Insert into eb_statements_total_banking_units
        cursor.callproc(
            "windmill.sp_insert_eb_statement_total_banking",
            (payload.eb_header_id, payload.banking_units, user_id)
        )

        # 3. Insert into eb_statements_applicable_charges
        for charge in payload.charges:
            charge_id = None
            # The master table stores energy_type as 'Windmill' and type as 'Variable' for windmill charges.
            # We'll match loosely on energy_type and allow both 'variable' and 'windmill' values for type.
            energy_type_value = "windmill"
            valid_charge_types = ("variable", "windmill")

            # Normalize the charge fields to improve matching (trim + lower + collapse whitespace)
            charge_name_norm = None
            if charge.name:
                charge_name_norm = " ".join(str(charge.name).strip().lower().split())

            charge_code_norm = None
            if getattr(charge, "code", None):
                charge_code_norm = str(charge.code).strip().lower()

            # 1) Preferred: Match using the charge description (charge_description column)
            if charge_name_norm:
                try:
                    cursor.callproc("masters.sp_mapping_charge_id", (charge_name_norm, ""))
                    res = cursor.fetchone()
                    if res:
                        charge_id = res[0]
                except Exception as ce:
                    print(f"Warning: Could not map charge description '{charge.name}': {ce}")

            # 2) Secondary: use code lookup if provided
            if not charge_id and charge_code_norm:
                try:
                    cursor.callproc("masters.sp_mapping_charge_id_by_code", (charge_code_norm,))
                    res = cursor.fetchone()
                    if res:
                        charge_id = res[0]
                except Exception as ce:
                    print(f"Warning: Could not map charge code '{charge.code}': {ce}")

            # 3) Fallback: match on charge name if still missing
            if not charge_id:
                try:
                    cursor.callproc("masters.sp_mapping_charge_id_fallback", (charge_name_norm,))
                    res = cursor.fetchone()
                    if res:
                        charge_id = res[0]
                except Exception as ce:
                    print(f"Warning: Could not map charge '{charge.name}': {ce}")

            if charge_id is None:
                print(f"Warning: charge_id not mapped for '{charge.name}' (code={getattr(charge, 'code', None)})")

            cursor.callproc(
                "windmill.sp_insert_eb_statement_charge",
                (payload.eb_header_id, charge_id, charge.name, charge.amount, user_id)
            )

        # 4. Mark as submitted and update modified time
        cursor.callproc("windmill.sp_mark_eb_statement_submitted", (payload.eb_header_id,))
        
        conn.commit()
        print(f"Successfully saved EB statement details for header {payload.eb_header_id}")
        return {"status": "success", "message": "Details saved successfully"}

    except Exception as e:
        conn.rollback()
        import traceback
        error_trace = traceback.format_exc()
        print(f"Error in save_eb_statement_details: {e}")
        print(error_trace)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    finally:
        conn.close()

@router.get("/summary/by-month")
async def get_eb_statement_summary_by_month(
    year: int,
    month: str,
    user: dict = Depends(get_current_user)
):
    """
    Get aggregated EB Statement slot values (Power Plant and Banking)
    for all windmills for a specific month and year.
    Used by the Energy Allotment grid to populate available values.
    """
    import pymysql

    # Convert numeric month string to month name (e.g. "1" -> "January")
    month_names = {
        "1": "January", "2": "February", "3": "March", "4": "April",
        "5": "May", "6": "June", "7": "July", "8": "August",
        "9": "September", "10": "October", "11": "November", "12": "December"
    }
    try:
        month_int = int(month)
    except:
        reverse_month_names = {v: k for k, v in month_names.items()}
        month_int = int(reverse_month_names.get(month, 0))

    db_month = month_names.get(str(month), month)

    # Current month details
    current_month_name = db_month
    current_month_num_str = str(month)
    current_month_num_str_pad = current_month_num_str.zfill(2)
    current_year = year

    # Previous month details
    prev_month_int = month_int - 1
    prev_year = year
    if prev_month_int == 0:
        prev_month_int = 12
        prev_year -= 1
    prev_month_name = month_names.get(str(prev_month_int))
    prev_month_num_str = str(prev_month_int)
    prev_month_num_str_pad = prev_month_num_str.zfill(2)

    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()
    try:
        # Fetch P/B values directly from EB Statements (Windmill and Solar).
        # The user requested that for a given month (e.g., March), values MUST come from 
        # the previous month's actual generation (e.g., February). 
        # If previous month data is missing, it should be 0.
        query = """
            SELECT 
                TRIM(mw.windmill_number) as windmill_number,
                d.slots AS slot,
                d.net_unit AS pp_units,
                d.banking_units AS bank_units,
                es.year,
                es.month,
                mw.id as windmill_id
            FROM windmill.eb_statements es
            JOIN masters.master_windmill mw ON es.windmill_id = mw.id
            JOIN windmill.eb_statements_details d ON es.id = d.eb_header_id
            WHERE (es.year = %s AND (es.month = %s OR es.month = %s OR es.month = %s))
            
            UNION ALL
            
            SELECT 
                TRIM(mw.windmill_number) as windmill_number,
                d.slots AS slot,
                0 AS pp_units,
                d.net_unit AS bank_units,
                es.year,
                es.month,
                mw.id as windmill_id
            FROM solar.eb_statement_solar es
            JOIN masters.master_windmill mw ON es.solar_id = mw.id
            JOIN solar.eb_statement_solar_details d ON es.id = d.eb_header_id
            WHERE (es.year = %s AND (es.month = %s OR es.month = %s OR es.month = %s))
        """
        params = (
            # Windmill params (Strictly previous month)
            prev_year, prev_month_name, prev_month_num_str, prev_month_num_str_pad,
            # Solar params (Strictly previous month)
            prev_year, prev_month_name, prev_month_num_str, prev_month_num_str_pad
        )
        cursor.execute(query, params)
        rows = cursor.fetchall()

        result_map = {}
        for row in rows:
            wm = str(row[0])
            slot_raw = str(row[1]).lower()
            slot = slot_raw if slot_raw.startswith('c') else f"c{slot_raw}"
            pp_units = float(row[2]) if row[2] else 0.0
            bank_units = float(row[3]) if row[3] else 0.0
            
            if wm not in result_map:
                result_map[wm] = {"windmill_id": row[6]}
            
            # Since we only fetch previous month now, we can just aggregate or pick the first found.
            # Usually there's only one EB statement per windmill per month.
            result_map[wm][f"{slot}_pp"] = result_map[wm].get(f"{slot}_pp", 0) + pp_units
            result_map[wm][f"{slot}_bank"] = result_map[wm].get(f"{slot}_bank", 0) + bank_units

        return {"status": "success", "data": result_map}


    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[EB Summary] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@router.post("/save-details")


@router.get("/applicable-charges/summary")
async def get_applicable_charges_summary(
    year: int,
    month: str,
    user: dict = Depends(get_current_user)
):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor(pymysql.cursors.DictCursor)
    
    try:
        month_names = {
            "1": "January", "2": "February", "3": "March", "4": "April",
            "5": "May", "6": "June", "7": "July", "8": "August",
            "9": "September", "10": "October", "11": "November", "12": "December"
        }
        db_month = month_names.get(str(month), month)

        query = """
            SELECT 
                TRIM(mw.windmill_number) as windmill_number,
                mcc.charge_code,
                ac.total_charge
            FROM windmill.eb_statements s
            JOIN windmill.eb_statements_applicable_charges ac ON s.id = ac.eb_header_id
            JOIN masters.master_consumption_chargers mcc ON ac.charge_id = mcc.id
            JOIN masters.master_windmill mw ON s.windmill_id = mw.id
            WHERE s.month = %s AND s.year = %s
        """
        cursor.execute(query, (db_month, year))
        rows = cursor.fetchall()
        
        result_map = {}
        for row in rows:
            wm = str(row['windmill_number'])
            code = str(row['charge_code'])
            val = float(row['total_charge']) if row['total_charge'] else 0.0
            
            if wm not in result_map:
                result_map[wm] = {}
            result_map[wm][code] = val
            
        return {"status": "success", "data": result_map}
    finally:
        conn.close()


@router.post("/save-all")
async def save_all_eb_statement(
    payload: EBStatementSaveRequest,
    user: dict = Depends(get_current_user)
):
    """
    Alias for /save-details. Called by the frontend after auto-upload.
    """
    return await save_eb_statement_details(payload, user)
