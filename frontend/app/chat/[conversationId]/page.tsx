"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiJson } from "@/lib/api";
import { isAuthenticated, getCurrentUserId } from "@/lib/auth";
import { useChatSocket } from "@/lib/websocket";
import type { UploadedAttachment } from "@/lib/uploads";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";
import type { ConversationSummary, Message, MessagePage } from "@/types";

const TYPING_TIMEOUT_MS = 3000;

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
    Promise.all([
      apiJson<ConversationSummary>(`/conversations/${conversationId}`),
      apiJson<MessagePage>(`/conversations/${conversationId}/messages`),
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
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load conversation"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, router]);

  const { sendMessage, sendFileMessage, sendTyping } = useChatSocket(conversationId, {
    onMessage: (message) => {
      if (message.sender_id === currentUserId) {
        // This is the self-echo of a message we sent — swap the oldest
        // pending placeholder for the confirmed (real-id) message instead
        // of appending a duplicate.
        const placeholderId = pendingSentIdsRef.current.shift();
        setMessages((prev) => prev.map((m) => (m.id === placeholderId ? message : m)));
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

  if (currentUserId === null) return null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <button onClick={() => router.push("/chat")} className="text-sm text-zinc-500 underline">
          ← Back
        </button>
        {conversation && <h1 className="font-medium">{conversation.name}</h1>}
      </div>

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
        />
      )}

      <MessageInput
        conversationId={conversationId}
        onSend={handleSend}
        onSendFile={handleSendFile}
        onTyping={sendTyping}
      />
    </div>
  );
}
