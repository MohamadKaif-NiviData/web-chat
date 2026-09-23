"use client";

import { useState, type SubmitEvent } from "react";

interface MessageInputProps {
  onSend: (content: string) => void;
  onTyping: () => void;
}

export function MessageInput({ onSend, onTyping }: MessageInputProps) {
  const [value, setValue] = useState("");

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 border-t p-3">
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onTyping();
        }}
        placeholder="Message"
        className="flex-1 rounded-full border px-4 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="rounded-full bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
      >
        Send
      </button>
    </form>
  );
}
