"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/types";

interface MessageListProps {
  messages: Message[];
  currentUserId: number;
  isGroup: boolean;
  participantsById: Record<number, string>;
  typingLabel: string | null;
  onLoadOlder: () => void;
  hasMore: boolean;
}

export function MessageList({
  messages,
  currentUserId,
  isGroup,
  participantsById,
  typingLabel,
  onLoadOlder,
  hasMore,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 py-3">
      {hasMore && (
        <button
          onClick={onLoadOlder}
          className="mx-auto mb-4 rounded-full border px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          Load older messages
        </button>
      )}
      <div className="flex flex-col gap-2">
        {messages.map((message) => {
          const isMine = message.sender_id === currentUserId;
          return (
            <div key={message.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
              {isGroup && !isMine && (
                <span className="mb-0.5 px-1 text-xs text-zinc-500">
                  {participantsById[message.sender_id] ?? "Unknown"}
                </span>
              )}
              <div
                className={`max-w-xs rounded-2xl px-4 py-2 text-sm ${
                  isMine ? "bg-foreground text-background" : "bg-zinc-100 dark:bg-zinc-800"
                }`}
              >
                {message.content}
              </div>
            </div>
          );
        })}
      </div>
      {typingLabel && <p className="mt-2 text-xs italic text-zinc-500">{typingLabel}</p>}
      <div ref={bottomRef} />
    </div>
  );
}
