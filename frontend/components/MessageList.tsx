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
  onEdit: (message: Message) => void;
  onDeleteForEveryone: (messageId: number) => void;
  onDeleteForMe: (messageId: number) => void;
  onForward: (message: Message) => void;
  onPin: (message: Message) => void;
  onUnpin: () => void;
  pinnedMessageId?: number | null;
  highlightMessageId?: number | null;
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
  onEdit,
  onDeleteForEveryone,
  onDeleteForMe,
  onForward,
  onPin,
  onUnpin,
  pinnedMessageId,
  highlightMessageId,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [expandedImage, setExpandedImage] = useState<{ url: string; alt: string } | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // A separate effect, keyed only on highlightMessageId (not messages.length)
  // — jumping into history from a search result needs to override the
  // default scroll-to-bottom above exactly once. It must NOT re-fire and
  // re-scroll when the highlight later clears back to null (page.tsx fades
  // it out after a few seconds), so a cleared highlight is a deliberate
  // no-op here, not "scroll to nothing."
  useEffect(() => {
    if (highlightMessageId == null) return;
    messageRefs.current.get(highlightMessageId)?.scrollIntoView({ block: "center" });
  }, [highlightMessageId]);

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
          // System notices ("Bob left the group") aren't sent by/to anyone
          // in the normal sense — render them as a centered, bubble-less
          // line instead of forcing them through the mine-vs-theirs layout,
          // and skip every per-message action (edit/delete/forward/seen)
          // that assumes a real sender.
          if (message.type === "system") {
            return (
              <p key={message.id} className="my-1 text-center text-xs italic text-zinc-500">
                {message.content}
              </p>
            );
          }

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
            <div
              key={message.id}
              ref={(el) => {
                if (el) messageRefs.current.set(message.id, el);
                else messageRefs.current.delete(message.id);
              }}
              className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}
            >
              {isGroup && !isMine && (
                <span className="mb-0.5 px-1 text-xs text-zinc-500">
                  {participantsById[message.sender_id] ?? "Unknown"}
                </span>
              )}
              {message.forwarded_from_display_name && (
                <span className="mb-0.5 px-1 text-xs italic text-zinc-500">
                  Forwarded from {message.forwarded_from_display_name}
                </span>
              )}
              <div
                className={`max-w-xs rounded-2xl px-4 py-2 text-sm ${
                  isMine ? "bg-foreground text-background" : "bg-zinc-100 dark:bg-zinc-800"
                } ${message.id === highlightMessageId ? "ring-2 ring-amber-400" : ""}`}
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
              <div className="mt-0.5 flex items-center gap-2 px-1 text-xs text-zinc-500">
                {message.edited_at && <span className="italic">(edited)</span>}
                {seenByEveryone && <span className="italic">Seen</span>}
                {isMine && (
                  <>
                    <button onClick={() => onEdit(message)} className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
                      Edit
                    </button>
                    <button
                      onClick={() => onDeleteForEveryone(message.id)}
                      className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      Delete for everyone
                    </button>
                  </>
                )}
                {/* Text-only in this version — an attachment message never
                    offers Forward, a stated limitation rather than a silent
                    empty-content forward (see MESSAGE_FORWARD_PLAN.md). */}
                {!attachment && (
                  <button onClick={() => onForward(message)} className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
                    Forward
                  </button>
                )}
                {/* Any participant can pin/unpin, in both 1-to-1s and groups
                    — no ownership check, unlike Edit/Delete for everyone
                    (see PIN_MESSAGE_PLAN.md). */}
                {message.id === pinnedMessageId ? (
                  <button onClick={onUnpin} className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
                    Unpin
                  </button>
                ) : (
                  <button onClick={() => onPin(message)} className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
                    Pin
                  </button>
                )}
                <button onClick={() => onDeleteForMe(message.id)} className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
                  Delete for me
                </button>
              </div>
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
