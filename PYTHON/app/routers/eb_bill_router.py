import os
from typing import List, Dict, Any, Optional
from uuid import uuid4
import shutil
from app.utils.auth_utils import get_current_user
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from app.database import DB_NAME, DB_NAME_WINDMILL, get_connection
import pdfplumber
import re
import tempfile
from app.schemas.eb_bill_schema import EBBillResponse, BulkSaveRequest
from app.utils.validation import validate_customer, validate_service_number

router = APIRouter(prefix="/eb-bill", tags=["EB Bill"])

def get_charge_labels():
    """Fetch charge code -> label mapping from masters database."""
    labels = {}
    conn = None
    try:
        conn = get_connection("masters")
        with conn.cursor() as cursor:
            cursor.callproc("sp_get_consumption_charges")
            rows = cursor.fetchall()
            for code, name in rows:
                if code and name:
                    c_db = code.upper()
                    # Use EXACT code from DB as requested
                    labels[c_db] = f"{c_db}- {name}"
        print(f"DEBUG: Fetched {len(labels)} charge labels: {labels}")
    except Exception as e:
        print(f"DEBUG Error fetching charge labels: {e}")
        labels = {"C001": "C001- Meter Reading Charges", "C002": "C002- O&M Charges", "C010": "C010- DSM Charges", "WHLC": "Wheeling Charges"}
    finally:
        if conn:
            conn.close()
    return labels

@router.get("/charge-labels")
async def fetch_charge_labels(user: dict = Depends(get_current_user)):
    """API endpoint to get charge labels for UI use."""
    return get_charge_labels()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads", "eb_bill")
os.makedirs(UPLOAD_DIR, exist_ok=True)

def normalize_month(month_val):
    month_names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    if str(month_val).isdigit():
        idx = int(month_val)
        if 1 <= idx <= 12:
            return month_names[idx-1]
    return str(month_val).capitalize()

