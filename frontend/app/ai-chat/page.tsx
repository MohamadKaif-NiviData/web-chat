"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { apiJson } from "@/lib/api";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function AiChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
    }
  }, [router]);

  async function handleSend(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const { reply } = await apiJson<{ reply: string }>("/ai/chat", {
        method: "POST",
        body: JSON.stringify({ messages: nextMessages }),
      });
      setMessages([...nextMessages, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI service is currently unavailable");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <button onClick={() => router.push("/chat")} className="text-sm text-zinc-500 underline">
          ← Back
        </button>
        <h1 className="font-medium">Chat with AI</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && !sending && (
          <p className="p-4 text-center text-sm text-zinc-500">Say hello to get started.</p>
        )}
        <div className="flex flex-col gap-2">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                m.role === "user"
                  ? "self-end bg-foreground text-background"
                  : "self-start bg-zinc-100 dark:bg-zinc-800"
              }`}
            >
              {m.content}
            </div>
          ))}
          {sending && (
            <div className="self-start rounded-2xl bg-zinc-100 px-4 py-2 text-sm text-zinc-500 dark:bg-zinc-800">
              AI is thinking…
            </div>
          )}
        </div>
      </div>

      {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}

      <form onSubmit={handleSend} className="flex gap-2 border-t p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message"
          disabled={sending}
          className="flex-1 rounded-full border px-4 py-2 text-sm disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-full bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
