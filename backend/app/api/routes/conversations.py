from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.conversation import Conversation, Participant
from app.models.message import Message
from app.schemas.message import MessageResponse, MessagePage
from app.schemas.conversation import ConversationResponse, ConversationSummary, ParticipantSummary
from app.services.presence import is_online

router = APIRouter()


@router.get("/", response_model=list[ConversationSummary])
async def list_conversations(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Participant.conversation_id).where(Participant.user_id == current_user.id)
    )
    conversation_ids = [row[0] for row in result.fetchall()]

    summaries = []
    for conversation_id in conversation_ids:
        other_result = await db.execute(
            select(User)
            .join(Participant, Participant.user_id == User.id)
            .where(
                Participant.conversation_id == conversation_id,
                Participant.user_id != current_user.id,
            )
        )
        other_user = other_result.scalar_one_or_none()
        if other_user is None:
            # No other participant left (e.g. a self-conversation edge case) — skip it.
            continue

        last_message_result = await db.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.id.desc())
            .limit(1)
        )
        last_message = last_message_result.scalar_one_or_none()

        summaries.append(
            ConversationSummary(
                conversation_id=conversation_id,
                other_user=ParticipantSummary(
                    id=other_user.id,
                    email=other_user.email,
                    display_name=other_user.display_name,
                    is_online=await is_online(other_user.id),
                ),
                last_message=MessageResponse.model_validate(last_message) if last_message else None,
            )
        )

    epoch = datetime.min.replace(tzinfo=timezone.utc)
    summaries.sort(key=lambda s: s.last_message.created_at if s.last_message else epoch, reverse=True)
    return summaries

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