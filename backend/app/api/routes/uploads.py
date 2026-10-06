from uuid import uuid4

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.conversation import Participant
from app.models.user import User
from app.schemas.attachment import PresignUploadRequest, PresignUploadResponse
from app.core.config import presigned_put_url, settings

router = APIRouter()

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"}
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/{conversation_id}/presign", response_model=PresignUploadResponse)
async def presign_upload(
    conversation_id: int,
    payload: PresignUploadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a presigned URL for uploading a file to S3.
    """
    result = await db.execute(
        select(Participant)
        .where(Participant.conversation_id == conversation_id)
        .where(Participant.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not authorized to upload into this conversation")

    if payload.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Content type '{payload.content_type}' is not allowed")

    if payload.size_bytes > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=400, detail=f"File exceeds the {MAX_UPLOAD_SIZE_BYTES} byte limit")

    # uuid4 prefix avoids collisions between two uploads of a same-named file
    # in the same conversation.
    object_key = f"conversations/{conversation_id}/{uuid4()}-{payload.filename}"

    upload_url = presigned_put_url(settings.s3_bucket_name, object_key)

    if not upload_url:
        raise HTTPException(status_code=500, detail="Failed to generate presigned URL")

    return PresignUploadResponse(upload_url=upload_url, object_key=object_key)
