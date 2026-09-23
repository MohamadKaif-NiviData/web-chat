"use client";

import Link from "next/link";
import type { ConversationSummary } from "@/types";

export function ConversationList({ conversations }: { conversations: ConversationSummary[] }) {
  if (conversations.length === 0) {
    return <p className="p-4 text-sm text-zinc-500">No conversations yet — start one below.</p>;
  }

  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {conversations.map((conversation) => (
        <li key={conversation.conversation_id}>
          <Link
            href={`/chat/${conversation.conversation_id}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                conversation.other_user.is_online ? "bg-green-500" : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{conversation.other_user.display_name}</p>
              {conversation.last_message && (
                <p className="truncate text-sm text-zinc-500">{conversation.last_message.content}</p>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
