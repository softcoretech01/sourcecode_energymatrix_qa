from app.database import get_db, get_connection
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import calendar
import os
import re
from app.routers.eb_statement_upload import extract_eb_statement_data

router = APIRouter(prefix="/charges-solar", tags=["Charges Solar"])

# Request Model
class ChargeRequest(BaseModel):
    solar_id: int | None = None
    eb_header_id: int | None = None
    month: int | None = None
    year: int | None = None

# Get days in month
def get_days(month, year):
    return calendar.monthrange(year, month)[1]

# MAIN API for Solar
def perform_solar_charge_calculation(db: Session, solar_id: int, month: int, year: int):
    # For solar, we might use the same master_consumption_chargers but store in solar tables
    conn = db.get_bind().raw_connection()
    cursor = conn.cursor()

    try:
        # 1. Get solar capacity (using the same master_windmill table but filtered by type='solar' if needed)
        # Actually, capacity is stored in the same place.
        cursor.callproc("masters.sp_get_windmill_capacity", (solar_id,))
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

        # 2.5 Get solar units from eb_statement_solar_details if exists
        cursor.callproc("solar.sp_get_solar_units", (solar_id, month, year))
        units_res = cursor.fetchone()
        while cursor.nextset(): pass
        solar_units = float(units_res[0] or 0) if units_res else 0

        charges_list = []
        total = 0.0

        # 3. Calculation loop
        for row in charges_data:
            charge_id = row[0]
            code = row[1]
            if code in ["WHLC", "C009", "C011","C012"]: continue
            name = row[2]
            cost = float(row[3] or 0)
            calc_str = ""
            if code == "C001": 
                value = cost
                calc_str = f"{cost}"
            elif code == "C002": 
                value = 0.0 # O&M always 0 for solar
                calc_str = "Nil"
            elif code == "C003": 
                value = ((cost * 0.5) * capacity * days)
                calc_str = f"({cost} * 0.5) * {capacity} MW * {days} Days"
            elif code == "C004": 
                value = ((cost * 0.5) * capacity * days)
                calc_str = f"({cost} * 0.5) * {capacity} MW * {days} Days"
            elif code in ["C005", "C006"]: 
                value = cost
                calc_str = f"Same as statement"
            elif code == "C007": 
                value = (cost * 0.5) * days
                calc_str = f"({cost} * 0.5) * {days} Days"
            elif code == "C008": 
                value = cost
                calc_str = f"If anything pending"
            elif code == "C010": 
                value = solar_units * cost 
                calc_str = f"{solar_units} Units * {cost} Cost"
            elif code == "WHLC": 
                value = cost
                calc_str = f"{cost} (Wheeling)"
            else: 
                value = cost
                calc_str = f"{cost} (Standard)"

            value = round(value, 2)
            total += value
            charges_list.append({
                "charge_id": charge_id,
                "code": code,
                "name": name,
                "value": value,
                "calculation": calc_str
            })

        # 4. Delete old records from SOLAR table
        cursor.callproc("solar.sp_delete_solar_charge_calculation", (solar_id, month, year))
        while cursor.nextset(): pass

        # 5. Insert new records into SOLAR table
        for item in charges_list:
            cursor.callproc("solar.sp_insert_solar_charge_calculation", (
                solar_id, month, year, item["charge_id"], item["value"], item["calculation"]
            ))
            while cursor.nextset(): pass

        conn.commit()
        return charges_list, total

    finally:
        cursor.close()

@router.post("/calculate")
def calculate_solar_charges(payload: ChargeRequest, db: Session = Depends(get_db)):
    s_id = payload.solar_id
    m_val = payload.month
    y_val = payload.year

    if payload.eb_header_id:
        conn = db.get_bind().raw_connection()
        cursor = conn.cursor()
        try:
            cursor.callproc("solar.sp_get_eb_solar_info", (payload.eb_header_id,))
            info = cursor.fetchone()
            if info:
                s_id, m_val, y_val = info[0], info[1], info[2]
        finally:
            cursor.close()

    if not s_id or not m_val or not y_val:
        raise HTTPException(status_code=400, detail="Missing solar_id, month, or year")

    # Handle string month if needed
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

    charges_list, total = perform_solar_charge_calculation(db, s_id, month_int, y_val)
    if charges_list is None:
        raise HTTPException(status_code=404, detail="Solar ID or Capacity not found")

    return {
        "success": True,
        "solar_id": s_id,
        "month": month_int,
        "year": y_val,
        "charges": charges_list,
        "total": round(total, 2)
    }

