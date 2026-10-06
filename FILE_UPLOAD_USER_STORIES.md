# File & Image Upload — User Stories

Scope: Phase 2 "file/image uploads" feature (GUIDE.md Steps 12–13). This
captures the *requirements* in Given/When/Then form — for the technical
plain-English build plan (which file does what, in what order), see
`GUIDE.md`. For the original architecture rationale (pre-signed URLs, AWS
S3 vs MinIO, boto3), see `PLAN.md` and the "Design decisions locked in"
callout at the top of `GUIDE.md`'s Step 12.

**Actors**:
- **Sender** — the participant uploading and sending a file/image.
- **Recipient(s)** — every other participant in that conversation (one
  other person in a 1-to-1, several in a group).
- **System** — the backend (FastAPI), the WebSocket connection, and S3.

---

## Story 1 — Upload and send an image

As a chat participant, I want to upload an image so I can share it in a
conversation, the same way I'd send a text message.

```gherkin
Scenario: Successfully upload and send an image
  Given I am an authenticated participant of a conversation
    And I have selected a valid image file under the configured size limit
  When I send the file
  Then the frontend requests a pre-signed upload URL from the backend
    And my browser uploads the file bytes directly to S3 (not through the backend)
    And a new message is created in the conversation with type "image"
    And an attachment record is linked to that message with the file's metadata
```

## Story 2 — Recipients see the shared file live

```gherkin
Scenario: Another participant has the chat open when a file is sent
  Given another participant's WebSocket connection to this conversation is open
  When I send an image or file message
  Then they see it rendered inline in their chat in real time
    And they do not need to refresh or re-open the conversation to see it
```

## Story 3 — Sender sees their own upload, without duplication

```gherkin
Scenario: The sender's own message reconciles correctly
  Given I have just sent a file message
    And my client is showing an optimistic placeholder for it
  When the backend echoes the persisted message back to my own socket
  Then my placeholder is replaced by the confirmed message
    And that confirmed message has a real database id and a working download URL
    And the message does not appear twice in my chat view
```

## Story 4 — Oversized uploads are rejected before anything is sent to S3

```gherkin
Scenario: File exceeds the size limit
  Given I attempt to upload a file larger than the configured size cap (e.g. 10 MB)
  When I request a pre-signed upload URL
  Then the backend rejects the request with a 400 error
    And no upload to S3 occurs
    And I see a clear, specific error message in the UI
```

## Story 5 — Unsupported file types are rejected

```gherkin
Scenario: File type is not allowed
  Given I attempt to upload a file whose content type is not on the allow-list
  When I request a pre-signed upload URL
  Then the backend rejects the request with a 400 error
    And no upload to S3 occurs
```

## Story 6 — Non-image files render as a download link, not a broken image

```gherkin
Scenario: Sending a non-image file (e.g. a PDF)
  Given I send a file whose mime type is not image/*
  When the message renders in the chat
  Then it appears as a file icon plus the original filename
    And it is a clickable link that downloads the file
    And it is not rendered as an inline <img>
```

## Story 7 — Attachments stay viewable after a page reload

```gherkin
Scenario: Revisiting a conversation with past attachments
  Given a message with an attachment already exists in a conversation's history
  When I reload the conversation page
  Then the message history endpoint returns a freshly-generated pre-signed download URL
    And the image/file still renders correctly
    And this is true even if the ORIGINAL upload/download URL has since expired
```

## Story 8 — Only participants of a conversation can upload into it

```gherkin
Scenario: A non-participant tries to upload into a conversation
  Given I am NOT a participant of a given conversation
  When I request a pre-signed upload URL for that conversation's id
  Then the backend rejects the request with a 403 Forbidden error
    And no upload URL is issued
```

## Story 9 — A failed upload never leaves a broken message behind

```gherkin
Scenario: The direct-to-S3 upload fails partway through
  Given my browser's PUT request to the pre-signed URL fails (e.g. network drop)
  When the upload does not complete successfully
  Then no message is created in the conversation
    And no attachment record is created
    And no participant — including me — ever sees a broken or placeholder file message
```

## Story 10 — A file can carry an optional caption

```gherkin
Scenario: Sending an image with a caption
  Given I attach a short text caption while sending an image
  When the message renders
  Then both the image and the caption text appear together in the same message bubble
```

---

## Acceptance notes (non-functional, cross-cutting)

- **Security**: the backend never stores or trusts a raw file URL long-term
  — every download URL is a short-lived, freshly-generated pre-signed URL,
  generated at read time (history fetch, live relay, or self-echo), never
  persisted. The S3 bucket itself blocks all public access.
- **Least privilege**: the backend's AWS credentials belong to an IAM user
  scoped to only the one upload bucket (`s3:PutObject`, `s3:GetObject`,
  `s3:HeadBucket`) — never root/admin AWS credentials.
- **Known, accepted limitation**: the backend validates the *claimed*
  content-type/size before issuing an upload URL, but cannot verify the
  actual uploaded bytes afterward, since the upload bypasses the backend by
  design. Out of scope for this practice project (see GUIDE.md Step 12).
