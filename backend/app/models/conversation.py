# Why: a Conversation is deliberately separate from who's IN it. Two tables
# instead of one, because a conversation can have any number of
# participants (1-to-1 now, groups in Phase 2) — that's a many-to-many
# relationship between users and conversations, which in a relational db
# needs its own linking table (Participant) rather than a column on either
# side.
#
# Plain-English steps:
#
# `Conversation` table:
# 1. `id: Mapped[int] = mapped_column(primary_key=True)`.
# 2. `is_group: Mapped[bool] = mapped_column(Boolean, default=False)` — lets
#    Phase 2's group chat feature reuse this same table instead of a new one.
# 3. `created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
#    server_default=func.now())`.
#
# `Participant` table (the linking table):
# 1. `id: Mapped[int] = mapped_column(primary_key=True)`.
# 2. `conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"))`
#    — points back to the Conversation row this participant belongs to.
# 3. `user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))` — points
#    to the User who's in it.
# 4. `joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
#    server_default=func.now())`.
# 5. `last_read_message_id: Mapped[int | None] = mapped_column(
#    ForeignKey("messages.id"), nullable=True)` — tracks the last message
#    this participant has seen, for a future "read receipts" feature
#    (Phase 2) — nullable now since no one's read anything at creation time.
#    Fine to add the column now even though nothing writes to it yet.
#
# Naming note: `ForeignKey("conversations.id")` references the DB table name
# string ("conversations"), not the Python class name (Conversation) — make
# sure `__tablename__` on the Conversation class is literally "conversations".

from app.db.base import Base
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, DateTime, func, ForeignKey
from datetime import datetime


class Conversation(Base):
    __tablename__ = "conversations"
    id : Mapped[int] = mapped_column(primary_key=True)
    created_at : Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class Participant(Base):
    __tablename__ = "participants"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


    