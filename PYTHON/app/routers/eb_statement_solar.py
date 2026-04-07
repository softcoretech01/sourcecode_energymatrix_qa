from app.utils.auth_utils import get_current_user
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Query, Response
from typing import Optional, List
import os
import shutil
import calendar
import re
from uuid import uuid4
from app.schemas.eb_solar_schema import (
    EBSolarUploadResponse,
    EBSolarReadResponse,
    EBSolarRecord,
    EBSolarListResponse,
    EBSolarSaveRequest
)
from app.database import get_connection, DB_NAME_WINDMILL
from app.routers.eb_statement_upload import extract_eb_statement_data
import csv
import io

router = APIRouter(prefix="/eb-solar", tags=["EB Statement Solar"]) 

# Use same uploads/eb_statements folder (creates subfolder 'solar')
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
# For legacy fallbacks
UPLOAD_DIR_LEGACY = os.path.join(BASE_DIR, "uploads", "eb_statements")

def normalize_month(month_val):
    month_names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    if str(month_val).isdigit():
        idx = int(month_val)
        if 1 <= idx <= 12:
            return month_names[idx-1]
    return str(month_val).capitalize()

def get_solar_number(cursor, solar_id):
    if not solar_id:
        return "solar"
    try:
        if str(solar_id).isdigit():
            cursor.execute("SELECT windmill_number FROM masters.master_windmill WHERE id=%s", (int(solar_id),))
        else:
            cursor.execute("SELECT windmill_number FROM masters.master_windmill WHERE windmill_number=%s", (solar_id,))
        row = cursor.fetchone()
        return row[0] if row else str(solar_id)
    except Exception:
        return str(solar_id)


def _normalize_month_value(month_value):
    if month_value is None:
        return None

    if isinstance(month_value, int):
        if 1 <= month_value <= 12:
            return calendar.month_name[month_value]
        return str(month_value)

    if isinstance(month_value, str):
        normalized = month_value.strip()
        if normalized.isdigit():
            num = int(normalized)
            if 1 <= num <= 12:
                return calendar.month_name[num]
            return normalized

        normalized_title = normalized.capitalize()
        if normalized_title in calendar.month_name:
            return normalized_title

        if normalized_title in calendar.month_abbr:
            idx = list(calendar.month_abbr).index(normalized_title)
            if idx > 0:
                return calendar.month_name[idx]
        return normalized

    return str(month_value)


