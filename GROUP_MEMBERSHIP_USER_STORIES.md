# Group Leave / Remove Member — User Stories

Scope: the group leave and remove-member features described in
`GROUP_MEMBERSHIP_PLAN.md`. This captures the *requirements* in
Given/When/Then form — for the technical plain-English build plan (which
file does what, in what order), see `GROUP_MEMBERSHIP_PLAN.md` itself.

**Actors**:
- **Leaver** — a participant who voluntarily leaves a group.
- **Creator** — the user who originally created the group; the only one who
  can remove another member.
- **Removed member** — the participant the Creator removes.
- **Remaining member** — any other participant still in the group afterward.
- **System** — the backend (the new REST routes, the WebSocket relay) and
  the database.

---

## Story 1 — Leaving a group

```gherkin
Scenario: A participant leaves a group they're in
  Given I am a participant of a group conversation
  When I choose to leave it
  Then I am no longer a participant of that conversation
    And I can no longer view it or its messages
```

## Story 2 — Leaving a 1-to-1 conversation is not possible

```gherkin
Scenario: Attempting to leave a 1-to-1 conversation
  Given a conversation that is NOT a group
  When I attempt to leave it
  Then the request is rejected
    And I remain a participant of it, unchanged
```

## Story 3 — Leaving revokes access immediately, not just visually

```gherkin
Scenario: Attempting to read history right after leaving
  Given I just left a group
  When I attempt to fetch that conversation's message history directly
  Then the request is rejected, the same way it would be for someone who
    was never a participant
    And this holds even for messages that were sent while I was still a
      member — there is no partial "history up to when I left" access
```

## Story 4 — Only the group's creator can remove another member

```gherkin
Scenario: The creator removes a member
  Given I created a group
    And another user is a participant of it
  When I remove that participant
  Then they are no longer a participant of the group
    And they can no longer view it or its messages
```

## Story 5 — A non-creator cannot remove anyone

```gherkin
Scenario: A regular member attempts to remove someone else
  Given I am a participant of a group but did NOT create it
  When I attempt to remove another participant
  Then the request is rejected
    And that participant remains in the group, unaffected
```

## Story 6 — The creator cannot remove themselves this way

```gherkin
Scenario: The creator attempts to use the remove-member action on themselves
  Given I created a group
  When I attempt to remove myself via the remove-member action
  Then the request is rejected
    And I remain a participant — removing myself requires leaving instead
```

## Story 7 — Removing participants from a 1-to-1 conversation is not possible

```gherkin
Scenario: Attempting to remove someone from a non-group conversation
  Given a conversation that is NOT a group
  When I attempt to remove the other participant from it
  Then the request is rejected
```

## Story 8 — Removing someone who isn't actually a participant is rejected

```gherkin
Scenario: The creator targets a user id that isn't in the group
  Given I created a group
    And a given user is NOT currently a participant of it
  When I attempt to remove that user
  Then the request is rejected
    And this holds even though I AM the group's creator — the target must
      actually be a real participant, not just any user id
```

## Story 9 — Remaining members see an inline notice

```gherkin
Scenario: Someone leaves or is removed while I'm still in the group
  Given I am a participant of a group
  When another participant leaves it, OR the creator removes someone
  Then I see a visible notice in the conversation saying who left, or who
    removed whom
    And this notice appears live, without needing to refresh
```

## Story 10 — The removed member is notified directly

```gherkin
Scenario: Being removed while the conversation is open
  Given I am currently viewing a group I'm a participant of
  When the creator removes me from it
  Then my own view is notified directly that I've been removed
    And I did not have to take any action myself to find this out — unlike
      leaving (which I'd already know, since I initiated it), this is
      something that happened TO me
```

## Story 11 — A departed member's still-open connection stops working

```gherkin
Scenario: Attempting to send a message right after being removed or leaving
  Given I just left a group, or was just removed from one
    And my app still has an open live connection to that conversation from
      just before that happened
  When I attempt to send a message through that still-open connection
  Then it is rejected and the connection is closed
    And no message from me is persisted into that group afterward
```

## Story 12 — System notices can't be tampered with

```gherkin
Scenario: Attempting to edit or delete a "left the group" / "removed" notice
  Given a system notice exists in a group's message history
  When anyone attempts to edit it, or delete it "for everyone"
  Then the request is rejected
    And this holds regardless of who is attempting it, including whoever
      the notice is nominally attributed to
```

## Story 13 — If the creator leaves, remove-member is gone for good

```gherkin
Scenario: The creator leaves their own group
  Given I created a group
  When I leave it
  Then I am removed as a participant like anyone else
    And from then on, nobody — including any remaining member — can remove
      participants from that group anymore, since there is no mechanism in
      this version to transfer who the creator is
```

---

## Acceptance notes (non-functional, cross-cutting)

- **Authentication**: both actions require a valid logged-in session, same
  as every other route in this app.
- **The server is the only real guard on permission and group-only scope**
  — a hidden "Remove" button or disabled "Leave" action in the UI is a
  convenience only; the routes independently re-check `is_group`,
  participant status, and (for remove) creator identity, regardless of
  what the client sends.
- **No new WebSocket event type for the system notice itself** — it's a
  normal message with `type="system"`, delivered through the exact same
  broadcast path a regular message already uses. The removed member's
  direct notification (Story 10) is the one genuinely new event type this
  feature adds, because unlike every other participant, they have no
  synchronous signal of their own to react to.
- **No auto-cleanup of an emptied group** and **no admin transfer** are
  explicitly out of scope for this version — see
  `GROUP_MEMBERSHIP_PLAN.md`'s own "Out of scope" section.
