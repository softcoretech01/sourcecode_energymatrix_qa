from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class ActualAllotmentBase(BaseModel):
    windmill_id: int
    service_id: int
    allotment_total: float
    year: int
    month: int

class ActualAllotmentCreate(ActualAllotmentBase):
    pass

class ActualAllotmentResponse(ActualAllotmentBase):
    id: int
    pdf_file_path: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True

class ActualAllotmentUploadResponse(BaseModel):
    message: str
    filename: str
    parsed_count: int
    header_id: Optional[int] = None
    unmatched_count: Optional[int] = 0
    unmatched_samples: Optional[List[str]] = []
