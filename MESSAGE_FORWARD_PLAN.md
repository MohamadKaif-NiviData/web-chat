# Message Forward — Plan

## Goal

Let any participant take a message they can currently see and re-send its
content into a different conversation they're also part of, with the
recipient able to tell it was forwarded and who originally wrote it.

## Scope decisions (locked in for this version)

- **One target conversation per forward action.** No multi-select "forward
  to 5 chats at once" — pick a message, pick one conversation, it's sent
  there. Forwarding to multiple places means repeating the action. Keeps
  the UI and the server-side logic to a single message-create, not a loop.
- **Attribution is shown**: a forwarded message is visibly marked
  "Forwarded" and names the **original** author — not generic, not silent.
- **Text-only in this version** — a message with an attachment simply
  doesn't offer a Forward action (button hidden/disabled for it), rather
  than silently forwarding an empty bubble. See "Out of scope" for why
  attachments are deferred, and why they're not just a small extension.
- **Anyone who can currently see a message may forward it** — not just its
  original sender. This mirrors standard messaging-app behavior (forwarding
  relays content, it doesn't claim authorship) and is a deliberately
  different rule from edit/delete-for-everyone, which stay sender-only.
  "Can currently see" means: the forwarder is a participant of the
  message's conversation, AND the message isn't one they've hidden "for
  me" — the exact same visibility rule every read path already enforces.
- **No time window.** Unlike edit (15 min) and delete-for-everyone (1
  hour), forwarding doesn't mutate the original message at all, so there's
  no "staleness" risk it needs to guard against. A message from a year ago
  is just as forwardable as one from a minute ago.
- **Forwarding a forward preserves the ORIGINAL author, not the
  intermediate forwarder.** If Alice's message is forwarded by Bob into
  another conversation, and someone then forwards *that* copy again, the
  label still reads "Forwarded from Alice" — not "Forwarded from Bob."
  Real messaging apps do this; showing an ever-changing chain of
  intermediate forwarders would be useless noise.
- **Editing a forwarded message does not clear its "Forwarded" label.**
  The label describes where the content originally came from; editing only
  changes `content`/`edited_at`, exactly as it does for any other message
  today — these are independent pieces of state, not linked.
- **Forwarding into the same conversation the message came from is
  allowed** — it just creates a second (now explicitly-marked-forwarded)
  copy. Not useful, but not harmful either, so there's no reason to add a
  special-case check that blocks it.

## No new dependencies

One new nullable column, no new table, no new service. Reuses the existing
REST-route-plus-manual-broadcast pattern edit/delete/hide already
established in `conversations.py` — not the WebSocket send path (see "Real
constraint #1" below for why that path can't be reused directly).

## One-time manual setup (same shape as edit/delete's Step 0)

`messages` already has rows, and `create_all()` never alters an existing
table, so:

```sql
ALTER TABLE messages ADD COLUMN forwarded_from_user_id INTEGER NULL REFERENCES users(id);
```

`forwarded_from_user_id` is the ORIGINAL author's user id (not the
forwarder's — the forwarder is already recorded as the new message's own
`sender_id`, same as any message). `NULL` means "not a forwarded message,"
which is true for every message that exists today.

## Two real constraints this plan has to handle (not hypothetical)

**1. Broadcasting a forwarded message naively WILL leak it into the
forwarder's currently-open, unrelated conversation view.** This is the big
one, and it's not an edge case for this feature — it's the *normal* case.
By definition, forwarding happens while the forwarder is looking at the
SOURCE conversation (that's where the message they're forwarding is
visible) and the new message belongs to a DIFFERENT, target conversation.
Tracing the existing code:

- `ConnectionManager.active_connections` is keyed by `user_id -> list[WebSocket]`
  — a flat list of every socket a user has open, with no record of which
  `conversation_id` each individual socket belongs to
  (`services/connection_manager.py`).
- `send_to_user(user_id, payload)` pushes `payload` to **every** socket in
  that list, regardless of which conversation each one represents.
- The frontend's `onMessage` handler (`app/chat/[conversationId]/page.tsx`)
  unconditionally does `setMessages((prev) => [...prev, message])` for any
  non-self-echo message it receives — it never checks
  `message.conversation_id === conversationId`.

So: if the forward route broadcasts the new message to the forwarder's own
`user_id` the same way edit/delete/hide already do (so their other open
devices/tabs stay in sync), and the forwarder currently has the SOURCE
conversation open, that open socket will receive a payload whose
`conversation_id` belongs to the TARGET conversation — and today's frontend
would wrongly splice it into the source conversation's message list.

This same latent issue already exists today for anyone with two tabs open
on two different conversations — forwarding just makes it certain to
happen instead of a rare multi-tab coincidence. **Fix, as a prerequisite
for this feature**: `onMessage` must check `message.conversation_id ===
conversationId` and discard (not append) anything that doesn't match. This
is a small, targeted frontend fix that both unblocks safe forward
broadcasting AND closes the pre-existing dormant bug — not a new piece of
infrastructure.

**2. "Forward" needs to create a message in a conversation that is NOT the
one the sender's WebSocket connection is scoped to.** `chat.py`'s WebSocket
endpoint is `/ws/chat/{conversation_id}` — one connection is permanently
bound to one conversation for its whole lifetime (see
`receive_json`'s loop, which always persists with that URL's
`conversation_id`). There is no way to tell an already-open socket "create
a message somewhere else" through that channel. Forwarding therefore has
to be a REST route that creates the `Message` row directly and then
manually broadcasts — exactly the same shape edit/delete/hide already use,
not an extension of the WebSocket send path.

## API shape

`POST /conversations/{conversation_id}/messages/{message_id}/forward`

- `{conversation_id}` is the **source** conversation — used the same way
  every other message-scoped route in this file uses it: to verify the
  message actually belongs there (never trust a client-supplied id pairing
  alone).
- Body: `ForwardMessageRequest { target_conversation_id: int }`.
- Response: the newly created message, as a normal `MessageResponse` (now
  carrying `forwarded_from_user_id` and `forwarded_from_display_name`) —
  same shape `edit_message` already returns for its own mutation.

## Route mechanics (plain-English steps)

1. Look up the source `Message` by `id` AND `conversation_id` — 404 if it
   doesn't exist there (same pattern as every other message route here).
2. Authorization, two checks:
   - The current user must be a `Participant` of the source
     `conversation_id` (same check `get_message_history` already makes).
   - The message must not appear in the current user's own
     `HiddenMessage` rows — if they hid it "for me," they can't forward
     what they can't see. (No ownership check here at all — unlike edit/
     delete, anyone who can see it can forward it.)
