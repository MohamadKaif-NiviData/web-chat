# Why: ConversationSummary currently has a single `other_user` field, which
# only makes sense for exactly-2-participant conversations. Groups need a
# shape that works for both cases without the frontend having to
# special-case "is this a 1-to-1 or a group" everywhere it renders a
# conversation.
#
# Plain-English steps:
# 1. Replace ConversationSummary's `other_user: ParticipantSummary` field
#    with:
#    - `is_group: bool`
#    - `name: str` — for a group, the conversation's own stored `name`; for
#      a 1-to-1, the OTHER participant's `display_name` (computed by the
#      route below, never stored on a 1-to-1 conversation).
#    - `participants: list[ParticipantSummary]` — for a 1-to-1, a list with
#      just the other person in it; for a group, everyone except the
#      current user.
# 2. Add `class GroupCreateRequest(BaseModel): name: str; member_emails: list[str]`
#    — the request body for the new group-creation route in
#    app/api/routes/conversations.py.

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
    last_message: MessageResponse | None
    is_group:bool
    name:str
    participants: list[ParticipantSummary]

class GroupCreateRequest(BaseModel):
    name: str
    member_emails: list[EmailStr]    