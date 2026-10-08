"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated, logout } from "@/lib/auth";
import { apiJson } from "@/lib/api";
import { ConversationList } from "@/components/ConversationList";
import { NotificationToggle } from "@/components/NotificationToggle";
import type { ConversationSummary, ConversationCreateResponse, User } from "@/types";

export default function ChatListPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [otherUserEmail, setOtherUserEmail] = useState("");
  const [starting, setStarting] = useState(false);
  const [showStartForm, setShowStartForm] = useState(false);

  const [groupName, setGroupName] = useState("");
  const [memberEmailInput, setMemberEmailInput] = useState("");
  const [pendingMembers, setPendingMembers] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);

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

  function openStartForm() {
    setShowGroupForm(false);
    setShowStartForm(true);
  }

  function closeStartForm() {
    setShowStartForm(false);
    setOtherUserEmail("");
  }

  function openGroupForm() {
    setShowStartForm(false);
    setShowGroupForm(true);
  }

  function closeGroupForm() {
    setShowGroupForm(false);
    setGroupName("");
    setMemberEmailInput("");
    setPendingMembers([]);
  }

  function handleAddMember(e: SubmitEvent) {
    e.preventDefault();
    const email = memberEmailInput.trim();
    if (!email || pendingMembers.includes(email)) return;
    setPendingMembers((prev) => [...prev, email]);
    setMemberEmailInput("");
  }

  function handleRemoveMember(email: string) {
    setPendingMembers((prev) => prev.filter((m) => m !== email));
  }

  async function handleCreateGroup(e: SubmitEvent) {
    e.preventDefault();
    const name = groupName.trim();
    if (!name || pendingMembers.length === 0) return;
    setCreatingGroup(true);
    setError(null);
    try {
      const result = await apiJson<ConversationCreateResponse>("/conversations/group", {
        method: "POST",
        body: JSON.stringify({ name, member_emails: pendingMembers }),
      });
      router.push(`/chat/${result.conversation_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setCreatingGroup(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Chats</h1>
        <div className="flex items-center gap-3">
          <NotificationToggle />
          <button onClick={handleLogout} className="text-sm text-zinc-500 underline">
            Log out
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-b  p-3">
        {!showStartForm && !showGroupForm && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={openStartForm}
              className="flex-1 rounded-full border px-4 py-2 text-sm"
            >
              + New chat
            </button>
            <button
              type="button"
              onClick={openGroupForm}
              className="flex-1 rounded-full border px-4 py-2 text-sm"
            >
              + New group
            </button>
          </div>
        )}

        {showStartForm && (
          <form onSubmit={handleStartConversation} className="flex gap-2">
            <input
              autoFocus
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
            <button
              type="button"
              onClick={closeStartForm}
              aria-label="Cancel"
              className="rounded-full border px-3 py-2 text-sm text-zinc-500"
            >
              ×
            </button>
          </form>
        )}

        {showGroupForm && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">New group</p>
              <button
                type="button"
                onClick={closeGroupForm}
                aria-label="Cancel"
                className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                ×
              </button>
            </div>
            <input
              autoFocus
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              className="rounded-full border px-4 py-2 text-sm"
            />
            <form onSubmit={handleAddMember} className="flex gap-2">
              <input
                type="email"
                value={memberEmailInput}
                onChange={(e) => setMemberEmailInput(e.target.value)}
                placeholder="Member's email"
                className="flex-1 rounded-full border px-4 py-2 text-sm"
              />
              <button type="submit" className="rounded-full border px-4 py-2 text-sm">
                Add
              </button>
            </form>
            {pendingMembers.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {pendingMembers.map((email) => (
                  <li
                    key={email}
                    className="flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-xs dark:bg-zinc-800"
                  >
                    {email}
                    <button
                      onClick={() => handleRemoveMember(email)}
                      className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                      aria-label={`Remove ${email}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={handleCreateGroup}>
              <button
                type="submit"
                disabled={creatingGroup || !groupName.trim() || pendingMembers.length === 0}
                className="w-full rounded-full bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
              >
                Create group
              </button>
            </form>
          </div>
        )}
      </div>

      {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="p-4 text-sm text-zinc-500">Loading…</p>
      ) : (
        <ConversationList conversations={conversations} />
      )}


    </div>
  );
}
