# Why: this is the actual live connection — the one endpoint that isn't
# request/response but stays open, letting the server push data to the
# client without the client asking again.
#
# Plain-English steps:
# 1. Import `APIRouter`, `WebSocket`, `WebSocketDisconnect`, `Query`,
#    `Depends` from `fastapi`; `AsyncSession` from `sqlalchemy.ext.asyncio`;
#    `select` from `sqlalchemy`; `JWTError` from `jose`; `decode_token` from
#    `app.core.security`; `get_db` from `app.db.session`; `Participant` from
#    `app.models.conversation`; `Message` from `app.models.message`;
#    `MessageResponse` from `app.schemas.message`; `manager` from
#    `app.services.connection_manager`.
# 2. `router = APIRouter()`, then
#    `@router.websocket("/ws/chat/{conversation_id}")`.
# 3. Signature:
#    ```
#    async def chat_endpoint(
#        websocket: WebSocket,
#        conversation_id: int,
#        token: str = Query(...),
#        db: AsyncSession = Depends(get_db),
#    ):
#    ```
#    NOTE: `token` comes from a query param (`?token=...`), NOT the
#    `Authorization` header — browsers' native WebSocket API can't set
#    custom headers on the handshake request, so passing the JWT as a query
#    param is the standard workaround for WebSocket auth. This means
#    `get_current_user` (built around `OAuth2PasswordBearer`, which reads
#    headers) can't be reused as-is here — its logic gets manually repeated
#    below instead.
# 4. Decode the token manually:
#    ```
#    try:
#        user_id = int(decode_token(token))
#    except JWTError:
#        await websocket.close(code=1008)
#        return
#    ```
#    You can't raise an `HTTPException` after a WebSocket handshake starts —
#    closing the socket (code 1008 = "policy violation") is the equivalent.
# 5. Authorization check — confirm `user_id` is actually a `Participant` in
#    `conversation_id` (same principle as the HTTP history endpoint in
#    `conversations.py`); close the socket the same way if not.
# 6. `await manager.connect(user_id, websocket)`.
# 7. Main loop:
#    ```
#    try:
#        while True:
#            data = await websocket.receive_json()
#            message = Message(
#                conversation_id=conversation_id,
#                sender_id=user_id,
#                content=data["content"],
#            )
#            db.add(message)
#            await db.commit()
#            await db.refresh(message)
#
#            other = await db.execute(
#                select(Participant.user_id).where(
#                    Participant.conversation_id == conversation_id,
#                    Participant.user_id != user_id,
#                )
#            )
#            other_user_id = other.scalar_one_or_none()
#            if other_user_id is not None:
#                payload = MessageResponse.model_validate(message).model_dump(mode="json")
#                await manager.send_to_user(other_user_id, payload)
#    except WebSocketDisconnect:
#        manager.disconnect(user_id, websocket)
#    ```
#    - `mode="json"` on `model_dump()` matters: it converts the `datetime`
#      field to a JSON-safe string — `send_json()` can't serialize a raw
#      Python `datetime` object on its own.
#    - `WebSocketDisconnect` is how you detect the tab closed / connection
#      dropped — there's no explicit "goodbye" message from the client in
#      the normal case.

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

PRESENCE_REFRESH_INTERVAL = 10  # must stay well under presence.ONLINE_TTL_SECONDS (30)


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