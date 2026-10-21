# Message Forward — User Stories

Scope: the message forwarding feature described in
`MESSAGE_FORWARD_PLAN.md`. This captures the *requirements* in Given/When/Then
form — for the technical plain-English build plan (which file does what, in
what order), see `MESSAGE_FORWARD_PLAN.md` itself.

**Actors**:
- **Forwarder** — the user performing the forward action.
- **Original author** — whoever actually wrote the message being forwarded
  (may or may not be the Forwarder).
- **Recipient** — any other participant of the target conversation.
- **System** — the backend (the new forward REST route, the WebSocket
  relay) and the database.

---

## Story 1 — Forwarding delivers a visibly-marked copy to another conversation

```gherkin
Scenario: Forwarding a message to a different conversation
  Given a message exists in a conversation I'm part of
    And I am also a participant of some other conversation
  When I forward that message to the other conversation
  Then a new message appears there with the same content
    And it is visibly labeled "Forwarded" and names the ORIGINAL author
    And the original message is completely unchanged where it came from
```

## Story 2 — Anyone who can see a message can forward it, not just its sender

```gherkin
Scenario: Forwarding a message someone else sent
  Given another participant sent a message in a conversation I'm part of
  When I forward that message to another conversation
  Then the forward succeeds
    And the "Forwarded from" label names THEM, not me
```

## Story 3 — Forwarding has no time window

```gherkin
Scenario: Forwarding an old message
  Given a message was sent a long time ago (well past the 15-minute edit
    window and the 1-hour delete window)
  When I forward it
  Then the forward succeeds — there is no staleness check on forwarding
```

## Story 4 — A message I've hidden "for me" can't be forwarded by me

```gherkin
Scenario: Attempting to forward a message I previously deleted "for me"
  Given I deleted a message "for me" in some conversation
  When I attempt to forward that same message
  Then the request is rejected
    And no new message is created anywhere
```

## Story 5 — Forwarding requires being a participant of the target conversation

```gherkin
Scenario: Attempting to forward into a conversation I'm not part of
  Given a conversation exists that I am NOT a participant of
  When I attempt to forward a message into it
  Then the request is rejected
    And no message is created in that conversation
```

## Story 6 — The source message must actually belong to the stated source conversation

```gherkin
Scenario: Forwarding with a mismatched source conversation and message id
  Given a message id that does not actually belong to the source
    conversation id supplied in the request
  When I attempt to forward it
  Then the request is rejected with "not found"
    And this holds even if I AM a legitimate participant of that source
      conversation — the id pairing itself must be valid
```

## Story 7 — Forwarding a forward attributes to the ORIGINAL author

```gherkin
Scenario: Forwarding a message that was already a forward
  Given Alice's message was forwarded by Bob into a second conversation
  When Carol forwards that (already-forwarded) copy into a third conversation
  Then the new copy in the third conversation is labeled "Forwarded from
    Alice" — not "Forwarded from Bob"
```

## Story 8 — Editing a forwarded message keeps its "Forwarded" label

```gherkin
Scenario: Editing the content of a forwarded message
  Given I forwarded a message and it now sits in the target conversation
  When I edit that forwarded message's content (within the normal 15-minute
    edit window, since it's a message I now own as its sender)
  Then the content updates as normal
    And the "Forwarded from <original author>" label is still shown
      afterward — editing does not clear it
```

## Story 9 — The forwarded copy is independent of the original

```gherkin
Scenario: Deleting the original message after it has been forwarded
  Given a message was forwarded into another conversation
  When the original message is later deleted "for everyone" (or edited)
  Then the forwarded copy in the target conversation is completely
    unaffected — it keeps its own independent content
```

## Story 10 — Messages with attachments are not offered for forwarding

```gherkin
Scenario: A message has an image or file attached
  Given a message in a conversation has an attachment
  When I view the actions available for that message
  Then there is no Forward action available for it
    And this is a stated limitation of this version, not a silent failure
```

## Story 11 — Live delivery reaches the target conversation without leaking elsewhere

```gherkin
Scenario: Forwarding while viewing a different, unrelated conversation
  Given I am currently viewing conversation A
    And I forward a message from conversation A into conversation B
  Then the new message appears live in conversation B for anyone who has it
    open (including my own other open sessions, if any)
    And conversation A's view — the one I'm actually looking at right now —
      does NOT show that new message appearing in it
```

## Story 12 — Forwarding into the same conversation is allowed

```gherkin
Scenario: Forwarding a message back into the conversation it came from
  Given a message exists in a conversation I'm part of
  When I forward it back into that same conversation
  Then a second, visibly-marked-as-forwarded copy is created there
    And this is not blocked — it's simply allowed, if not especially useful
```

---

## Acceptance notes (non-functional, cross-cutting)

- **Authentication**: forwarding requires a valid logged-in session, same as
  every other route in this app.
- **The server is the only real guard on visibility and participation** — a
  hidden/disabled Forward button in the UI is a convenience only; the route
  itself independently re-checks that the forwarder is a participant of
  BOTH the source and target conversations, and that the message isn't
  hidden for them, regardless of what the client sends.
- **No new WebSocket event type** — a forwarded message arrives at
  recipients as a normal message payload with two extra optional fields
  (`forwarded_from_user_id`, `forwarded_from_display_name`). Any code that
  already handles incoming messages handles a forwarded one correctly,
  provided it correctly filters by `conversation_id` first (see Story 11 —
  this is the one real behavioral risk this feature introduces, not a
  hypothetical edge case).
- **No forward chain history or count is kept** — only the single original
  author is tracked, per `MESSAGE_FORWARD_PLAN.md`'s stated scope.
