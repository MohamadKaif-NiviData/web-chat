from pydantic import BaseModel, ConfigDict
from datetime import datetime
from app.schemas.attachment import AttachmentResponse

class MessageResponse(BaseModel):
    id:int
    conversation_id: int
    sender_id: int
    content: str
    type: str
    created_at: datetime
    read_by: list[int] = []
    model_config = ConfigDict(from_attributes=True)
    attachment: AttachmentResponse | None = None
    edited_at: datetime | None = None

class MessagePage(BaseModel):
    messages: list[MessageResponse]
    next_cursor : int | None

class MarkReadRequest(BaseModel):
    message_ids: list[int]

class MessageEditRequest(BaseModel):
    content: str

class MessageSearchResult(BaseModel):
    message_id: int
    conversation_id: int
    conversation_name: str
    is_group: bool
    sender_id: int
    sender_display_name: str
    content: str
    created_at: datetime
    edited_at: datetime | None = None

class MessageSearchPage(BaseModel):
    results: list[MessageSearchResult]
    next_cursor: int | None
