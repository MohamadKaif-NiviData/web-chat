# Message Search — User Stories

Scope: the global message search feature described in
`MESSAGE_SEARCH_PLAN.md`. This captures the *requirements* in Given/When/Then
form — for the technical plain-English build plan (which file does what, in
what order), see `MESSAGE_SEARCH_PLAN.md` itself.

**Actors**:
- **Searcher** — the current user running a search.
- **Participant** — any other user in one of the Searcher's conversations.
- **System** — the backend (the new search REST route) and the database.

---

## Story 1 — Finding a message in any of my conversations

```gherkin
Scenario: A search term matches a message in a conversation I'm part of
  Given I am a participant in several conversations
    And one of them contains a message whose content includes my search term
  When I search for that term
  Then that message appears in my results
    And the result identifies which conversation it came from
```

## Story 2 — Results are useful without opening the conversation first

```gherkin
Scenario: A match comes from a group conversation
  Given a matching message was sent by another participant in a group chat
  When I view my search results
  Then the result shows the group's name AND the sender's display name
    And I can tell who said it and where without clicking into it
```

## Story 3 — Search is case-insensitive

```gherkin
Scenario: Matching ignores letter case
  Given a message contains the word "Meeting"
  When I search for "meeting" (lowercase)
  Then that message appears in my results
```

## Story 4 — Very short queries are rejected

```gherkin
Scenario: Searching with fewer than 2 characters
  Given I enter a 1-character (or empty, whitespace-only) search term
  When I submit the search
  Then the request is rejected
    And no broad/unbounded result set is ever computed or returned
```

## Story 5 — A message I deleted "for me" never appears in my own results

```gherkin
Scenario: Searching after hiding a message
  Given I previously deleted a message "for me"
    And that message's content matches my search term
  When I search for that term
  Then that message does not appear in my results
    And it still appears normally in every other participant's results
```

## Story 6 — A message deleted "for everyone" can never appear

```gherkin
Scenario: Searching for content that was hard-deleted
  Given a message was deleted "for everyone" (and its row no longer exists)
  When anyone searches for text that used to be in that message
  Then it does not appear in anyone's results — there is nothing left to match
```

## Story 7 — Only my own conversations are ever searched

```gherkin
Scenario: A matching message exists in a conversation I'm not part of
  Given some other conversation (that I am not a participant in) contains a
    message matching my search term
  When I search for that term
  Then that message never appears in my results
    And this is enforced by the server regardless of what the client requests
```

## Story 8 — Literal `%` and `_` in a search term are matched literally

```gherkin
Scenario: Searching for text that contains a percent sign
  Given a message's content is "50% off this weekend"
  When I search for "50% off"
  Then that message appears in my results
    And the search does not silently behave as if I had typed a wildcard
      pattern I never intended
```

## Story 9 — Editing a message changes what it matches on

```gherkin
Scenario: Searching after a message has been edited
  Given a message originally said "call Bob" and was later edited to say
    "call Alice"
  When I search for "Bob"
  Then that message no longer appears in my results
  When I search for "Alice"
  Then that message does appear in my results
```

## Story 10 — Jumping to a result opens the exact message, not just the chat

```gherkin
Scenario: Clicking a search result
  Given my search returned a message from several hundred messages ago in a
    conversation
  When I click that result
  Then the conversation opens scrolled directly to that message
    And the matched message is visually highlighted
    And I did not have to manually scroll/page back through history to find it
```

## Story 11 — Paging through a large result set

```gherkin
Scenario: A search term matches more results than fit on one page
  Given my search term matches more messages than the page size
  When I view my first page of results and then request more
  Then I receive the next batch of older matches, not duplicates
    And this continues to work the same way regardless of how many
      conversations the matches are spread across
```

## Story 12 — No matches found

```gherkin
Scenario: Searching for a term that appears nowhere
  Given no message in any of my conversations contains my search term
  When I search for that term
  Then I receive an empty result set, not an error
```

---

## Acceptance notes (non-functional, cross-cutting)

- **Authentication**: search requires a valid logged-in session, same as
  every other route in this app — there is no "search as another user" path.
- **The server is the only real guard on scope and query length** — a
  disabled search box or client-side length check is a UI convenience only;
  the route itself re-validates query length and re-scopes to the
  requesting user's actual conversations via the `Participant` join,
  independent of whatever the client sent.
- **No live updates while viewing results**: search is a point-in-time
  query, not a subscription. If a new matching message arrives while a
  result list is open, it does not appear until the search is re-run — this
  is a deliberate difference from the rest of the app's WebSocket-driven
  real-time behavior, not an oversight (see `MESSAGE_SEARCH_PLAN.md`'s
  "Frontend shape" section).
- **No highlighted snippet or relevance ranking in this version** — results
  are returned in recency order with full message content; see
  `MESSAGE_SEARCH_PLAN.md`'s "Out of scope" section for why, and what the
  future upgrade path looks like.
