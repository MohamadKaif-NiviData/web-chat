"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import type { ConversationSummary, Message } from "@/types";

interface ForwardPickerProps {
  message: Message;
  sourceConversationId: number;
  onClose: () => void;
}

export function ForwardPicker({ message, sourceConversationId, onClose }: ForwardPickerProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [forwardingTo, setForwardingTo] = useState<number | null>(null);
  const [sentTo, setSentTo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<ConversationSummary[]>("/conversations/")
      .then(setConversations)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load conversations"))
      .finally(() => setLoading(false));
  }, []);

  // The target conversation's own open session (if any) learns about this
  // via the normal WebSocket broadcast, same as any other incoming message
  // — this component doesn't append anything locally, it only reports
  // success/failure of the REST call itself.
  async function handleForward(targetConversationId: number) {
    setForwardingTo(targetConversationId);
    setError(null);
    try {
      await apiJson(`/conversations/${sourceConversationId}/messages/${message.id}/forward`, {
        method: "POST",
        body: JSON.stringify({ target_conversation_id: targetConversationId }),
      });
      setSentTo(targetConversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to forward message");
    } finally {
      setForwardingTo(null);
    }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border bg-background p-4"
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Forward message</p>
          <button onClick={onClose} aria-label="Close" className="text-sm text-zinc-500">
            ×
          </button>
        </div>
        <p className="mb-3 truncate rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {message.content}
        </p>

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        {loading ? (
          <p className="text-sm text-zinc-500">Loading conversations…</p>
        ) : conversations.length === 0 ? (
          <p className="text-sm text-zinc-500">No conversations to forward to.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-800">
            {conversations.map((c) => (
              <li key={c.conversation_id}>
                <button
                  onClick={() => handleForward(c.conversation_id)}
                  disabled={forwardingTo !== null || sentTo === c.conversation_id}
                  className="flex w-full items-center justify-between px-1 py-2 text-left text-sm hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-900"
                >
                  <span className="truncate">{c.name}</span>
                  {sentTo === c.conversation_id && <span className="text-xs text-zinc-500">Forwarded</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