@router.get("/compare-charges")
def compare_solar_charges(eb_header_id: int, db: Session = Depends(get_db)):
    conn = db.get_bind().raw_connection()
    cursor = conn.cursor()

    try:
        # 1. Get statement info from SOLAR tables
        cursor.callproc("solar.sp_get_eb_solar_info", (eb_header_id,))
        info = cursor.fetchone()
        if not info:
            raise HTTPException(status_code=404, detail="Solar EB Statement not found")
        
        solar_id, month_val, year_val = info
        
        # 2. Normalize month
        month_map = {
            "january": 1, "february": 2, "march": 3, "april": 4,
            "may": 5, "june": 6, "july": 7, "august": 8,
            "september": 9, "october": 10, "november": 11, "december": 12
        }
        month_str = str(month_val).strip().lower()
        month_int = month_map.get(month_str)
        if not month_int:
            try: month_int = int(month_str)
            except: raise HTTPException(status_code=400, detail=f"Invalid month: {month_val}")

        # 2.5 RE-CALCULATE to ensure values are fresh and use the latest logic/day counts
        perform_solar_charge_calculation(db, solar_id, month_int, year_val)

        # 3. Get Statement Charges from solar.eb_statement_solar_applicable_charges
        pdf_charges_map = {}
        cursor.callproc("solar.sp_get_eb_solar_charges", (eb_header_id,))
        for row in cursor.fetchall():
            # sp_get_eb_solar_charges returns: id, charge_id, total_charge, charge_description, charge_code
            cid = row[1]
            amt = row[2]
            if cid:
                pdf_charges_map[cid] = pdf_charges_map.get(cid, 0) + float(amt or 0)
        while cursor.nextset(): pass

        # 4. FORCE UPDATE IDs 5 and 6 in solar.charge_calculation if they exist in statement
        for sid in [5, 6]:
            if sid in pdf_charges_map:
                val = pdf_charges_map[sid]
                cursor.callproc("solar.sp_update_solar_charge_calculation_value", (val, solar_id, month_int, year_val, sid))
                while cursor.nextset(): pass
        conn.commit()

        # 5. Get Calculated Charges from solar.charge_calculation
        cursor.callproc("solar.sp_get_solar_calculated_charges", (solar_id, month_int, year_val))
        calc_res = cursor.fetchall()
        while cursor.nextset(): pass
        calc_map = {row[0]: float(row[1] or 0) for row in calc_res}
        calc_info_map = {row[0]: row[2] for row in calc_res}

        # 6. Combine all charge IDs and get names
        all_ids = sorted(list(set(list(calc_map.keys()) + list(pdf_charges_map.keys()))))
        names_map = {}
        if all_ids:
            cursor.callproc("masters.sp_get_charge_names")
            for row in cursor.fetchall():
                if row[0] in all_ids:
                    names_map[row[0]] = row[1]
            while cursor.nextset(): pass

        data = []
        for cid in all_ids:
            calc_val = calc_map.get(cid, 0)
            stmt_val = pdf_charges_map.get(cid, 0)
            name = names_map.get(cid, f"Charge {cid}")
            if cid in [5, 6]: calc_val = stmt_val
            
            # Skip Wheeling Charges (C009) and Self Generation Tax (C011) as requested
            cursor.callproc("masters.sp_get_charge_code_by_id", (cid,))
            code_res = cursor.fetchone()
            while cursor.nextset(): pass
            if code_res and code_res[0] in ["C009", "C011"]:
                continue

            data.append({
                "solar_id": solar_id,
                "charge_id": cid,
                "charge_name": name,
                "calculated_value": calc_val,
                "total_charge": stmt_val,
                "difference": round(stmt_val - calc_val, 2),
                "calculation": calc_info_map.get(cid, "N/A")
            })

        return {"success": True, "data": data}

    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
