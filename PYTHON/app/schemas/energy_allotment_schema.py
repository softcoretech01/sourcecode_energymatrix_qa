from pydantic import BaseModel, Field
from typing import Optional


class EnergyAllotmentCreate(BaseModel):
    """Schema for creating Energy Allotment"""
    allotment_year: int
    allotment_month: int
    allotment_date: str
    customer_id: Optional[int] = Field(default=0, description="Customer ID")
    windmill_id: Optional[int] = Field(default=0, description="Windmill ID")
    service_id: Optional[int] = Field(default=0, description="Service ID")
    service_number: Optional[str] = None
    
    # Category C1-C5 Values
    c1_power: float = 0
    c1_banking: float = 0
    c2_power: float = 0
    c2_banking: float = 0
    c4_power: float = 0
    c4_banking: float = 0
    c5_power: float = 0
    c5_banking: float = 0
    
    # Requested Values
    requested_power: float = 0
    requested_banking: float = 0
    
    # Allocated Values
    allocated_power: float = 0
    allocated_banking: float = 0
    
    # Utilized Values
    utilized_power: float = 0
    utilized_banking: float = 0


class EnergyAllotmentUpdate(BaseModel):
    """Schema for updating Energy Allotment"""
    c1_power: float = 0
    c1_banking: float = 0
    c2_power: float = 0
    c2_banking: float = 0
    c4_power: float = 0
    c4_banking: float = 0
    c5_power: float = 0
    c5_banking: float = 0
    requested_power: float = 0
    requested_banking: float = 0
    allocated_power: float = 0
    allocated_banking: float = 0
    utilized_power: float = 0
    utilized_banking: float = 0


class EnergyAllotmentResponse(BaseModel):
    """Schema for Energy Allotment Response"""
    id: int
    allotment_year: int
    allotment_month: int
    allotment_date: str
    customer_id: int
    service_number: Optional[str]
    c1_power: float
    c1_banking: float
    c2_power: float
    c2_banking: float
    c4_power: float
    c4_banking: float
    c5_power: float
    c5_banking: float
    requested_power: float
    requested_banking: float
    allocated_power: float
    allocated_banking: float
    utilized_power: float
    utilized_banking: float
    is_submitted: int
    created_at: str
    modified_at: str
