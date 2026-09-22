# Why: replaces the Alembic migration setup we removed. For this stage of
# the project (no real data yet, schema still likely to change), the
# simplest correct thing is: on every app startup, make sure every table
# your models define actually exists in Postgres. `Base.metadata.create_all`
# does exactly that — it's a no-op for tables that already exist, and
# creates any that are missing.
#
# Trade-off to keep in mind (not solved by this file): create_all() only
# CREATES missing tables — it never ALTERS an existing table. If you change
# a model after its table already exists (e.g. add a column to User),
# nothing here will apply that change. While there's no real data yet, the
# fix is `docker compose down -v` (drops the Postgres volume) so the next
# startup creates everything fresh from the current models. Once there's
# real data you can't lose, that's the point to bring a migration tool
# (like Alembic) back.
#
# Plain-English steps:
# 1. Import `Base` from `app.db.base` (this also imports all three model
#    modules via base.py's own bottom-of-file imports, so their tables are
#    registered on Base.metadata before this runs).
# 2. Import `engine` from `app.db.session`.
# 3. Write:
#    ```
#    async def init_models():
#        async with engine.begin() as conn:
#            await conn.run_sync(Base.metadata.create_all)
#    ```
#    - `engine.begin()` opens a connection with a transaction already
#      active — anything inside commits together, or rolls back together.
#    - `Base.metadata.create_all` is a normal SYNC function (SQLAlchemy
#      wrote it long before async existed). `conn.run_sync(...)` is the
#      bridge that lets your async engine call it anyway — it runs that
#      sync function using the async connection under the hood.

from app.db.base import Base
from app.db.session import engine
async def init_models():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)