# Pin Message — User Stories

Scope: the pin/unpin message feature described in `PIN_MESSAGE_PLAN.md`.
This captures the *requirements* in Given/When/Then form — for the
technical plain-English build plan (which file does what, in what order),
see `PIN_MESSAGE_PLAN.md` itself.

**Actors**:
- **Pinner** — the participant performing a pin or unpin action.
- **Hider** — a participant who has hidden a particular message "for me,"
  independent of who pins/unpins it.
- **Participant** — any other member of the conversation.
- **System** — the backend (the new REST routes, the WebSocket relay) and
  the database.

---

## Story 1 — Pinning a message

```gherkin
Scenario: Pinning a message in a conversation
  Given a message exists in a conversation I'm part of
  When I pin it
  Then it becomes that conversation's pinned message
    And every participant sees it pinned, live, without refreshing
```

## Story 2 — Unpinning a message

```gherkin
Scenario: Unpinning the currently pinned message
  Given a conversation currently has a pinned message
  When I unpin it
  Then the conversation no longer has a pinned message
    And every participant's view updates live to reflect that
```

## Story 3 — Pinning a new message replaces the old pin

```gherkin
Scenario: A conversation already has a pinned message
  Given conversation already has message A pinned
  When I pin message B in the same conversation
  Then message B becomes the pinned message
    And message A is no longer pinned
    And there is never more than one pinned message at a time
```

## Story 4 — I can't pin a message I've hidden "for me"

```gherkin
Scenario: Attempting to pin a message I previously hid from my own view
  Given I deleted a message "for me" in some conversation
  When I attempt to pin that same message
  Then the request is rejected
    And the conversation's pinned message (if any) is unchanged
```

## Story 5 — A pin survives my own personal hide of that message

```gherkin
Scenario: Hiding a message that someone else already pinned
  Given another participant pinned a message
  When I delete that same message "for me"
  Then I personally no longer see it as pinned (or at all)
    And every OTHER participant who has not hidden it still sees it pinned,
      completely unaffected by my personal choice
```

## Story 6 — Only participants can pin or unpin

```gherkin
Scenario: A non-participant attempts to pin or unpin
  Given a conversation that I am NOT a participant of
  When I attempt to pin a message in it, or unpin whatever is pinned there
  Then the request is rejected
    And this is enforced by the server regardless of what the client sends
```

## Story 7 — The message must actually belong to the stated conversation

```gherkin
Scenario: Pinning with a mismatched conversation and message id
  Given a message id that does not actually belong to the conversation id
    supplied in the request
  When I attempt to pin it
  Then the request is rejected with "not found"
    And this holds even if I AM a legitimate participant of that
      conversation — the id pairing itself must be valid
```

## Story 8 — Pin and unpin are safely repeatable

```gherkin
Scenario: Pinning an already-pinned message, or unpinning an empty pin
  Given a message is already the conversation's pinned message
  When I pin that same message again
  Then nothing breaks and nothing changes — it's already pinned
  Given a conversation currently has no pinned message
  When I attempt to unpin
  Then nothing breaks — there was nothing to unpin
```

## Story 9 — Deleting the pinned message clears the pin for everyone

```gherkin
Scenario: The currently pinned message is deleted "for everyone"
  Given a message is currently pinned in a conversation
  When that message is deleted "for everyone"
  Then the delete succeeds without error
    And the conversation no longer has a pinned message, for every
      participant, live
```

## Story 10 — Pin and unpin updates arrive live

```gherkin
Scenario: Another participant pins or unpins while I have the conversation open
  Given I am currently viewing a conversation
  When another participant pins a message, or unpins the current one
  Then my view reflects the change without me needing to refresh or
    reopen the conversation
```

## Story 11 — The pin banner always reflects current content

```gherkin
Scenario: The pinned message is edited after being pinned
  Given a message is currently pinned
  When its sender edits its content
  Then the pin banner shows the UPDATED content, not what it said at the
    moment it was pinned
```

## Story 12 — Jumping from the pin banner to the message in history

```gherkin
Scenario: Clicking the pinned message banner
  Given a conversation has a pinned message that is several hundred
    messages back in history
  When I click the pin banner
  Then the conversation scrolls directly to that message and highlights it
    And I did not have to manually page back through history to find it
```

## Story 13 — Any participant can pin or unpin in a group, not just its creator

```gherkin
Scenario: A regular group member (not the creator) pins or unpins a message
  Given I am a participant of a group but did not create it
  When I pin a message, or unpin the current one
  Then the action succeeds exactly as it would for the group's creator
    And this is a deliberate difference from remove-member, which stays
      creator-only
```

---

## Acceptance notes (non-functional, cross-cutting)

- **Authentication**: pinning and unpinning require a valid logged-in
  session, same as every other route in this app.
- **The server is the only real guard on participation and visibility** —
  a hidden "Pin" button in the UI is a convenience only; the routes
  independently re-check participant status and the hidden-for-me
  exclusion regardless of what the client sends.
- **The WebSocket events never carry message content** — `message_pinned`
  and `message_unpinned` are bare signals; every client reacts by
  re-fetching the conversation summary, which is the one place
  hidden-for-me visibility is actually computed. This is what makes
  Story 5's guarantee hold even over the live channel, not just on a
  fresh page load.
- **No pin history, no "pinned by" attribution, and no per-group
  permission gate** are explicitly out of scope for this version — see
  `PIN_MESSAGE_PLAN.md`'s own "Out of scope" section.
