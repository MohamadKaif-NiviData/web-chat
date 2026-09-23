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
