"use client";

import { useState } from "react";
import { apiJson } from "@/lib/api";
import type { ConversationSummary } from "@/types";

interface GroupInfoPanelProps {
  conversation: ConversationSummary;
  currentUserId: number;
  onClose: () => void;
  onLeft: () => void;
  onParticipantRemoved: (userId: number) => void;
}

export function GroupInfoPanel({
  conversation,
  currentUserId,
  onClose,
  onLeft,
  onParticipantRemoved,
}: GroupInfoPanelProps) {
  const isCreator = conversation.created_by_user_id === currentUserId;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the creator can remove members — enforced server-side regardless
  // of whether this button is shown (see GROUP_MEMBERSHIP_PLAN.md).
  async function handleRemove(userId: number) {
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/conversations/${conversation.conversation_id}/participants/${userId}`, {
        method: "DELETE",
      });
      onParticipantRemoved(userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove participant");
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/conversations/${conversation.conversation_id}/leave`, { method: "POST" });
      onLeft();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to leave group");
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border bg-background p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">{conversation.name}</p>
          <button onClick={onClose} aria-label="Close" className="text-sm text-zinc-500">
            ×
          </button>
        </div>

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        <p className="mb-1 px-1 text-xs text-zinc-500">Members</p>
        <ul className="mb-3 max-h-64 divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-800">
          {conversation.participants.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-1 py-2 text-sm">
              <span>{p.display_name}</span>
              {isCreator && (
                <button
                  onClick={() => handleRemove(p.id)}
                  disabled={busy}
                  className="text-xs text-red-600 underline disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>

        <button
          onClick={handleLeave}
          disabled={busy}
          className="w-full rounded-full border px-4 py-2 text-sm text-red-600 disabled:opacity-50"
        >
          Leave group
        </button>
      </div>
    </div>
  );
}
