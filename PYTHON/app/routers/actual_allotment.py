from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel
from app.database import get_connection
import pymysql

router = APIRouter()

# ✅ Request Schema
class ActualsResponse(BaseModel):
    actual_month: int
    actual_year: int
    customer_name: Optional[str]
    sc_number: Optional[str]
   

# ✅ API (POST because we pass body)
@router.get("/actuals/list")
async def get_actuals():
    conn = get_connection(db_name="windmill")
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    try:
        cursor.callproc("sp_get_actuals_list")
        rows = cursor.fetchall()
        return rows

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cursor.close()
        conn.close()



@router.get("/actuals/pdf/{client_eb_id}")
async def get_actuals_pdf(client_eb_id: int):
    conn = get_connection(db_name="windmill")
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    try:
        cursor.callproc("sp_get_actuals_pdf", (client_eb_id,))
        rows = cursor.fetchall()

        if not rows:
            return {"message": "No data found"}

        first = rows[0]

        # ✅ Header (now includes tax)
        header = {
            "customer_name": first["customer_name"],
            "sc_number": first["sc_number"],
            "month": first["actual_month"],
            "year": first["actual_year"],
            "self_generation_tax": float(first["self_generation_tax"]),
            
        }

        # ✅ Table data
        table_data = [
            {
                "windmill": row["windmill"],
                "wheeling_charges": float(row["wheeling_charges"] or 0),
            }
            for row in rows
        ]

        # ✅ Total
        total = float(first["total_wheeling"])

        return {
            "header": header,
            "data": table_data,
            "total": total
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cursor.close()
        conn.close()