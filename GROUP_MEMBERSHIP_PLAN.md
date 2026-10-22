# Group Leave / Remove Member — Plan

## Goal

Let any participant of a group voluntarily leave it, and let the group's
creator remove another member from it — both ending that person's access to
the group going forward, with everyone else notified live.

## Scope decisions (locked in for this version)

- **Only the group's creator can remove members.** There is currently no
  admin/role concept anywhere in this app — every group member is
  indistinguishable from every other once the group exists. Rather than
  "anyone can remove anyone" (the first unguarded destructive action in the
  app if built that way), this introduces the minimal concept needed:
  `Conversation.created_by_user_id`. No roles, no promotion/demotion, no
  multiple admins — just "whoever made it."
- **Leaving needs no permission check beyond already being a participant** —
  anyone can leave any group they're in, at any time, no approval needed.
- **Both actions are group-only.** Leaving or removing someone from a 1-to-1
  conversation doesn't mean anything in this app's model and is rejected —
  server-side, not just hidden from the UI.
- **The creator cannot remove themselves via the remove-member route** —
  that's what leave is for. Keeps exactly one code path responsible for
  "I'm out," instead of two that could disagree.
- **No admin transfer / no ownership handoff.** If the creator leaves their
  own group, nobody can remove members from it ever again for the rest of
  its life — there's no mechanism to promote someone else. Stated
  explicitly as a real consequence of this version's scope, not an
  oversight (see "Out of scope").
- **Leaving/being removed is a total, immediate cutoff** — not "you can
  still see history up to when you left." The moment the `Participant` row
  is gone, every read path's existing authorization check (`get_message_history`,
  `get_conversation`, etc.) simply 403s them, exactly as it already does for
  anyone who was never a participant. No partial-access window, because
  nothing in this app tracks one.
- **Remaining members see an inline system notice** ("Bob left the group" /
  "Alice removed Bob") — implemented as a normal `Message` row with
  `type="system"`, riding the exact same real-time broadcast path a regular
  message already uses. No new WebSocket event type for the notice itself.
- **An empty group (zero participants left) is left dangling** — not
  auto-deleted. Consistent with this app's general "don't solve problems
  this phase doesn't have" pattern; cleanup/archival is a future
  enhancement, not a correctness requirement today.
- **Hidden-message rows for a departed user are not cleaned up** — they
  become inert or ophaned data, same "leave it dangling" reasoning as above.
  Harmless, because `get_message_history` already requires an active
  `Participant` row before that data would ever matter.

## No new dependencies

One new nullable column (`created_by_user_id`), two new REST routes, one new
conventional `Message.type` value (`"system"` — `type` is already a
free-form string column, no schema change needed for that part), and one
small addition to the existing WebSocket loop. No new table, no new service.

## One-time manual setup

```sql
ALTER TABLE conversations ADD COLUMN created_by_user_id INTEGER NULL REFERENCES users(id);

-- Backfill existing groups: `create_group_conversation` already adds the
-- creator's Participant row FIRST, before any invited members, in the same
-- transaction — so the lowest participants.id for a given conversation_id
-- is a reliable stand-in for "who made this group" even for groups created
-- before this migration exists.
UPDATE conversations c
SET created_by_user_id = (
  SELECT p.user_id FROM participants p
  WHERE p.conversation_id = c.id
  ORDER BY p.id ASC LIMIT 1
)
WHERE c.is_group = true;
```

Without this backfill, every group created before this feature ships would
have `created_by_user_id = NULL` and silently lose "remove member"
capability forever (nobody would ever pass the `current_user.id ==
created_by_user_id` check) — leaving still works fine for them regardless,
since leave never depends on this column.

## Three real constraints this plan has to handle (not hypothetical)

