from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.schemas.push_subscription import PushSubscriptionRequest, UnsubscribeRequest

router = APIRouter()


@router.get("/vapid-public-key")
async def get_vapid_public_key():
    # Not a secret — this is the exact value every subscribing browser
    # already receives as `applicationServerKey`. Unauthenticated so the
    # frontend can fetch it before the user has logged in.
    return {"public_key": settings.vapid_public_key}


@router.post("/subscribe")
async def subscribe(
    payload: PushSubscriptionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint)
    )
    subscription = result.scalar_one_or_none()

    if subscription:
        subscription.user_id = current_user.id
        subscription.p256dh = payload.keys.p256dh
        subscription.auth = payload.keys.auth
    else:
        subscription = PushSubscription(
            user_id=current_user.id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
        )
        db.add(subscription)

    await db.commit()
    return {"status": "subscribed"}


@router.delete("/subscribe")
async def unsubscribe(
    payload: UnsubscribeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint == payload.endpoint,
            PushSubscription.user_id == current_user.id,
        )
    )
    subscription = result.scalar_one_or_none()
    if subscription:
        await db.delete(subscription)
        await db.commit()

    return {"status": "unsubscribed"}
