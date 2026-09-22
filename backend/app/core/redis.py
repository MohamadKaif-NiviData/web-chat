# Why: same reasoning as app/db/session.py — one shared Redis client that
# every other file imports, instead of each file opening its own connection
# to Redis.
#
# Plain-English steps:
# 1. Import `redis.asyncio` as `redis` (async support has been built into
#    the `redis` package itself since v4.2+ — no separate library needed)
#    and `settings` from `app.core.config`.
# 2. `redis_client = redis.from_url(settings.redis_url, decode_responses=True)`
#    — `decode_responses=True` means reads come back as normal Python `str`,
#    not raw `bytes`.
import redis.asyncio as redis
from app.core.config import settings

redis_client = redis.from_url(settings.redis_url, decode_responses=True)