**1. A removed user's already-open WebSocket connection keeps working until
they reconnect.** Tracing `app/api/ws/chat.py`: the `Participant` check
happens exactly once, at `connect()` time. The `while True: data = await
websocket.receive_json()` loop that follows never re-checks it. So if Bob is
removed while his browser tab is still open on that conversation, his
existing socket can keep persisting and relaying messages into a group he's
no longer part of, for as long as that connection stays alive. This mirrors
the same "never trust a cached check" principle CLAUDE.md already states
for this codebase ("every WS/HTTP endpoint... independently re-checks the
requesting user is actually a Participant") — it just hadn't been applied
to the *lifetime* of a connection, only its start. **Fix**: add the same
`Participant` re-check inside the receive loop, on every incoming message,
not only at connect — if it fails, close the connection instead of
persisting whatever they just sent.

**2. A system message must not be editable or deletable through the normal
message routes just because it technically has a `sender_id`.** The system
message for "Bob left the group" needs *some* `sender_id` to satisfy the
existing NOT NULL/foreign-key constraint on `messages.sender_id` — the
natural choice is the acting user (whoever left, or whoever removed
someone). But `edit_message` and `delete_message_for_everyone` only check
`message.sender_id == current_user.id` today — they don't check `type`. Left
unguarded, that user could edit "Bob left the group" into arbitrary text,
or quietly delete the notice. **Fix**: both routes gain a one-line guard —
reject with `400` if `message.type != "text"` — closing this the same way
the forward route already defensively rejects attachment messages
server-side instead of only hiding the button client-side.

**3. The removed user needs to find out, even though they didn't initiate
anything.** Leaving doesn't need a dedicated self-notification: the leaver's
own REST call already succeeds or fails synchronously, so their own client
can react directly (navigate back to `/chat`) without waiting on anything
async. But someone who gets *removed* is a passive third party — their
client has no synchronous signal at all. **Fix**: in addition to the
system-message broadcast to everyone else, send one more self-only
WebSocket event directly to the removed user's own socket(s) — same
`manager.send_to_user(removed_user_id, {...})` shape `hide_message_for_me`
already uses for its own self-only event — so their open tab can redirect
them immediately instead of silently sitting on a conversation that will
403 on its next action.

## Data model

- `Conversation.created_by_user_id: int | None` (new column, see migration
  above). `None` only for 1-to-1 conversations and any group created before
  the backfill ran and somehow missed it.
- `ConversationSummary` schema gains `created_by_user_id: int | None` so the
  frontend can decide whether to show "Remove" for each member (`current
  user id == created_by_user_id`).
- `create_group_conversation` sets `created_by_user_id=current_user.id` on
  the new `Conversation` going forward.
- No change to `Message` — `type="system"` is just a new value in an
  already-free-form column, the same way `"image"`/`"file"` already are.

## API shape

`POST /conversations/{conversation_id}/leave` — no body.

`DELETE /conversations/{conversation_id}/participants/{user_id}` — no body,
`user_id` in the path identifies who's being removed.

## Route mechanics — leave

1. Look up the `Conversation` — 404 if missing.
2. `400` if `not conversation.is_group` — leaving a 1-to-1 isn't meaningful.
3. `403` if the current user has no `Participant` row here.
4. Delete that `Participant` row.
5. Create `Message(conversation_id=.., sender_id=current_user.id,
   content=f"{display_name} left the group", type="system")`, commit.
6. Fetch the *remaining* participants (the query naturally excludes the
   leaver now, since their row is already gone) and broadcast the system
   message to them the same full-fanout way edit/delete already do.
7. No self-only event needed (see constraint #3) — the leaver's own
   `page.tsx` navigates to `/chat` directly off this call's `200` response.

## Route mechanics — remove member

1. Look up the `Conversation` — 404 if missing.
2. `400` if `not conversation.is_group`.
3. `403` if `current_user.id != conversation.created_by_user_id` — the one
   real permission gate this feature adds.
4. `400` if `user_id == current_user.id` — "use leave instead."
5. `404` if `user_id` has no `Participant` row here — never trust the path
   alone, same pairing check every message route already makes.
6. Delete that `Participant` row.
7. Create the system message: `content=f"{creator_display_name} removed
   {target_display_name} from the group"`, `sender_id=current_user.id`
   (the creator — they're the one who acted).
8. Broadcast the system message to the remaining participants (full
   fanout, same as leave).
9. Send the one additional self-only event to the removed user:
   `manager.send_to_user(user_id, {"type": "removed_from_conversation",
   "conversation_id": conversation_id})`.

## Frontend shape

There's currently no group-membership UI surface at all — `conversation.
participants` is only ever used today to build a sender-name lookup, never
rendered as a visible list. This feature needs a small new one:

- A "Group info" entry point in the conversation header (e.g. tapping the
  group name) opens a panel listing `conversation.participants`, each with
  a "Remove" action shown only when `conversation.created_by_user_id ===
  currentUserId`, plus a "Leave group" action at the bottom shown whenever
  `conversation.is_group` is true.
- `MessageList.tsx` renders `type === "system"` messages distinctly — a
  centered, bubble-less gray line (standard chat-app convention), with no
  Edit/Delete/Forward/Seen actions at all, rather than forcing them through
  the normal left/right-aligned bubble logic that assumes a "mine vs.
  theirs" sender.
- `useChatSocket` gains one more optional handler,
  `onRemovedFromConversation?: (conversationId: number) => void`, wired to
  the new `removed_from_conversation` event type; `page.tsx` uses it to
  `router.push("/chat")` plus a brief "You were removed from this group"
  notice.
- Leaving calls `POST .../leave` and navigates to `/chat` directly on
  success — no WebSocket round-trip needed for the acting user themselves
  (see constraint #3's reasoning).

## Out of scope (stated, not an oversight)

- **No admin transfer / ownership handoff.** Once the creator leaves, the
  group permanently has no one who can remove members. A future version
  could add "transfer ownership before leaving" or multiple admins; this
  version doesn't need to solve that yet.
- **No re-invite / rejoin flow** for someone who left or was removed —
  getting back in means being added fresh, same as any other new member
  (already supported by the existing group-creation flow).
- **No auto-cleanup of an emptied conversation** — see the locked scope
  decision above.
