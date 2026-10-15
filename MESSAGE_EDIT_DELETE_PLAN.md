# Message Editing / Deletion — Plan

## Goal

Let a sender edit or delete their own messages, and let any participant hide
a message from just their own view — matching standard messaging-app
behavior (edit, delete-for-everyone, delete-for-me), fully real-time across
all open sessions.

## Scope decisions (locked in for this version)

- **Edit window: 15 minutes** after sending. Enforced server-side — a
  client-side countdown is just a UI hint, never the actual guard (same
  "never trust the client" instinct already applied to read-receipt
  validation in `conversations.py`).
- **Delete for everyone: hard delete, 1-hour window.** The message row (and
  its attachment, if any — both the S3 object and the `Attachment` row) is
  actually removed, not soft-replaced with a placeholder. Only the sender
  can do this, only within 1 hour of sending.
- **Delete for me: server-side, no time limit.** Any participant (sender or
  recipient) can hide any message from their own view, at any time. Stored
  in a new table, not client-side-only — so it persists across devices/logins,
  consistent with everywhere else this app treats "your account" as the unit
  of state, not "this browser."
- **No edit history kept** — editing overwrites `content` and stamps
  `edited_at`; the UI shows an "(edited)" label, not a version history. A
  reasonable future enhancement, not built now (same "state the limitation,
  don't solve problems this phase doesn't have" pattern used throughout this
  project).
- **Editing only changes text** — you can't swap or remove an attachment via
  edit, only the `content` field.

## No new dependencies

Everything here is built on infrastructure that already exists: SQLAlchemy
models, the existing REST route file (`conversations.py`), and the existing
WebSocket relay (`ConnectionManager`). No new library, no new service.

## A real constraint this plan has to handle (not hypothetical)

Hard-deleting a `Message` row will hit a real `ForeignKeyViolation` unless
dependent rows are deleted first — **this already happened once in this
project**, during manual test-data cleanup after the push notifications
work (`ERROR: update or delete on table "messages" violates foreign key
constraint "message_reads_message_id_fkey"`). `message_reads.message_id`
and `attachments.message_id` both reference `messages.id` with no cascade
configured, so the delete order has to be explicit in application code:
hidden-message rows → read-receipt rows → attachment (S3 object + row) →
the message itself.

## Data model changes

```
messages: + edited_at  (nullable, new column on an EXISTING table)

hidden_messages (new table, same shape as message_reads):
  id, message_id (FK messages.id), user_id (FK users.id), hidden_at
  UniqueConstraint(message_id, user_id)
```

**One-time manual setup**: `create_all()` only creates missing tables, it
never alters existing ones (the same gotcha already documented for every
prior Phase 2 feature). Adding `edited_at` to the already-existing
`messages` table needs one manual step against the running Postgres
container:
```sql
ALTER TABLE messages ADD COLUMN edited_at TIMESTAMPTZ NULL;
```
`hidden_messages` is a brand new table, so `create_all()` handles it with no
manual step, same as every other new table added so far.

## New/changed real-time events

Three new WebSocket message types, relayed through the existing
`ConnectionManager` exactly like `typing`/`read` events are today:

| Event | Who sends it | Who receives it | Why |
|---|---|---|---|
| `message_edited` | Backend, after a successful `PATCH` | All other participants **and** the sender's own other devices | Everyone's open view needs the new content immediately |
| `message_deleted` | Backend, after a successful hard delete | All other participants **and** the sender's own other devices | Everyone's open view needs to remove the message immediately |
| `message_hidden` | Backend, after a successful hide | **Only** the requesting user's own other devices — `manager.send_to_user(current_user.id, ...)`, not `other_user_ids` | This is a new kind of relay this feature introduces: a self-targeted broadcast for cross-device sync, since "delete for me" is explicitly per-user state (per the locked scope decision), not something other participants should even be told happened |

## New files / changes — backend

- `backend/app/models/message.py` (modify): add `edited_at: Mapped[datetime
  | None]`.
- `backend/app/models/hidden_message.py` (new): `HiddenMessage` model, as above.
- `backend/app/db/base.py` (modify): import `hidden_message`.
- `backend/app/schemas/message.py` (modify): `MessageResponse` gains
  `edited_at: datetime | None`; new `MessageEditRequest{content: str}`.
- `backend/app/core/config.py` (modify): add `delete_object(bucket_name,
  object_name)` alongside the existing `presigned_put_url`/`presigned_get_url`
  helpers — one `s3_client.delete_object(...)` call, same error-handling
  style as its neighbors.
