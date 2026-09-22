# Why: online/offline status is inherently transient — nobody needs to
# query "was Alice online three days ago," so this doesn't belong in
# Postgres. Redis fits naturally here because of its TTL (auto-expiring
# key) support, which a plain Python dict doesn't give you for free.
#
# Plain-English steps:
# 1. Import `redis_client` from `app.core.redis`.
# 2. `ONLINE_TTL_SECONDS = 30` (or similar) — how long a presence key
#    survives before Redis deletes it automatically if nothing refreshes it.
# 3. `async def set_online(user_id: int):`
#    `await redis_client.set(f"presence:{user_id}", "online", ex=ONLINE_TTL_SECONDS)`
# 4. `async def set_offline(user_id: int):`
#    `await redis_client.delete(f"presence:{user_id}")`
# 5. `async def is_online(user_id: int) -> bool:`
#    `return await redis_client.exists(f"presence:{user_id}") == 1`
#
# Why the TTL matters even though chat.py calls set_offline() on disconnect:
# if the server process crashes, or a connection drops in a way that never
# reaches the `finally` block (e.g. the container gets killed outright),
# there'd be no explicit "offline" call — a stale "online" key would stay
# forever with a plain key/value store. The TTL is a self-healing safety
# net: worst case, a phantom online status clears itself within
# ONLINE_TTL_SECONDS on its own, with no manual cleanup code needed.

from app.core.redis import redis_client

ONLINE_TTL_SECONDS= 30

def get_presence_key(user_id: int) -> str:
    return f"presence:{user_id}"

async def set_online(user_id:int):
    return await redis_client.set(get_presence_key(user_id=user_id), "online", ex=ONLINE_TTL_SECONDS)

async def set_offline(user_id:int):
    return await redis_client.delete(get_presence_key(user_id=user_id))

async def is_online(user_id: int):
    return await redis_client.exists(get_presence_key(user_id=user_id)) == 1
