"use client";

import { useState, type SubmitEvent } from "react";
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
  // Same single admin concept gates remove, rename, and add-member —
  // one check, reused three times, not three that happen to agree (see
  // GROUP_ADMIN_PLAN.md).
  const isCreator = conversation.created_by_user_id === currentUserId;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(conversation.name);
  const [addEmailInput, setAddEmailInput] = useState("");

  // Local state isn't updated directly from these calls' own responses —
  // the page's onConversationRenamed/onParticipantsAdded WebSocket
  // handlers update `conversation` (passed back down as this prop), same
  // "one code path" reconciliation pattern used everywhere else in this
  // app (edit/delete/hide/forward all work this way too).
  async function handleRename(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/conversations/${conversation.conversation_id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmed }),
      });
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename group");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember(e: SubmitEvent) {
    e.preventDefault();
    const email = addEmailInput.trim();
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/conversations/${conversation.conversation_id}/participants`, {
        method: "POST",
        body: JSON.stringify({ member_emails: [email] }),
      });
      setAddEmailInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setBusy(false);
    }
  }

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
        <div className="mb-2 flex items-center justify-between gap-2">
          {renaming ? (
            <form onSubmit={handleRename} className="flex flex-1 gap-1">
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
              />
              <button type="submit" disabled={busy} className="text-xs text-zinc-500 underline disabled:opacity-50">
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setNameInput(conversation.name);
                  setRenaming(false);
                }}
                className="text-xs text-zinc-500 underline"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <p className="truncate text-sm font-medium">{conversation.name}</p>
              {isCreator && (
                <button
                  onClick={() => {
                    setNameInput(conversation.name);
                    setRenaming(true);
                  }}
                  className="shrink-0 text-xs text-zinc-500 underline"
                >
                  Rename
                </button>
              )}
            </div>
          )}
          <button onClick={onClose} aria-label="Close" className="shrink-0 text-sm text-zinc-500">
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

        {isCreator && (
          <form onSubmit={handleAddMember} className="mb-3 flex gap-1">
            <input
              type="email"
              value={addEmailInput}
              onChange={(e) => setAddEmailInput(e.target.value)}
              placeholder="Add member by email"
              className="min-w-0 flex-1 rounded-full border px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 rounded-full border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Add
            </button>
          </form>
        )}

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
