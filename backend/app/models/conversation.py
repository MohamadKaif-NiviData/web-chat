# Why: Conversation currently has no way to say "this is a group" or to
# store a group name — every conversation today is implicitly 1-to-1.
# Participant needs ZERO changes here — it's already a plain join table
# between conversations and users (many-to-many), so it already supports
# any number of members per conversation without touching its columns.
#
# Plain-English steps:
# 1. Add `is_group: Mapped[bool] = mapped_column(default=False)` — SQLAlchemy
#    infers the Boolean column type from the `Mapped[bool]` annotation, no
#    explicit `Boolean` import needed.
# 2. Add `name: Mapped[str | None] = mapped_column(String(255), nullable=True)`
#    — null for 1-to-1 conversations; the frontend shows the OTHER
#    participant's display_name instead in that case (computed by the route,
#    never stored for 1-to-1s).
# 3. No Alembic in this project (see Step 3) — `conversations` already has
#    rows from Phase 1 testing, so `create_all()` won't retroactively add
#    these columns to the existing table. Either `docker compose down -v` to
#    drop and recreate everything fresh, or run
#    `ALTER TABLE conversations ADD COLUMN is_group BOOLEAN DEFAULT false;`
#    and `ALTER TABLE conversations ADD COLUMN name VARCHAR(255);` by hand
#    against Postgres.

from app.db.base import Base
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, DateTime, func, ForeignKey
from datetime import datetime


class Conversation(Base):
    __tablename__ = "conversations"
    id : Mapped[int] = mapped_column(primary_key=True)
    created_at : Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_group : Mapped[bool] = mapped_column(default=False)
    name: Mapped[str] = mapped_column(String(255), nullable=True)

class Participant(Base):
    __tablename__ = "participants"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


    