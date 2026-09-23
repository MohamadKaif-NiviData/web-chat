"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated, logout } from "@/lib/auth";
import { apiJson } from "@/lib/api";
import { ConversationList } from "@/components/ConversationList";
import type { ConversationSummary, ConversationCreateResponse, User } from "@/types";

export default function ChatListPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [otherUserEmail, setOtherUserEmail] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    apiJson<ConversationSummary[]>("/conversations/")
      .then(setConversations)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load conversations"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleStartConversation(e: SubmitEvent) {
    e.preventDefault();
    const email = otherUserEmail.trim();
    if (!email) return;
    setStarting(true);
    setError(null);
    try {
      const user = await apiJson<User>(`/users/lookup?email=${encodeURIComponent(email)}`);
      const result = await apiJson<ConversationCreateResponse>(`/conversations/?other_user_id=${user.id}`, {
        method: "POST",
      });
      router.push(`/chat/${result.conversation_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start conversation");
    } finally {
      setStarting(false);
    }
  }

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Chats</h1>
        <button onClick={handleLogout} className="text-sm text-zinc-500 underline">
          Log out
        </button>
      </div>

      {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="p-4 text-sm text-zinc-500">Loading…</p>
      ) : (
        <ConversationList conversations={conversations} />
      )}

      <form onSubmit={handleStartConversation} className="flex gap-2 border-t p-3">
        <input
          type="email"
          value={otherUserEmail}
          onChange={(e) => setOtherUserEmail(e.target.value)}
          placeholder="Other user's email"
          className="flex-1 rounded-full border px-4 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={starting}
          className="rounded-full bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
        >
          Start
        </button>
      </form>
    </div>
  );
}
