from app.database import get_db
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import calendar
import os
import re
from app.routers.eb_statement_upload import extract_eb_statement_data





router = APIRouter(prefix="/charges", tags=["Charges"])


#Request Model
class ChargeRequest(BaseModel):
    windmill_id: int | None = None
    eb_header_id: int | None = None
    month: int | None = None
    year: int | None = None


#  Get days in month
def get_days(month, year):
    return calendar.monthrange(year, month)[1]


#  MAIN API
def perform_charge_calculation(db: Session, windmill_id: int, month: int, year: int):
    conn = db.get_bind().raw_connection()
    cursor = conn.cursor()

    try:
        #  1. Get windmill capacity
        cursor.callproc("masters.sp_get_windmill_capacity", (windmill_id,))
        cap_result = cursor.fetchone()
        while cursor.nextset(): pass

        if not cap_result:
            return None, 0.0

        capacity = float(cap_result[0])
        days = get_days(month, year)

        # 2. Get charges master data
        cursor.callproc("masters.sp_get_charges_master_data")
        charges_data = cursor.fetchall()
        while cursor.nextset(): pass

        charges_list = []
        total = 0.0

        # 3. Calculation loop
        for row in charges_data:
            # Row indexing: 0:id, 1:charge_code, 2:charge_name, 3:cost
            charge_id = row[0]
            code = row[1]

            # SKIP WHLC
            if code == "WHLC":
                continue

            name = row[2]
            cost = float(row[3] or 0)
            calc_str = ""

            value = 0.0

            # C001 → fixed monthly
            if code == "C001":
                value = cost
                calc_str = f"{cost}"

            # C002 → MW/year
            elif code == "C002":
                value = ((cost * capacity) / 365) * days
                calc_str = f"({cost} * {capacity} / 365) * {days} Days"

            # C003 → 50% MW/day
            elif code == "C003":
                value = ((cost * 0.5) * capacity * days)
                calc_str = f"({cost} * 0.5) * {capacity} MW * {days} Days"

            # C004 → 50% MW/day
            elif code == "C004":
                value = ((cost * 0.5) * capacity * days)
                calc_str = f"({cost} * 0.5) * {capacity} MW * {days} Days"

            # C005, C006 → actuals
            elif code in ["C005", "C006"]:
                value = cost
                calc_str = "Same as statement"

            # C007 → 50% per day
            elif code == "C007":
                value = (cost * 0.5) * days
                calc_str = f"({cost} * 0.5) * {days} Days"

            # C008 → manual/pending
            elif code == "C008":
                value = cost
                calc_str = "If anything pending"

            # C010 → DSM charges
            elif code == "C010":
                generated_units = 0  # replace with real data
                value = generated_units * cost
                calc_str = f"{generated_units} Units * {cost} Cost"

            else:
                value = cost
                calc_str = f"{cost}"

            value = round(value, 2)
            total += value

            charges_list.append({
                "charge_id": charge_id,
                "code": code,
                "name": name,
                "value": value,
                "calculation": calc_str
            })

        # 4. Delete old records
        cursor.callproc("masters.sp_delete_charge_calculation", (windmill_id, month, year))

        #  5. Insert new records
        for item in charges_list:
            cursor.callproc("masters.sp_insert_charge_calculation", (
                windmill_id, 
                month, 
                year, 
                item["charge_id"], 
                item["value"],
                item["calculation"]
            ))

        conn.commit()
        return charges_list, total

    finally:
        cursor.close()