3. The current user must also be a `Participant` of `target_conversation_id`
   — you can't forward into a conversation you're not in.
4. Compute the attribution to carry forward:
   `origin_user_id = source_message.forwarded_from_user_id or source_message.sender_id`
   — this single line is what implements "forwarding a forward keeps the
   original author," per the scope decision above.
5. Create a new `Message(conversation_id=target_conversation_id,
   sender_id=current_user.id, content=source_message.content, type="text",
   forwarded_from_user_id=origin_user_id)`, add, commit, refresh.
6. Look up `origin_user_id`'s `display_name` (one query) to populate
   `forwarded_from_display_name` on the response — not stored on the row
   itself, computed at read time, same as every other derived display
   field in this file (e.g. a 1-to-1's conversation name).
7. Broadcast the new message to every participant of
   `target_conversation_id`, **including the forwarder's own other
   sessions** — same `[*other_user_ids, current_user.id]` full-fanout
   already used by edit/delete, safe now that "real constraint #1"'s
   frontend fix is in place. The payload is a plain message payload, same
   shape `chat.py`'s normal send flow already produces — **no new
   WebSocket event type is needed**. A receiving client that doesn't
   recognize "forwarded-ness" as a protocol concept still handles it
   correctly, because it's just a message with two extra, optional fields.
8. Return the `MessageResponse`.

## Reading forwarded messages back (`get_message_history`, `search_messages`)

`get_message_history` needs one more small batched lookup, same shape as
its existing read-receipt/attachment batching: collect the distinct
`forwarded_from_user_id`s present in the page (skipping `None`s), fetch
those users' `display_name`s in one query, and set
`forwarded_from_display_name` per message from that map. This is the same
"collect ids → one batch query → build a dict → assemble responses"
pattern already used three times in this file — not a new technique.

Search results (`search_messages`) do **not** need this — no user story
asks for forward attribution to show up in search, so it's left out rather
than added speculatively.

## Frontend shape

- A "Forward" action appears in `MessageList.tsx`'s per-message action row,
  alongside Edit/Delete — shown for every message regardless of `isMine`
  (consistent with "anyone who can see it can forward it"), but hidden for
  any message with an attachment (text-only, per scope).
- Clicking it opens a lightweight picker (reuse the existing conversation
  list data already fetched for `/chat` — no new endpoint needed to list
  "which conversations can I forward into") and on selecting one, calls the
  new route.
- On success, the forwarder sees a brief confirmation (e.g. "Forwarded to
  Bob") — they are **not** necessarily looking at the target conversation,
  so there's nothing to append to their currently-visible message list.
  If they do have the target conversation open in another tab, that tab
  receives the new message live through the normal WebSocket path, same as
  any other incoming message.
- `MessageList.tsx` renders the label when present:
  `{message.forwarded_from_display_name && <span className="italic text-xs">Forwarded from {message.forwarded_from_display_name}</span>}`
  above the bubble content, the same way `(edited)` already renders next to
  it — another small, additive label, not a structural change to the
  message bubble.

## Out of scope (stated, not an oversight)

- **Attachments.** Forwarding a message with an image/file would mean two
  `Attachment` rows (original + forwarded copy) pointing at the same S3
  `object_key` (`models/attachment.py` has no uniqueness constraint on
  `message_id` or `object_key`, so nothing stops this at the schema level).
  That collides with `delete_message_for_everyone`'s current logic, which
  calls `delete_object(bucket, attachment.object_key)` unconditionally
  whenever ANY message with that attachment is hard-deleted — deleting the
  original would silently break every forwarded copy's image. Supporting
  attachment forwarding later means first changing that delete path to
  only call `delete_object` when no other `Attachment` row still
  references the same `object_key`. Real fix, real scope, deliberately not
  bundled into this version.
- **Multi-target forward** (picking several conversations at once) — see
  the locked scope decision above.
- **"Forwarded N times" counts or a full forward chain/history** — only the
  original author is tracked, nothing about how many hops it took to get
  here.