- `backend/app/api/routes/conversations.py` (modify): three new routes, all
  behind `get_current_user` and the existing "is this user actually a
  Participant" authorization check already used by every route here:
  1. **`PATCH /{conversation_id}/messages/{message_id}`** (edit): verify
     `message.sender_id == current_user.id` (403 if not), verify `now() -
     message.created_at <= 15 minutes` (403 if expired), update `content`,
     set `edited_at = now()`, commit, broadcast `message_edited` to
     `other_user_ids` **and** `current_user.id` (multi-device), return the
     updated `MessageResponse`.
  2. **`DELETE /{conversation_id}/messages/{message_id}`** (delete for
     everyone): verify ownership and the 1-hour window (same shape as
     above), then delete in the required order — `hidden_messages` rows for
     this message, `message_reads` rows for this message, the S3 object +
     `Attachment` row if one exists, then the `Message` row itself — commit,
     broadcast `message_deleted` to `other_user_ids` **and**
     `current_user.id`.
  3. **`POST /{conversation_id}/messages/{message_id}/hide`** (delete for
     me): any participant (not just the sender) may call this, no time
     limit. Insert a `HiddenMessage` row if one doesn't already exist for
     `(message_id, current_user.id)` — idempotent, same "check existing
     first" pattern `message_reads`' insert already uses, so hiding an
     already-hidden message is a safe no-op, not a unique-constraint crash.
     Broadcast `message_hidden` to `current_user.id` only.
  4. **`get_message_history`** (modify): exclude any message with a
     `HiddenMessage` row for the requesting user (`WHERE NOT EXISTS (SELECT
     1 FROM hidden_messages WHERE message_id = messages.id AND user_id =
     :current_user_id)`) — applied before the existing `LIMIT`, so keyset
     pagination's cursor logic stays correct per-user with no changes needed
     to that logic itself.
  5. **`list_conversations`** (modify): apply the same hidden-message
     exclusion to the "last message" lookup — otherwise a user could still
     see a preview of a message they chose to hide from the actual
     conversation view, which would be inconsistent.

## New files / changes — frontend

- `frontend/types/index.ts` (modify): `Message` gains `edited_at?: string |
  null`; new `MessageEditedEvent`/`MessageDeletedEvent`/`MessageHiddenEvent`
  WS payload types.
- `frontend/lib/websocket.ts` (modify): `useChatSocket` dispatches the three
  new event types to new callback props (`onMessageEdited`,
  `onMessageDeleted`, `onMessageHidden`) — same shape as the existing
  `onMessage`/`onTyping`/`onRead` callbacks.
- `frontend/components/MessageList.tsx` (modify):
  - Render "(edited)" next to the timestamp when `edited_at` is set.
  - A small action menu on each message: "Edit" and "Delete for everyone"
    shown only on your own messages, and only hinted as available within
    the 15-minute/1-hour windows client-side (a UI convenience — the real
    enforcement is server-side, per the "never trust the client" note
    above); "Delete for me" shown on any message, no time restriction.
- `frontend/app/chat/[conversationId]/page.tsx` (modify): wire the three new
  callbacks — `message_edited` updates that message's `content`/`edited_at`
  in state; `message_deleted` removes it from state; `message_hidden`
  removes it from state (this only ever arrives for your own hide actions
  taken on another device, per the self-targeted relay design above).
- **Edit UI**: reuses `MessageInput`'s text box in an "editing" mode (pre-filled
  with the existing content, "Send" becomes "Save") rather than a separate
  input — on submit, calls the new `PATCH` endpoint instead of sending a new
  WebSocket message.

## Verification checklist

- Edit your own message within 15 minutes → content updates live for both
  sides, "(edited)" appears, `GET .../messages` reflects it after a reload.
- Try editing after 15 minutes (or edit the time check manually for testing)
  → `403`, message unchanged.
- Try editing someone else's message → `403`.
- Delete-for-everyone within 1 hour on a text message → row actually gone
  from the DB (`SELECT` confirms), removed live for both sides.
- Delete-for-everyone on a message with an attachment → confirm the S3
  object is actually gone (a subsequent `GET` on the old presigned URL
  fails) AND the `Attachment` row is gone, not just the `Message` row.
- Delete-for-everyone after the 1-hour window → `403`, nothing removed.
- Delete-for-everyone on someone else's message → `403`.
- Delete-for-me on any message (yours or someone else's) → disappears from
  your view only; the other participant still sees it normally; a second
  call is a safe no-op (no duplicate-row crash).
- Log in as the same user on a second session/device → confirm a
  delete-for-me performed on device A removes it on device B too (the
  self-targeted `message_hidden` relay working), and that NO event reaches
  the other participant's session.
- Confirm a hidden message never resurfaces as the chat list's "last
  message" preview for the user who hid it.
- Check backend logs across the whole run — no unhandled tracebacks,
  including on the deliberately-forced failure cases (expired windows,
  wrong-user attempts).

---

Once this plan looks right, the next step (same pattern as the last few
features) would be a matching `MESSAGE_EDIT_DELETE_USER_STORIES.md` and
`MESSAGE_EDIT_DELETE_IMPLEMENTATION_STEPS.md`.
