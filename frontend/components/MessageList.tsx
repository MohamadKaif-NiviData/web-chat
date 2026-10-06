"use client";

import { useEffect, useRef, useState } from "react";
import type { Message } from "@/types";

interface MessageListProps {
  messages: Message[];
  currentUserId: number;
  isGroup: boolean;
  participantsById: Record<number, string>;
  otherParticipantIds: number[];
  typingLabel: string | null;
  onLoadOlder: () => void;
  hasMore: boolean;
}

export function MessageList({
  messages,
  currentUserId,
  isGroup,
  participantsById,
  otherParticipantIds,
  typingLabel,
  onLoadOlder,
  hasMore,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expandedImage, setExpandedImage] = useState<{ url: string; alt: string } | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Escape closes the lightbox the same way clicking the backdrop does.
  useEffect(() => {
    if (!expandedImage) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExpandedImage(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expandedImage]);

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
          // "Seen" only ever applies to your own messages, and only once
          // EVERY other participant has read it — otherParticipantIds is
          // empty for a degenerate conversation with nobody else in it, and
          // `.every()` on an empty array is vacuously true, so that case is
          // guarded explicitly rather than showing "Seen" on everything.
          const seenByEveryone =
            isMine &&
            otherParticipantIds.length > 0 &&
            otherParticipantIds.every((id) => message.read_by.includes(id));
          const attachment = message.attachment;
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
                {attachment &&
                  (attachment.mime_type.startsWith("image/") ? (
                    <img
                      src={attachment.download_url}
                      alt={attachment.original_filename}
                      onClick={() => setExpandedImage({ url: attachment.download_url, alt: attachment.original_filename })}
                      className="max-h-60 max-w-full cursor-zoom-in rounded-lg object-cover"
                    />
                  ) : (
                    <a
                      href={attachment.download_url}
                      download={attachment.original_filename}
                      className="flex items-center gap-2 underline"
                    >
                      📄 {attachment.original_filename}
                    </a>
                  ))}
                {message.content && <p className={attachment ? "mt-1" : ""}>{message.content}</p>}
              </div>
              {seenByEveryone && <span className="mt-0.5 px-1 text-xs italic text-zinc-500">Seen</span>}
            </div>
          );
        })}
      </div>
      {typingLabel && <p className="mt-2 text-xs italic text-zinc-500">{typingLabel}</p>}
      <div ref={bottomRef} />
      {expandedImage && (
        <div
          onClick={() => setExpandedImage(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-4"
        >
          <img
            src={expandedImage.url}
            alt={expandedImage.alt}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}
