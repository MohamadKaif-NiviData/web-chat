"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiJson } from "@/lib/api";
import { isAuthenticated, getCurrentUserId } from "@/lib/auth";
import { useChatSocket } from "@/lib/websocket";
import type { UploadedAttachment } from "@/lib/uploads";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";
import { ForwardPicker } from "@/components/ForwardPicker";
import { GroupInfoPanel } from "@/components/GroupInfoPanel";
import { PinnedMessageBanner } from "@/components/PinnedMessageBanner";
import type { ConversationSummary, Message, MessagePage } from "@/types";

const TYPING_TIMEOUT_MS = 3000;
const HIGHLIGHT_TIMEOUT_MS = 3000;

function buildTypingLabel(typingUserIds: Set<number>, participantsById: Record<number, string>): string | null {
  if (typingUserIds.size === 0) return null;
  const names = Array.from(typingUserIds).map((id) => participantsById[id] ?? "Someone");
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}

export default function ConversationPage() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = Number(params.conversationId);
  const router = useRouter();

  // getCurrentUserId() touches localStorage, which doesn't exist during SSR.
  // useSyncExternalStore forces the server/first-hydration render to use
  // getServerSnapshot (null) and only swaps in the real value after
  // hydration — reading it inline would instead make the server's render
  // (always null) disagree with the client's very first render.
  const currentUserId = useSyncExternalStore(
    () => () => {},
    getCurrentUserId,
    () => null,
  );

  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<number | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [typingUserIds, setTypingUserIds] = useState<Set<number>>(new Set());
  const typingTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // FIFO queue of this tab's own not-yet-confirmed placeholder ids. chat.py
  // now echoes every persisted message back to its own sender (see the "Why"
  // comment there) specifically so the placeholder can be swapped for the
  // real, database-backed message — read receipts need the REAL id to ever
  // match a message you sent yourself. Safe to match strictly in send order:
  // a single WebSocket connection processes/echoes messages in the order
  // they were sent.
  const pendingSentIdsRef = useRef<number[]>([]);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const participantsById = useMemo(() => {
    const map: Record<number, string> = {};
    conversation?.participants.forEach((p) => {
      map[p.id] = p.display_name;
    });
    return map;
  }, [conversation]);

  const otherParticipantIds = useMemo(
    () => conversation?.participants.map((p) => p.id) ?? [],
    [conversation],
  );

  // `conversation.pinned_message` is a snapshot from the last time it was
  // fetched (on mount, or after a pin/unpin event) — it does NOT update
  // when that message is later edited, since editing only patches
  // `messages` state (via onMessageEdited), not `conversation`. Prefer the
  // live copy from `messages` whenever it's loaded (keeping the banner
  // edit-aware, per PIN_MESSAGE_USER_STORIES.md Story 11), and fall back to
  // the fetched snapshot only when the pinned message isn't in the
  // currently loaded window.
  const pinnedMessageForBanner = useMemo(() => {
    if (!conversation?.pinned_message) return null;
    return messages.find((m) => m.id === conversation.pinned_message!.id) ?? conversation.pinned_message;
  }, [conversation, messages]);

  // Fire-and-forget: the UI already knows what it asked to mark, so there's
  // nothing useful to do with the response beyond ignoring failures.
  function markRead(messageIds: number[]) {
    if (messageIds.length === 0) return;
    apiJson(`/conversations/${conversationId}/messages/read`, {
      method: "POST",
      body: JSON.stringify({ message_ids: messageIds }),
    }).catch(() => {});
  }

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    // Read directly from the URL rather than useSearchParams — this is a
    // "use client" page component with no Suspense boundary above it, and
    // useSearchParams requires one in production builds. A plain read here
    // is safe because this effect already only ever runs client-side.
    const aroundParam = new URLSearchParams(window.location.search).get("around");
    const aroundId = aroundParam ? Number(aroundParam) : null;
    const messagesUrl = aroundId
      ? `/conversations/${conversationId}/messages?around=${aroundId}`
      : `/conversations/${conversationId}/messages`;

    Promise.all([
      apiJson<ConversationSummary>(`/conversations/${conversationId}`),
      apiJson<MessagePage>(messagesUrl),
    ])
      .then(([conversationDetail, page]) => {
        setConversation(conversationDetail);
        const loaded = [...page.messages].reverse();
        setMessages(loaded);
        setNextCursor(page.next_cursor);
        // getCurrentUserId() is read directly here (not the `currentUserId`
        // state above) because this effect only runs once on mount and its
        // closure would otherwise capture whatever that value was on the
        // very first render — which can still be null before hydration
        // settles it via useSyncExternalStore.
        const myId = getCurrentUserId();
        markRead(loaded.filter((m) => m.sender_id !== myId).map((m) => m.id));

        if (aroundId !== null) {
          setHighlightMessageId(aroundId);
          highlightTimeoutRef.current = setTimeout(() => setHighlightMessageId(null), HIGHLIGHT_TIMEOUT_MS);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load conversation"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, router]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  const { sendMessage, sendFileMessage, sendTyping } = useChatSocket(conversationId, {
    onMessage: (message) => {
      // ConnectionManager.send_to_user fans out to EVERY socket a user has
      // open, regardless of which conversation each one represents (see
      // MESSAGE_FORWARD_PLAN.md's "real constraint #1") — a message
      // forwarded elsewhere, or sent in some other conversation while this
      // tab also happens to be connected, must never leak into this view.
      if (message.conversation_id !== conversationId) return;

      if (message.sender_id === currentUserId) {
        if (pendingSentIdsRef.current.length > 0) {
          // This is the self-echo of a message we sent through THIS tab —
          // swap the oldest pending placeholder for the confirmed
          // (real-id) message instead of appending a duplicate.
          const placeholderId = pendingSentIdsRef.current.shift();
          setMessages((prev) => prev.map((m) => (m.id === placeholderId ? message : m)));
        } else {
          // A message from ourselves with no placeholder to reconcile — e.g.
          // a message we just forwarded landing directly in a conversation
          // we already have open, rather than something typed into
          // MessageInput here.
          setMessages((prev) => [...prev, message]);
        }
        return;
      }
      setMessages((prev) => [...prev, message]);
      markRead([message.id]);
    },
    onRead: (messageIds, userId) => {
      setMessages((prev) =>
        prev.map((m) =>
          messageIds.includes(m.id) && !m.read_by.includes(userId)
            ? { ...m, read_by: [...m.read_by, userId] }
            : m,
        ),
      );
    },
    onTyping: (userId) => {
      setTypingUserIds((prev) => new Set(prev).add(userId));
      const existingTimeout = typingTimeoutsRef.current.get(userId);
      if (existingTimeout) clearTimeout(existingTimeout);
      typingTimeoutsRef.current.set(
        userId,
        setTimeout(() => {
          setTypingUserIds((prev) => {
            const next = new Set(prev);
            next.delete(userId);
            return next;
          });
          typingTimeoutsRef.current.delete(userId);
        }, TYPING_TIMEOUT_MS),
      );
    },
    onMessageEdited: (messageId, content, editedAt) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, content, edited_at: editedAt } : m)),
      );
    },
    onMessageDeleted: (messageId) => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    },
    onMessageHidden: (messageId) => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    },
    // Unlike leaving (where our own REST call's success is the synchronous
    // signal), being removed is something someone else did to us — there's
    // no response of our own to react to, so this event is the only way our
    // open tab finds out (see GROUP_MEMBERSHIP_PLAN.md's constraint #3).
    onRemovedFromConversation: (removedConversationId) => {
      if (removedConversationId !== conversationId) return;
      router.push("/chat?notice=removed");
    },
    // Deliberately never carries the message content itself — re-fetching
    // is what makes the hidden-for-me exclusion apply correctly to THIS
    // viewer specifically, rather than trusting whatever the broadcast
    // happened to include (see PIN_MESSAGE_PLAN.md's "real constraint #2").
    onMessagePinned: (eventConversationId) => {
      if (eventConversationId !== conversationId) return;
      apiJson<ConversationSummary>(`/conversations/${conversationId}`).then(setConversation).catch(() => {});
    },
    onMessageUnpinned: (eventConversationId) => {
      if (eventConversationId !== conversationId) return;
      apiJson<ConversationSummary>(`/conversations/${conversationId}`).then(setConversation).catch(() => {});
    },
  });

  useEffect(() => {
    const timeouts = typingTimeoutsRef.current;
    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, []);

  // Optimistically show the message immediately under a fake local id (so
  // sending feels instant), then reconcile it against chat.py's self-echo
  // once the real, database-backed message comes back over the socket (see
  // onMessage above and pendingSentIdsRef's comment) — read receipts need
  // that real id to ever be able to match your own sent messages.
  function handleSend(content: string) {
    sendMessage(content);
    const placeholderId = -Date.now();
    pendingSentIdsRef.current.push(placeholderId);
    setMessages((prev) => [
      ...prev,
      {
        id: placeholderId,
        conversation_id: conversationId,
        sender_id: currentUserId as number,
        content,
        type: "text",
        created_at: new Date().toISOString(),
        read_by: [],
      },
    ]);
  }

  // The file's bytes are already sitting in S3 by the time this fires (see
  // MessageInput's onSendFile) — this just mirrors handleSend's optimistic
  // placeholder + pendingSentIdsRef reconciliation so the sender sees
  // something immediately instead of waiting on the self-echo round trip.
  function handleSendFile(attachment: UploadedAttachment) {
    sendFileMessage(attachment, "");
    const placeholderId = -Date.now();
    pendingSentIdsRef.current.push(placeholderId);
    setMessages((prev) => [
      ...prev,
      {
        id: placeholderId,
        conversation_id: conversationId,
        sender_id: currentUserId as number,
        content: attachment.mime_type.startsWith("image/") ? "Uploading image…" : "Uploading file…",
        type: attachment.mime_type.startsWith("image/") ? "image" : "file",
        created_at: new Date().toISOString(),
        read_by: [],
      },
    ]);
  }

  async function handleLoadOlder() {
    if (nextCursor === null) return;
    try {
      const page = await apiJson<MessagePage>(`/conversations/${conversationId}/messages?cursor=${nextCursor}`);
      setMessages((prev) => [...[...page.messages].reverse(), ...prev]);
      setNextCursor(page.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load older messages");
    }
  }

  // Local message state is updated from the WebSocket echo (onMessageEdited
  // above), not directly from this response — keeps exactly one code path
  // responsible for applying the change, same reconciliation-via-echo
  // pattern already used for sending a message.
  async function handleSaveEdit(content: string) {
    if (!editingMessage) return;
    try {
      await apiJson(`/conversations/${conversationId}/messages/${editingMessage.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to edit message");
    } finally {
      setEditingMessage(null);
    }
  }

  async function handleDeleteForEveryone(messageId: number) {
    try {
      await apiJson(`/conversations/${conversationId}/messages/${messageId}`, { method: "DELETE" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete message");
    }
  }

  async function handleDeleteForMe(messageId: number) {
    try {
      await apiJson(`/conversations/${conversationId}/messages/${messageId}/hide`, { method: "POST" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to hide message");
    }
  }

  // The removed participant's row is already gone server-side by the time
  // this fires — just drop them from local state so the panel/header
  // reflect it immediately instead of waiting on a refetch.
  function handleParticipantRemoved(userId: number) {
    setConversation((prev) =>
      prev ? { ...prev, participants: prev.participants.filter((p) => p.id !== userId) } : prev,
    );
  }

  // Reuses the exact same `around` windowed-fetch the backend already
  // built for search result navigation (see MESSAGE_SEARCH_PLAN.md) — the
  // only difference is this is a direct call instead of a fresh page
  // mount, since we're already on this conversation when the pin banner
  // is clicked.
  async function handleJumpToMessage(messageId: number) {
    try {
      const page = await apiJson<MessagePage>(`/conversations/${conversationId}/messages?around=${messageId}`);
      setMessages([...page.messages].reverse());
      setNextCursor(page.next_cursor);
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
      setHighlightMessageId(messageId);
      highlightTimeoutRef.current = setTimeout(() => setHighlightMessageId(null), HIGHLIGHT_TIMEOUT_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to jump to message");
    }
  }

  // Local state is updated only from the WebSocket event (onMessagePinned/
  // onMessageUnpinned above), not directly from this call's response —
  // same "one code path" reconciliation pattern used everywhere else here.
  async function handlePin(messageId: number) {
    try {
      await apiJson(`/conversations/${conversationId}/messages/${messageId}/pin`, { method: "POST" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pin message");
    }
  }

  async function handleUnpin() {
    try {
      await apiJson(`/conversations/${conversationId}/pin`, { method: "DELETE" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unpin message");
    }
  }

  if (currentUserId === null) return null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <button onClick={() => router.push("/chat")} className="text-sm text-zinc-500 underline">
          ← Back
        </button>
        {conversation && (
          <button
            onClick={() => conversation.is_group && setShowGroupInfo(true)}
            className="font-medium"
            disabled={!conversation.is_group}
          >
            {conversation.name}
          </button>
        )}
      </div>

      {showGroupInfo && conversation && (
        <GroupInfoPanel
          conversation={conversation}
          currentUserId={currentUserId}
          onClose={() => setShowGroupInfo(false)}
          onParticipantRemoved={handleParticipantRemoved}
          onLeft={() => router.push("/chat")}
        />
      )}

      {pinnedMessageForBanner && (
        <PinnedMessageBanner
          message={pinnedMessageForBanner}
          onJump={() => handleJumpToMessage(pinnedMessageForBanner.id)}
          onUnpin={handleUnpin}
        />
      )}

      {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="p-4 text-sm text-zinc-500">Loading…</p>
      ) : (
        <MessageList
          messages={messages}
          currentUserId={currentUserId}
          isGroup={conversation?.is_group ?? false}
          participantsById={participantsById}
          otherParticipantIds={otherParticipantIds}
          typingLabel={buildTypingLabel(typingUserIds, participantsById)}
          onLoadOlder={handleLoadOlder}
          hasMore={nextCursor !== null}
          onEdit={setEditingMessage}
          onDeleteForEveryone={handleDeleteForEveryone}
          onDeleteForMe={handleDeleteForMe}
          onForward={setForwardingMessage}
          onPin={(message) => handlePin(message.id)}
          onUnpin={handleUnpin}
          pinnedMessageId={conversation?.pinned_message?.id ?? null}
          highlightMessageId={highlightMessageId}
        />
      )}

      {forwardingMessage && (
        <ForwardPicker
          message={forwardingMessage}
          sourceConversationId={conversationId}
          onClose={() => setForwardingMessage(null)}
        />
      )}

      <MessageInput
        key={editingMessage?.id ?? "compose"}
        conversationId={conversationId}
        onSend={handleSend}
        onSendFile={handleSendFile}
        onTyping={sendTyping}
        editingContent={editingMessage?.content ?? null}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={() => setEditingMessage(null)}
      />
    </div>
  );
}
