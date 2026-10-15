# Message Editing / Deletion — Implementation Steps

Follow these in order — each step builds on the last and should leave the
app in a working (if incomplete) state. For design rationale, see
`MESSAGE_EDIT_DELETE_PLAN.md`; for acceptance criteria, see
`MESSAGE_EDIT_DELETE_USER_STORIES.md`. Every step below names which Story
it fulfills, and the final section maps every Story to where it's verified.

---

## 0. One-time manual setup (not code)

**Why**: `create_all()` only creates missing tables — it never alters an
existing one. `messages` already has rows in it, so adding a column needs a
manual step, same as every prior Phase 2 column addition.

**Steps**:
1. With the stack running, apply the new column once:
   ```bash
   docker compose exec postgres-chat-app psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
     -c "ALTER TABLE messages ADD COLUMN edited_at TIMESTAMPTZ NULL;"
   ```
2. `hidden_messages` (Step 2 below) is a brand new table — `create_all()`
   handles it automatically on the next backend startup, no manual step.

---

## 1. `backend/app/models/message.py` (modify)

**Fulfills**: Story 1 (needed to mark a message as edited), Story 11
(persisted state).

**Steps**:
1. Add `edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)` —
   same `DateTime(timezone=True)` pattern as `created_at` on this model.

---

## 2. `backend/app/models/hidden_message.py` (new)

**Fulfills**: Story 7, Story 8 (the `UniqueConstraint` is what makes hiding
idempotent), Story 9 (this table is what makes it per-account, not
per-browser).

**Steps**:
1. `class HiddenMessage(Base):` `__tablename__ = "hidden_messages"`,
   `__table_args__ = (UniqueConstraint("message_id", "user_id"),)` — copy
   `MessageRead`'s exact shape:
   - `id` (primary key)
   - `message_id: Mapped[int] = mapped_column(ForeignKey("messages.id"))`
   - `user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))`
   - `hidden_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())`

---

## 3. `backend/app/db/base.py` (modify)

**Steps**:
1. Add `hidden_message` to the bottom-of-file import line:
   `from app.models import user, conversation, message, message_read,
   attachment, push_subscription, hidden_message`.

---

## 4. `backend/app/schemas/message.py` (modify)

**Fulfills**: Story 1 (`edited_at` needs to reach the frontend), Story 11.

**Steps**:
1. Add `edited_at: datetime | None = None` to `MessageResponse`.
2. Add a new class: `class MessageEditRequest(BaseModel): content: str`.

---

## 5. `backend/app/core/config.py` (modify)

**Fulfills**: Story 4 (removing the actual file on delete-for-everyone).

**Steps**:
1. Add a `delete_object(bucket_name: str, object_name: str) -> bool`
   function right below `presigned_get_url`, same try/except-and-log shape
   as its neighbors:
   ```python
   def delete_object(bucket_name: str, object_name: str) -> bool:
       try:
           s3_client.delete_object(Bucket=bucket_name, Key=object_name)
           return True
       except Exception as e:
           print(f"Error deleting object: {e}")
           return False
   ```

---

## 6. `backend/app/api/routes/conversations.py` (modify)

This is the bulk of the backend work — three new routes plus two modified
queries, all in the file that already owns every message-related route.

### 6a. `PATCH /{conversation_id}/messages/{message_id}` (new)

**Fulfills**: Story 1, Story 2, Story 3.

