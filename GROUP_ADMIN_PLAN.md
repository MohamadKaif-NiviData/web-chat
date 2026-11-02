# Group Admin Permissions (Rename / Add Members) — Plan

## Goal

Restrict renaming a group and adding new members to it to the group's
admin — reusing the same "creator" concept `GROUP_MEMBERSHIP_PLAN.md`
already introduced for remove-member, rather than building a second,
competing permission system.

## Scope decisions (locked in for this version)

- **Admin = the existing `created_by_user_id`, nothing new.** Single
  admin, no promotion, no multiple admins — exactly the concept that
  already exists and already gates `remove_participant`. This plan adds
  two more actions behind that same check; it doesn't add a new kind of
  permission.
- **Remove-member, rename, and add-member all use the identical check**
  (`current_user.id == conversation.created_by_user_id`). Not three
  separate gates that happen to currently agree — one gate, reused three
  times. If this project ever grows multi-admin support later, there's
  exactly one place that check's definition would need to change, not
  three.
- **Both actions are group-only** — renaming or adding members to a
  1-to-1 conversation doesn't mean anything in this app's model (a 1-to-1's
  displayed name is always computed from the other participant, never
  stored) and is rejected server-side.
- **Adding members reuses `create_group_conversation`'s existing
  all-or-nothing email resolution** — if any supplied email doesn't
  resolve to a real user, the whole request fails with 404 listing which
  one(s), nobody gets added. Same behavior as group creation, not a new
  rule.
- **Re-adding someone who left or was removed just works** — this is
  exactly the "being added fresh" mechanism `GROUP_MEMBERSHIP_PLAN.md`'s
  "Out of scope" section already pointed forward to. Their old departure
  stays in the system-message history; a new "X added Y to the group"
  notice is simply added alongside it.
- **No live push to a newly-added member specifically** — they'll see the
  new group next time they load or refresh their `/chat` list, the same
  way every other conversation-list update already works in this app (there
  is no live-updating conversation list today, for any event). Stated
  limitation, not an oversight.

## No new dependencies, no migration

Zero schema changes. `Conversation.created_by_user_id` and `.name` already
exist; `Participant` already supports any number of members. This is two
new routes and two new request schemas, reusing infrastructure end to end.

## Two real constraints this plan has to handle (not hypothetical)

**1. A group's name lives in conversation-level state that a chat message
can't update on its own.** Like pin/unpin before it, renaming needs to
change two different things that are fetched through two different
channels: the group's `name` (part of `ConversationSummary`, fetched once
on mount) and a visible historical record that it happened. Without a
dedicated signal, every other open tab would show the stale name in its
header indefinitely — a new message arriving through the normal pipe
doesn't touch `conversation.name` state at all. **Fix**: renaming does
both — creates a `type="system"` message ("Alice renamed the group to
'Launch Team'") for history, delivered through the existing message-relay
path with no new WebSocket event type, AND broadcasts a small dedicated
`conversation_renamed` event (`{"type": "conversation_renamed",
"conversation_id": ..., "name": ...}`) that every client applies directly
to its local `conversation.name` — same "conversation-level state needs
its own bare signal" pattern `PIN_MESSAGE_PLAN.md` established, just
without that plan's privacy reason for withholding content (a group's name
isn't hidden-for-me-sensitive, so the new name can ride directly in the
event instead of forcing a refetch).

**2. Adding someone already in the group would silently create a second
`Participant` row, not a clean error.** `participants` has no unique
constraint on `(conversation_id, user_id)` — nothing at the database level
stops two rows existing for the same pairing. If add-member doesn't check
for this, re-adding someone already present (or a client double-submitting
the same request) creates a duplicate row that then corrupts everything
built on "one row per membership": participant counts, "(N members)"
badges, `other_participantIds`-based seen-by-everyone logic, batched
display-name lookups. **Fix**: before inserting, filter out any requested
user who already has a `Participant` row in this conversation — add only
the genuinely new ones, silently skip the rest, same idempotent-by-default
instinct `hide_message_for_me`/pin/unpin already use elsewhere in this
file.

