# Why: every API route that touches Postgres needs a db session, but
# opening a raw connection per query (or sharing one global connection
# across all requests) is wrong in both directions — too slow, or unsafe
# under concurrent requests. The standard fix is one shared connection POOL
# (the "engine") plus a fresh, short-lived session handed to each request,
# closed when that request finishes. This file is the one place that builds
# both, so routes never construct their own connection.
#
# Plain-English steps:
# 1. Import `create_async_engine` and `async_sessionmaker` from
#    `sqlalchemy.ext.asyncio`, and `settings` from `app.core.config`.
# 2. Build the engine once at module level:
#    `engine = create_async_engine(settings.database_url, echo=True)` —
#    `settings.database_url` already has the right `postgresql+asyncpg://`
#    scheme (fixed in the root `.env`), so no transformation needed here.
#    `echo=True` logs every SQL statement, useful while learning/debugging,
#    turn it off later.
# 3. Build a session factory once at module level:
#    `AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)`
#    — `expire_on_commit=False` matters here because otherwise, after you
#    commit and later access an attribute on that same object (e.g. return
#    it from a route after saving), SQLAlchemy would try to re-fetch it and
#    crash on an already-closed async session.
# 4. Write the dependency every route will use:
#    ```
#    async def get_db():
#        async with AsyncSessionLocal() as session:
#            yield session
#    ```
#    FastAPI calls this per-request, runs your route with `session` injected
#    (via `Depends(get_db)`), then resumes this generator after the route
#    returns — the `async with` block closes the session automatically at
#    that point, whether the route succeeded or raised.

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.core.config import settings

engine = create_async_engine(settings.database_url, echo=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session