# File/Image Upload — Backend Implementation Steps (Step 12)

Follow these in order — each step builds on the last and should leave the
app in a working (if incomplete) state. For the full design rationale, see
`GUIDE.md`'s Step 12 section; for acceptance criteria, see
`FILE_UPLOAD_USER_STORIES.md`.

---

## 0. One-time manual AWS setup (not code)

**Why**: an S3 bucket name is globally unique and a real, billable resource
— not something an app should create for itself on every startup the way it
creates database tables.

**Steps**:
1. In the AWS Console, create an S3 bucket (pick a globally-unique name,
   e.g. `yourname-chat-uploads`). Leave "Block all public access" ON.
2. Create an IAM user with a policy scoped to ONLY this bucket:
   `s3:PutObject`, `s3:GetObject`, `s3:HeadBucket` on
   `arn:aws:s3:::your-bucket-name` and  `arn:aws:s3:::your-bucket-name/*`.
3. Generate an access key pair for that IAM user. Never use your AWS root
   account's keys here.

---

## 1. `.env` (modify)

**Why**: secrets and environment-specific config live here, same as every
other credential this project already uses.

**Steps**:
1. Add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
   `S3_BUCKET_NAME` with the values from Step 0.
2. No `docker-compose.yml` changes needed — `backend-chat-app` already does
   `env_file: .env`, so these are automatically available in the container.

---

## 2. `backend/requirements.txt` (modify)

**Why**: `boto3` is the AWS SDK that talks to S3 (and would talk to MinIO
identically, if you ever swap later).

**Steps**:
1. Add a line: `boto3` (pin a version if you want reproducible builds).

---

## 3. `backend/app/core/config.py` (modify)

**Why**: every other file should read these values through `settings`, not
`os.environ` directly — same reasoning as every existing field on this
class.

**Steps**:
1. Add four fields to the existing `Settings` class: `aws_access_key_id: str`,
   `aws_secret_access_key: str`, `aws_region: str`, `s3_bucket_name: str`.

---

## 4. `backend/app/core/storage.py` (new)

**Why**: one shared S3 client, created once, instead of every route
constructing its own — same reasoning as `db/session.py` and `core/redis.py`.

**Steps**:
1. Create `s3_client = boto3.client("s3", region_name=settings.aws_region, aws_access_key_id=settings.aws_access_key_id, aws_secret_access_key=settings.aws_secret_access_key)`.
2. Write `async def verify_bucket()`: call `s3_client.head_bucket(Bucket=settings.s3_bucket_name)` in a try/except; if it raises, raise a clear
   error telling you the bucket doesn't exist or these credentials can't see
   it. Do NOT auto-create the bucket here.
3. Write `def presigned_put_url(object_key: str, content_type: str) -> str`,
   wrapping `s3_client.generate_presigned_url("put_object", Params={"Bucket": settings.s3_bucket_name, "Key": object_key, "ContentType": content_type}, ExpiresIn=300)`.
4. Write `def presigned_get_url(object_key: str) -> str`, same pattern with
   `"get_object"`, `Params={"Bucket": ..., "Key": object_key}`,
   `ExpiresIn=3600`.

---

## 5. `backend/app/models/attachment.py` (new)

**Why**: a message that carries a file needs somewhere to record WHAT file
— a genuinely new table, same reasoning as `MessageRead` in Step 10.