## API shape

`PATCH /conversations/{conversation_id}` — body `{"name": "New name"}`.

`POST /conversations/{conversation_id}/participants` — body
`{"member_emails": ["new@example.com", ...]}`.

## Route mechanics — rename

1. Look up the `Conversation` — 404 if missing.
2. `400` if `not conversation.is_group`.
3. `403` if `current_user.id != conversation.created_by_user_id` — "Only
   the group's creator can rename this group."
4. Reject an empty/whitespace-only name with `400` (never trust the client
   to have validated this — same instinct as every other input check in
   this file).
5. Set `conversation.name = payload.name.strip()`, commit.
6. Create the system message, commit, then broadcast it through the normal
   message-relay path (full fanout to every participant including the
   actor), AND separately broadcast `{"type": "conversation_renamed",
   "conversation_id": ..., "name": conversation.name}` to the same list.

## Route mechanics — add members

1. Look up the `Conversation` — 404 if missing.
2. `400` if `not conversation.is_group`.
3. `403` if `current_user.id != conversation.created_by_user_id` — "Only
   the group's creator can add members."
4. Resolve every email in `member_emails` to a `User` — if any fail to
   resolve, `404` listing which one(s), nobody is added (same all-or-
   nothing logic `create_group_conversation` already uses).
5. Of the resolved users, filter out anyone who already has a
   `Participant` row in this conversation (real constraint #2) — if that
   leaves nobody new, return success with nothing further to do (another
   idempotent no-op, consistent with the rest of this file).
6. Create `Participant` rows for the remaining genuinely-new users, commit.
7. Create one system message naming all newly-added users ("Alice added
   Bob, Carol to the group") — one message for the whole batch, not one
   per person (same "batch, not N" instinct `mark_messages_read` already
   follows for its own broadcast).
8. Broadcast that system message through the normal path, full fanout
   including the newly-added members themselves (they're real participants
   the moment their `Participant` row commits) AND the acting admin.
9. Broadcast `{"type": "participants_added", "conversation_id": ...}` —
   bare, no participant list — to the same full-fanout set, so every
   existing open tab's `conversation.participants` refreshes correctly.
   Deliberately the same "bare signal, re-fetch to get the real list"
   shape pin/unpin already established, since `ConversationSummary` is
   the one place `participants` is actually assembled.

## Frontend shape

- `GroupInfoPanel.tsx` (already shows the member list and Remove buttons
  gated on `conversation.created_by_user_id === currentUserId`) gains, under
  that same existing check: an editable name field calling the rename
  route, and an "Add member" email input calling the add-members route.
  No new permission-gating logic needed in the frontend — it's the exact
  same condition already written there for Remove.
- `useChatSocket` gains `onConversationRenamed?: (conversationId: number,
  name: string) => void` (patches `conversation.name` directly — safe,
  unlike pin, since a group's name has no per-viewer visibility rule) and
  `onParticipantsAdded?: (conversationId: number) => void` (bare signal,
  re-fetches `GET /conversations/{id}` — identical pattern to
  `onMessagePinned`/`onMessageUnpinned`).
- The two system messages need zero new frontend rendering work — they
  flow through the exact `type === "system"` path `MessageList.tsx`
  already built for leave/remove notices.

## Out of scope (stated, not an oversight)

- **No multi-admin, no promotion/demotion** — see the locked scope
  decision above; a future version could revisit this the same way
  `GROUP_MEMBERSHIP_PLAN.md` already flagged admin transfer as deferred.
- **No live update to a newly-added member's own conversation list** — see
  the locked scope decision above.
- **No limit on group size, no de-duplication of the `member_emails` list
  itself** (if the admin's own request lists the same email twice, it's
  simply resolved to the same user and then naturally collapsed by real
  constraint #2's existing-participant filter — not a new rule, just a
  side effect of the fix already being built).