**Steps** (body: `MessageEditRequest`, behind `get_current_user`):
1. Same authorization check every route here already does: look up the
   `Message` by `id` AND `conversation_id` (404 if not found — don't leak
   whether a message id exists in a conversation this user isn't even in).
2. If `message.sender_id != current_user.id`: `403` (Story 3).
3. If `datetime.now(timezone.utc) - message.created_at > timedelta(minutes=15)`:
   `403` (Story 2). Compare against `message.created_at`, never anything
   client-supplied.
4. Update `message.content = payload.content`, set
   `message.edited_at = datetime.now(timezone.utc)`, commit, refresh.
5. Look up `other_user_ids` the same way `mark_messages_read` already does
   (`select(Participant.user_id).where(conversation_id=..., user_id !=
   current_user.id)`).
6. Broadcast to **every** participant including the sender's own other
   devices — `for uid in [*other_user_ids, current_user.id]:
   await manager.send_to_user(uid, {"type": "message_edited", "message_id":
   message.id, "content": message.content, "edited_at":
   message.edited_at.isoformat()})` (Story 1's "every other open session…
   and my own other devices").
7. Return the updated `MessageResponse`.

### 6b. `DELETE /{conversation_id}/messages/{message_id}` (new)

**Fulfills**: Story 4, Story 5, Story 6.

**Steps** (behind `get_current_user`):
1. Same lookup + 404 pattern as 6a.
2. If `message.sender_id != current_user.id`: `403` (Story 6).
3. If older than 1 hour (same comparison style as 6a, different threshold):
   `403` (Story 5).
4. **Delete in this exact order** (the FK-violation constraint documented in
   the plan):
   1. `DELETE FROM hidden_messages WHERE message_id = message.id`
   2. `DELETE FROM message_reads WHERE message_id = message.id`
   3. If an `Attachment` row exists for this message: call
      `delete_object(settings.s3_bucket_name, attachment.object_key)`, then
      delete the `Attachment` row (Story 4's "file is actually removed from
      storage").
   4. Delete the `Message` row itself.
   5. Commit once, after all of the above — not once per step.
5. Broadcast `{"type": "message_deleted", "message_id": message.id}` to
   `[*other_user_ids, current_user.id]`, same full-fanout reasoning as 6a.

### 6c. `POST /{conversation_id}/messages/{message_id}/hide` (new)

**Fulfills**: Story 7, Story 8, Story 9.

**Steps** (behind `get_current_user`):
1. Same lookup + 404 pattern — but **no ownership check**: any participant
   may hide any message (Story 7 explicitly includes messages "sent by me
   or anyone else").
2. No time-window check at all (Story 7's "no time restriction").
3. Check for an existing `HiddenMessage(message_id, current_user.id)` row
   first — if one exists, do nothing further (Story 8: safe to repeat, no
   unique-constraint crash). If not, insert one, commit.
4. Broadcast `{"type": "message_hidden", "message_id": message.id}` to
   **`current_user.id` only** — never to `other_user_ids` (Story 9's "no
   other participant is ever notified").

### 6d. `get_message_history` (modify)

**Fulfills**: Story 10, Story 11.

**Steps**:
1. Add a filter to the existing message query: exclude any `Message.id`
   that has a matching `HiddenMessage` row for `current_user.id`. A
   `NOT EXISTS` subquery (or an equivalent `outerjoin` + `is_(None)` filter)
   applied alongside the existing `cursor`/`conversation_id` filters, before
   `.limit(limit + 1)` — the existing keyset-pagination logic right after it
   needs no changes, since the filter narrows the candidate rows before
   `LIMIT` is applied either way.

### 6e. `list_conversations` (modify)

**Fulfills**: Story 10.

**Steps**:
1. Apply the same hidden-message exclusion to the "last message" lookup for
   each conversation, so a hidden message can never surface as the chat
   list's preview for the user who hid it.

---

## 7. `frontend/types/index.ts` (modify)

**Steps**:
1. Add `edited_at?: string | null` to the `Message` interface.
2. Add three new event types:
   ```ts
   export type MessageEditedEvent = { type: "message_edited"; message_id: number; content: string; edited_at: string };
   export type MessageDeletedEvent = { type: "message_deleted"; message_id: number };
   export type MessageHiddenEvent = { type: "message_hidden"; message_id: number };
   ```

---

## 8. `frontend/lib/websocket.ts` (modify)

**Fulfills**: the real-time half of Story 1, Story 4, Story 9 (this is what
actually delivers those WebSocket events to the UI).

**Steps**:
1. Add three new optional handlers to `ChatSocketHandlers`:
   `onMessageEdited?: (messageId: number, content: string, editedAt: string) => void`,
   `onMessageDeleted?: (messageId: number) => void`,
   `onMessageHidden?: (messageId: number) => void`.
2. In the `socket.onmessage` dispatch, add three more `else if` branches
   (alongside the existing `"typing"`/`"read"` checks) recognizing
   `"message_edited"`, `"message_deleted"`, `"message_hidden"` and calling
   the matching handler.
3. **No new "send" functions needed here** — unlike `sendMessage`/`sendTyping`,
   editing/deleting/hiding are REST calls (Step 6's routes), not messages
   this hook sends over the socket. This hook only needs to *receive* the
   resulting broadcast.

---

## 9. `frontend/components/MessageList.tsx` (modify)

**Fulfills**: the visible half of Story 1 ("(edited)" label), Story 4/6/7
(the actions that trigger these flows).

**Steps**:
1. Render `{message.edited_at && <span className="text-xs text-zinc-500"> (edited)</span>}`
   next to the existing timestamp/seen-indicator area.
2. Add new props: `onEdit: (message: Message) => void`, `onDeleteForEveryone:
   (messageId: number) => void`, `onDeleteForMe: (messageId: number) =>
   void`.
3. Add a small action affordance per message (e.g. a "⋯" button revealing a
   menu): "Edit" and "Delete for everyone" only rendered when `isMine` is
   true — purely a UI hint, not the real enforcement (the 15-minute/1-hour
   windows are still re-checked server-side regardless of what this menu
   shows); "Delete for me" rendered on every message regardless of
   `isMine`.

---

## 10. `frontend/app/chat/[conversationId]/page.tsx` (modify)

**Fulfills**: wiring every story end-to-end into the live page.

**Steps**:
1. Wire the three new `useChatSocket` handlers:
   - `onMessageEdited`: find the message by id in `messages` state, update
     its `content`/`edited_at`.
   - `onMessageDeleted`: remove that message from `messages` state.
   - `onMessageHidden`: remove that message from `messages` state (this
     only ever fires for hides performed by this same account on another
     device, per Step 6c's self-only broadcast).
2. **Design choice, stated explicitly**: update local state ONLY from these
   WebSocket handlers, never directly from the REST call's response — even
   for the tab that initiated the edit/delete/hide. Because Step 6's routes
   broadcast back to `current_user.id` too, the acting tab receives its own
   echo over the socket, the same reconciliation-via-echo pattern already
   used for sending a message. This keeps exactly one code path responsible
   for updating message state, instead of two (a direct update AND an echo
   handler) that could disagree.
3. `handleEditMessage(messageId, newContent)`: `PATCH
   /conversations/{conversationId}/messages/{messageId}` via `apiJson`,
   body `{content: newContent}`. On a `403` (Story 2 or Story 3), surface a
   readable error — don't let it crash silently.
4. `handleDeleteForEveryone(messageId)`: `DELETE
   /conversations/{conversationId}/messages/{messageId}` via `apiJson`,
   same `403` handling.
5. `handleDeleteForMe(messageId)`: `POST
   /conversations/{conversationId}/messages/{messageId}/hide` via `apiJson`.
6. **Edit-mode UI**: reuse `MessageInput`'s existing text box rather than
   building a second one — when `onEdit` is clicked, lift the message into
   an "editing" state (e.g. `editingMessage: Message | null`), pre-fill the
   input with its `content`, swap the submit button's label from "Send" to
   "Save", and route submission to `handleEditMessage` instead of
   `sendMessage` while editing is active.

---

## Story → verification map

| Story | Verified by |
|---|---|
| 1 — Edit within window | Edit a message <15 min old in two open sessions; confirm live update + "(edited)" in both |
| 2 — Edit window expired | `PATCH` a >15-min-old message → `403`, unchanged |
| 3 — Edit requires ownership | `PATCH` another user's message → `403`, unchanged |
| 4 — Delete-for-everyone within window | `DELETE` a <1hr-old message (with an attachment) → row AND S3 object actually gone, live removal both sides |
| 5 — Delete-for-everyone window expired | `DELETE` a >1hr-old message → `403`, still exists |
| 6 — Delete-for-everyone requires ownership | `DELETE` another user's message → `403`, still exists |
| 7 — Delete-for-me, any message, any time | `POST .../hide` on your own and someone else's message, both old and new → disappears only for you |
| 8 — Hide is idempotent | `POST .../hide` twice on the same message → no error, still hidden |
| 9 — Hide follows the account | Hide on device A (two sessions, same account) → gone on device B too; confirm the OTHER participant's session receives nothing |
| 10 — Hidden message never previews | Hide the newest message in a conversation → chat list shows the next-newest instead, for that user only |
| 11 — Persists across reload | After any edit/delete/hide, reload (or re-fetch `GET .../messages`) → state matches what was live, not just in-memory |

Also check backend container logs across the whole run — no unhandled
tracebacks, including on every deliberately-forced `403` case above (an
expected `403` is not the same as a crash; confirm it's the former).
