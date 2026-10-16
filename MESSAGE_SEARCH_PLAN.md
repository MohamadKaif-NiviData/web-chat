# Message Search — Plan

## Goal

Let a user search the text content of every message across every conversation
they're a participant in — not just the one currently open — and jump
straight into the right conversation, scrolled to the matching message.

## Scope decisions (locked in for this version)

- **Global search, across all of the user's conversations** — not scoped to
  whichever conversation happens to be open. One search box, results grouped
  by/labeled with which conversation they came from.
- **Match strategy: simple case-insensitive substring match** (`content
  ILIKE '%term%'`). No new infrastructure, no migration, consistent with how
  little this project reaches for new dependencies. Trade-off stated
  up front: no relevance ranking, no stemming ("running" won't match "run"),
  and — because the pattern has a leading wildcard — Postgres can't use a
  plain index for it, so this is a full scan of `messages.content` per
  search. Fine at this project's data volume; see "Out of scope" below for
  the upgrade path.
- **Hidden-for-me messages are excluded**, same as every other read path
  (`get_message_history`, `list_conversations`). Searching must never
  resurface something you already deleted "for me" — that would quietly
  break the guarantee the previous feature just built.
- **Minimum query length: 2 characters.** A 1-character query against
  `ILIKE '%x%'` would match a huge fraction of all messages and do a full
  table scan for a result set too large to be useful — reject it
  client-side before it's even sent, and reject server-side too (never
  trust the client alone, same instinct as every time-window check in the
  edit/delete feature).
- **Search matches message `content` only** — not sender names, not
  attachment filenames, not conversation names. Keeps the first version
  small; see "Out of scope."
- **Editing doesn't need special handling** — search always matches whatever
  is currently in `content`, the same column `edited_at` logic already
  overwrites. No separate "search old versions" concept, consistent with
  "no edit history" being out of scope for this project already.

## No new dependencies, no migration

Unlike edit/delete (which needed a new column and a new table), search needs
**no schema change at all** — it's a new query pattern over data that
already exists (`Message.content`), plus one new route and one new response
schema. `Base.metadata.create_all()` has nothing new to create.

## Two real constraints this plan has to handle (not hypothetical)

**1. `%` and `_` are wildcards to `ILIKE`, not literal characters.**
If a user searches for `"50% off"`, a naive `f"%{term}%"` turns that into
the pattern `%50% off%` — the `%` *in the search term* is interpreted as
"zero or more of anything," not a literal percent sign, so it'll match
things the user never typed. The search term has to be escaped (escape
`%`, `_`, and the escape character itself) before being wrapped in
wildcards. This is a correctness bug waiting to happen, not a hypothetical —
`ILIKE` doesn't know the difference between "wildcard from our code" and
"literal character from user input" unless we tell it to.