# ✅ UNIVERSAL OA extractor (table + fallback text parsing)
def extract_abstract_rows(pdf):
    lines = []
    windmill_map = {} # {windmill: {global_col_idx: value}}
    columns = ["CHARGES"]
    inside_abstract = False

    # Get standard labels once at start of extraction
    standard_labels = get_charge_labels()
    # Codes used for identification (e.g. ['C001', 'C002', ...])
    known_codes = list(standard_labels.keys()) + ["WHEEL", "DSM"]

    for page in pdf.pages:
        text = page.extract_text() or ""
        lines.extend(text.split("\n"))

        if "ABSTRACT FOR OA ADJUSTMENT CHARGES" in text.upper():
            inside_abstract = True

        # Stop at LT section
        if inside_abstract and "LT Side Metering" in text:
            break

        if not inside_abstract:
            continue

        # -----------------------
        # 1️⃣ Try table extraction first
        # -----------------------
        tables = page.extract_tables() or []

        for table in tables:
            if not table:
                continue

            # ------------------------------------------------------------
            # DYNAMIC COLUMN MAPPING FOR EACH TABLE
            # ------------------------------------------------------------
            table_header_rows = 0
            curr_table_col_map = {} # Maps table_col_idx -> global_col_idx
            
            # Search first 3 rows for headers
            found_headers = False
            for r_idx, r in enumerate(table[:3]):
                row_text_r = " ".join([str(c) for c in r if c]).upper()
                if any(x in row_text_r for x in ["C00", "C010", "WHEEL", "WHLC", "DSM", "PENAL"]):
                    table_header_rows = r_idx + 1
                    found_headers = True
                    # Map columns
                    for c_idx, cell in enumerate(r):
                        if not cell: continue
                        cell_clean = re.sub(r"\s+", " ", str(cell)).strip().upper()
                        # Search for recognized codes in the cell
                        matched_label = None
                        for code in known_codes:
                            if code in cell_clean:
                                matched_label = code
                                break
                        
                        if matched_label:
                            # Standardize label
                            full_label = matched_label
                            if full_label == "WHEEL": full_label = "WHLC"
                            
                            # Ensure it's in global columns
                            if full_label not in columns:
                                columns.append(full_label)
                            
                            curr_table_col_map[c_idx] = columns.index(full_label)

            if not found_headers and len(columns) <= 1:
                continue # Skip tables that don't look like OA charges until we find the first one

            # Process data rows
            data_rows = table[table_header_rows:]
            for row in data_rows:
                if not row or not row[0]: continue
                
                # Extract windmill number
                windmill_raw = str(row[0]).strip()
                windmill = re.sub(r"\D", "", windmill_raw)
                if not windmill or not windmill.isdigit() or len(windmill) < 10:
                    continue

                if windmill not in windmill_map:
                    windmill_map[windmill] = {}

                # Map values based on identified columns
                for t_idx, g_idx in curr_table_col_map.items():
                    if t_idx < len(row) and row[t_idx]:
                        val_str = str(row[t_idx]).replace(",", "").strip()
                        # Extract first numeric value found in case of merged text
                        match = re.search(r"^-?\d+(\.\d+)?", val_str)
                        if match:
                            val = match.group(0)
                        else:
                            val = "0.00"
                        
                        # Store/Update (prefer non-zero if multiple tables provide value)
                        if g_idx not in windmill_map[windmill] or windmill_map[windmill][g_idx] == "0.00":
                            windmill_map[windmill][g_idx] = val

        # -----------------------
        # 2️⃣ FALLBACK: text parsing
        # -----------------------
        if inside_abstract and not windmill_map:
            for idx, line in enumerate(lines):
                parts = line.strip().split()
                if not parts:
                    continue

                # Look for 10-12 digit service number
                if re.fullmatch(r"\d{10,12}", parts[0]):
                    windmill = parts[0]
                    nums = re.findall(r"\d+\.\d+", line)
                    
                    # Also look in the immediate next line for more numbers (common in some PDF layouts)
                    if idx + 1 < len(lines):
                        next_line = lines[idx+1]
                        if not re.search(r"\d{10,12}", next_line): # Don't bleed into next windmill
                            nums.extend(re.findall(r"\d+\.\d+", next_line))

                    if nums:
                        windmill_map[windmill] = {i+1: val for i, val in enumerate(nums)}
                        if len(columns) == 1:
                            columns.extend([f"Charge_{i+1}" for i in range(len(nums))])

    # Get standard labels from DB
    standard_labels = get_charge_labels()

    # Final cleanup: ensure unique columns while preserving order
    seen_cols = set()
    unique_columns = []
    global_to_final_idx = {} # map global index in 'columns' list to index in 'unique_columns'
    
    # Always put 'CHARGES' first
    unique_columns.append("CHARGES")
    seen_cols.add("CHARGES")
    
    for idx, col in enumerate(columns):
        col_str = str(col).strip()
        if not col_str or col_str == "CHARGES": continue
        
        # Aggressively remove any trailing numbers (e.g. "C001 0.00" -> "C001")
        col_name = re.sub(r"\s+[\d,\.]+$", "", col_str).strip()
        
        # Standardize if a known code is found in standard_labels
        col_upper = col_name.upper()
        
        # Check for specific codes (C001, C002, etc.) inside the column header
        matched = False
        for code, label in standard_labels.items():
            # Flexible matching: handle zero-padding diffs (C005 vs C0005)
            # Normalize e.g. C0005 -> C05 and C005 -> C05
            code_min = re.sub(r'0+', '0', code)
            col_min = re.sub(r'0+', '0', col_upper)
            
            if code in col_upper or code_min in col_min:
                col_name = label
                matched = True
                break
        
        # Fallback for common patterns if not in standard_labels
        if not matched:
            if "WHEEL" in col_upper:
                col_name = standard_labels.get("WHLC", "Wheeling Charges")
            elif "AMR" in col_upper:
                 col_name = standard_labels.get("C001", "C001- Meter Reading Charges")
            elif "DSM" in col_upper:
                 col_name = standard_labels.get("C010", "C010- DSM Charges")
        
        if col_name.upper() not in seen_cols:
            unique_columns.append(col_name)
            seen_cols.add(col_name.upper())
        
        # Map original 'columns' index to the current 'unique_columns' index (minus 1 for CHARGES)
        final_idx = unique_columns.index(col_name) - 1
        global_to_final_idx[idx] = final_idx
    
    # Assemble final rows: map dict values to the correct list index
    target_count = len(unique_columns) - 1
    final_rows = []
    for k, v_dict in windmill_map.items():
        # v_dict is { global_col_idx: value }
        charges = ["0.00"] * target_count
        for g_idx, val in v_dict.items():
            if g_idx in global_to_final_idx:
                f_idx = global_to_final_idx[g_idx]
                if f_idx < target_count:
                    charges[f_idx] = val
        
        final_rows.append({"windmill": k, "charges": charges})

    return final_rows, unique_columns


