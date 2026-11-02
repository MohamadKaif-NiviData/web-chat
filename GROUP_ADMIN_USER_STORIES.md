# Group Admin Permissions (Rename / Add Members) — User Stories

Scope: the admin-gated rename and add-member features described in
`GROUP_ADMIN_PLAN.md`. This captures the *requirements* in Given/When/Then
form — for the technical plain-English build plan (which file does what, in
what order), see `GROUP_ADMIN_PLAN.md` itself.

**Actors**:
- **Admin** — the group's creator, the only one who can rename it or add
  members to it.
- **Member** — any other participant of the group.
- **New member** — a user being added to a group they weren't previously in.
- **System** — the backend (the new REST routes, the WebSocket relay) and
  the database.

---

## Story 1 — The admin renames the group

```gherkin
Scenario: The admin changes a group's name
  Given I created a group
  When I rename it to a new name
  Then the group's name is updated
    And every participant sees the new name live, without refreshing
```

## Story 2 — A non-admin cannot rename the group

```gherkin
Scenario: A regular member attempts to rename a group they didn't create
  Given I am a participant of a group but did not create it
  When I attempt to rename it
  Then the request is rejected
    And the group's name is unchanged
```

## Story 3 — Renaming a 1-to-1 conversation is not possible

```gherkin
Scenario: Attempting to rename a non-group conversation
  Given a conversation that is NOT a group
  When I attempt to rename it
  Then the request is rejected
```

## Story 4 — An empty name is rejected

```gherkin
Scenario: The admin submits a blank or whitespace-only name
  Given I am the admin of a group
  When I attempt to rename it to an empty or whitespace-only string
  Then the request is rejected
    And the group's existing name is unchanged
```

## Story 5 — A rename is visible and live, not just a silent change

```gherkin
Scenario: Checking the conversation after a rename
  Given the admin just renamed a group
  When any participant views that conversation
  Then they see the new name in the header
    And they see a visible notice in the message history recording that
      the rename happened
    And both of these are true live, for anyone with the conversation
      already open, without needing to reopen or refresh it
```

## Story 6 — The admin adds new members

```gherkin
Scenario: The admin adds someone new to a group
  Given I created a group
    And a user exists who is not currently a participant of it
  When I add them to the group
  Then they become a participant of the group
    And every participant (including the person just added) sees a
      visible notice recording who was added
```

## Story 7 — A non-admin cannot add members

```gherkin
Scenario: A regular member attempts to add someone to a group they didn't create
  Given I am a participant of a group but did not create it
  When I attempt to add a new member to it
  Then the request is rejected
    And no one new is added to the group
```

## Story 8 — Adding members to a 1-to-1 conversation is not possible

```gherkin
Scenario: Attempting to add a member to a non-group conversation
  Given a conversation that is NOT a group
  When I attempt to add a member to it
  Then the request is rejected
```

## Story 9 — Adding an unresolvable email rejects the whole batch

```gherkin
Scenario: One of several emails in an add-members request doesn't match any user
  Given I am the admin of a group
    And I submit a list of emails to add, one of which belongs to no
      registered user
  When I submit the request
  Then the entire request is rejected
    And NONE of the emails are added, including the ones that WOULD have
      resolved successfully — all or nothing, not partial success
```

## Story 10 — Adding someone already in the group doesn't duplicate them

```gherkin
Scenario: One of the emails being added already belongs to a current participant
  Given I am the admin of a group
    And one of the people I'm adding is already a participant of it
  When I submit the request, including other people who are genuinely new
  Then the already-present person is not duplicated or affected in any way
    And the genuinely new people in the same request ARE still added
    And the request succeeds rather than being rejected outright
```

## Story 11 — Re-adding someone who left or was removed works normally

```gherkin
Scenario: Adding back a user who previously left or was removed
  Given a user was previously removed from a group, or left it voluntarily
  When the admin adds that same user back to the group
  Then they become a participant again, exactly as if they were any other
    new member
    And the history still shows their earlier departure notice, alongside
      the new notice recording that they were added back
```

## Story 12 — A newly added member can use the group immediately

```gherkin
Scenario: Participating right after being added
  Given I was just added to a group by its admin
  When I view that conversation
  Then I can see its messages and send new ones
    And I am treated exactly like any other participant from this point on
```

## Story 13 — One consistent permission, not three coincidentally-matching ones

```gherkin
Scenario: Checking who can perform admin-only actions on the same group
  Given a group has one admin and several other members
  When any of remove-member, rename, or add-member is attempted
  Then the exact same person — the group's admin — is the only one who can
    successfully perform ANY of the three
    And this holds consistently even as the group's membership changes
      over time (people leaving, being removed, or being added)
```

---

## Acceptance notes (non-functional, cross-cutting)

- **Authentication**: both actions require a valid logged-in session, same
  as every other route in this app.
- **The server is the only real guard on admin status and group-only
  scope** — a hidden rename field or add-member form in the UI is a
  convenience only; both routes independently re-check `is_group` and
  `current_user.id == conversation.created_by_user_id` regardless of what
  the client sends.
- **Renaming uses two different update channels on purpose**: a
  `type="system"` message (for permanent, visible history) and a separate
  bare `conversation_renamed` event (for live conversation-level state).
  Neither alone would be correct — the message doesn't update the header,
  and the bare event alone would leave no record in history.
- **No live push to a newly-added member's own conversation list** — they
  see the new group next time they load or refresh it, consistent with
  how this app doesn't live-update the conversation list for any other
  event either. See `GROUP_ADMIN_PLAN.md`'s own "Out of scope" section.
- **No multi-admin, no promotion/demotion** in this version — see
  `GROUP_ADMIN_PLAN.md`'s locked scope decision.
