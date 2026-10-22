"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_BASE_URL } from "./config";
import { getAccessToken } from "./auth";
import type { UploadedAttachment } from "./uploads";
import type {
  Message,
  ReadEvent,
  TypingEvent,
  MessageEditedEvent,
  MessageDeletedEvent,
  MessageHiddenEvent,
  RemovedFromConversationEvent,
} from "@/types";

const TYPING_THROTTLE_MS = 2000;

interface ChatSocketHandlers {
  onMessage: (message: Message) => void;
  onTyping: (userId: number) => void;
  onRead: (messageIds: number[], userId: number) => void;
  onMessageEdited?: (messageId: number, content: string, editedAt: string) => void;
  onMessageDeleted?: (messageId: number) => void;
  onMessageHidden?: (messageId: number) => void;
  onRemovedFromConversation?: (conversationId: number) => void;
}

export function useChatSocket(conversationId: number | null, handlers: ChatSocketHandlers) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  const lastTypingSentAt = useRef(0);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (conversationId === null) return;
    const token = getAccessToken();
    if (!token) return;

    const socket = new WebSocket(`${WS_BASE_URL}/ws/chat/${conversationId}?token=${token}`);
    socketRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data) as
        | Message
        | TypingEvent
        | ReadEvent
        | MessageEditedEvent
        | MessageDeletedEvent
        | MessageHiddenEvent
        | RemovedFromConversationEvent;
      if (data.type === "typing") {
        handlersRef.current.onTyping((data as TypingEvent).user_id);
      } else if (data.type === "read") {
        const readEvent = data as ReadEvent;
        handlersRef.current.onRead(readEvent.message_ids, readEvent.user_id);
      } else if (data.type === "message_edited") {
        const editedEvent = data as MessageEditedEvent;
        handlersRef.current.onMessageEdited?.(editedEvent.message_id, editedEvent.content, editedEvent.edited_at);
      } else if (data.type === "message_deleted") {
        handlersRef.current.onMessageDeleted?.((data as MessageDeletedEvent).message_id);
      } else if (data.type === "message_hidden") {
        handlersRef.current.onMessageHidden?.((data as MessageHiddenEvent).message_id);
      } else if (data.type === "removed_from_conversation") {
        handlersRef.current.onRemovedFromConversation?.(
          (data as RemovedFromConversationEvent).conversation_id,
        );
      } else {
        handlersRef.current.onMessage(data as Message);
      }
    };

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [conversationId]);

  const sendMessage = useCallback((content: string) => {
    socketRef.current?.send(JSON.stringify({ content }));
  }, []);

  // A file message reuses the same create-relay-echo flow as a text message
  // (chat.py), just with the attachment metadata riding along — the caption
  // is optional and maps onto the same `content` field a text message uses.
  const sendFileMessage = useCallback((attachment: UploadedAttachment, caption: string) => {
    socketRef.current?.send(
      JSON.stringify({
        content: caption,
        type: attachment.mime_type.startsWith("image/") ? "image" : "file",
        object_key: attachment.object_key,
        original_filename: attachment.original_filename,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
      }),
    );
  }, []);

  // Throttled to at most one "typing" event every TYPING_THROTTLE_MS while
  // the user is actively typing — the receiving end handles its own
  // auto-hide timeout, so no explicit "stopped typing" event is needed.
  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_THROTTLE_MS) return;
    lastTypingSentAt.current = now;
    socketRef.current?.send(JSON.stringify({ type: "typing" }));
  }, []);

  return { connected, sendMessage, sendFileMessage, sendTyping };
}
