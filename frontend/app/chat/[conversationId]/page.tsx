"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiJson } from "@/lib/api";
import { isAuthenticated, getCurrentUserId } from "@/lib/auth";
import { useChatSocket } from "@/lib/websocket";
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

  const participantsById = useMemo(() => {
    const map: Record<number, string> = {};
    conversation?.participants.forEach((p) => {
      map[p.id] = p.display_name;
    });
    return map;
  }, [conversation]);

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
        setMessages([...page.messages].reverse());
        setNextCursor(page.next_cursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load conversation"))
      .finally(() => setLoading(false));
  }, [conversationId, router]);

  const { sendMessage, sendTyping } = useChatSocket(conversationId, {
    onMessage: (message) => setMessages((prev) => [...prev, message]),
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

  // The backend only relays a new message to the OTHER participant (see
  // chat.py) — it never echoes it back to the sender's own socket — so the
  // sender has to add their own outgoing message to local state directly.
  function handleSend(content: string) {
    sendMessage(content);
    setMessages((prev) => [
      ...prev,
      {
        id: -Date.now(),
        conversation_id: conversationId,
        sender_id: currentUserId as number,
        content,
        type: "text",
        created_at: new Date().toISOString(),
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
          typingLabel={buildTypingLabel(typingUserIds, participantsById)}
          onLoadOlder={handleLoadOlder}
          hasMore={nextCursor !== null}
        />
      )}

      <MessageInput onSend={handleSend} onTyping={sendTyping} />
    </div>
  );
}
