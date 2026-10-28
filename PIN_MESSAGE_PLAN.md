# Pin Message — Plan

## Goal

Let any participant pin one message per conversation so everyone sees it
highlighted at the top, and unpin it the same way — live, for everyone.

## Scope decisions (locked in for this version)

- **One pinned message per conversation, at most.** Pinning a new message
  replaces whatever was pinned before — no pinned-messages list, no
  history of past pins. A single nullable `Conversation.pinned_message_id`
  column, not a new table.
- **Any participant can pin or unpin, in both 1-to-1s and groups** — no
  permission gate, unlike `remove_participant`'s creator-only rule. A pin
  is shared, everyone-sees-it state, but so is a conversation's name or
  its messages in general; nothing about this app's existing model treats
  "visible to everyone" as needing extra permission by itself (edit/delete-
  for-everyone gate on *ownership* of the content, not on visibility).
- **No "pinned by X at Y" attribution stored** — just the message itself.
  A future version could add `pinned_by_user_id`/`pinned_at` the same way
  `forwarded_from_user_id` tracks attribution elsewhere; not needed to
  satisfy this version's scope, stated as a future enhancement, not an
  oversight.
- **A message hidden "for me" cannot be pinned by the person who hid it** —
  same reasoning as forwarding: if you've chosen not to see it, you
  shouldn't be the one exposing it to everyone else as "the pinned
  message."
- **A message that's hidden "for me" by some OTHER participant still
  appears pinned for everyone who hasn't hidden it** — the hide is
  personal, the pin is shared. Each viewer's own hidden-message set
  decides whether *they* see the pin, independently of who pinned it.
- **No time window, no restriction on message type** — any visible text,
  image/file, or even a system message can be pinned. Nothing about
  pinning mutates the message, so there's no staleness risk to guard
  against (same reasoning as forwarding having no window).

## No new dependencies

One new nullable column, two new REST routes, two new WebSocket event
types (deliberately tiny — see the real constraint below for why). No new
table, no new service.

## One-time manual setup

```sql
ALTER TABLE conversations ADD COLUMN pinned_message_id INTEGER NULL REFERENCES messages(id);
```

`NULL` is the correct default for every existing conversation — "nothing
pinned yet" needs no backfill.

## Two real constraints this plan has to handle (not hypothetical)

**1. Hard-deleting the pinned message would either violate the new foreign
key or silently leave a dangling reference.** `pinned_message_id`
references `messages.id` with Postgres's default `NO ACTION` behavior —
if the currently pinned message is hard-deleted while
`delete_message_for_everyone` doesn't know to clear the pin first, the
`DELETE FROM messages` statement itself will raise a foreign-key
violation and the whole delete will fail with a 500, not a clean error.
This is the exact same class of bug already hit once in this project (the
`message_reads`/`attachments` FK ordering issue documented in
`MESSAGE_EDIT_DELETE_PLAN.md`) — just with a new column instead of a new
table. **Fix**: `delete_message_for_everyone` gains one more step, before
deleting the message: if `message.id == conversation.pinned_message_id`,
clear `conversation.pinned_message_id = None` first, in the same
transaction.

**2. A naive "broadcast the pinned message's content to everyone" design
would leak content past someone's own hidden-for-me state.** If Alice
pins a message that Bob has personally hidden "for me," and the pin
event's WebSocket payload carries the message's actual content, Bob's own
client would receive and could display content he specifically chose not
to see — a real violation of the guarantee every other read path in this
app already enforces (search, history, previews all exclude hidden-for-me
messages per-viewer). **Fix**: the `message_pinned`/`message_unpinned`
WebSocket events carry only a bare signal — `{"type": "message_pinned",
"conversation_id": ..., "message_id": ...}` — never the message content
itself. Every client reacts by re-fetching `GET /conversations/{id}`,
which already computes `pinned_message` server-side with the SAME
hidden-for-me exclusion `list_conversations`'s `last_message` already
uses. One source of truth for "what am I allowed to see," not two.

## Data model

- `Conversation.pinned_message_id: int | None` (new column, see migration).
- `ConversationSummary` gains `pinned_message: MessageResponse | None` —
  computed by the route exactly the way `last_message` already is, not a
  bare id. For the requesting user specifically: `None` if nothing is
  pinned, OR if the pinned message is hidden-for-me for them.

## API shape

`POST /conversations/{conversation_id}/messages/{message_id}/pin` — pins
this message (replacing any existing pin), no body.

`DELETE /conversations/{conversation_id}/pin` — unpins whatever is
currently pinned, no body, no message id needed (there's only ever one).

## Route mechanics — pin

1. Look up the `Conversation` — 404 if missing.
2. Look up the `Message` by `id` AND `conversation_id` — 404 if it doesn't
   belong there (never trust the path pairing alone, same as every other
   message route).
3. `403` if the current user has no `Participant` row here.
4. `404` if the current user has hidden this message "for me" — same
   treatment as forwarding's identical check.
5. If `conversation.pinned_message_id` already equals this message's id,
   return success without writing or broadcasting anything — idempotent,
   same instinct as `hide_message_for_me`'s existing-row check.
6. Set `conversation.pinned_message_id = message.id`, commit.
7. Broadcast `{"type": "message_pinned", "conversation_id": ..., "message_id": ...}`
   to every participant, full fanout including the actor themselves.

## Route mechanics — unpin

1. Look up the `Conversation` — 404 if missing.
2. `403` if the current user has no `Participant` row here.
3. If `conversation.pinned_message_id` is already `None`, return success
   without broadcasting anything.
4. Set `conversation.pinned_message_id = None`, commit.
5. Broadcast `{"type": "message_unpinned", "conversation_id": ...}` to
   every participant, full fanout.

## Frontend shape

- A pin banner renders at the top of the conversation view (below the
  header, above the message list) whenever `conversation.pinned_message`
  is non-null — showing a truncated preview of its content and an "Unpin"
  action, visible to any participant per the locked permission decision.
- Clicking the banner jumps to that message in history by reusing the
  **existing** `around=<message_id>` mechanism built for search result
  navigation — no new "jump to message" logic needed, this is the exact
  same problem search already solved.
- `MessageList.tsx` gains a "Pin" action in the per-message row (alongside
  Edit/Delete/Forward) for any message that isn't already the pinned one,
  and shows "Unpin" directly on the currently pinned message's own row as
  a second way to unpin besides the banner.
- `useChatSocket` gains `onMessagePinned?: (conversationId: number) => void`
  and `onMessageUnpinned?: (conversationId: number) => void`. Per real
  constraint #2, neither handler updates local state directly from the
  event's payload — both simply re-trigger the same `GET
  /conversations/{id}` call the page already makes on mount, and let that
  response (which is always correctly hidden-aware) replace `conversation`
  state wholesale.

## Out of scope (stated, not an oversight)

- **No multiple simultaneous pins, no pin history** — see the locked scope
  decision above.
- **No "pinned by X" attribution** — see the locked scope decision above.
- **No permission gate in groups** — every participant has equal pin/unpin
  power in this version; a future version could revisit this the same way
  `remove_participant` gates on `created_by_user_id`, if it turns out to
  matter in practice.
