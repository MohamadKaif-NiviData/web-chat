"use client";

import type { Message } from "@/types";

interface PinnedMessageBannerProps {
  message: Message;
  onJump: () => void;
  onUnpin: () => void;
}

export function PinnedMessageBanner({ message, onJump, onUnpin }: PinnedMessageBannerProps) {
  return (
    <div className="flex items-center gap-2 border-b bg-zinc-50 px-4 py-2 text-sm dark:bg-zinc-900">
      <button onClick={onJump} className="min-w-0 flex-1 truncate text-left">
        📌 {message.content || "Attachment"}
      </button>
      <button onClick={onUnpin} className="shrink-0 text-xs text-zinc-500 underline">
        Unpin
      </button>
    </div>
  );
}
