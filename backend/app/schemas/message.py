from pydantic import BaseModel, ConfigDict
from datetime import datetime

class MessageResponse(BaseModel):
    id:int
    conversation_id: int
    sender_id: int
    content: str
    type: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class MessagePage(BaseModel):
    messages: list[MessageResponse]
    next_cursor : int | None    