# Why: same reasoning as Step 4's schemas — the `Message` SQLAlchemy model
# (app/models/message.py) defines DB storage; this defines what goes over
# the wire, both for the WebSocket payload and the HTTP history endpoint.
#
# Plain-English steps:
# 1. Import `BaseModel`, `ConfigDict` from `pydantic`; `datetime` from
#    `datetime`.
# 2. `class MessageResponse(BaseModel):`
#    - `id: int`
#    - `conversation_id: int`
#    - `sender_id: int`
#    - `content: str`
#    - `type: str`
#    - `created_at: datetime`
#    - `model_config = ConfigDict(from_attributes=True)` — same reason as
#      `UserResponse`: lets you return a SQLAlchemy `Message` object
#      directly and have this schema read its attributes.
# 3. `class MessagePage(BaseModel):`
#    - `messages: list[MessageResponse]`
#    - `next_cursor: int | None` — the id of the OLDEST message in this
#      page; the client sends this back as the `cursor` query param to fetch
#      the next (older) page. `None` means there are no more pages.


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