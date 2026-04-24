from fastapi import APIRouter, Depends, HTTPException, Query
from app.utils.auth_utils import get_current_user
from app.database import get_connection
from datetime import date
from typing import Optional
import pymysql

router = APIRouter(
    prefix="/invoices",
    tags=["Client Invoice"]
)


# =====================================================
# 🔵 GENERATE (create) a new client invoice
# =====================================================
@router.post("/generate")
async def generate_invoice(data: dict, user: dict = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)

        # Step 1: Get the next sequential invoice number
        cursor.callproc("sp_get_next_invoice_number")
        row = cursor.fetchone()
        next_number = row["next_number"] if row else 1
        # drain any remaining result sets
        while cursor.nextset():
            pass

        # Step 2: Save the new invoice record
        today = date.today()
        cursor.callproc("sp_save_client_invoice", (
            next_number,
            int(data["customer_id"]),
            int(data["service_id"]),
            int(data["year"]),
            data["month"],
            today,
            user["id"]
        ))
        result = cursor.fetchone()
        conn.commit()

        # Step 3: Auto-populate client_invoice_details
        invoice_id = result["id"] if result else None
        if invoice_id:
            # Fetch the calculated default values
            while cursor.nextset(): pass
            cursor.callproc("sp_get_client_invoice_by_id", (invoice_id,))
            invoice = cursor.fetchone()
            while cursor.nextset(): pass
            
            if invoice:
                default_fields = [
                    ("Units", float(invoice.get("generated_units", 0))),
                    ("Rate", float(invoice.get("invoice_constant", 6.80))),
                    ("Meter", float(invoice.get("charge_meter", 0))),
                    ("O&M Charges", float(invoice.get("charge_om", 0))),
                    ("Transmsn Chrgs", float(invoice.get("charge_trans", 0))),
                    ("Sys Opr Chrgs", float(invoice.get("charge_sys_opr", 0))),
                    ("RkvAh", float(invoice.get("charge_rkvah", 0))),
                    ("Import Chrgs", float(invoice.get("charge_import", 0))),
                    ("Scheduling chrgs", float(invoice.get("charge_scheduling", 0))),
                    ("DSM Charges", float(invoice.get("charge_dsm", 0))),
                    ("Wheeling", float(invoice.get("charge_wheeling", 0))),
                    ("Selfenergy chrgs", float(invoice.get("charge_tax", 0))),
                ]
                
                for field_name, amount in default_fields:
                    cursor.execute(
                        "INSERT INTO client_invoice_details (invoice_id, field_name, amount) VALUES (%s, %s, %s)",
                        (invoice_id, field_name, amount)
                    )
                conn.commit()

        return {
            "status": "success",
            "invoice_id": invoice_id,
            "invoice_number": next_number
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


# =====================================================
# 🔵 LIST client invoices (with optional filters)
# =====================================================
@router.get("")
async def get_invoice_list(
    customer_id: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[str] = Query(None),
    user: dict = Depends(get_current_user)
):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.callproc("sp_get_client_invoice_list", (customer_id, year, month))
        rows = cursor.fetchall()
        while cursor.nextset():
            pass

        # Convert date / decimal fields to serializable types
        result = []
        for r in rows:
            row_copy = dict(r)
            if row_copy.get("invoice_date"):
                row_copy["invoice_date"] = str(row_copy["invoice_date"])
            result.append(row_copy)

        return {"status": "success", "data": result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


# =====================================================
# 🔵 GET a single invoice by ID (for print view)
# =====================================================
@router.get("/{invoice_id}/print-data")
async def get_invoice_print_data(
    invoice_id: int,
    user: dict = Depends(get_current_user)
):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.callproc("sp_get_client_invoice_by_id", (invoice_id,))
        row = cursor.fetchone()
        while cursor.nextset():
            pass

        if not row:
            raise HTTPException(status_code=404, detail="Invoice not found")

        # Fetch stored details
        cursor.execute("SELECT field_name, amount FROM client_invoice_details WHERE invoice_id = %s", (invoice_id,))
        details = cursor.fetchall()
        
        # Serialize
        row_copy = dict(row)
        if row_copy.get("invoice_date"):
            row_copy["invoice_date"] = str(row_copy["invoice_date"])
            
        row_copy["details"] = details

        return {"status": "success", "data": row_copy}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
# =====================================================
# 🔵 GET invoice details (for editing)
# =====================================================
@router.get("/{invoice_id}/details")
async def get_invoice_details(invoice_id: int, user: dict = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        cursor.execute("SELECT field_name, amount FROM client_invoice_details WHERE invoice_id = %s", (invoice_id,))
        rows = cursor.fetchall()
        
        # If no details exist (for old invoices), populate them
        if not rows:
            cursor.callproc("sp_get_client_invoice_by_id", (invoice_id,))
            invoice = cursor.fetchone()
            while cursor.nextset(): pass
            
            if invoice:
                default_fields = [
                    ("Units", float(invoice.get("generated_units", 0))),
                    ("Rate", float(invoice.get("invoice_constant", 6.80))),
                    ("Meter", float(invoice.get("charge_meter", 0))),
                    ("O&M Charges", float(invoice.get("charge_om", 0))),
                    ("Transmsn Chrgs", float(invoice.get("charge_trans", 0))),
                    ("Sys Opr Chrgs", float(invoice.get("charge_sys_opr", 0))),
                    ("RkvAh", float(invoice.get("charge_rkvah", 0))),
                    ("Import Chrgs", float(invoice.get("charge_import", 0))),
                    ("Scheduling chrgs", float(invoice.get("charge_scheduling", 0))),
                    ("DSM Charges", float(invoice.get("charge_dsm", 0))),
                    ("Wheeling", float(invoice.get("charge_wheeling", 0))),
                    ("Selfenergy chrgs", float(invoice.get("charge_tax", 0))),
                ]
                for field_name, amount in default_fields:
                    cursor.execute(
                        "INSERT INTO client_invoice_details (invoice_id, field_name, amount) VALUES (%s, %s, %s)",
                        (invoice_id, field_name, amount)
                    )
                conn.commit()
                cursor.execute("SELECT field_name, amount FROM client_invoice_details WHERE invoice_id = %s", (invoice_id,))
                rows = cursor.fetchall()

        return {"status": "success", "data": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


# =====================================================
# 🔵 UPDATE invoice details & main amount
# =====================================================
@router.put("/{invoice_id}/details")
async def update_invoice_details(invoice_id: int, data: dict, user: dict = Depends(get_current_user)):
    conn = None
    cursor = None
    try:
        conn = get_connection(db_name="windmill")
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        details = data.get("details", [])
        
        # 1. Update details table
        for item in details:
            cursor.execute(
                "UPDATE client_invoice_details SET amount = %s WHERE invoice_id = %s AND field_name = %s",
                (item["amount"], invoice_id, item["field_name"])
            )
            
        # 2. Recalculate total amount for the main invoice table
        # Formula: Amount = Net Units - Total
        d_map = {d["field_name"]: float(d["amount"]) for d in details}
        units = d_map.get("Units", 0)
        rate = d_map.get("Rate", 6.80)
        net_units_value = units * rate
        
        charges_list = [
            "Meter", "O&M Charges", "Transmsn Chrgs", "Sys Opr Chrgs",
            "RkvAh", "Import Chrgs", "Scheduling chrgs", "DSM Charges",
            "Wheeling", "Selfenergy chrgs"
        ]
        total_charges = sum(d_map.get(c, 0) for c in charges_list)
        final_amount = net_units_value - total_charges
        
        cursor.execute("UPDATE client_invoice SET amount = %s WHERE id = %s", (final_amount, invoice_id))
        
        conn.commit()
        return {"status": "success", "final_amount": final_amount}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cursor: cursor.close()
        if conn: conn.close()