@router.post("/calculate")
def calculate_charges(payload: ChargeRequest, db: Session = Depends(get_db)):
    w_id = payload.windmill_id
    m_val = payload.month
    y_val = payload.year

    # If eb_header_id is provided, fetch info from DB
    if payload.eb_header_id:
        conn = db.get_bind().raw_connection()
        cursor = conn.cursor()
        try:
            cursor.callproc("windmill.sp_get_eb_statement_info", (payload.eb_header_id,))
            info = cursor.fetchone()
            if info:
                # Row: windmill_id, month, year
                w_id = info[0]
                m_val = info[1]
                y_val = info[2]
        finally:
            cursor.close()

    # Final check
    if not w_id or not m_val or not y_val:
        raise HTTPException(status_code=400, detail="Missing windmill_id, month, or year (and no eb_header_id found)")

    month_int = m_val
    if isinstance(m_val, str):
        month_map = {
            "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
            "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12
        }
        month_int = month_map.get(str(m_val).lower())
        if not month_int:
            try: month_int = int(m_val)
            except: raise HTTPException(status_code=400, detail=f"Invalid month: {m_val}")

    charges_list, total = perform_charge_calculation(db, w_id, month_int, y_val)
    
    if charges_list is None:
        raise HTTPException(status_code=404, detail="Windmill or Capacity not found")

    return {
        "message": "Charges calculated successfully",
        "windmill_id": w_id,
        "month": month_int,
        "year": y_val,
        "charges": charges_list,
        "total": round(total, 2)
    }

