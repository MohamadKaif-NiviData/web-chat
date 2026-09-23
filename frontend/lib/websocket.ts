"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_BASE_URL } from "./config";
import { getAccessToken } from "./auth";
import type { Message, TypingEvent } from "@/types";

const TYPING_THROTTLE_MS = 2000;

interface ChatSocketHandlers {
  onMessage: (message: Message) => void;
  onTyping: (userId: number) => void;
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
      const data = JSON.parse(event.data) as Message | TypingEvent;
      if (data.type === "typing") {
        handlersRef.current.onTyping((data as TypingEvent).user_id);
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

  // Throttled to at most one "typing" event every TYPING_THROTTLE_MS while
  // the user is actively typing — the receiving end handles its own
  // auto-hide timeout, so no explicit "stopped typing" event is needed.
  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_THROTTLE_MS) return;
    lastTypingSentAt.current = now;
    socketRef.current?.send(JSON.stringify({ type: "typing" }));
  }, []);

  return { connected, sendMessage, sendTyping };
}
