# Push Notifications — User Stories

Scope: Phase 2 "push notifications" feature (GUIDE.md Steps 14-15). This
captures the *requirements* in Given/When/Then form — for the technical
plain-English build plan (which file does what, in what order), see
`GUIDE.md`.

**Actors**:
- **Sender** — the participant sending a message.
- **Recipient** — a participant the message is addressed to, other than the
  sender.
- **System** — the backend (FastAPI + WebSocket), the browser's push
  service (e.g. Chrome/FCM, Firefox/autopush), and the recipient's browser.

---

## Story 1 — Enable notifications on a device

As a chat participant, I want to opt in to push notifications on this
browser so I can be notified of new messages even when the app isn't open.

```gherkin
Scenario: Granting notification permission
  Given I am logged in and my browser supports the Push API
  When I click "Enable notifications" and grant the permission prompt
  Then my browser creates a push subscription
    And that subscription is sent to the backend and stored against my user id
```

## Story 2 — Receive a push notification while offline

```gherkin
Scenario: Recipient has no open connection to the app
  Given I have an active push subscription
    And I have no browser tab open with a live connection to the backend
  When another participant sends a message in a conversation I'm part of
  Then I receive an OS-level push notification naming the sender
    And the notification does not appear if I never enabled notifications
```

## Story 3 — No push notification while actively connected

This is the one easy to get backwards: notifications are for reaching
someone who ISN'T currently looking at the app, not a duplicate alert for
someone who is.

```gherkin
Scenario: Recipient already has the app open and connected
  Given I have an active, open WebSocket connection to the backend
  When another participant sends a message in a conversation I'm part of
  Then I see the message arrive live in the chat, same as before this feature existed
    And I do NOT also receive a push notification for that same message
```

## Story 4 — A file or image message also triggers a sensible notification

```gherkin
Scenario: Offline recipient is sent an attachment instead of plain text
  Given I am offline (per Story 2)
  When another participant sends an image or file with no caption
  Then I receive a push notification with readable body text (e.g. "Sent an image")
    rather than an empty or blank notification body
```

## Story 5 — One person, multiple devices

```gherkin
Scenario: I have notifications enabled on more than one browser/device
  Given I enabled notifications on both my laptop and my phone
    And neither device currently has an open connection to the backend
  When another participant sends me a message
  Then both devices receive a push notification independently
```

## Story 6 — Clicking a notification opens the right conversation

```gherkin
Scenario: Acting on a received notification
  Given I received a push notification for a new message in conversation X
  When I click that notification
  Then a browser window/tab opens directly to conversation X
    rather than the generic chat list
```

## Story 7 — A revoked or dead subscription stops being used

```gherkin
Scenario: The recipient's subscription is no longer valid
  Given I previously enabled notifications on a device
    And I have since revoked permission, uninstalled, or cleared site data
  When another participant sends me a message while I'm offline
  Then the backend's attempt to push to that subscription fails
    And the backend removes that dead subscription so it is never retried again
    And this failure does not affect delivery to any of my OTHER valid subscriptions
```

## Story 8 — Explicitly turning notifications off

```gherkin
Scenario: I disable notifications myself
  Given I have an active push subscription on this device
  When I turn notifications off in the app
  Then my subscription is deleted from the backend immediately
    And I receive no further push notifications on this device
    And this does not affect my OTHER devices' subscriptions
```

## Story 9 — Group chats only notify participants who are actually offline

```gherkin
Scenario: A group message where some members are online and some aren't
  Given a group conversation with three participants: Alice, Bob, and Carol
    And Bob is connected (chat open), Carol is not
  When Alice sends a message to the group
  Then Bob receives the message live and gets NO push notification
    And Carol receives a push notification, since she is offline
```

---

## Acceptance notes (non-functional, cross-cutting)

- **Authentication**: a push subscription can only ever be created or
  deleted for the currently logged-in user — never on behalf of another
  user id.
- **Privacy**: the notification payload (title/body) is end-to-end
  encrypted between the backend and the recipient's browser using that
  subscription's own keys — not even the push service provider in the
  middle (Google/Mozilla/etc.) can read the message content.
- **Never notify yourself**: the sender's own device never receives a push
  for their own message, regardless of their connection state.
- **Known, accepted limitation**: "offline" here means "no open WebSocket
  connection on ANY conversation," not "not currently viewing THIS
  conversation." A participant actively chatting in conversation A will not
  get a push for a new message in conversation B, even though they aren't
  actually looking at B. Out of scope for this phase — see GUIDE.md Step 14.