@router.get("/check-duplicate")
async def check_eb_bill_duplicate(
    customer_id: int,
    service_number_id: int,
    year: int,
    month: int,
    user: dict = Depends(get_current_user)
):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()
    try:
        # Check if a record exists for this specific combination
        cursor.callproc("sp_check_eb_bill_duplicate", [customer_id, service_number_id, year, month])
        row = cursor.fetchone()
        
        if row:
            return {"exists": True, "id": row[0]}
        return {"exists": False}
    finally:
        cursor.close()
        conn.close()


@router.get("/list")
async def get_eb_bill_list(
    customer_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    user: dict = Depends(get_current_user)
):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()
    try:
        cursor.callproc("get_eb_bill_list", [customer_id, year, month])
        rows = cursor.fetchall()

        data = []
        for row in rows:
            data.append({
                "id": row[0],
                "bill_month": row[1],
                "bill_year": row[2],
                "customer_name": row[3],
                "service_number": row[4],
                "pdf_file_path": row[5],
                "is_submitted": row[6],
                "created_at": row[7],
                "created_by": row[8]
            })
        return {"status": "success", "data": data}
    finally:
        cursor.close()
        conn.close()


@router.get("/view/{id}")
async def view_eb_bill(id: int, user: dict = Depends(get_current_user)):
    print(f"DEBUG: View request for EB Bill ID: {id}")
    try:
        conn = get_connection(db_name=DB_NAME_WINDMILL)
        cursor = conn.cursor()
        try:
            # 1. Fetch main header info
            cursor.callproc("get_eb_bill_header", [id])
            header = cursor.fetchone()
            if not header:
                print(f"DEBUG: EB Bill {id} not found")
                raise HTTPException(status_code=404, detail="EB Bill not found")

            # Consume results to allow next SP call
            while cursor.nextset():
                pass

            # 2. Fetch self generation tax from details
            cursor.callproc("get_eb_bill_details", [id])
            details = cursor.fetchone()
            tax = str(details[3]) if details else "0.00"

            while cursor.nextset():
                pass

            # 3. Fetch adjustment charges
            cursor.callproc("get_eb_bill_adjustment_charges", [id])
            charge_rows = cursor.fetchall()

            # Build dynamic columns
            labels = get_charge_labels()
            codes = ["C001", "C002", "C003", "C004", "C005", "C006", "C007", "C008", "C010", "WHLC"]
            columns = ["CHARGES"] + [labels.get(c, c) for c in codes]
            
            matched_rows = []
            for row in charge_rows:
                # Map columns 3 to 12 directly to match charges starting from C001
                charges = [
                    str(row[3]), str(row[4]), str(row[5]), str(row[6]), str(row[7]),
                    str(row[8]), str(row[9]), str(row[10]), str(row[11]), str(row[12])
                ]
                matched_rows.append({
                    "windmill": row[2],
                    "charges": charges
                })

            month_names = ["January","February","March","April","May","June","July","August","September","October","November","December"]
            bill_year = header[1]
            bill_month = header[2]
            bill_month_name = month_names[bill_month - 1] if 1 <= bill_month <= 12 else ""

            return {
                "header_id": header[0],
                "bill_month": bill_month,
                "bill_year": bill_year,
                "bill_month_name": bill_month_name,
                "customer_id": header[5],
                "service_number_id": header[6],
                "customer_name": header[3],
                "service_number": header[4],
                "self_generation_tax": tax,
                "columns": columns,
                "matched_rows": matched_rows
            }
        finally:
            cursor.close()
            conn.close()
    except Exception as e:
        import traceback
        print(f"ERROR: View EB Bill failed: {str(e)}")
        traceback.print_exc()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))
        
