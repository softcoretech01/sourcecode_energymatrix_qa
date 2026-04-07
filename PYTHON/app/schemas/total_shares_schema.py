from pydantic import BaseModel
from typing import Optional, Union
from datetime import datetime


# ===============================
# CREATE TOTAL SHARES
# ===============================
class TotalSharesCreate(BaseModel):
    total_company_shares: int
    investor_shares: int
    status: Optional[str] = "Active"
    is_submitted: Optional[int] = 0


# ===============================
# UPDATE TOTAL SHARES
# ===============================
class TotalSharesUpdate(BaseModel):
    total_company_shares: int
    investor_shares: int
    status: Optional[str] = "Active"
    is_submitted: Optional[int] = 0


# ===============================
# RESPONSE MODEL
# ===============================
class TotalSharesResponse(BaseModel):
    id: Optional[int] = None
    total_company_shares: Optional[float] = 0.0
    total_investor_shares: Optional[float] = 0.0
    total_customer_shares: Optional[float] = 0.0


# ===============================
# MESSAGE RESPONSE
# ===============================
class TotalSharesMessage(BaseModel):
    message: str
    id: Optional[int] = None
    customer_shares: Optional[int] = None