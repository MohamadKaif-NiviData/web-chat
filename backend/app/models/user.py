# Why: this table is the source of truth for "who can log in." Every other
# table (Participant, Message) points back to a user by id via a foreign
# key, so this model has to exist before those can reference it.
#
# Plain-English steps:
# 1. Import `Base` from `app.db.base`, plus SQLAlchemy 2.0-style column
#    tools: `Mapped`, `mapped_column` from `sqlalchemy.orm`, and types like
#    `String`, `DateTime` from `sqlalchemy`, plus `datetime` for the default.
# 2. Define `class User(Base):` with `__tablename__ = "users"`.
# 3. Columns:
#    - `id: Mapped[int] = mapped_column(primary_key=True)` — auto-incrementing
#      primary key.
#    - `email: Mapped[str] = mapped_column(String, unique=True, index=True,
#      nullable=False)` — unique + indexed because you'll look up users by
#      email on every login.
#    - `hashed_password: Mapped[str] = mapped_column(String, nullable=False)`
#      — store ONLY what `hash_password()` from security.py produces, never
#      plain text.
#    - `display_name: Mapped[str] = mapped_column(String, nullable=False)`.
#    - `created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
#      server_default=func.now())` — `server_default` (needs
#      `from sqlalchemy import func`) means Postgres itself stamps the time
#      on insert, so it's correct even if inserted from a raw SQL client,
#      not just through this model.


from app.db.base import Base
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, DateTime, func
from datetime import datetime

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    created_at:Mapped[datetime] =mapped_column(DateTime(timezone=True), server_default=func.now())

