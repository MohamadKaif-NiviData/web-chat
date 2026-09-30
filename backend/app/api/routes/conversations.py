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
from app.schemas.conversation import ConversationResponse, ConversationSummary, ParticipantSummary, GroupCreateRequest
from app.services.presence import is_online

router = APIRouter()


# Why: every conversation-shaped read/write already lives in this file;
# group creation is one more endpoint on the same resource, not a new
# subsystem.
#
# Plain-English steps for a new `POST /conversations/group` route (body:
# GroupCreateRequest, behind get_current_user):
# 1. Look up every email in `member_emails` (same query app/api/routes/users.py's
#    `/lookup` already does — select(User).where(User.email == email)).
#    If ANY email doesn't resolve to a user, fail the WHOLE request with 404
#    listing which email(s) didn't resolve — don't create a half-formed
#    group. All-or-nothing, not partial success.
# 2. Create one `Conversation(is_group=True, name=payload.name)`, `db.add`,
#    `commit`, `refresh` (to get its id).
# 3. Create a `Participant` row for `current_user.id` AND for every resolved
#    member's id, `add_all`, `commit`.
# 4. Return the same `ConversationResponse` shape the 1-to-1 endpoint below
#    already returns (`{"conversation_id": ...}`) — the frontend doesn't
#    need to know or care whether what it just created is a group.
@router.post("/group", response_model=ConversationResponse)
async def create_group_conversation(payload: GroupCreateRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Look up users by email
    result = await db.execute(
        select(User).where(User.email.in_(payload.member_emails))
    )
    users = result.scalars().all()

    found_emails = {user.email for user in users}
    missing_emails = set(payload.member_emails) - found_emails
    if missing_emails:
        raise HTTPException(
            status_code=404,
            detail=f"No user found for: {', '.join(sorted(missing_emails))}",
        )

    conversation = Conversation(is_group=True, name=payload.name)
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)

    participants = [Participant(conversation_id=conversation.id, user_id=current_user.id)] + [
        Participant(conversation_id=conversation.id, user_id=user.id) for user in users
    ]
    db.add_all(participants)
    await db.commit()

    return ConversationResponse(conversation_id=conversation.id)



# Why: this currently assumes exactly one "other" participant per
# conversation (a single scalar_one_or_none()), which only works for 1-to-1s.
# Groups can have any number of other participants, so this needs to fetch
# ALL of them, not just one.
#
# Plain-English steps to rewrite this function:
# 1. Also SELECT the `Conversation` row itself for each conversation_id (not
#    just `Participant.conversation_id` like now) — you need its `is_group`
#    and `name` columns.
# 2. Change the "other_result" query below to NOT assume one row: drop
#    `.scalar_one_or_none()`, use `.scalars().all()` instead — this can
#    legitimately return many User rows now for a group.
# 3. Build the summary's `name`: if `is_group`, use the conversation's own
#    `name`; if not (1-to-1), use the (single) other participant's
#    `display_name` — same value the old `other_user` field used to hold.
# 4. Build `participants: list[ParticipantSummary]` from ALL the other
#    users fetched in step 2 (was just one `ParticipantSummary` before).
# 5. Last-message + sort-by-recency logic below stays exactly the same.
@router.get("/", response_model=list[ConversationSummary])
async def list_conversations(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Participant.conversation_id)
        .where(Participant.user_id == current_user.id)

    )
    conversation_ids = [row[0] for row in result.fetchall()]
    conversation_result = await db.execute(
        select(Conversation)
        .where(Conversation.id.in_(conversation_ids))
    )
    conversations = {conv.id: conv for conv in conversation_result.scalars().all()}

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
        other_users = other_result.scalars().all()
        if not other_users:
            # No other participant left (e.g. a self-conversation edge case) — skip it.
            continue

        conversation = conversations[conversation_id]

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
                is_group=conversation.is_group,
                name=conversation.name if conversation.is_group else other_users[0].display_name,
                participants=[ParticipantSummary(
                    id=user.id,
                    email=user.email,
                    display_name=user.display_name,
                    is_online=await is_online(user.id),
                ) for user in other_users],
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


# Why: the frontend's conversation page only knows the conversation_id from
# the URL — it has no cheap way to get THIS conversation's participant
# names (for showing "Alice: hello" style sender labels in a group) or
# group name for the header bar, without either re-fetching the whole list
# above and filtering client-side, or a dedicated single-conversation route.
# The dedicated route is simpler and cheaper.
#
# Plain-English steps for a new `GET /conversations/{conversation_id}` route:
# 1. Same authorization check as get_message_history above (current user
#    must be a Participant of conversation_id, else 403) — never trust the
#    URL alone.
# 2. Build and return the exact same ConversationSummary shape as one item
#    from list_conversations — same is_group/name/participants/last_message
#    logic, just scoped to this one conversation_id instead of looping over
#    all of them.
@router.get("/{conversation_id}", response_model=ConversationSummary)
async def get_conversation(conversation_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Authorization check
    result = await db.execute(
        select(Participant)
        .where(Participant.conversation_id == conversation_id)
        .where(Participant.user_id == current_user.id)
    )
    participant = result.scalar_one_or_none()
    if not participant:
        raise HTTPException(status_code=403, detail="Not authorized to view this conversation")

    # Fetch the conversation
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Fetch other participants
    result = await db.execute(
        select(User)
        .join(Participant, Participant.user_id == User.id)
        .where(
            Participant.conversation_id == conversation_id,
            Participant.user_id != current_user.id,
        )
    )
    other_users = result.scalars().all()

    # Build the summary
    last_message_result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.id.desc())
        .limit(1)
    )
    last_message = last_message_result.scalar_one_or_none()

    return ConversationSummary(
        conversation_id=conversation_id,
        is_group=conversation.is_group,
        name=conversation.name if conversation.is_group else (other_users[0].display_name if other_users else ""),
        participants=[ParticipantSummary(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            is_online=await is_online(user.id),
        ) for user in other_users],
        last_message=MessageResponse.model_validate(last_message) if last_message else None,
    )