# Push Notifications — Backend Implementation Steps (Step 14)

Follow these in order — each step builds on the last and should leave the
app in a working (if incomplete) state. For the full design rationale, see
`GUIDE.md`'s Step 14 section; for acceptance criteria, see
`PUSH_NOTIFICATIONS_USER_STORIES.md`. Frontend (Step 15 — service worker,
subscribe UI) is a separate doc, written after this one is implemented and
verified.

---

## 0. One-time manual setup (not code)

**Why**: a VAPID key pair identifies YOUR backend to the push services
(Google/Mozilla/etc.) as a legitimate sender — generated once, not
regenerated on every startup, same spirit as Step 12's S3 bucket being
created manually rather than auto-created by app code.

**Steps**:
1. After Step 2 below adds `pywebpush` to `requirements.txt` and you've
   rebuilt the backend image, run this once, inside the backend container,
   to generate a real key pair in exactly the format `pywebpush` and the
   browser's Push API both expect:
   ```python
   import base64
   from py_vapid import Vapid02
   from cryptography.hazmat.primitives import serialization

   def b64url(data: bytes) -> str:
       return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

   v = Vapid02()
   v.generate_keys()

   private_raw = v.private_key.private_numbers().private_value.to_bytes(32, "big")
   public_bytes = v.public_key.public_bytes(
       serialization.Encoding.X962,
       serialization.PublicFormat.UncompressedPoint,
   )

   print("VAPID_PRIVATE_KEY=" + b64url(private_raw))
   print("VAPID_PUBLIC_KEY=" + b64url(public_bytes))
   ```
2. Copy the two printed lines into `.env` (Step 1). The private key is a
   base64url-encoded raw 32-byte EC scalar — this is the exact string form
   `pywebpush`'s `webpush(vapid_private_key=...)` accepts directly (confirmed
   against its source: a non-file-path string is passed to
   `Vapid.from_string`, which expects this). The public key is a 65-byte
   uncompressed EC point, same encoding — this exact string is what the
   frontend passes as `applicationServerKey` in Step 15.
3. Never regenerate this pair once real subscriptions exist — every
   existing `PushSubscription` row was encrypted against the OLD public key
   and would silently fail to decrypt against a new one. Treat it like the
   AWS credentials: one-time, stored in `.env`, not committed.

---

## 1. `.env` (modify)

**Steps**:
1. Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (from Step 0), and
   `VAPID_CLAIMS_EMAIL` (a contact email VAPID requires in its signed
   claims — push services may use this to reach you if your server is
   misbehaving).

---

## 2. `backend/requirements.txt` (modify)

**Steps**:
1. Add `pywebpush` (pin a version) — pulls in `py_vapid`, `http_ece`, and
   `cryptography` as transitive dependencies.

---

## 3. `backend/app/core/config.py` (modify)

**Steps**:
1. Add three fields to the existing `Settings` class: `vapid_public_key:
   str`, `vapid_private_key: str`, `vapid_claims_email: str` — same
   "every secret flows through `settings`, never raw `os.environ`" pattern
   as every other field here.

---

## 4. `backend/app/models/push_subscription.py` (new)

**Why**: one user can grant notification permission from multiple
browsers/devices (Story 5) — each is a genuinely separate credential, so
this needs its own table, same reasoning as `Attachment` in Step 12.