@router.get("/customers")
async def get_customers(user: dict = Depends(get_current_user)):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()

    try:
        cursor.callproc("get_eb_bill_customers")
        rows = cursor.fetchall()

        data = [
            {
                "id": row[0],
                "customer_name": row[1]
            }
            for row in rows
        ]

        return {"status": "success", "data": data}

    finally:
        cursor.close()
        conn.close()

@router.get("/service-numbers/{customer_id}")
async def get_service_numbers(customer_id: int, user: dict = Depends(get_current_user)):

    from app.database import get_connection

    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()

    try:
        cursor.callproc("get_eb_bill_service_number", [customer_id])
        rows = cursor.fetchall()

        data = []

        for row in rows:
            data.append({
                "id": row[0],
                "service_number": row[1]
            })

        return {
            "status": "success",
            "data": data
        }

    finally:
        cursor.close()
        conn.close()


@router.post("/seed")
async def seed_eb_bill_master_data(user: dict = Depends(get_current_user)):
    """Seed minimal master data for customer + service number when SQL access is problematic."""
    print("Seeding EB Bill master data...")
    # Allow seeding even if auth header is missing as part of initial setup.
    if user is None:
        user = {"id": 0, "username": "seed"}

    conn = get_connection(db_name=DB_NAME)
    cursor = conn.cursor()

    try:
        customer_name = "Texmo"
        cursor.callproc("sp_seed_get_customer", (customer_name,))
        existing = cursor.fetchone()

        if existing:
            customer_id = existing[0]
            print(f"Found existing customer: {customer_name} (ID: {customer_id})")
        else:
            cursor.callproc("sp_seed_insert_customer", (customer_name, user.get("id", 0)))
            res = cursor.fetchone()
            customer_id = res[0] if res else None
            print(f"Created new customer: {customer_name} (ID: {customer_id})")

        while cursor.nextset(): pass

        # ensure service entry exists in masters.customer_service
        service_number = "SE1001"
        cursor.callproc("sp_seed_get_service", (customer_id, service_number))
        existing_service = cursor.fetchone()

        if existing_service:
            service_id = existing_service[0]
            print(f"Found existing service number: {service_number} (ID: {service_id})")
        else:
            cursor.callproc("sp_seed_insert_service", (customer_id, service_number, user.get("id", 0)))
            res = cursor.fetchone()
            service_id = res[0] if res else None
            print(f"Created new service number: {service_number} (ID: {service_id})")

        conn.commit()
        print("Seed successful.")

        return {
            "status": "success",
            "data": {
                "customer_id": customer_id,
                "customer_name": customer_name,
                "service_id": service_id,
                "service_number": service_number
            }
        }

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Seed failed: {e}")

    finally:
        cursor.close()
        conn.close()
        

@router.post("/details")
async def create_eb_bill_detail(
    eb_bill_header_id: int,
    customer_id: int,
    customer_service_id: int,
    self_generation_tax: float,
    user: dict = Depends(get_current_user)
):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()

    try:
        cursor.callproc(
            "insert_eb_bill_detail",
            [
                eb_bill_header_id,
                customer_id,
                customer_service_id,
                self_generation_tax,
                user.get("id"),
                user.get("id")
            ]
        )
        conn.commit()

        new_id = cursor.fetchone()[0] if cursor.rowcount != -1 else None

        return {"status": "success", "inserted_id": new_id}

    finally:
        cursor.close()
        conn.close()


