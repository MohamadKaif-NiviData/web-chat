# Why: Alembic's autogenerate (see GUIDE.md Step 3) works by comparing the
# ACTUAL Postgres schema against a single "this is what the schema SHOULD
# look like" object — that object is Base.metadata. Every model needs to
# inherit from the SAME Base instance, or Alembic won't see them all as one
# combined schema. This file's only job is to be that one shared Base, and
# to make sure every model module actually gets imported (Python only
# registers a table on Base.metadata once its class body has executed) —
# a model file that's never imported is invisible to Alembic, even though
# the class technically exists.
#
# Plain-English steps:
# 1. Import DeclarativeBase from sqlalchemy.orm (this is the SQLAlchemy 2.0
#    style — subclassing it, not calling declarative_base()).
# 2. Define `class Base(DeclarativeBase): pass` — this is the class every
#    model (User, Conversation, Participant, Message) will inherit from.
# 3. At the BOTTOM of this file (after Base is defined), import every model
#    module, e.g. `from app.models import user, conversation, message` —
#    even though nothing here calls them directly. The import's side effect
#    (running the class body, which registers the table on Base.metadata)
#    is the whole point. This is also why `app/db/base.py` — not
#    `app/models/__init__.py` — is what Alembic's env.py will import.
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass



from app.models import user, conversation, message