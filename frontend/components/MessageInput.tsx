"use client";

import { useRef, useState, type ChangeEvent, type SubmitEvent } from "react";
import { uploadFile, type UploadedAttachment } from "@/lib/uploads";

interface MessageInputProps {
  conversationId: number;
  onSend: (content: string) => void;
  onSendFile: (attachment: UploadedAttachment) => void;
  onTyping: () => void;
}

export function MessageInput({ conversationId, onSend, onSendFile, onTyping }: MessageInputProps) {
  const [value, setValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so selecting the same file again still fires onChange
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      const attachment = await uploadFile(conversationId, file);
      onSendFile(attachment);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border-t">
      {uploadError && <p className="px-3 pt-2 text-xs text-red-600">{uploadError}</p>}
      <form onSubmit={handleSubmit} className="flex gap-2 p-3">
        <input ref={fileInputRef} type="file" onChange={handleFileChange} disabled={uploading} className="hidden" />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Attach a file"
          className="rounded-full border px-3 py-2 text-sm disabled:opacity-50"
        >
          {uploading ? "…" : "📎"}
        </button>
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
    </div>
  );
}
