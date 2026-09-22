# Why: this is the table every chat feature reads/writes constantly (Step 5
# onward) — sending a message, loading history, pagination. Getting the
# indexing right here now avoids a slow, painful migration later once
# there's real data in it.
#
# Plain-English steps:
# 1. `id: Mapped[int] = mapped_column(primary_key=True)`.
# 2. `conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"),
#    index=True)` — every query is "give me messages FOR this conversation,"
#    so this needs an index on its own even before the combined one below.
# 3. `sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"))` — who
#    sent it.
# 4. `content: Mapped[str] = mapped_column(Text, nullable=False)` — use
#    `Text` (unbounded), not `String`, since chat messages shouldn't have an
#    arbitrary length cap baked into the column type.
# 5. `type: Mapped[str] = mapped_column(String, default="text")` — lets you
#    distinguish a normal chat message from a future "system message" (e.g.
#    "Alice joined the conversation") without a separate table.
# 6. `created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
#    server_default=func.now())`.
# 7. Composite index for pagination — add this INSIDE the class body:
#    ```
#    __table_args__ = (
#        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
#    )
#    ```
#    Why a composite index specifically: Step 5's history endpoint will
#    query "messages in conversation X, ordered by created_at, older than
#    cursor Y" (keyset pagination). An index on conversation_id alone still
#    forces Postgres to sort every matching row by created_at at query time;
#    a composite (conversation_id, created_at) index lets it walk the index
#    in already-sorted order instead — the difference between fast and slow
#    once a conversation has thousands of messages.


from app.db.base import Base
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, DateTime, func, ForeignKey, Text
from datetime import datetime



class Message(Base):
    __tablename__ = "messages"
    id : Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"))
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    content : Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(String, default="text")
    created_at : Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