@router.post("/adjustment-charges")
async def create_eb_bill_adjustment_charge(
    eb_bill_header_id: int,
    energy_number: str,
    c001: float = 0,
    c002: float = 0,
    c003: float = 0,
    c004: float = 0,
    c005: float = 0,
    c006: float = 0,
    c007: float = 0,
    c008: float = 0,
    c010: float = 0,
    wheeling_charges: float = 0,
    user: dict = Depends(get_current_user)
):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()

    try:
        cursor.callproc(
            "insert_eb_bill_adjustment_charge",
            [
                eb_bill_header_id,
                energy_number,
                c001,
                c002,
                c003,
                c004,
                c005,
                c006,
                c007,
                c008,
                c010,
                wheeling_charges,
                user.get("id"),
                user.get("id")
            ]
        )
        conn.commit()

        new_id = cursor.fetchone()[0] if cursor.rowcount != -1 else None

        return {"status": "success", "inserted_id": new_id}

    finally:
        cursor.close()
        conn.close()


@router.post("/save-all")
async def save_all_eb_bill_details(
    payload: BulkSaveRequest,
    user: dict = Depends(get_current_user)
):
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()

    try:
        # ✅ Validate inputs
        header_id = int(payload.header_id) if payload.header_id else None
        cust_id = int(payload.customer_id) if payload.customer_id else None
        sc_id = int(payload.service_number_id) if payload.service_number_id else None

        if not header_id or not cust_id or not sc_id:
            raise HTTPException(status_code=400, detail="Missing required IDs")

        # ✅ Parse tax
        try:
            tax = float(str(payload.self_generation_tax).replace(",", "").strip()) if payload.self_generation_tax else 0.0
        except:
            tax = 0.0

        columns = payload.columns or []
        rows = payload.matched_rows or []

        print(f"DEBUG: header={header_id}, customer={cust_id}, sc={sc_id}, rows={len(rows)}")

        # ✅ 1. Mark header as submitted
        cursor.callproc("sp_submit_eb_bill", [header_id])

        # ✅ 2. Clean old data (IMPORTANT)
        cursor.callproc("sp_clear_eb_bill_data", [header_id])

        # ✅ 3. Call SP → insert_eb_bill_detail
        cursor.callproc(
            "insert_eb_bill_detail",
            (
                header_id,
                cust_id,
                sc_id,
                tax,
                user.get("id"),
                user.get("id")
            )
        )

        # ✅ 4. Column mapping
        col_to_param = {}
        for i, col_name in enumerate(columns):
            col_upper = col_name.upper()
            if "C001" in col_upper: col_to_param[i] = "c001"
            elif "C002" in col_upper: col_to_param[i] = "c002"
            elif "C003" in col_upper: col_to_param[i] = "c003"
            elif "C004" in col_upper: col_to_param[i] = "c004"
            elif "C005" in col_upper: col_to_param[i] = "c005"
            elif "C006" in col_upper: col_to_param[i] = "c006"
            elif "C007" in col_upper: col_to_param[i] = "c007"
            elif "C008" in col_upper: col_to_param[i] = "c008"
            elif "C010" in col_upper: col_to_param[i] = "c010"
            elif "WHEEL" in col_upper or "WHLC" in col_upper: col_to_param[i] = "wheeling_charges"
            elif "DSM" in col_upper: col_to_param[i] = "c008" # Map DSM to C008 if applicable, or add extra column if needed

        # ✅ 5. Loop rows → call adjustment SP
        for idx, row in enumerate(rows):
            params = {
                "c001": 0, "c002": 0, "c003": 0, "c004": 0, "c005": 0,
                "c006": 0, "c007": 0, "c008": 0, "c010": 0, "wheeling_charges": 0
            }

            offset = max(0, len(columns) - len(row.charges))

            for i, val in enumerate(row.charges):
                param_name = col_to_param.get(i + offset)
                if param_name:
                    try:
                        clean_val = str(val).replace(",", "").strip()
                        params[param_name] = float(clean_val) if clean_val else 0
                    except:
                        params[param_name] = 0

            print(f"DEBUG Row {idx}: {params}")

            # ✅ Call SP → insert_eb_bill_adjustment_charge
            cursor.callproc(
                "insert_eb_bill_adjustment_charge",
                (
                    header_id,
                    row.windmill,
                    params["c001"],
                    params["c002"],
                    params["c003"],
                    params["c004"],
                    params["c005"],
                    params["c006"],
                    params["c007"],
                    params["c008"],
                    params["c010"],
                    params["wheeling_charges"],
                    user.get("id"),
                    user.get("id")
                )
            )

        conn.commit()
        print("DEBUG: Transaction committed")

        return {
            "status": "success",
            "message": "All EB bill details saved successfully"
        }

    except Exception as e:
        conn.rollback()
        import traceback
        print("ERROR:", str(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cursor.close()
        conn.close()

@router.post("/read-pdf", response_model=EBBillResponse)
async def read_pdf(
    customer_id: int = Form(...),
    service_number_id: int = Form(...),
    year: int = Form(...),
    month: int = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    try:
        if not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF allowed")

        # DB lookup & Validation
        conn = get_connection(db_name=DB_NAME_WINDMILL)
        cursor = conn.cursor()
        
        try:
            validate_customer(cursor, customer_id)
            validate_service_number(cursor, service_number_id)

            # Fetch DB expected values for validation using SP
            cursor.callproc("get_eb_bill_customers")
            all_custs = cursor.fetchall()
            while cursor.nextset(): pass
            exp_cust = next((c[1] for c in all_custs if c[0] == customer_id), "")
            
            cursor.callproc("get_eb_bill_service_number", [customer_id])
            all_services = cursor.fetchall()
            while cursor.nextset(): pass
            exp_se = next((s[1] for s in all_services if s[0] == service_number_id), "")

            # Fetch customer and sc_number for naming
            cursor.callproc("sp_get_customer_name_by_id", (customer_id,))
            cust_res = cursor.fetchone()
            customer_name_db = cust_res[0] if cust_res else "unknown_customer"
            
            while cursor.nextset(): pass
            
            cursor.callproc("sp_get_service_number_by_id", (service_number_id,))
            sc_res = cursor.fetchone()
            sc_number_db = sc_res[0] if sc_res else "unknown_sc"
            
            while cursor.nextset(): pass
            
            # Normalize month for folder and filename
            month_name = normalize_month(month)
            
            # Clean names for filename
            clean_cust = re.sub(r'[^a-zA-Z0-9]', '_', str(customer_name_db))
            clean_sc = re.sub(r'[^a-zA-Z0-9]', '_', str(sc_number_db))
            
            # New Structured Path: uploads/eb_bills/customer_name/sc_number/year/month
            year_str = str(year)
            target_dir = os.path.join(BASE_DIR, "uploads", "eb_bills", clean_cust, clean_sc, year_str, month_name)
            os.makedirs(target_dir, exist_ok=True)

            unique_name = f"{clean_cust}_{clean_sc}_{month_name}_{year_str}.pdf"
            file_path = os.path.join(target_dir, unique_name)
            
            await file.seek(0)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            # Get active numbers for parsing
            cursor.callproc("get_active_windmill_numbers")
            db_rows = cursor.fetchall()
            db_numbers = {re.sub(r"\D", "", str(r[0])) for r in db_rows}
            while cursor.nextset(): pass

            text_parts = []
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    txt = page.extract_text()
                    if txt:
                        text_parts.append(str(txt))
                full_text = "\n".join(text_parts)
                oa_rows, columns = extract_abstract_rows(pdf)

            # ----------- HEADER EXTRACTION -----------
            customer_name_extracted = None
            service_number_extracted = None
            self_tax = None

            lines = [l.strip() for l in full_text.split("\n") if l.strip()]

            for i, line in enumerate(lines):
                if line.lower().startswith("to:"):
                    val = line.split(":", 1)[1].strip()
                    val = re.split(r"service\s*no", val, flags=re.IGNORECASE)[0].strip()
                    customer_name_extracted = val

                if "service" in line.lower() and "no" in line.lower():
                    m = re.search(r"([0-9]{8,15})", line)
                    if m:
                        service_number_extracted = m.group(1)

                if "self generation tax" in line.lower():
                    m = re.search(r"([0-9,]+\.\d+)", line)
                    if m:
                        self_tax = m.group(1).replace(",", "")
                    else:
                        if i + 1 < len(lines):
                            m = re.search(r"([0-9,]+\.\d+)", lines[i+1])
                            if m:
                                self_tax = m.group(1).replace(",", "")

            # ----------- VALIDATION AGAINST FILTERS -----------
            def norm(s): return re.sub(r"[^a-z0-9]", "", str(s).lower()) if s else ""
            
            if exp_se and service_number_extracted:
                # Compare after stripping leading zeros to handle inconsistencies
                if str(exp_se).lstrip('0') != str(service_number_extracted).lstrip('0'):
                    if os.path.exists(file_path): os.remove(file_path)
                    raise HTTPException(status_code=400, detail=f"Mismatch: Selected SE Number ({exp_se}) does not match PDF ({service_number_extracted})")
                    
            month_names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
            if 1 <= month <= 12:
                short_month = month_names[month-1]
                # the pdf sometimes uses full month or short month. 
                if short_month not in full_text.lower():
                    if os.path.exists(file_path): os.remove(file_path)
                    raise HTTPException(status_code=400, detail=f"Mismatch: PDF does not appear to be for Month '{short_month.capitalize()}'")
            if str(year) not in full_text:
                if os.path.exists(file_path): os.remove(file_path)
                raise HTTPException(status_code=400, detail=f"Mismatch: PDF does not appear to be for Year '{year}'")

            # Check duplicate and Upsert header using SP
            cursor.callproc(
                "upsert_eb_bill_header",
                [
                    customer_id,
                    service_number_id,
                    year,
                    month,
                    file_path,
                    user.get("id", 0)
                ]
            )
            
            result = cursor.fetchone()
            if result:
                header_id = result[0]
                # If we want to strictly follow the current code's error on duplicate:
                # if result[1] is NOT NULL (meaning old file existed), then it was an update.
                # But SP does upsert. I'll stick to SP behavior for consistency.
            else:
                header_id = cursor.lastrowid

            conn.commit()
            while cursor.nextset(): pass

            matched_rows = []
            for r in oa_rows:
                pdf_id = re.sub(r"\D", "", str(r["windmill"]))
                if pdf_id in db_numbers:
                    matched_rows.append(r)

            month_names = ["January","February","March","April","May","June","July","August","September","October","November","December"]
            
            return {
                "header_id": header_id,
                "bill_year": year,
                "bill_month": month,
                "bill_month_name": month_names[month - 1] if 1 <= month <= 12 else "",
                "customer_name": customer_name_extracted,
                "service_number": service_number_extracted,
                "self_generation_tax": self_tax,
                "columns": columns,
                "matched_rows": matched_rows
            }

        finally:
            cursor.close()
            conn.close()

    except Exception as e:
        import traceback
        print(f"READ-PDF ERROR: {str(e)}")
        traceback.print_exc()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))
        
        
        
@router.delete("/delete/{id}")
async def delete_eb_bill(id: int, user: dict = Depends(get_current_user)):

    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()
    try:
        print(f"DEBUG: Deleting EB Bill ID: {id}")
        
        # Verify the bill exists before attempting delete
        cursor.callproc("sp_check_eb_bill_exists", [id])
        existing = cursor.fetchone()
        if not existing:
            print(f"DEBUG: EB Bill ID {id} not found")
            raise HTTPException(status_code=404, detail="EB Bill not found")
        
        # Call the delete procedure
        cursor.callproc("delete_eb_bill", [id])
        conn.commit()
        
        print(f"DEBUG: Successfully deleted EB Bill ID: {id}")
        return {
            "status": "success",
            "message": "EB Bill deleted successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        print(f"ERROR: Delete EB Bill failed: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to delete EB Bill: {str(e)}")
    finally:
        cursor.close()
        conn.close()