@router.get("/compare-charges")
def compare_charges(eb_header_id: int, db: Session = Depends(get_db)):
    conn = db.get_bind().raw_connection()
    cursor = conn.cursor()
    
    try:
        # 1. Get statement info (windmill_id, month, year, etc.)
        cursor.callproc("windmill.sp_get_eb_statement_info", (eb_header_id,))
        info = cursor.fetchone()
        while cursor.nextset(): pass
        
        if not info:
            raise HTTPException(status_code=404, detail="EB Statement header not found")
        
        # Row: windmill_id, month, year
        windmill_id = info[0]
        month_val = info[1]
        year_val = info[2]

        # Also get the PDF path using the SP
        cursor.callproc("windmill.sp_get_eb_statement_by_id", (eb_header_id,))
        stmt_row = cursor.fetchone()
        while cursor.nextset(): pass
        
        pdf_path = stmt_row[3] if stmt_row and len(stmt_row) > 3 else None

        # 2. Convert string month to integer and Trigger calculation automatically
        month_map = {
            "january": 1, "february": 2, "march": 3, "april": 4,
            "may": 5, "june": 6, "july": 7, "august": 8,
            "september": 9, "october": 10, "november": 11, "december": 12
        }
        month_str = str(month_val).strip().lower()
        month_int = month_map.get(month_str)
        if not month_int:
            try: month_int = int(month_str)
            except: raise HTTPException(status_code=400, detail=f"Invalid month format: {month_val}")

        # 2.5 RE-CALCULATE to ensure values are fresh and use the latest logic/day counts
        perform_charge_calculation(db, windmill_id, month_int, year_val)

        # 3. Get Statement Charges
        pdf_charges_map = {}
        
        # First, try to get already saved charges from DB using SP
        cursor.callproc("windmill.sp_get_eb_statement_charges", (eb_header_id,))
        saved_charges = cursor.fetchall()
        while cursor.nextset(): pass
        
        for row in saved_charges:
            # sp_get_eb_statement_charges returns: charge_id, charge_description, total_charge, ...
            c_id = row[0]
            amount = float(row[2] or 0)
            if c_id:
                pdf_charges_map[c_id] = pdf_charges_map.get(c_id, 0) + amount

        # If no saved charges, or to supplement, try PDF parsing
        if not pdf_charges_map and pdf_path and os.path.exists(pdf_path):
            try:
                cursor.callproc("masters.sp_get_windmill_number_by_id_or_val", (str(windmill_id),))
                wm_num_row = cursor.fetchone()
                while cursor.nextset(): pass
                
                wm_number = wm_num_row[0] if wm_num_row else str(windmill_id)
                
                parsed_data = extract_eb_statement_data(pdf_path, wm_number, year_val, month_val)
                pdf_charges = parsed_data.get("charges", [])
                
                for pc in pdf_charges:
                    name = pc.get("name", "")
                    code = pc.get("code", "")
                    amount = float(pc.get("amount", 0) or 0)
                    
                    # Use the EXACT SAME mapping SPs as upload
                    charge_id = None
                    name_norm = " ".join(str(name).strip().lower().split())
                    
                    try:
                        cursor.callproc("masters.sp_mapping_charge_id", (name_norm, ""))
                        res = cursor.fetchone()
                        if res: charge_id = res[0]
                        while cursor.nextset(): pass
                        
                        if not charge_id and code:
                            cursor.callproc("masters.sp_mapping_charge_id_by_code", (str(code).strip().lower(),))
                            res = cursor.fetchone()
                            if res: charge_id = res[0]
                            while cursor.nextset(): pass
                            
                        if not charge_id:
                            cursor.callproc("masters.sp_mapping_charge_id_fallback", (name_norm,))
                            res = cursor.fetchone()
                            if res: charge_id = res[0]
                            while cursor.nextset(): pass
                    except:
                        pass
                    
                    if charge_id:
                        pdf_charges_map[charge_id] = pdf_charges_map.get(charge_id, 0) + amount
            except Exception as e:
                print(f"Error parsing PDF for comparison: {e}")

        # 4. FORCE UPDATE IDs 5 and 6 in masters.charge_calculation if they exist in statement
        for special_id in [5, 6]:
            if special_id in pdf_charges_map:
                val = pdf_charges_map[special_id]
                cursor.callproc("masters.sp_update_charge_calculation_value", (val, windmill_id, month_int, year_val, special_id))
                while cursor.nextset(): pass
        conn.commit()

        # 5. Get Calculated Charges (Including the forced overrides for 5 and 6)
        cursor.callproc("masters.sp_get_calculated_charges", (windmill_id, month_int, year_val))
        calc_results = cursor.fetchall()
        while cursor.nextset(): pass
        
        calc_map = {row[0]: float(row[1] or 0) for row in calc_results}
        calc_info_map = {row[0]: row[2] for row in calc_results}

        # 6. Combine all charge IDs from both sources and get names
        # Filter to ensure we only process numeric IDs as keys
        def safe_int(val):
            try: return int(val)
            except: return None

        all_charge_ids = sorted(list(set(
            [id for id in [safe_int(k) for k in calc_map.keys()] if id is not None] +
            [id for id in [safe_int(k) for k in pdf_charges_map.keys()] if id is not None]
        )))
        names_map = {}
        if all_charge_ids:
            try:
                cursor.callproc("masters.sp_get_charge_names")
                names_results = cursor.fetchall()
                while cursor.nextset(): pass
                
                # Map only the ones we need, or just build the whole map since it's small
                names_map = {row[0]: row[1] for row in names_results if row[0] in all_charge_ids}
            except Exception as e:
                print(f"Error fetching charge names: {e}")
        
        data = []
        for cid in all_charge_ids:
            calc_val = calc_map.get(cid, 0)
            stmt_val = pdf_charges_map.get(cid, 0)
            name = names_map.get(cid, f"Charge {cid}")
            
            # Enforce rule: specific charges always match statement
            if cid in [5, 6]:
                calc_val = stmt_val

            # Skip Wheeling Charges (C009), Self Generation Tax (C011), and C012 as requested
            cursor.callproc("masters.sp_get_charge_code_by_id", (cid,))
            code_res = cursor.fetchone()
            while cursor.nextset(): pass
            if code_res and code_res[0] in ["C009", "C011", "C012"]:
                continue

            data.append({
                "windmill_id": windmill_id,
                "charge_id": cid,
                "charge_name": name,
                "calculated_value": calc_val,
                "total_charge": stmt_val,
                "difference": round(stmt_val - calc_val, 2),
                "calculation": calc_info_map.get(cid, "N/A")
            })

        return {"success": True, "data": data}

    except Exception as e:
        print(f"Error in compare_charges: {e}")
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")
    finally:
        cursor.close()