**Steps**:
1. Define `class Attachment(Base)`, `__tablename__ = "attachments"`.
2. Columns: `id` (primary key), `message_id` (`ForeignKey("messages.id")`),
   `object_key: str`, `original_filename: str`, `mime_type: str`,
   `size_bytes: int`, `created_at` (same `DateTime(timezone=True),
   server_default=func.now()` pattern as every other model's `created_at`).
3. Note: `object_key`, not a full URL — a stored URL would go stale since
   presigned URLs expire; always regenerate at read time instead.

---

## 6. `backend/app/db/base.py` (modify)

**Why**: a model that's never imported never registers on `Base.metadata`,
so `create_all()` won't create its table — same reasoning every model file
here already follows.

**Steps**:
1. Add `attachment` to the existing import line:
   `from app.models import user, conversation, message, message_read, attachment`.

---

## 7. `backend/app/schemas/attachment.py` (new)

**Why**: request/response shapes for the upload flow, kept separate from DB
models — same reasoning as every other `schemas/` file in this project.

**Steps**:
1. `class PresignUploadRequest(BaseModel)`: `filename: str`,
   `content_type: str`, `size_bytes: int`.
2. `class PresignUploadResponse(BaseModel)`: `upload_url: str`,
   `object_key: str`.
3. `class AttachmentResponse(BaseModel)`: `id: int`, `download_url: str`,
   `original_filename: str`, `mime_type: str`, `size_bytes: int`.

---

## 8. `backend/app/schemas/message.py` (modify)

**Why**: `MessageResponse` needs to carry attachment info to the frontend —
computed at read time, not a real column, same idea as the existing
`read_by` field.

**Steps**:
1. Import `AttachmentResponse` from `app.schemas.attachment`.
2. Add `attachment: AttachmentResponse | None = None` to `MessageResponse`.

---

## 9. `backend/app/api/routes/uploads.py` (new)

**Why**: requesting permission to upload is a plain request/response
action, separate from the WebSocket's job of relaying live chat events —
same separation `conversations.py` already has between HTTP actions and
`chat.py`'s live relay.

**Steps**:
1. `router = APIRouter()`.
2. `@router.post("/conversations/{conversation_id}/presign", response_model=PresignUploadResponse)`,
   signature `(conversation_id: int, payload: PresignUploadRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db))`.
3. Authorization: query `Participant` for `conversation_id` +
   `current_user.id`, same pattern `conversations.py` already uses
   everywhere — 403 if not found.
4. Validate `payload.content_type` against an allow-list (pick your own —
   e.g. `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`)
   and `payload.size_bytes` against a cap (e.g. `10 * 1024 * 1024`) — 400 if
   either check fails.
5. Build `object_key = f"conversations/{conversation_id}/{uuid4()}-{payload.filename}"`
   (`from uuid import uuid4`).
6. Call `presigned_put_url(object_key, payload.content_type)` from
   `storage.py`, return `PresignUploadResponse(upload_url=..., object_key=object_key)`.

---

## 10. `backend/app/main.py` (modify)

**Why**: a route only becomes reachable once it's registered on `app`, and
the bucket needs to be verified to exist before the app starts accepting
traffic.

**Steps**:
1. Add `from app.api.routes import uploads` alongside the existing
   `from app.api.routes import auth, conversations, users` imports.
2. Add `app.include_router(uploads.router, prefix="/uploads", tags=["uploads"])`
   alongside the existing `include_router` calls — this makes Step 9's route
   reachable at `POST /uploads/conversations/{conversation_id}/presign`.
3. Import `verify_bucket` from `app.core.storage`.
4. In the existing `lifespan` function, add `await verify_bucket()`
   alongside the existing `await init_models()`.

**Checkpoint**: `docker compose up --build` should start cleanly (confirms
`verify_bucket()` found your bucket). If it fails here, re-check Step 0/1
before moving on.

---

## 11. `backend/app/api/ws/chat.py` (modify)

**Why**: sending a file message is still "a message in this conversation" —
it reuses the exact same create → relay → self-echo flow already built for
text in Step 11, just with an optional attachment riding along.

**Steps**:
1. Find the existing `Message(conversation_id=conversation_id, sender_id=user_id, content=data["content"])` line. Add `type=data.get("type", "text")`.
2. After `await db.commit()` / `await db.refresh(message)`, add: if
   `data.get("object_key")` is present, create
   `Attachment(message_id=message.id, object_key=data["object_key"], original_filename=data["original_filename"], mime_type=data["mime_type"], size_bytes=data["size_bytes"])`,
   `db.add`, `await db.commit()`.
3. When building the payload that gets relayed to other participants AND
   echoed back to the sender (same payload, used in both places already),
   if the message has an attachment: call
   `presigned_get_url(attachment.object_key)` and embed it as
   `payload["attachment"] = {"id": attachment.id, "download_url": ..., "original_filename": ..., "mime_type": ..., "size_bytes": ...}`.
   Generate this fresh every time — never store or reuse a URL.
4. Everything else (relay-to-others loop, then self-echo) is unchanged.

---

## 12. `backend/app/api/routes/conversations.py` (modify)

**Why**: past attachments need to show up in history too, with a freshly
generated (not stale) download URL — same batching spirit as the existing
`read_by` logic in this same function.

**Steps**:
1. In `get_message_history`, after fetching the page's `Message` rows,
   batch-fetch matching `Attachment` rows in ONE query:
   `select(Attachment).where(Attachment.message_id.in_([m.id for m in messages]))`.
2. Build a `dict[int, Attachment]` keyed by `message_id` from the results.
3. When constructing each `MessageResponse`, if that message's id has a
   matching attachment, call `presigned_get_url(attachment.object_key)` and
   pass `attachment=AttachmentResponse(id=..., download_url=..., original_filename=..., mime_type=..., size_bytes=...)` — else `attachment=None`.

---

## Verification checklist

Work through these as you complete each step above — don't wait until the
end to test everything at once.

- **After Step 4**: a one-off Python shell call to `verify_bucket()`
  succeeds against your real bucket (no exception raised).
- **After Step 10**: `docker compose up --build` starts cleanly.
- **Presign endpoint**: `curl`/Postman
  `POST /uploads/conversations/{id}/presign` with a valid image
  content-type/size as a real participant → 200 with `upload_url` +
  `object_key`. Retry with an oversized `size_bytes` or a disallowed
  `content_type` → 400. Retry as a user who ISN'T a participant of that
  conversation → 403.
- **Real upload**: `curl -T yourfile.jpg "<upload_url>" -H "Content-Type: image/jpeg"`,
  then check the AWS S3 console — the object should appear under
  `conversations/{id}/...`.
- **After Step 11**: send a WS message referencing that `object_key` (plus
  `type`, `original_filename`, `mime_type`, `size_bytes`). Confirm a
  `messages` row AND an `attachments` row both exist in Postgres, and the
  relayed/echoed payload's `download_url` opens the file directly in a
  browser.
- **After Step 12**: re-fetch `GET /conversations/{id}/messages` and
  confirm the attachment's `download_url` is present — and is a DIFFERENT
  signed URL each time you call it (proves it's generated fresh, not
  cached/stored).