**Steps**:
1. `class PushSubscription(Base):` `__tablename__ = "push_subscriptions"`.
2. Columns: `id` (primary key), `user_id` (`ForeignKey("users.id")`),
   `endpoint: str` (`unique=True` — the push service's delivery URL for
   this one subscription; unique because it's what Step 8's subscribe
   route upserts on), `p256dh: str`, `auth: str` (the two keys the
   browser's `PushSubscription.toJSON()` returns — needed to encrypt the
   payload so only that browser can read it), `created_at` (same
   `DateTime(timezone=True), server_default=func.now()` pattern as every
   other model's `created_at`).

---

## 5. `backend/app/db/base.py` (modify)

**Steps**:
1. Add `push_subscription` to the existing bottom-of-file import line:
   `from app.models import user, conversation, message, message_read,
   attachment, push_subscription`.

---

## 6. `backend/app/schemas/push_subscription.py` (new)

**Steps**:
1. `class PushSubscriptionKeys(BaseModel)`: `p256dh: str`, `auth: str`.
2. `class PushSubscriptionRequest(BaseModel)`: `endpoint: str`, `keys:
   PushSubscriptionKeys` — this shape mirrors exactly what the browser's
   `PushSubscription.toJSON()` produces, so the frontend can forward it
   almost unchanged.
3. `class UnsubscribeRequest(BaseModel)`: `endpoint: str`.

---

## 7. `backend/app/services/push.py` (new)

**Why**: one shared helper that both `chat.py`'s fan-out loop and (later)
any other caller can use, instead of reimplementing the webpush call at
every call site — same reasoning as `core/config.py`'s presigned-URL
helpers from Step 12.

**Steps**:
1. `async def send_push_notification(db, user_id, title, body,
   conversation_id)`.
2. Query every `PushSubscription` row for `user_id` — there may be several
   (Story 5); loop over all of them, not just the first.
3. For each subscription, call:
   ```python
   await asyncio.to_thread(
       webpush,
       subscription_info={
           "endpoint": subscription.endpoint,
           "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
       },
       data=json.dumps({"title": title, "body": body, "conversation_id": conversation_id}),
       vapid_private_key=settings.vapid_private_key,
       vapid_claims={"sub": f"mailto:{settings.vapid_claims_email}"},
   )
   ```
   Wrapped in `asyncio.to_thread(...)` because `pywebpush` itself makes a
   blocking HTTP call — this keeps it from stalling the WebSocket handler
   it's called from.
4. Catch `WebPushException` around that call, per subscription (one dead
   subscription must never stop the loop from reaching a user's other
   devices — Story 5 + Story 7 together). If `e.response.status_code` is
   `404` or `410` — the push service itself saying this endpoint is gone —
   delete that `PushSubscription` row and commit (Story 7). For any other
   status code, log it and move on; don't let one bad send take down the
   whole notification attempt.

---

## 8. `backend/app/api/routes/push.py` (new)

**Why**: subscribing/unsubscribing is a plain request/response action, same
separation `uploads.py`'s presign route already has from the WebSocket's
live-relay job.

**Steps for `POST /push/subscribe`** (body: `PushSubscriptionRequest`,
behind `get_current_user`):
1. Look up an existing `PushSubscription` by `endpoint` ALONE, not by
   `(user_id, endpoint)`. Why: the same browser/device could later be used
   by a different logged-in user (e.g. a shared computer, or someone
   logging into a different account) — looking up by endpoint only and
   reassigning `user_id` to whoever is currently authenticated means that
   device always notifies whoever is CURRENTLY logged in on it, never a
   previous user. This also naturally covers "the same browser subscribes
   twice" (Story 1) without any extra branching.
2. If found: update its `user_id`, `p256dh`, `auth` to the current
   request's values. If not found: insert a new `PushSubscription` row for
   `current_user.id`.
3. Commit. Return `{"status": "subscribed"}`.

**Steps for `DELETE /push/subscribe`** (body: `UnsubscribeRequest`, behind
`get_current_user`):
1. Delete the `PushSubscription` row matching `endpoint` AND `user_id ==
   current_user.id` — the `user_id` check matters here (unlike subscribe):
   it stops one user from deleting someone else's subscription by guessing
   or replaying an endpoint value they don't own (Story 8).
2. No error if nothing matched — this call should be safely repeatable.

---

## 9. `backend/app/main.py` (modify)

**Steps**:
1. Add `from app.api.routes import push` alongside the existing route
   imports.
2. Add `app.include_router(push.router, prefix="/push", tags=["push"])` —
   makes Step 8's routes reachable at `/push/subscribe`.

---

## 10. `backend/app/api/ws/chat.py` (modify)

**Why**: this is the one real behavior change in the whole feature — the
existing fan-out loop currently just relays to everyone; it now has to
decide, per recipient, "are they actually connected right now, or should
this go out as a push instead" (Story 3's core distinction, and the thing
worth re-reading `GUIDE.md`'s Step 14 design notes for if anything here is
unclear about WHY offline-vs-online is the right trigger, not the reverse).

