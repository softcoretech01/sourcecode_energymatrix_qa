from app.utils.auth_utils import get_current_user
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from app.database import get_connection
import pymysql
import os
from uuid import uuid4
import fastapi

router = APIRouter(
    prefix="/windmills",
    tags=["Energy Allotment"]
)

@router.post("/energy-allotment/create")
async def create_energy_allotment(payload: dict, user: dict = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)

        params = (
            payload.get("customer_id"),
            payload.get("windmill_id"),
            payload.get("service_id"),
            payload.get("allotment_year"),
            payload.get("allotment_month"),
            user["id"],
            payload.get("c1_power", 0),
            payload.get("c1_banking", 0),
            payload.get("c2_power", 0),
            payload.get("c2_banking", 0),
            payload.get("c4_power", 0),
            payload.get("c4_banking", 0),
            payload.get("c5_power", 0),
            payload.get("c5_banking", 0)
        )

        cursor.callproc("sp_save_energy_allotment", params)
        conn.commit()

        return {"status": "success", "message": "Energy allotment saved successfully"}

    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

# -------------------------------------------------------
# UPDATE ENERGY ALLOTMENT BALANCE
# -------------------------------------------------------
@router.post("/energy-allotment/update-balance")
async def update_energy_allotment_balance(payload: dict, user: dict = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor()

        windmill_id_raw = payload.get("windmill_id")
        windmill_id = None
        try:
            if windmill_id_raw is not None:
                windmill_id = int(windmill_id_raw)
        except (ValueError, TypeError):
            pass
            
        year = payload.get("year")
        month = payload.get("month")
        balances = payload.get("balances", []) # List of {slot: 'c1', pp: 0, bank: 0, wm: 'WM-001'}

        for b in balances:
            slot = b.get("slot")
            pp = b.get("pp", 0)
            bank = b.get("bank", 0)
            wm_number = b.get("wm")
            
            # Resolve windmill_id from wm_number if provided, else use global windmill_id
            target_wm_id = windmill_id
            if wm_number:
                cursor.execute("SELECT id FROM masters.master_windmill WHERE windmill_number = %s", (wm_number,))
                row = cursor.fetchone()
                if row:
                    target_wm_id = row[0]

            if not target_wm_id:
                continue

            query = """
                INSERT INTO windmill.energy_allotment_balance (windmill_id, year, month, slot, powerplant_balance, banking_balance, created_at, created_by, status)
                VALUES (%s, %s, %s, %s, %s, %s, NOW(), %s, '1')
                ON DUPLICATE KEY UPDATE 
                    powerplant_balance = VALUES(powerplant_balance),
                    banking_balance = VALUES(banking_balance),
                    modified_at = NOW(),
                    modified_by = %s
            """
            cursor.execute(query, (target_wm_id, year, month, slot, pp, bank, user["id"], user["id"]))

        conn.commit()
        return {"status": "success", "message": "Balances updated successfully"}
    except Exception as e:
        print(f"❌ Error in update_energy_allotment_balance: {str(e)}")
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# -------------------------------------------------------
# CHARGE ALLOTMENT SAVE (WINDMILL)
# -------------------------------------------------------
@router.post("/charge-allotment/save")
async def save_charge_allotment(payload: dict, user: dict = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor()

        customer_id = payload.get("customer_id")
        windmill_id = payload.get("windmill_id")
        service_id = payload.get("service_id")
        year = payload.get("allotment_year")
        month = payload.get("allotment_month")
        charges = payload.get("charges", {})

        for code, val in charges.items():
            if val is not None:
                params = (customer_id, windmill_id, service_id, year, month, user["id"], code, val)
                cursor.callproc("sp_save_charge_allotment", params)
        
        conn.commit()
        return {"status": "success", "message": "Windmill charge allotment saved successfully"}

    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# -------------------------------------------------------
# SOLAR CHARGE ALLOTMENT SAVE
# -------------------------------------------------------
@router.post("/solar-allotment/save")
async def save_solar_allotment(payload: dict, user: dict = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor()

        customer_id = payload.get("customer_id")
        solar_id = payload.get("solar_id")
        service_id = payload.get("service_id")
        year = payload.get("allotment_year")
        month = payload.get("allotment_month")
        items = payload.get("items", [])

        for item in items:
            code = item.get("charge_code")
            val = item.get("value")
            if val is not None:
                params = (customer_id, solar_id, service_id, year, month, user["id"], code, val)
                cursor.callproc("sp_save_solar_charge_allotment", params)
        
        conn.commit()
        return {"status": "success", "message": "Solar charge allotment saved successfully"}

    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# -------------------------------------------------------
# ALLOTMENT ORDER UPLOAD & LIST
# -------------------------------------------------------
@router.post("/allotment-order/upload")
async def upload_allotment_order(
    windmill_id: int = fastapi.Form(...),
    year: int = fastapi.Form(...),
    month: str = fastapi.Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor()

        UPLOAD_DIR = "uploads/allotment_orders"
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        
        safe_name = os.path.basename(file.filename)
        unique_name = f"{uuid4().hex}_{safe_name}"
        path = os.path.join(UPLOAD_DIR, unique_name)
        db_path = path.replace("\\\\", "/")

        content = await file.read()
        with open(path, "wb") as buffer:
            buffer.write(content)

        cursor.callproc("sp_upload_allotment_order", (
            windmill_id,
            year,
            month,
            db_path,
            safe_name,
            user["id"]
        ))
        
        conn.commit()
        return {"status": "success", "message": "Allotment order uploaded successfully", "file_name": safe_name, "file_path": db_path}

    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@router.get("/allotment-order/list")
async def get_allotment_orders(
    year: int,
    month: str,
    user: dict = Depends(get_current_user)
):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)

        cursor.callproc("sp_get_allotment_orders", (month, year))
        result = cursor.fetchall()
        return {"status": "success", "data": result}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# -------------------------------------------------------
# ENERGY ALLOTMENT EXPORT
# -------------------------------------------------------
@router.get("/energy-allotment/export")
async def export_energy_allotment(
    year: int,
    month: int,
    user: dict = Depends(get_current_user)
):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)

        query = """
            SELECT
                mc.customer_name             AS `Customer`,
                cs.service_number            AS `Service Number`,
                mw.windmill_number           AS `Windmill Number`,
                h.year                       AS `Year`,
                h.month                      AS `Month`,
                MAX(CASE WHEN d.slot='c1' THEN d.allocated ELSE 0 END) AS `C1 (Units)`,
                MAX(CASE WHEN d.slot='c1_bank' THEN d.allocated ELSE 0 END) AS `C1 Banking`,
                MAX(CASE WHEN d.slot='c2' THEN d.allocated ELSE 0 END) AS `C2 (Units)`,
                MAX(CASE WHEN d.slot='c2_bank' THEN d.allocated ELSE 0 END) AS `C2 Banking`,
                MAX(CASE WHEN d.slot='c4' THEN d.allocated ELSE 0 END) AS `C4 (Units)`,
                MAX(CASE WHEN d.slot='c4_bank' THEN d.allocated ELSE 0 END) AS `C4 Banking`,
                MAX(CASE WHEN d.slot='c5' THEN d.allocated ELSE 0 END) AS `C5 (Units)`,
                MAX(CASE WHEN d.slot='c5_bank' THEN d.allocated ELSE 0 END) AS `C5 Banking`,
                MAX(CASE WHEN d.slot='consumption' THEN d.allocated ELSE 0 END) AS `Consumption`
            FROM windmill.energy_allotment_header h
            JOIN windmill.energy_allotment_details d ON h.allocation_id = d.allocation_id
            JOIN masters.master_windmill mw ON h.windmill_id = mw.id
            LEFT JOIN masters.master_customers mc ON h.customer_id = mc.id
            LEFT JOIN masters.customer_service cs ON h.service_id = cs.id
            WHERE h.year = %s AND h.month = %s AND h.status = '1' AND d.status = '1'
            GROUP BY h.allocation_id, mc.customer_name, cs.service_number, mw.windmill_number, h.year, h.month
            ORDER BY mc.customer_name, mw.windmill_number
        """
        cursor.execute(query, (year, month))
        rows = cursor.fetchall()

        # Convert Decimal to float for JSON serialisation
        result = []
        for row in rows:
            clean = {}
            for k, v in row.items():
                try:
                    clean[k] = float(v) if v is not None else 0
                except (TypeError, ValueError):
                    clean[k] = v
            result.append(clean)

        return {"status": "success", "data": result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# -------------------------------------------------------
# CHARGE ALLOTMENT EXPORT
# -------------------------------------------------------
@router.get("/charge-allotment/export")
async def export_charge_allotment(
    year: int,
    month: int,
    user: dict = Depends(get_current_user)
):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)

        # 1. WINDMILL CHARGES
        windmill_query = """
            SELECT
                mw.windmill_number           AS `Windmill No`,
                mc.customer_name             AS `Customer`,
                cs.service_number            AS `Service Number`,
                MAX(CASE WHEN mcc.charge_code='C001' THEN d.charge_amount ELSE 0 END) AS `Meter Reading Charges`,
                MAX(CASE WHEN mcc.charge_code='C002' THEN d.charge_amount ELSE 0 END) AS `O&M Charges`,
                MAX(CASE WHEN mcc.charge_code='C003' THEN d.charge_amount ELSE 0 END) AS `Transmission Charges`,
                MAX(CASE WHEN mcc.charge_code='C004' THEN d.charge_amount ELSE 0 END) AS `System Operation Charges`,
                MAX(CASE WHEN mcc.charge_code='C005' THEN d.charge_amount ELSE 0 END) AS `RKvah Penalty`,
                MAX(CASE WHEN mcc.charge_code='C006' THEN d.charge_amount ELSE 0 END) AS `Excess Unit Charges`,
                MAX(CASE WHEN mcc.charge_code='C007' THEN d.charge_amount ELSE 0 END) AS `SLDC Charges`,
                MAX(CASE WHEN mcc.charge_code='C008' THEN d.charge_amount ELSE 0 END) AS `Other Charges`,
                MAX(CASE WHEN mcc.charge_code='C010' THEN d.charge_amount ELSE 0 END) AS `Disconnection Charges`
            FROM windmill.charge_allotment_header h
            JOIN windmill.charge_allotment_details d ON h.id = d.header_id
            JOIN masters.master_windmill mw ON h.windmill_id = mw.id
            LEFT JOIN masters.master_customers mc ON h.customer_id = mc.id
            LEFT JOIN masters.customer_service cs ON h.service_id = cs.id
            LEFT JOIN masters.master_consumption_chargers mcc ON d.charge_id = mcc.id
            WHERE h.year = %s AND h.month = %s AND h.status = '1'
            GROUP BY h.id, mw.windmill_number, mc.customer_name, cs.service_number
            ORDER BY mw.windmill_number
        """
        cursor.execute(windmill_query, (year, month))
        windmill_rows = cursor.fetchall()

        # 2. SOLAR CHARGES
        solar_query = """
            SELECT
                mc.customer_name             AS `Customer`,
                cs.service_number            AS `Service Number`,
                mcc.charge_name              AS `Charge Name`,
                d.charge_amount              AS `Value`
            FROM windmill.solar_charge_allotment_header h
            JOIN windmill.solar_charge_allotment_details d ON h.id = d.header_id
            LEFT JOIN masters.master_customers mc ON h.customer_id = mc.id
            LEFT JOIN masters.customer_service cs ON h.service_id = cs.id
            LEFT JOIN masters.master_consumption_chargers mcc ON d.charge_id = mcc.id
            WHERE h.year = %s AND h.month = %s AND h.status = '1'
            ORDER BY mc.customer_name, cs.service_number
        """
        cursor.execute(solar_query, (year, month))
        solar_rows = cursor.fetchall()

        def clean_decimal(rows):
            res = []
            for r in rows:
                c = {}
                for k, v in r.items():
                    try:
                        c[k] = float(v) if v is not None else 0
                    except:
                        c[k] = v
                res.append(c)
            return res

        return {
            "status": "success",
            "windmill_charges": clean_decimal(windmill_rows),
            "solar_charges": clean_decimal(solar_rows)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()
# -------------------------------------------------------
# ENERGY ALLOTMENT FETCH SAVED DETAILS (single windmill)
# -------------------------------------------------------
@router.get("/charge-allotment/all-by-month")
async def get_all_charge_allotments_by_month(
    year: int,
    month: int,
    user: dict = Depends(get_current_user)
):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)

        windmill_query = """
            SELECT
                mw.windmill_number           AS `windmill`,
                mc.customer_name             AS `customer`,
                cs.service_number            AS `seNumber`,
                MAX(CASE WHEN mcc.charge_code='C001' THEN d.charge_amount ELSE 0 END) AS `mrc`,
                MAX(CASE WHEN mcc.charge_code='C002' THEN d.charge_amount ELSE 0 END) AS `omc`,
                MAX(CASE WHEN mcc.charge_code='C003' THEN d.charge_amount ELSE 0 END) AS `trc`,
                MAX(CASE WHEN mcc.charge_code='C004' THEN d.charge_amount ELSE 0 END) AS `oc1`,
                MAX(CASE WHEN mcc.charge_code='C005' THEN d.charge_amount ELSE 0 END) AS `kp`,
                MAX(CASE WHEN mcc.charge_code='C006' THEN d.charge_amount ELSE 0 END) AS `ec`,
                MAX(CASE WHEN mcc.charge_code='C007' THEN d.charge_amount ELSE 0 END) AS `shc`,
                MAX(CASE WHEN mcc.charge_code='C008' THEN d.charge_amount ELSE 0 END) AS `other`,
                MAX(CASE WHEN mcc.charge_code='C010' THEN d.charge_amount ELSE 0 END) AS `dc`
            FROM windmill.charge_allotment_header h
            JOIN windmill.charge_allotment_details d ON h.id = d.header_id
            JOIN masters.master_windmill mw ON h.windmill_id = mw.id
            LEFT JOIN masters.master_customers mc ON h.customer_id = mc.id
            LEFT JOIN masters.customer_service cs ON h.service_id = cs.id
            LEFT JOIN masters.master_consumption_chargers mcc ON d.charge_id = mcc.id
            WHERE h.year = %s AND h.month = %s AND h.status = '1'
            GROUP BY h.id, mw.windmill_number, mc.customer_name, cs.service_number
            ORDER BY mw.windmill_number
        """
        cursor.execute(windmill_query, (year, month))
        windmill_rows = cursor.fetchall()

        solar_query = """
            SELECT
                mc.customer_name             AS `customer`,
                cs.service_number            AS `seNumber`,
                mcc.charge_code              AS `charge_code`,
                d.charge_amount              AS `value`
            FROM windmill.solar_charge_allotment_header h
            JOIN windmill.solar_charge_allotment_details d ON h.id = d.header_id
            LEFT JOIN masters.master_customers mc ON h.customer_id = mc.id
            LEFT JOIN masters.customer_service cs ON h.service_id = cs.id
            LEFT JOIN masters.master_consumption_chargers mcc ON d.charge_id = mcc.id
            WHERE h.year = %s AND h.month = %s AND h.status = '1'
            ORDER BY mc.customer_name, cs.service_number
        """
        cursor.execute(solar_query, (year, month))
        solar_rows = cursor.fetchall()

        def clean_decimal(rows):
            res = []
            for r in rows:
                c = {}
                for k, v in r.items():
                    try:
                        c[k] = float(v) if v is not None else 0
                    except:
                        c[k] = v
                res.append(c)
            return res

        return {
            "status": "success",
            "windmill_charges": clean_decimal(windmill_rows),
            "solar_charges": clean_decimal(solar_rows)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# -------------------------------------------------------
# ENERGY ALLOTMENT FETCH SAVED DETAILS (single windmill)
# -------------------------------------------------------
@router.get("/energy-allotment/details-list")
async def get_energy_allotment_details(
    windmill_id: int,
    year: int,
    month: int,
    user: dict = Depends(get_current_user)
):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)

        cursor.callproc("sp_get_energy_allotment_details", (windmill_id, year, month))
        rows = cursor.fetchall()

        # Convert Decimal to float for JSON serialisation
        result = []
        for row in rows:
            clean = {}
            for k, v in row.items():
                try:
                    clean[k] = float(v) if hasattr(v, '__float__') else v
                except:
                    clean[k] = v
            result.append(clean)

        return {"status": "success", "data": result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# -------------------------------------------------------
# ENERGY ALLOTMENT FETCH ALL SAVED FOR A MONTH (no windmill filter)
# -------------------------------------------------------
@router.get("/energy-allotment/all-by-month")
async def get_all_energy_allotments_by_month(
    year: int,
    month: int,
    user: dict = Depends(get_current_user)
):
    """
    Returns every saved allotment row for the given year+month across ALL windmills.
    Used to auto-populate the Energy Allotment grid when the month dropdown changes,
    without requiring a windmill to be selected first.
    """
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)

        query = """
            SELECT
                h.customer_id,
                h.service_id,
                h.windmill_id,
                TRIM(mw.windmill_number) AS windmill_number,
                mc.customer_name,
                cs.service_number,
                MAX(CASE WHEN d.slot = 'c1' THEN d.power_allocated   ELSE 0 END) AS c1_pp,
                MAX(CASE WHEN d.slot = 'c1' THEN d.banking_allocated  ELSE 0 END) AS c1_bank,
                MAX(CASE WHEN d.slot = 'c1' THEN d.allocated          ELSE 0 END) AS c1,
                MAX(CASE WHEN d.slot = 'c2' THEN d.power_allocated   ELSE 0 END) AS c2_pp,
                MAX(CASE WHEN d.slot = 'c2' THEN d.banking_allocated  ELSE 0 END) AS c2_bank,
                MAX(CASE WHEN d.slot = 'c2' THEN d.allocated          ELSE 0 END) AS c2,
                MAX(CASE WHEN d.slot = 'c4' THEN d.power_allocated   ELSE 0 END) AS c4_pp,
                MAX(CASE WHEN d.slot = 'c4' THEN d.banking_allocated  ELSE 0 END) AS c4_bank,
                MAX(CASE WHEN d.slot = 'c4' THEN d.allocated          ELSE 0 END) AS c4,
                MAX(CASE WHEN d.slot = 'c5' THEN d.power_allocated   ELSE 0 END) AS c5_pp,
                MAX(CASE WHEN d.slot = 'c5' THEN d.banking_allocated  ELSE 0 END) AS c5_bank,
                MAX(CASE WHEN d.slot = 'c5' THEN d.allocated          ELSE 0 END) AS c5
            FROM windmill.energy_allotment_header h
            JOIN windmill.energy_allotment_details d ON h.allocation_id = d.allocation_id
            JOIN masters.master_windmill mw ON h.windmill_id = mw.id
            JOIN masters.master_customers mc ON h.customer_id = mc.id
            JOIN masters.customer_service cs ON h.service_id = cs.id
            WHERE h.year = %s
              AND h.month = %s
              AND h.status = '1'
              AND d.status = '1'
            GROUP BY h.customer_id, h.service_id, h.windmill_id,
                     mw.windmill_number, mc.customer_name, cs.service_number
            ORDER BY mw.windmill_number, mc.customer_name
        """
        cursor.execute(query, (year, month))
        rows = cursor.fetchall()

        result = []
        for row in rows:
            clean = {}
            for k, v in row.items():
                try:
                    clean[k] = float(v) if hasattr(v, '__float__') else v
                except:
                    clean[k] = v
            result.append(clean)

        return {"status": "success", "data": result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()
