from app.utils.auth_utils import get_current_user
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from typing import Optional, Any
import os
import shutil
from uuid import uuid4
from app.schemas.eb_statement_schema import EBStatementUploadResponse, EBStatementSaveRequest
from app.utils.validation import validate_windmill
from app.database import get_connection, DB_NAME_WINDMILL
import pdfplumber
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
            m_alt = re.search(r"(\d{12})", full_text)
            if m_alt:
                data["windmill_number"] = m_alt.group(1)

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
                if "charge description" in header_row and "total charges" in header_row:
                    idx_desc = header_row.index("charge description")
                    idx_total = header_row.index("total charges")
                    idx_code = header_row.index("charge code") if "charge code" in header_row else None

                    for row in table[1:]:
                        if not row or len(row) <= max(idx_desc, idx_total):
                            continue

                        desc = str(row[idx_desc] or "").strip()
                        amount = str(row[idx_total] or "").strip().replace(",", "")
                        code = None
                        if idx_code is not None and len(row) > idx_code:
                            code = str(row[idx_code] or "").strip()

                        # Only add if it looks like a valid charge (has a name and a numeric amount)
                        # Supports decimals in amount
                        if desc and amount.replace(".", "").isdigit():
                            charge_item = {
                                "name": desc,
                                "amount": amount,
                            }
                            if code:
                                charge_item["code"] = code
                            data["charges"].append(charge_item)


    # Validation
    # Validation
    if data["windmill_number"] and expected_windmill_no:
        pdf_wm = re.sub(r"\D", "", str(data["windmill_number"]))
        expected_wm = re.sub(r"\D", "", str(expected_windmill_no))
        # Sometimes PDF has a slash or prefix, we compare only digits
        if pdf_wm != expected_wm:
            # We check if one contains the other (e.g. 12 digits vs 10 digits)
            if pdf_wm not in expected_wm and expected_wm not in pdf_wm:
                raise Exception(f"Mismatch: PDF Windmill No ({data['windmill_number']}) does not match selected ({expected_windmill_no})")
                
    if expected_month:
        month_names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        # If expected_month is a digit like '3', get 'march' / 'mar'
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
            
        # Use regex to match exactly 'march' or 'mar' as a whole word to prevent matching "margin"!
        if not re.search(rf"\b({short_month}|{long_month})\b", full_text.lower()):
            raise Exception(f"Mismatch: PDF does not appear to be for Month '{display_name}'")
                
    if expected_year:
        # Use word boundaries so "2026" doesn't match inside "120264"
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
        cursor.execute(
            """
            SELECT id FROM windmill.eb_statements 
            WHERE windmill_id=%s AND month=%s AND year=%s
            """,
            (windmill_id, month, year)
        )
        existing_record = cursor.fetchone()
        if existing_record:
            raise HTTPException(
                status_code=409, 
                detail=f"EB Statement for this windmill already exists for {month} {year}."
            )

        # Get Windmill Number for validation and naming
        cursor.execute("SELECT windmill_number FROM masters.master_windmill WHERE id=%s", (windmill_id,))
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
            cursor.execute(
                """
                INSERT INTO windmill.eb_statements 
                (windmill_id, month, year, pdf_file_path, is_submitted, created_by, created_at, modified_at)
                VALUES (%s, %s, %s, %s, 0, 1, NOW(), NOW())
                """,
                (windmill_id, month, year, file_path)
            )
            conn.commit()
            header_id = cursor.lastrowid
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
        # Build dynamic query with windmill_number from masters table, created_at, and user name
        query = """
            SELECT es.id, es.month, es.year, mw.windmill_number, es.pdf_file_path, es.is_submitted, es.created_at, u.name
            FROM windmill.eb_statements es
            LEFT JOIN masters.master_windmill mw ON es.windmill_id = mw.id
            LEFT JOIN masters.users u ON es.created_by = u.id
            WHERE 1=1
        """
        params = []
        
        if windmill_number and windmill_number != "all":
            query += " AND mw.windmill_number = %s"
            params.append(windmill_number)
        
        if year and year != "all":
            query += " AND es.year = %s"
            params.append(year)
        
        if month and month != "all":
            query += " AND es.month = %s"
            params.append(month)
        
        query += " ORDER BY es.created_at DESC"
        
        cursor.execute(query, params)
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
                "created_at": row[6],
                "created_by": row[7]
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

    # Check if filename is full path or just name
    if os.path.isabs(filename):
        file_path = filename
    else:
        # Fallback search
        file_path = os.path.join(BASE_DIR, "uploads", "eb_statements_windmill", filename)
        if not os.path.exists(file_path):
            file_path = os.path.join(UPLOAD_DIR_LEGACY, filename)
        if not os.path.exists(file_path):
            file_path = os.path.join(BASE_DIR, "uploads", "eb_bills", filename)
        
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    try:
        # Extract windmill_id from filename (format: {windmill_id}_{month}_{uuid}.pdf)
        parts = filename.split("_")
        windmill_id = int(parts[0])

        conn = get_connection(db_name=DB_NAME_WINDMILL)
        cursor = conn.cursor()
        cursor.execute("SELECT windmill_number FROM masters.master_windmill WHERE id=%s", (windmill_id,))
        wm_row = cursor.fetchone()
        expected_wm_no = wm_row[0] if wm_row else ""

        # Get header ID, month, and year from db
        cursor.execute("SELECT id, month, year FROM windmill.eb_statements WHERE pdf_file_path LIKE %s", (f"%{filename}%",))
        h_row = cursor.fetchone()
        header_id = h_row[0] if h_row else None
        db_month = h_row[1] if h_row else None
        db_year = h_row[2] if h_row else None

        parsed_data = extract_eb_statement_data(file_path, expected_wm_no)
        
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
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/details/{header_id}")
async def get_eb_statement_details(header_id: int, user: dict = Depends(get_current_user)):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()
    try:
        # 1. Fetch slots and banking units
        cursor.execute(
            """
            SELECT slots, net_unit, banking_units 
            FROM windmill.eb_statements_details 
            WHERE eb_header_id = %s
            """,
            (header_id,)
        )
        details_rows = cursor.fetchall()
        
        slots = {}
        banking_slots = {}
        for row in details_rows:
            s_key = f"C{row[0]}"
            slots[s_key] = str(row[1])
            banking_slots[s_key] = str(row[2])

        # 2. Fetch total banking units
        cursor.execute(
            "SELECT total_banking_units FROM windmill.eb_statements_total_banking_units WHERE eb_header_id = %s",
            (header_id,)
        )
        tb_row = cursor.fetchone()
        banking_units = str(tb_row[0]) if tb_row else "0"

        # 3. Fetch charges (join with master table if possible, otherwise use stored description)
        cursor.execute(
            """
            SELECT a.charge_id, a.charge_description, a.total_charge, m.charge_name, m.charge_code
            FROM windmill.eb_statements_applicable_charges a
            LEFT JOIN masters.master_consumption_chargers m ON a.charge_id = m.id
            WHERE a.eb_header_id = %s
            """,
            (header_id,)
        )
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
        cursor.execute("SELECT id, windmill_number FROM masters.master_windmill WHERE LOWER(type) = 'windmill' AND is_submitted = 1 ORDER BY windmill_number")

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
        cursor.execute(
            "SELECT pdf_file_path FROM windmill.eb_statements WHERE id=%s",
            (id,)
        )

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
        cursor.execute(
            "SELECT id, month, windmill_id, pdf_file_path, is_submitted FROM windmill.eb_statements WHERE id=%s",
            (id,)
        )
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
        cursor.execute("SELECT pdf_file_path FROM windmill.eb_statements WHERE id=%s", (id,))
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
        cursor.execute(
            "UPDATE windmill.eb_statements SET windmill_id=%s, month=%s, pdf_file_path=%s, modified_at=NOW() WHERE id=%s",
            (windmill_id, month, new_pdf_path, id)
        )
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
        cursor.execute("DELETE FROM windmill.eb_statements_details WHERE eb_header_id=%s", (payload.eb_header_id,))
        cursor.execute("DELETE FROM windmill.eb_statements_applicable_charges WHERE eb_header_id=%s", (payload.eb_header_id,))
        cursor.execute("DELETE FROM windmill.eb_statements_total_banking_units WHERE eb_header_id=%s", (payload.eb_header_id,))

        # 1. Insert into eb_statements_details for EACH slot (Net + Banking per slot)
        for slot_key, net_val_str in payload.slots.items():
            # Extract number from "C1", "C2", etc.
            slot_num_str = slot_key.replace("C", "")
            slot_id = int(slot_num_str) if slot_num_str.isdigit() else None
            
            net_val = float(net_val_str) if net_val_str else 0
            # Map corresponding banking slot value
            banking_val_str = payload.banking_slots.get(slot_key, "0")
            banking_val = float(banking_val_str) if banking_val_str else 0

            cursor.execute(
                """
                INSERT INTO windmill.eb_statements_details 
                (eb_header_id, company_name, windmill_id, slots, net_unit, banking_units, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
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
        cursor.execute(
            """
            INSERT INTO windmill.eb_statements_total_banking_units
            (eb_header_id, total_banking_units, created_by)
            VALUES (%s, %s, %s)
            """,
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
                    cursor.execute(
                        "SELECT id FROM masters.master_consumption_chargers "
                        "WHERE TRIM(LOWER(charge_description)) LIKE %s "
                        "LIMIT 1",
                        (f"%{charge_name_norm}%",)
                    )
                    res = cursor.fetchone()
                    if res:
                        charge_id = res[0]
                except Exception as ce:
                    print(f"Warning: Could not map charge description '{charge.name}': {ce}")

            # 2) Secondary: use code lookup if provided
            if not charge_id and charge_code_norm:
                try:
                    cursor.execute(
                        "SELECT id FROM masters.master_consumption_chargers "
                        "WHERE TRIM(LOWER(charge_code)) = %s "
                        "LIMIT 1",
                        (charge_code_norm,)
                    )
                    res = cursor.fetchone()
                    if res:
                        charge_id = res[0]
                except Exception as ce:
                    print(f"Warning: Could not map charge code '{charge.code}': {ce}")

            # 3) Fallback: match on charge name if still missing
            if not charge_id:
                try:
                    cursor.execute(
                        "SELECT id FROM masters.master_consumption_chargers "
                        "WHERE (TRIM(LOWER(charge_name)) LIKE %s OR TRIM(LOWER(charge_code)) LIKE %s) "
                        "LIMIT 1",
                        (
                            f"%{charge_name_norm}%",
                            f"%{charge_name_norm}%",
                        )
                    )
                    res = cursor.fetchone()
                    if res:
                        charge_id = res[0]
                except Exception as ce:
                    print(f"Warning: Could not map charge '{charge.name}': {ce}")

            if charge_id is None:
                print(f"Warning: charge_id not mapped for '{charge.name}' (code={getattr(charge, 'code', None)})")

            cursor.execute(
                """
                INSERT INTO windmill.eb_statements_applicable_charges 
                (eb_header_id, charge_id, total_charge, created_by)
                VALUES (%s, %s, %s, %s)
                """,
                (payload.eb_header_id, charge_id, charge.amount, user_id)
            )

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
    db_month = month_names.get(str(month), month)
    print(f"[EB Summary] Fetching for year={year}, month={db_month}")

    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()
    try:
        query = """
            SELECT 
                mw.windmill_number,
                d.slots AS slot,
                d.net_unit AS pp_units,
                d.banking_units AS bank_units
            FROM windmill.eb_statements es
            JOIN masters.master_windmill mw ON es.windmill_id = mw.id
            JOIN windmill.eb_statements_details d ON es.id = d.eb_header_id
            WHERE es.year = %s AND es.month = %s
        """
        cursor.execute(query, (year, db_month))
        rows = cursor.fetchall()
        print(f"[EB Summary] Found {len(rows)} detail rows")

        # Slot number to column key: 1->c1, 2->c2, 4->c4, 5->c5 (3 is skipped)
        slot_to_col = {1: "c1", 2: "c2", 4: "c4", 5: "c5"}

        # Build result map: windmill_number -> {c1_pp, c1_bank, c2_pp, ...}
        result_map = {}
        for row in rows:
            wm = str(row[0])          # windmill_number
            slot = int(row[1])        # slot number (1,2,3,4,5)
            pp_units = float(row[2]) if row[2] else 0.0
            bank_units = float(row[3]) if row[3] else 0.0

            if wm not in result_map:
                result_map[wm] = {}

            col = slot_to_col.get(slot)
            if col:
                result_map[wm][f"{col}_pp"] = pp_units
                result_map[wm][f"{col}_bank"] = bank_units

        print(f"[EB Summary] Result: {result_map}")

        return {
            "status": "success",
            "data": result_map
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[EB Summary] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()