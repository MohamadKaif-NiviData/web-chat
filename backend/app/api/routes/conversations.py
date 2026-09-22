# Why: creating a conversation and fetching message history are normal
# request/response HTTP operations — no persistent connection needed, so
# they get their own regular FastAPI routes (unlike the WebSocket in
# app/api/ws/chat.py).
#
# Plain-English steps:
# 1. Import `APIRouter`, `HTTPException`, `Depends`, `Query` from `fastapi`;
#    `AsyncSession` from `sqlalchemy.ext.asyncio`; `select` from
#    `sqlalchemy`; `get_db` from `app.db.session`; `get_current_user` from
#    `app.api.deps`; `User` from `app.models.user`; `Conversation`,
#    `Participant` from `app.models.conversation`; `Message` from
#    `app.models.message`; `MessageResponse`, `MessagePage` from
#    `app.schemas.message`.
# 2. `router = APIRouter()`.
#
# 3. Create/get conversation —
#    `@router.post("/", response_model=...)` (define a small inline
#    response, or reuse an existing shape — e.g. just return the
#    conversation id: `{"conversation_id": int}`):
#    - Take `other_user_id: int` (e.g. via a tiny request body model) and
#      `current_user: User = Depends(get_current_user)`,
#      `db: AsyncSession = Depends(get_db)`.
#    - Find an existing conversation between exactly these two users: query
#      `Participant` for conversation ids where `user_id == current_user.id`,
#      then check which of those conversation ids ALSO have a `Participant`
#      row for `user_id == other_user_id`. (One way: two queries and
#      intersect the id sets in Python — simplest to read while learning;
#      a single SQL join/subquery is the more "production" version once
#      you're comfortable.)
#    - If found, return that conversation's id.
#    - If not found: create a new `Conversation()`, `db.add`, `commit`,
#      `refresh` (to get its id), then create TWO `Participant` rows (one
#      for `current_user.id`, one for `other_user_id`) pointing at it,
#      `db.add` both, `commit`. Return the new conversation's id.
#
# 4. Message history —
#    `@router.get("/{conversation_id}/messages", response_model=MessagePage)`:
#    - Take `conversation_id: int` (path), `cursor: int | None = Query(None)`,
#      `limit: int = Query(20)`, `current_user`, `db` as above.
#    - AUTHORIZATION CHECK FIRST: query `Participant` to confirm
#      `current_user.id` is actually a participant of `conversation_id` — if
#      not, raise `HTTPException(status_code=403)`. Never trust the URL
#      alone to prove someone's allowed to read a conversation's messages.
#    - Query `Message` where `conversation_id` matches, adding
#      `Message.id < cursor` if `cursor` was given, ordered by
#      `Message.id.desc()`, limited to `limit + 1` rows.
#    - If you got back more than `limit` rows: `next_cursor` = the id of the
#      row at index `limit - 1` (the last one you're actually returning),
#      and drop the extra row before returning. If you got back `limit` or
#      fewer: `next_cursor = None` (no more pages).
#    - Return a `MessagePage(messages=..., next_cursor=...)`.
#    - Why this is "keyset" pagination and not `OFFSET`: filtering by
#      "id less than the last one you saw" stays fast no matter how far back
#      you page, since Postgres can jump straight there using the index;
#      `OFFSET n` gets slower the deeper you paginate, since the db still
#      has to scan and discard every skipped row first.

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.conversation import Conversation, Participant
from app.models.message import Message
from app.schemas.message import MessageResponse, MessagePage
from app.schemas.conversation import ConversationResponse

router = APIRouter()

@router.post("/", response_model=ConversationResponse)
async def create_or_get_conversation(other_user_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Check if a conversation already exists between the two users
    result = await db.execute(
        select(Participant.conversation_id)
        .where(Participant.user_id == current_user.id)
    )
    user_conversations = {row[0] for row in result.fetchall()}

    result = await db.execute(
        select(Participant.conversation_id)
        .where(Participant.user_id == other_user_id)
    )
    other_user_conversations = {row[0] for row in result.fetchall()}

    common_conversations = user_conversations.intersection(other_user_conversations)

    if common_conversations:
        conversation_id = common_conversations.pop()
        return ConversationResponse(conversation_id=conversation_id)

    # Create a new conversation
    new_conversation = Conversation()
    db.add(new_conversation)
    await db.commit()
    await db.refresh(new_conversation)

    # Add participants
    participant1 = Participant(conversation_id=new_conversation.id, user_id=current_user.id)
    participant2 = Participant(conversation_id=new_conversation.id, user_id=other_user_id)
    db.add_all([participant1, participant2])
    await db.commit()

    return {"conversation_id": new_conversation.id}


@router.get("/{conversation_id}/messages", response_model=MessagePage)
async def get_message_history(conversation_id: int, cursor: int | None = Query(None), limit: int = Query(20), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Authorization check
    result = await db.execute(
        select(Participant)
        .where(Participant.conversation_id == conversation_id)
        .where(Participant.user_id == current_user.id)
    )
    participant = result.scalar_one_or_none()
    if not participant:
        raise HTTPException(status_code=403, detail="Not authorized to view this conversation")

    # Fetch messages
    query = select(Message).where(Message.conversation_id == conversation_id)
    if cursor:
        query = query.where(Message.id < cursor)
    query = query.order_by(Message.id.desc()).limit(limit + 1)

    result = await db.execute(query)
    messages = result.scalars().all()

    next_cursor = None
    if len(messages) > limit:
        next_cursor = messages[limit - 1].id
        messages = messages[:limit]

    return MessagePage(messages=messages, next_cursor=next_cursor)    