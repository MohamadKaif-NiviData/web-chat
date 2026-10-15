# Message Editing / Deletion — User Stories

Scope: the edit, delete-for-everyone, and delete-for-me features described
in `MESSAGE_EDIT_DELETE_PLAN.md`. This captures the *requirements* in
Given/When/Then form — for the technical plain-English build plan (which
file does what, in what order), see `MESSAGE_EDIT_DELETE_PLAN.md` itself.

**Actors**:
- **Sender** — the participant who originally sent a message.
- **Recipient** — any other participant in the conversation.
- **System** — the backend (FastAPI REST routes + WebSocket relay) and the
  database.

---

## Story 1 — Edit a message shortly after sending

```gherkin
Scenario: Editing within the allowed window
  Given I sent a message less than 15 minutes ago
  When I edit its content and save
  Then the message updates immediately in my own view
    And every other open session (other participants, and my own other devices)
      sees the updated content live, without needing to refresh
    And the message is now marked "(edited)"
```

## Story 2 — Editing is blocked once the window expires

```gherkin
Scenario: Attempting to edit an old message
  Given I sent a message more than 15 minutes ago
  When I attempt to edit it
  Then the request is rejected
    And the message's content is unchanged everywhere
```

## Story 3 — Only the sender can edit their own message

```gherkin
Scenario: Attempting to edit someone else's message
  Given another participant sent a message less than 15 minutes ago
  When I attempt to edit that message
  Then the request is rejected
    And the message's content is unchanged
```

## Story 4 — Delete a message for everyone shortly after sending

```gherkin
Scenario: Deleting my own message for everyone
  Given I sent a message less than 1 hour ago
  When I delete it "for everyone"
  Then the message is completely removed — not just hidden with a placeholder
    And it disappears immediately from every other open session, mine included
    And if it had an attachment, the file is actually removed from storage,
      not just the chat bubble
```

## Story 5 — Delete-for-everyone is blocked once the window expires

```gherkin
Scenario: Attempting to delete an old message for everyone
  Given I sent a message more than 1 hour ago
  When I attempt to delete it "for everyone"
  Then the request is rejected
    And the message still exists for every participant
```

## Story 6 — Only the sender can delete-for-everyone

```gherkin
Scenario: Attempting to delete someone else's message for everyone
  Given another participant sent a message less than 1 hour ago
  When I attempt to delete that message "for everyone"
  Then the request is rejected
    And the message still exists for every participant, including me
```

## Story 7 — Hide any message from just my own view, any time

```gherkin
Scenario: Deleting a message "for me"
  Given a message exists in a conversation I'm part of (sent by me or anyone else)
    And there is no time restriction on this action
  When I delete it "for me"
  Then the message disappears from my view
    And every other participant still sees it completely normally
```

## Story 8 — Hiding a message is safely repeatable

```gherkin
Scenario: Hiding the same message twice
  Given I have already deleted a message "for me"
  When I attempt to delete the same message "for me" again
  Then nothing breaks — no error, no duplicate record
    And the message remains hidden from my view, exactly as before
```

## Story 9 — "Delete for me" follows my account, not my browser

```gherkin
Scenario: Hiding a message while logged in on two devices
  Given I am logged into the same account on two devices
  When I delete a message "for me" on device A
  Then it also disappears from my view on device B
    And no other participant is ever notified that this happened
```

## Story 10 — A hidden message never resurfaces as a preview

```gherkin
Scenario: Checking the chat list after hiding the most recent message
  Given the most recent message in a conversation is one I've deleted "for me"
  When I view my chat list
  Then the conversation's preview shows my next-most-recent VISIBLE message,
    not the one I hid
```

## Story 11 — Edits and deletions survive a page reload

```gherkin
Scenario: Reloading after an edit or a deletion
  Given I edited a message, or deleted one for everyone or for me
  When I reload the page (or open the conversation fresh on another device)
  Then the message history reflects the change exactly as it was live —
    this is not just a live WebSocket event, it's the stored, persisted state
```

---

## Acceptance notes (non-functional, cross-cutting)

- **Authentication**: every action (edit, delete-for-everyone, delete-for-me)
  requires a valid logged-in session and, for edit/delete-for-everyone,
  verified ownership of the message — never just a client-asserted user id.
- **Server is the only real guard on time windows**: a client-side
  countdown showing "you can still edit this" is a convenience, never the
  actual enforcement — the server re-checks `created_at` against the current
  time on every request, independent of whatever the UI displayed.
- **Data integrity on hard delete**: deleting a message for everyone must
  never leave orphaned rows behind (stale read receipts, stale hidden-message
  records, an attachment row pointing at a deleted file) and must never
  crash with a foreign-key error — dependent rows are cleaned up in the
  correct order before the message row itself is removed.
- **"Delete for me" never leaks to other participants** — not as a message
  in the chat, not as a WebSocket event, not in any API response another
  participant can see. It is exclusively visible to, and reversible only
  by (in a future version), the user who hid it.
- **No edit history** is kept in this version — only the current content and
  an "edited" flag are available. Out of scope for now, not an oversight
  (see `MESSAGE_EDIT_DELETE_PLAN.md`'s scope decisions).