**Steps**:
1. Where the existing code does
   `for uid in other_user_ids: await manager.send_to_user(uid, payload)`,
   split `other_user_ids` into two groups first:
   `offline_uids = [uid for uid in other_user_ids if not
   manager.active_connections.get(uid)]` and everyone else.
2. Send live to everyone NOT in `offline_uids`, exactly as today —
   unchanged behavior for anyone actually connected.
3. Only if `offline_uids` is non-empty (skip entirely, no extra query, when
   every recipient is online): look up the sender's `display_name` once
   (`select(User.display_name).where(User.id == user_id)`) and compute a
   notification body — `message.content` if present, else `"Sent an
   image"` or `"Sent a file"` depending on whether `attachment.mime_type`
   starts with `image/` (Story 4, covers an attachment sent with no
   caption).
4. For each `uid` in `offline_uids`, call `await send_push_notification(db,
   uid, title=sender_display_name, body=notification_body,
   conversation_id=conversation_id)`.
5. The sender's own self-echo (the line right after this loop) is
   untouched — never push-notify yourself, regardless of connection state.
6. No change needed to the `"typing"` branch — it already `continue`s
   before reaching any of this, so typing events never trigger a push.

---

## Verification checklist

Work through these as you complete each step above — don't wait until the
end to test everything at once.

- **After Step 0**: the printed keys actually decode/round-trip (the
  snippet above already includes this implicitly via `py_vapid`'s own
  loader — if `Vapid02.generate_keys()` ran without error, the pair is
  valid).
- **After Step 9**: `docker compose up --build` starts cleanly.
- **Subscribe**: `POST /push/subscribe` with a real
  `PushSubscriptionRequest`-shaped body as an authenticated user → 200,
  row appears in `push_subscriptions`. Re-POST the exact same `endpoint` →
  still exactly ONE row for it (confirms upsert, not a duplicate).
- **Unsubscribe**: `DELETE /push/subscribe` with that `endpoint` → row
  removed. Call it again → no error, nothing to remove.
- **Real push, offline case**: with that user's WebSocket NOT connected,
  send them a message from another user (or call
  `send_push_notification` directly against a real subscription, same
  "exercise the engine before any UI exists" approach Step 12 used for
  S3) → a real OS-level notification appears in a subscribed browser
  (Story 2).
- **Real push, online case**: reconnect that same user's WebSocket, send
  another message → confirm NO push fires this time, only the live relay
  (Story 3) — this is the one most worth not skipping, since it's the
  flow that's easy to get backwards.
- **Attachment body text**: send an image with no caption to an offline
  recipient → confirm the notification body reads "Sent an image", not
  blank (Story 4).
- **Multiple devices**: subscribe the same user from two different
  simulated "devices" (two different fake `endpoint`/key sets), both
  offline, send one message → both receive a push independently
  (Story 5).
- **Dead subscription cleanup**: revoke notification permission in a
  subscribed browser (or otherwise force a 404/410), send another message
  → confirm that specific `PushSubscription` row is deleted after the
  failed attempt, and that this does NOT prevent delivery to that same
  user's OTHER valid subscriptions (Story 7 + Story 5 together).
- **Group fan-out**: a 3-person group conversation, one member offline,
  two connected → confirm only the offline member gets a push; the
  connected two just get the live relay, no push (Story 9).
- Check backend container logs across the whole run — no tracebacks or
  unhandled errors, even on the deliberately-forced failure cases above.