@router.post("/upload", response_model=EBSolarUploadResponse)
async def upload_eb_statement_solar(
    solar_id: str = Form(...),
    month: str = Form(...),
    year: Optional[int] = Form(None),
    file: UploadFile = File(...)
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files allowed")

    # Check for duplicate upload (same solar_id, month, and year)
    conn = get_connection(db_name="solar")
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT id FROM solar.eb_statement_solar 
            WHERE solar_id=%s AND month=%s AND year=%s
            """,
            (solar_id, month, year)
        )
        existing_record = cursor.fetchone()
        if existing_record:
            raise HTTPException(
                status_code=409, 
                detail=f"EB Statement (solar) for this ID already exists for {month} {year}. Please delete the existing record first if you want to re-upload."
            )
    finally:
        cursor.close()
        conn.close()

    # Get Solar Number for naming
    cursor = conn.cursor()
    solar_num = get_solar_number(cursor, solar_id)
    cursor.close()

    # Normalize month
    month_name = normalize_month(month)
    year_str = str(year) if year else str(__import__('datetime').datetime.now().year)
    
    # New Structured Path: uploads/eb_statements_solar/year/month
    target_dir = os.path.join(BASE_DIR, "uploads", "eb_statements_solar", year_str, month_name)
    os.makedirs(target_dir, exist_ok=True)

    # Filename: solar_number_month_year.pdf
    clean_solar = re.sub(r'[^a-zA-Z0-9]', '_', solar_num)
    unique_name = f"{clean_solar}_{month_name}_{year_str}.pdf"
    file_path = os.path.join(target_dir, unique_name)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Store file path in DB
    # Use direct INSERT instead of SP to ensure only the header is created.
    # This prevents premature saving of detail values.
    header_id = None
    conn = get_connection(db_name="solar")
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO solar.eb_statement_solar (solar_id, month, year, pdf_file_path, is_submitted, created_by) VALUES (%s, %s, %s, %s, %s, %s)",
            (int(solar_id) if solar_id and str(solar_id).isdigit() else solar_id, month, year, file_path, 0, 1),
        )
        conn.commit()
        header_id = cursor.lastrowid
        
        try:
            # Ensure year column exists before updating
            cursor.execute("SHOW COLUMNS FROM solar.eb_statement_solar LIKE 'year'")
            if not cursor.fetchone():
                cursor.execute("ALTER TABLE solar.eb_statement_solar ADD COLUMN year INT NULL")
                conn.commit()
            cursor.execute("UPDATE solar.eb_statement_solar SET year=%s WHERE id=%s", (year, header_id))
            conn.commit()
        except Exception as year_update_exc:
            print("Failed to update year on EB solar upload:", year_update_exc)

    except Exception as direct_exc:
        print("Failed to insert solar.eb_statement_solar directly:", direct_exc)
        raise HTTPException(status_code=500, detail="Failed to create header record")
    finally:
        cursor.close()
        conn.close()

    # Parse and validate PDF data
    try:
        parsed_data = extract_eb_statement_data(file_path, solar_num, year, month)
        if isinstance(parsed_data, dict) and parsed_data.get("error"):
            raise Exception(parsed_data["error"])
    except Exception as pe:
        # cleanup physical file
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass
        # cleanup DB record
        if header_id:
            try:
                conn = get_connection(db_name="solar")
                cur = conn.cursor()
                cur.execute("DELETE FROM solar.eb_statement_solar WHERE id=%s", (header_id,))
                conn.commit()
                cur.close()
                conn.close()
            except:
                pass
        raise HTTPException(status_code=400, detail=str(pe))

    return {
        "message": "EB Statement (solar) uploaded and header created", 
        "filename": unique_name,
        "header_id": header_id,
        "parsed": parsed_data
    }


@router.get("/windmills")
async def get_solar_windmill_numbers():
    """Return available solar windmill numbers from masters.master_windmill (posted only)."""
    conn = get_connection(db_name=DB_NAME_WINDMILL)
    cursor = conn.cursor()

    try:
        # Filter by type = 'Solar' and posted status to show only active records
        cursor.execute("SELECT id, windmill_number FROM masters.master_windmill WHERE LOWER(type) = 'solar' AND is_submitted = 1 ORDER BY windmill_number")
        rows = cursor.fetchall()
        data = [
            {"id": row[0], "solar_number": row[1]}
            for row in rows
        ]
        return {"status": "success", "data": data}
    finally:
        cursor.close()
        conn.close()


# --------------------------------------------------
# Search / list endpoint for EB solar statements
# --------------------------------------------------
@router.get("/", response_model=EBSolarListResponse)
def list_eb_solar(
    solar_id: Optional[str] = Query(None),
    solar_number: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Legacy/compatibility root route for EB solar listing (keeps frontend using /eb-solar until updated)."""
    return search_eb_solar(
        solar_id=solar_id,
        solar_number=solar_number,
        year=year,
        month=month,
        status=status,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )


@router.get("/search", response_model=EBSolarListResponse)
def search_eb_solar(
    solar_id: Optional[str] = Query(None),
    solar_number: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Search using direct query from solar database.
    This is EB Statement Solar logic and should be isolated from windmill EB statements.
    """
    conn = get_connection(db_name="solar")
    cursor = conn.cursor()

    def _normalize_month_value(month_value):
        if month_value is None:
            return None

        if isinstance(month_value, int):
            if 1 <= month_value <= 12:
                return calendar.month_name[month_value]
            return str(month_value)

        if isinstance(month_value, str):
            normalized = month_value.strip()
            if normalized.isdigit():
                num = int(normalized)
                if 1 <= num <= 12:
                    return calendar.month_name[num]
                return normalized

            normalized_title = normalized.capitalize()
            if normalized_title in calendar.month_name:
                return normalized_title
            # Accept abbreviated month names (Jan, Feb, ...)
            if normalized_title in calendar.month_abbr:
                idx = list(calendar.month_abbr).index(normalized_title)
                if idx > 0:
                    return calendar.month_name[idx]
            return normalized

        return str(month_value)

    def fallback_query():
        # Resolve solar_number to solar_id if provided to allow server-side filtering
        nonlocal solar_id
        if solar_number:
            try:
                wm_conn = get_connection(db_name=DB_NAME_WINDMILL)
                wm_cur = wm_conn.cursor()
                wm_cur.execute("SELECT id FROM masters.master_windmill WHERE windmill_number = %s", (solar_number,))
                wm_row = wm_cur.fetchone()
                if wm_row:
                    solar_id = wm_row[0]
                wm_cur.close()
                wm_conn.close()
            except Exception as wm_exc:
                print(f"Warning: Could not resolve solar_number to id: {wm_exc}")

        # Detect if a year column exists on eb_statement_solar (for historical/year filtering)
        year_column_exists = False
        try:
            cursor.execute("SHOW COLUMNS FROM eb_statement_solar LIKE 'year'")
            year_column_exists = cursor.fetchone() is not None
        except Exception:
            year_column_exists = False

        conditions = []
        params = []

        if solar_id:
            conditions.append("solar_id = %s")
            params.append(solar_id)

        if year is not None:
            try:
                year_int = int(year)
                if year_column_exists:
                    conditions.append("(year = %s OR YEAR(created_at) = %s)")
                    params.extend([year_int, year_int])
                else:
                    conditions.append("YEAR(created_at) = %s")
                    params.append(year_int)
            except (ValueError, TypeError):
                pass

        if month is not None:
            try:
                month_int = int(month)
            except (ValueError, TypeError):
                month_int = None

            if month_int and 1 <= month_int <= 12:
                month_name = calendar.month_name[month_int]
                conditions.append("(month = %s OR month = %s)")
                params.extend([month_int, month_name])
            else:
                conditions.append("month = %s")
                params.append(month)

        if status:
            status_text = status.lower() if isinstance(status, str) else ""
            conditions.append("is_submitted = %s")
            params.append(1 if status_text in ["posted", "submitted", "saved"] else 0)

        if keyword:
            conditions.append("pdf_file_path LIKE %s")
            kw = f"%{keyword}%"
            params.append(kw)

        where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""

        count_sql = f"SELECT COUNT(*) FROM eb_statement_solar{where_clause}"
        cursor.execute(count_sql, tuple(params))
        count_row = cursor.fetchone()
        total = int(count_row[0]) if count_row and len(count_row) > 0 else 0

        query_sql = (
            f"SELECT DISTINCT es.id, es.solar_id, es.month, es.year, es.pdf_file_path, es.is_submitted, "
            f"COALESCE(es.modified_at, es.created_at) as submitted_time, u.name as submitted_by "
            f"FROM eb_statement_solar es "
            f"LEFT JOIN masters.users u ON es.created_by = u.id "
            f"{where_clause} ORDER BY submitted_time DESC LIMIT %s OFFSET %s"
        )
        cursor.execute(query_sql, tuple(params + [limit, offset]))
        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]
        items = [dict(zip(columns, row)) for row in rows]

        # Get solar numbers separately from windmill database
        solar_ids = [item.get('solar_id') for item in items if item.get('solar_id')]
        solar_map = {}
        if solar_ids:
            try:
                windmill_conn = get_connection(db_name=DB_NAME_WINDMILL)
                wm_cursor = windmill_conn.cursor()
                placeholders = ",".join(["%s"] * len(solar_ids))
                wm_cursor.execute(f"SELECT id, windmill_number FROM masters.master_windmill WHERE id IN ({placeholders})", solar_ids)
                for row in wm_cursor.fetchall():
                    solar_map[row[0]] = row[1]
                wm_cursor.close()
                windmill_conn.close()
            except Exception as e:
                print(f"Warning: Could not fetch solar numbers: {e}")
        
        # Add solar_number to items
        for item in items:
            item["solar_number"] = solar_map.get(item.get('solar_id'), item.get('solar_id'))
            item["month"] = _normalize_month_value(item.get("month"))
            
            # Handle datetime and numeric fields to avoid Pydantic validation errors (str expected)
            if "submitted_time" in item and item["submitted_time"]:
                s_dt = item["submitted_time"]
                if hasattr(s_dt, "strftime"):
                    item["submitted_time"] = s_dt.strftime("%Y-%m-%d %H:%M:%S")
                else:
                    item["submitted_time"] = str(s_dt)
            
            if "submitted_by" in item and item["submitted_by"] is not None:
                item["submitted_by"] = str(item["submitted_by"])

            if "year" not in item or item.get("year") is None:
                s_time = item.get("submitted_time")
                if s_time is not None:
                    try:
                        if isinstance(s_time, str):
                            item["year"] = int(s_time.split("-")[0])
                        else:
                            item["year"] = int(s_time.year)
                    except Exception:
                        item["year"] = None
        
        return {"total": total, "items": items}

    try:
        # Run direct SQL query; avoid stored procedure dependency that may fail in some DB setups.
        return fallback_query()
    except Exception as exc:
        import traceback
        traceback_str = traceback.format_exc()
        print("EB solar search error:\n", traceback_str)
        raise HTTPException(status_code=500, detail="EB solar search error: " + str(exc))
    finally:
        cursor.close()
        conn.close()


# --------------------------------------------------
# All entries endpoint for EB solar statements (unfiltered)
# --------------------------------------------------
@router.get("/all", response_model=EBSolarListResponse)
def get_all_eb_solar(
    limit: int = Query(1000, ge=1, le=10000),
    offset: int = Query(0, ge=0),
):
    conn = get_connection(db_name="solar")
    cursor = conn.cursor()

    def _normalize_month_value(month_value):
        if month_value is None:
            return None
        if isinstance(month_value, int):
            if 1 <= month_value <= 12:
                return calendar.month_name[month_value]
            return str(month_value)
        if isinstance(month_value, str):
            normalized = month_value.strip()
            if normalized.isdigit():
                num = int(normalized)
                if 1 <= num <= 12:
                    return calendar.month_name[num]
                return normalized
            normalized_title = normalized.capitalize()
            if normalized_title in calendar.month_name:
                return normalized_title
            if normalized_title in calendar.month_abbr:
                idx = list(calendar.month_abbr).index(normalized_title)
                if idx > 0:
                    return calendar.month_name[idx]
            return normalized
        return str(month_value)

    try:
        cursor.execute("SELECT COUNT(*) FROM eb_statement_solar")
        count_row = cursor.fetchone()
        total = int(count_row[0]) if count_row and len(count_row) > 0 else 0

        cursor.execute(
            "SELECT DISTINCT es.id, es.solar_id, es.month, es.year, es.pdf_file_path, es.is_submitted, "
            "COALESCE(es.modified_at, es.created_at) as submitted_time, u.name as submitted_by "
            "FROM eb_statement_solar es "
            "LEFT JOIN masters.users u ON es.created_by = u.id "
            "ORDER BY submitted_time DESC LIMIT %s OFFSET %s",
            (limit, offset),
        )
        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        items = [dict(zip(columns, row)) for row in rows]

        # Get solar numbers separately
        solar_ids = [item.get('solar_id') for item in items if item.get('solar_id')]
        solar_map = {}
        if solar_ids:
            try:
                windmill_conn = get_connection(db_name=DB_NAME_WINDMILL)
                wm_cursor = windmill_conn.cursor()
                placeholders = ",".join(["%s"] * len(solar_ids))
                wm_cursor.execute(f"SELECT id, windmill_number FROM masters.master_windmill WHERE id IN ({placeholders})", solar_ids)
                for row in wm_cursor.fetchall():
                    solar_map[row[0]] = row[1]
                wm_cursor.close()
                windmill_conn.close()
            except Exception as e:
                print(f"Warning: Could not fetch solar numbers: {e}")
        
        # Add solar_number to items
        for item in items:
            item["solar_number"] = solar_map.get(item.get('solar_id'), item.get('solar_id'))

        for item in items:
            item["month"] = _normalize_month_value(item.get("month"))
            
            # Handle datetime and numeric fields to avoid Pydantic validation errors (str expected)
            if "submitted_time" in item and item["submitted_time"]:
                s_dt = item["submitted_time"]
                if hasattr(s_dt, "strftime"):
                    item["submitted_time"] = s_dt.strftime("%Y-%m-%d %H:%M:%S")
                else:
                    item["submitted_time"] = str(s_dt)
            
            if "submitted_by" in item and item["submitted_by"] is not None:
                item["submitted_by"] = str(item["submitted_by"])

            if "year" not in item or item.get("year") is None:
                s_time = item.get("submitted_time")
                if s_time is not None:
                    try:
                        if isinstance(s_time, str):
                            item["year"] = int(s_time.split("-")[0])
                        else:
                            item["year"] = int(s_time.year)
                    except Exception:
                        item["year"] = None

        return {"total": total, "items": items}
    except Exception as exc:
        import traceback
        traceback_str = traceback.format_exc()
        print("EB solar all error:\n", traceback_str)
        raise HTTPException(status_code=500, detail="EB solar all error: " + str(exc))
    finally:
        cursor.close()
        conn.close()


@router.get("/details/{eb_header_id}")
async def get_eb_statement_solar_details(eb_header_id: int):
    conn = get_connection(db_name="solar")
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT id, company_name, solar_id, slots, net_unit FROM solar.eb_statement_solar_details WHERE eb_header_id=%s",
            (eb_header_id,),
        )
        detail_rows = cursor.fetchall()
        details = [
            {
                "id": row[0],
                "company_name": row[1],
                "solar_id": row[2],
                "slot": row[3],
                "net_unit": float(row[4]) if row[4] is not None else None,
            }
            for row in detail_rows
        ]

        cursor.execute(
            """
            SELECT c.id, c.charge_id, c.total_charge, m.charge_description, m.charge_code
            FROM solar.eb_statement_solar_applicable_charges c
            LEFT JOIN masters.master_consumption_chargers m ON c.charge_id = m.id
            WHERE c.eb_header_id=%s
            """,
            (eb_header_id,),
        )
        charge_rows = cursor.fetchall()
        charges = [
            {
                "id": row[0],
                "charge_id": row[1],
                "charge_description": row[3],
                "charge_code": row[4],
                "total_charge": float(row[2]) if row[2] is not None else None,
            }
            for row in charge_rows
        ]

        return {
            "status": "success",
            "details": details,
            "charges": charges,
        }
    finally:
        cursor.close()
        conn.close()


# --------------------------------------------------
# Export endpoint (Excel/CSV) for EB solar statements
# --------------------------------------------------
@router.get("/export")
def export_eb_solar(
    solar_id: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
):
    """Export rows via stored procedure.
    Note: no pagination applied.
    """
    conn = get_connection(db_name="solar")
    cursor = conn.cursor()
    try:
        cursor.execute(
            "CALL solar.sp_export_eb_statement_solar(%s,%s,%s,%s,%s)",
            (solar_id, year, month, status, keyword),
        )
        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]
    finally:
        cursor.close()
        conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(columns)
    for row in rows:
        writer.writerow(row)
    output.seek(0)
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=eb_solar_export.csv"},
    )


@router.post("/read-pdf", response_model=EBSolarReadResponse)
async def read_eb_statement_solar_pdf(
    solar_id: str = Form(None),
    year: Optional[int] = Form(None),
    month: str = Form(None),
    file: UploadFile = File(...)
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files allowed")

    # Check for duplicate upload (same solar_id, month, and year)
    conn = get_connection(db_name="solar")
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT id FROM solar.eb_statement_solar 
            WHERE solar_id=%s AND month=%s AND year=%s
            """,
            (solar_id, month, year)
        )
        existing_record = cursor.fetchone()
        if existing_record:
            raise HTTPException(
                status_code=409, 
                detail=f"EB Statement (solar) for this ID already exists for {month} {year}. Please delete the existing record first if you want to re-upload."
            )
    finally:
        cursor.close()
        conn.close()

    # Get Solar Number for naming
    solar_num = get_solar_number(cursor, solar_id)
    
    # Normalize month
    month_name = normalize_month(month)
    year_str = str(year) if year else str(__import__('datetime').datetime.now().year)

    # New Structured Path: uploads/eb_statements_solar/year/month
    target_dir = os.path.join(BASE_DIR, "uploads", "eb_statements_solar", year_str, month_name)
    os.makedirs(target_dir, exist_ok=True)

    # Filename: solar_number_month_year.pdf
    clean_solar = re.sub(r'[^a-zA-Z0-9]', '_', solar_num)
    unique_name = f"{clean_solar}_{month_name}_{year_str}.pdf"
    file_path = os.path.join(target_dir, unique_name)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # GET expected_windmill_no from master_windmill by id or number
    expected_wm = ""
    conn = get_connection(db_name="solar")
    cursor = conn.cursor()
    try:
        if solar_id:
            # Determine if solar_id is numeric id or actual windmill number
            if str(solar_id).isdigit():
                cursor.execute("SELECT windmill_number FROM masters.master_windmill WHERE id=%s", (int(solar_id),))
            else:
                cursor.execute("SELECT windmill_number FROM masters.master_windmill WHERE windmill_number=%s", (solar_id,))
            row = cursor.fetchone()
            expected_wm = row[0] if row else ""
    finally:
        cursor.close()
        conn.close()

    # Parse and validate PDF data BEFORE saving to DB
    try:
        parsed_data = extract_eb_statement_data(file_path, expected_wm, year, month)
    except Exception as parse_err:
        # cleanup physical file
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass
        raise HTTPException(status_code=400, detail=f"Invalid solar EB PDF: {str(parse_err)}")

    # Use extracted month/year if validation passed
    # They match 'month' and 'year' from UI anyway because extract_eb_statement_data validates them
    final_month = parsed_data.get("month", month)
    final_year = parsed_data.get("year", year)

    # insert a record in the database
    header_id = None
    try:
        conn = get_connection(db_name="solar")
        cursor = conn.cursor()
        
        cursor.execute(
            "INSERT INTO solar.eb_statement_solar (solar_id, month, year, pdf_file_path, is_submitted, created_by) VALUES (%s, %s, %s, %s, %s, %s)",
            (int(solar_id) if solar_id and str(solar_id).isdigit() else solar_id, final_month, final_year, unique_name, 0, 1),
        )
        conn.commit()
        header_id = cursor.lastrowid
    except Exception as exc:
        print("Failed to create EB solar record:", exc)
        # cleanup physical file if DB insert fails
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass
        raise HTTPException(status_code=500, detail=f"Database error: {str(exc)}")
    finally:
        if 'cursor' in locals() and cursor: cursor.close()
        if 'conn' in locals() and conn: conn.close()

    warning_msg = parsed_data.get("warning")

    return {
        "message": "EB Statement (solar) uploaded and read",
        "filename": unique_name,
        "parsed": parsed_data,
        "header_id": header_id,
        "warning": warning_msg,
    }


@router.get("/read-metadata")
async def read_eb_statement_solar_metadata(filename: str, user: dict = Depends(get_current_user)):
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Check if filename is actually a full path or just a name
    if os.path.isabs(filename):
        file_path = filename
    else:
        # Try new structure or legacy locations
        file_path = os.path.join(BASE_DIR, "uploads", "eb_statements_solar", filename) # In case only relative part passed
        if not os.path.exists(file_path):
            file_path = os.path.join(UPLOAD_DIR_LEGACY, "solar", filename)
        if not os.path.exists(file_path):
            file_path = os.path.join(UPLOAD_DIR_LEGACY, filename)
        if not os.path.exists(file_path):
            file_path = os.path.join(BASE_DIR, "uploads", "eb_bills", filename)
    if not os.path.exists(file_path):
        # Fallback 1: parent eb_statements
        alt_dir1 = os.path.join(BASE_DIR, "uploads", "eb_statements")
        file_path = os.path.join(alt_dir1, filename)
    if not os.path.exists(file_path):
        # Fallback 2: eb_bills
        alt_dir2 = os.path.join(BASE_DIR, "uploads", "eb_bills")
        file_path = os.path.join(alt_dir2, filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"Solar statement file not found: {filename}")

    conn = get_connection(db_name="solar")
    cursor = conn.cursor()
    try:
        parts = filename.split("_")
        solar_id_val = None
        try:
            solar_id_val = int(parts[0])
        except Exception:
            solar_id_val = None

        cursor.execute("SELECT id, month, year FROM solar.eb_statement_solar WHERE pdf_file_path LIKE %s ORDER BY created_at DESC LIMIT 1", (f"%{filename}%",))
        row = cursor.fetchone()
        header_id = row[0] if row else None
        db_month = row[1] if row else None
        db_year = row[2] if row else None

        # Try by solar_id if header is not found
        if header_id is None and solar_id_val is not None:
            cursor.execute("SELECT id, month, year FROM solar.eb_statement_solar WHERE solar_id=%s ORDER BY created_at DESC LIMIT 1", (solar_id_val,))
            row = cursor.fetchone()
            header_id = row[0] if row else None
            if not db_month: db_month = row[1] if row else None
            if not db_year: db_year = row[2] if row else None

        # Prepare windmill number context
        master_wm = ""
        if header_id is not None:
            cursor.execute("SELECT solar_id FROM solar.eb_statement_solar WHERE id=%s", (header_id,))
            row = cursor.fetchone()
            solar_id_from_header = row[0] if row else None
            if solar_id_from_header is not None:
                cursor.execute("SELECT windmill_number FROM masters.master_windmill WHERE id=%s", (solar_id_from_header,))
                row2 = cursor.fetchone()
                master_wm = row2[0] if row2 else ""

        if not master_wm and solar_id_val is not None:
            cursor.execute("SELECT windmill_number FROM masters.master_windmill WHERE id=%s", (solar_id_val,))
            row2 = cursor.fetchone()
            master_wm = row2[0] if row2 else ""

        parsed_data = None
        warning_text = None
        try:
            from app.routers.eb_statement_upload import extract_eb_statement_data
            parsed_data = extract_eb_statement_data(file_path, master_wm, db_year, db_month)
            if isinstance(parsed_data, dict):
                # Ensure year/month in parsed
                if db_month: parsed_data["month"] = normalize_month(db_month)
                if db_year: parsed_data["year"] = db_year
                warning_text = parsed_data.get("warning") if "warning" in parsed_data else None
        except Exception as parse_exc:
            print("Failed to parse EB statement metadata (read-metadata):", parse_exc)

        return {
            "status": "success",
            "header_id": header_id,
            "parsed": parsed_data,
            "warning": warning_text,
        }
    finally:
        cursor.close()
        conn.close()


@router.post("/save-details")
async def save_eb_statement_solar_details(
    payload: EBSolarSaveRequest,
    user: dict = Depends(get_current_user)
):
    conn = get_connection(db_name="solar")
    cursor = conn.cursor()
    user_id = user.get("id")

    try:
        eb_header_id = payload.eb_header_id
        if not eb_header_id or eb_header_id <= 0:
            # fallback to latest EB solar header by solar_id
            cursor.execute(
                "SELECT id FROM solar.eb_statement_solar WHERE solar_id=%s ORDER BY created_at DESC LIMIT 1",
                (payload.solar_id,),
            )
            row = cursor.fetchone()
            if row:
                eb_header_id = row[0]
            else:
                raise HTTPException(status_code=400, detail="No EB Statement header found for solar_id")

        cursor.execute("DELETE FROM solar.eb_statement_solar_details WHERE eb_header_id=%s", (eb_header_id,))
        cursor.execute("DELETE FROM solar.eb_statement_solar_applicable_charges WHERE eb_header_id=%s", (eb_header_id,))

        for slot_key, net_val_str in payload.slots.items():
            slot_id = int(slot_key.replace("C", "")) if slot_key.startswith("C") and slot_key[1:].isdigit() else None
            net_val = float(net_val_str or 0)

            cursor.execute(
                """
                INSERT INTO solar.eb_statement_solar_details
                (eb_header_id, company_name, solar_id, slots, net_unit, created_by)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    eb_header_id,
                    payload.company_name,
                    payload.solar_id,
                    slot_id,
                    net_val,
                    user_id,
                ),
            )

        for charge in payload.charges:
            charge_id = None
            energy_type_value = "solar"
            valid_charge_types = ("variable", "solar")
            charge_name_norm = "" if not charge.name else " ".join(str(charge.name).strip().lower().split())
            charge_code_norm = "" if not charge.code else str(charge.code).strip().lower()

            def normalize_for_compare(text: str) -> str:
                return re.sub(r"[^a-z0-9]+", "", str(text or "").lower())

            normalized_charge_name = normalize_for_compare(charge_name_norm)

            # 1) Preferred: exact match on master charge_description (no energy_type filter to maximize match rate)
            if charge_name_norm:
                try:
                    cursor.execute(
                        """
                        SELECT id, charge_description FROM masters.master_consumption_chargers
                        WHERE TRIM(LOWER(charge_description)) = %s
                        ORDER BY id LIMIT 1
                        """,
                        (charge_name_norm,),
                    )
                    res = cursor.fetchone()
                    if res:
                        charge_id = res[0]
                        mapped_desc = res[1]
                        print(f"Exact mapped solar charge '{charge.name}' -> id={charge_id}, desc='{mapped_desc}'")
                except Exception as ce:
                    print(f"Warning: Could not map charge description '{charge.name}' exactly: {ce}")

            # 2) Normalized exact match ignoring spaces/punctuation (no energy_type filter)
            if not charge_id and normalized_charge_name:
                try:
                    cursor.execute(
                        """
                        SELECT id, charge_description FROM masters.master_consumption_chargers
                        """
                    )
                    for mid, mdesc in cursor.fetchall():
                        if normalize_for_compare(mdesc) == normalized_charge_name:
                            charge_id = mid
                            mapped_desc = mdesc
                            print(f"Normalized exact mapped solar charge '{charge.name}' -> id={charge_id}, desc='{mapped_desc}'")
                            break
                except Exception as ce:
                    print(f"Warning: Could not map charge description '{charge.name}' by normalized exact: {ce}")

            # 3) Fallback: LIKE match (no energy_type filter)
            if not charge_id and charge_name_norm:
                try:
                    cursor.execute(
                        """
                        SELECT id, charge_description FROM masters.master_consumption_chargers
                        WHERE TRIM(LOWER(charge_description)) LIKE %s
                        ORDER BY CHAR_LENGTH(charge_description) DESC, id LIMIT 1
                        """,
                        (f"%{charge_name_norm}%",),
                    )
                    res = cursor.fetchone()
                    if res:
                        charge_id = res[0]
                        mapped_desc = res[1]
                        print(f"Partial mapped solar charge '{charge.name}' -> id={charge_id}, desc='{mapped_desc}'")
                except Exception as ce:
                    print(f"Warning: Could not map charge description '{charge.name}' partially: {ce}")

            # 4) code based mapping by exact code
            if not charge_id and charge_code_norm:
                try:
                    cursor.execute(
                        """
                        SELECT id, charge_description FROM masters.master_consumption_chargers
                        WHERE TRIM(LOWER(charge_code)) = %s
                          AND TRIM(LOWER(energy_type)) = %s
                          AND TRIM(LOWER(`type`)) IN (%s, %s)
                        LIMIT 1
                        """,
                        (charge_code_norm, energy_type_value, valid_charge_types[0], valid_charge_types[1]),
                    )
                    res = cursor.fetchone()
                    if res:
                        charge_id = res[0]
                        mapped_desc = res[1]
                        print(f"Mapped solar charge code '{charge.code}' -> id={charge_id}, desc='{mapped_desc}'")
                except Exception as ce:
                    print(f"Warning: Could not map charge code '{charge.code}': {ce}")

            # 5) fallback token based matching as last resort
            if not charge_id and charge_name_norm:
                tokens = [t for t in re.sub(r"[^a-z0-9 ]", "", charge_name_norm).split() if len(t) > 2]
                for token in tokens:
                    try:
                        cursor.execute(
                            """
                            SELECT id, charge_description FROM masters.master_consumption_chargers
                            WHERE TRIM(LOWER(charge_description)) LIKE %s
                              AND TRIM(LOWER(energy_type)) = %s
                              AND TRIM(LOWER(`type`)) IN (%s, %s)
                            ORDER BY CHAR_LENGTH(charge_description) DESC, id LIMIT 1
                            """,
                            (f"%{token}%", energy_type_value, valid_charge_types[0], valid_charge_types[1]),
                        )
                        res = cursor.fetchone()
                        if res:
                            charge_id = res[0]
                            mapped_desc = res[1]
                            print(f"Token mapped solar charge '{charge.name}' token '{token}' -> id={charge_id}, desc='{mapped_desc}'")
                            break
                    except Exception as ce:
                        print(f"Warning: Could not map token '{token}' for charge '{charge.name}': {ce}")

            if charge_id is None:
                print(f"Warning: charge_id not mapped for '{charge.name}' (code={charge.code})")
            if charge_id is None:
                print(f"Warning: charge_id not mapped for '{charge.name}' (code={charge.code})")

            if not charge_id and charge_code_norm:
                try:
                    cursor.execute(
                        """
                        SELECT id FROM masters.master_consumption_chargers
                        WHERE TRIM(LOWER(charge_code)) = %s
                        AND TRIM(LOWER(energy_type)) = %s
                        AND TRIM(LOWER(`type`)) IN (%s, %s)
                        LIMIT 1
                        """,
                        (charge_code_norm, energy_type_value, valid_charge_types[0], valid_charge_types[1]),
                    )
                    res = cursor.fetchone()
                    if res:
                        charge_id = res[0]
                except Exception as ce:
                    print(f"Warning: Could not map charge code '{charge.code}': {ce}")

            if not charge_id and charge_name_norm:
                try:
                    cursor.execute(
                        """
                        SELECT id, charge_description FROM masters.master_consumption_chargers
                        WHERE (TRIM(LOWER(charge_description)) LIKE %s OR TRIM(LOWER(charge_code)) LIKE %s)
                        AND TRIM(LOWER(energy_type)) = %s
                        AND TRIM(LOWER(`type`)) IN (%s, %s)
                        LIMIT 1
                        """,
                        (f"%{charge_name_norm}%", f"%{charge_name_norm}%", energy_type_value, valid_charge_types[0], valid_charge_types[1]),
                    )
                    res = cursor.fetchone()
                    if res:
                        charge_id = res[0]
                except Exception as ce:
                    print(f"Warning: Could not map charge '{charge.name}': {ce}")

            # 4) Fallback: token based matching on description from master table
            if not charge_id and charge_name_norm:
                tokens = [t for t in charge_name_norm.split() if len(t) > 2]
                for token in tokens:
                    try:
                        cursor.execute(
                            """
                            SELECT id, charge_description FROM masters.master_consumption_chargers
                            WHERE TRIM(LOWER(charge_description)) LIKE %s
                            AND TRIM(LOWER(energy_type)) = %s
                            AND TRIM(LOWER(`type`)) IN (%s, %s)
                            ORDER BY id LIMIT 1
                            """,
                            (f"%{token}%", energy_type_value, valid_charge_types[0], valid_charge_types[1]),
                        )
                        res = cursor.fetchone()
                        if res:
                            charge_id = res[0]
                            mapped_desc = res[1]
                            print(f"Token mapped solar charge '{charge.name}' token '{token}' -> id={charge_id}, desc='{mapped_desc}'")
                            break
                    except Exception as ce:
                        print(f"Warning: Could not map token '{token}' for charge '{charge.name}': {ce}")

            if charge_id is None:
                print(f"Warning: charge_id not mapped for '{charge.name}' (code={charge.code})")

            cursor.execute(
                """
                INSERT INTO solar.eb_statement_solar_applicable_charges
                (eb_header_id, charge_id, total_charge, created_by)
                VALUES (%s, %s, %s, %s)
                """,
                (eb_header_id, charge_id, float(charge.amount), user_id),
            )

        # Mark as submitted and update modified time
        cursor.execute(
            "UPDATE solar.eb_statement_solar SET is_submitted=1, modified_at=NOW() WHERE id=%s",
            (eb_header_id,)
        )

        conn.commit()
        return {"status": "success", "message": "Solar EB statement details saved successfully"}
    except Exception as e:
        conn.rollback()
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()