**2. Search results span conversations the frontend hasn't necessarily
loaded anything about** — unlike `get_message_history` (always scoped to
one already-open conversation), a global result list needs enough context
per row to be useful on its own: which conversation this came from (its
display name), and who sent it (useful in a group, where "found in: Project
Team" isn't enough — you also want "— Bob: ..."). Computing that naively
(one query per matched message to find its conversation's other
participants) is the same N+1 trap already avoided elsewhere in this file
(`get_message_history`'s batched read-receipt/attachment lookups). The fix
is the same shape: collect the distinct `conversation_id`s from the matched
messages first, batch-fetch each conversation's other participants in one
query, then assemble each result row from that pre-built map.

## API shape

`GET /conversations/search?q=<term>&cursor=<message_id>&limit=20`

- `q`: the search term. Reject with `422`/`400` if, after trimming, it's
  under 2 characters.
- `cursor`/`limit`: same keyset pagination shape as `get_message_history` —
  `Message.id < cursor`, ordered `Message.id DESC`. Ordering by `id` desc
  approximates recency across every conversation at once without needing to
  compare `created_at` across rows, same reasoning as everywhere else `id`
  is already used as the sort key.

Response: a new `MessageSearchPage` (mirrors `MessagePage`'s shape):

```
MessageSearchResult:
  message_id: int
  conversation_id: int
  conversation_name: str      # same is_group ? conversation.name : other participant's display_name logic as ConversationSummary
  is_group: bool
  sender_id: int
  sender_display_name: str
  content: str
  created_at: datetime
  edited_at: datetime | None

MessageSearchPage:
  results: list[MessageSearchResult]
  next_cursor: int | None
```

## Query mechanics (plain-English steps for the route)

1. Authorization is implicit in the query shape, not a separate check:
   join `Message` to `Participant` on `conversation_id`, filtered to
   `Participant.user_id == current_user.id` — a message can only appear in
   results if the requesting user is actually a participant of its
   conversation. (More efficient than `list_conversations`'s "fetch
   conversation_ids, then loop" pattern, which doesn't scale to "search
   everything" — a single joined query is the right shape here.)
2. Apply the escaped `ILIKE` filter on `Message.content`, the existing
   `hidden_message_ids` exclusion (same subquery already used in
   `get_message_history`/`list_conversations`), the `cursor` filter, order
   by `Message.id DESC`, `limit(limit + 1)` — identical "fetch one extra row
   to know if there's a next page" trick already used for message history.
3. Collect the distinct `conversation_id`s from the matched page, batch
   fetch: each conversation's row (for `is_group`/`name`), and — for
   non-group conversations — the other participant's `display_name`, and
   the sender `User` rows for every matched message's `sender_id`. Three
   small batched queries, not N.
4. Assemble `MessageSearchResult` rows from those maps, return
   `MessageSearchPage`.

## The jump-to-message problem (a real gap this plan has to close)

Clicking a search result should open the conversation scrolled to that exact
message — but `get_message_history` can only page backward from the
*newest* end via `cursor`. It has no way to fetch a window of messages
centered on an arbitrary older `message_id`. Without addressing this, a
search result would only be able to open the conversation at the live end,
not at the actual match — which defeats most of the point of searching.

**Decision**: extend `get_message_history` with an optional `around:
int | None` query param. When present (and `cursor` is not), fetch some
messages immediately before AND after that id (e.g. `limit // 2` on each
side) instead of the normal "everything before cursor" query, still
applying the same hidden-message exclusion. The frontend scrolls to and
briefly highlights that message id once the page loads, then normal
"load older" pagination continues upward from the oldest message in that
window exactly as it does today.

## Frontend shape

- A search input lives on the conversation-list page (`app/chat/page.tsx`),
  not inside an already-open conversation — matches the "global" scope
  decision.
- Debounced input (same throttle instinct as the existing typing-indicator
  throttle in `lib/websocket.ts`, just client-side setTimeout, no new
  pattern) calls `GET /conversations/search?q=...` via the existing
  `apiJson` helper, renders a flat result list: conversation name, sender
  name (useful mainly in groups), the matched snippet, timestamp.
- Clicking a result navigates to `/chat/[conversationId]?around=<message_id>`
  (or equivalent client-side state) — the conversation page reads that and
  calls `get_message_history` with `around` instead of its normal initial
  fetch, then scrolls to and highlights that message.
- No WebSocket involvement at all — search is a point-in-time REST query,
  not a live subscription. Nothing needs to update in real time while a
  search result list is open.

## Out of scope (stated, not an oversight)

- **No ranked/relevance-scored results, no stemming** — straight substring
  match only. Upgrading to Postgres full-text search (`tsvector`/`tsquery`
  with a GIN index, or `pg_trgm` for fuzzy/typo-tolerant matching) is a
  real future option and would need its own migration step (like edit/
  delete's Step 0) — not needed at this project's scale today.
  Here, the user explicitly chose the simple path over that now.
- **No search by sender name or within attachment filenames** — content
  only, for this version.
- **No highlighted match snippet with surrounding context** — the full
  `content` is returned as-is; truncating/highlighting around the match is
  a presentation detail the frontend can add without any backend change.
