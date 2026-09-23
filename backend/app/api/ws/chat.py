import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import JWTError
from app.core.security import decode_token
from app.db.session import get_db
from app.models.conversation import Participant
from app.models.message import Message
from app.schemas.message import MessageResponse
from app.services.connection_manager import manager
from app.services.presence import set_online, set_offline


router = APIRouter()

PRESENCE_REFRESH_INTERVAL = 10


async def _presence_heartbeat(user_id: int):
    while True:
        await asyncio.sleep(PRESENCE_REFRESH_INTERVAL)
        await set_online(user_id)

@router.websocket("/ws/chat/{conversation_id}")
async def chat_endpoint(
    websocket: WebSocket,
    conversation_id: int,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = int(decode_token(token))
    except JWTError:
        await websocket.close(code=1008)
        return

    # Authorization check
    result = await db.execute(
        select(Participant)
        .where(Participant.conversation_id == conversation_id)
        .where(Participant.user_id == user_id)
    )
    participant = result.scalar_one_or_none()
    if not participant:
        await websocket.close(code=1008)
        return

    await manager.connect(user_id, websocket)
    await set_online(user_id)
    heartbeat_task = asyncio.create_task(_presence_heartbeat(user_id))

    try:
        while True:
            data = await websocket.receive_json()

            other = await db.execute(
                select(Participant.user_id).where(
                    Participant.conversation_id == conversation_id,
                    Participant.user_id != user_id,
                )
            )
            other_user_id = other.scalar_one_or_none()

            if data.get("type") == "typing":
                if other_user_id is not None:
                    await manager.send_to_user(
                        other_user_id, {"type": "typing", "user_id": user_id}
                    )
                continue

            message = Message(
                conversation_id=conversation_id,
                sender_id=user_id,
                content=data["content"],
            )
            db.add(message)
            await db.commit()
            await db.refresh(message)

            if other_user_id is not None:
                payload = MessageResponse.model_validate(message).model_dump(mode="json")
                await manager.send_to_user(other_user_id, payload)
    except WebSocketDisconnect:
        pass

    finally:
        heartbeat_task.cancel()
        manager.disconnect(user_id, websocket)
        await set_offline(user_id)