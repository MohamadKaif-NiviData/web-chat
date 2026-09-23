from pydantic import BaseModel, EmailStr
from app.schemas.message import MessageResponse


class ConversationResponse(BaseModel):
    conversation_id: int


class ParticipantSummary(BaseModel):
    id: int
    email: EmailStr
    display_name: str
    is_online: bool


class ConversationSummary(BaseModel):
    conversation_id: int
    other_user: ParticipantSummary
    last_message: MessageResponse | None
