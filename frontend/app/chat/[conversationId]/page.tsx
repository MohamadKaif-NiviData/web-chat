"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiJson } from "@/lib/api";
import { isAuthenticated, getCurrentUserId } from "@/lib/auth";
import { useChatSocket } from "@/lib/websocket";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";
import type { Message, MessagePage } from "@/types";

const TYPING_TIMEOUT_MS = 3000;

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

  const [messages, setMessages] = useState<Message[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    apiJson<MessagePage>(`/conversations/${conversationId}/messages`)
      .then((page) => {
        setMessages([...page.messages].reverse());
        setNextCursor(page.next_cursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load messages"))
      .finally(() => setLoading(false));
  }, [conversationId, router]);

  const { sendMessage, sendTyping } = useChatSocket(conversationId, {
    onMessage: (message) => setMessages((prev) => [...prev, message]),
    onTyping: () => {
      setIsOtherTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setIsOtherTyping(false), TYPING_TIMEOUT_MS);
    },
  });

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
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
      </div>

      {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="p-4 text-sm text-zinc-500">Loading…</p>
      ) : (
        <MessageList
          messages={messages}
          currentUserId={currentUserId}
          isOtherTyping={isOtherTyping}
          onLoadOlder={handleLoadOlder}
          hasMore={nextCursor !== null}
        />
      )}

      <MessageInput onSend={handleSend} onTyping={sendTyping} />
    </div>
  );
}
