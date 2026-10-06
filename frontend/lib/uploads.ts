import { apiJson } from "./api";

export interface UploadedAttachment {
  object_key: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
}

interface PresignResponse {
  upload_url: string;
  object_key: string;
}

// Two-step upload: ask the backend for a short-lived presigned S3 URL
// (backend checks you're a participant + validates type/size), then PUT the
// file bytes straight to S3 — the backend never touches file content
// (see GUIDE.md Step 12).
export async function uploadFile(conversationId: number, file: File): Promise<UploadedAttachment> {
  const { upload_url, object_key } = await apiJson<PresignResponse>(`/uploads/${conversationId}/presign`, {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
    }),
  });

  // Deliberately a raw fetch, not apiJson/apiFetch: this request goes to S3,
  // not our backend, and must NOT carry our app's Authorization bearer token
  // — the presigned URL itself is the auth, and an unexpected extra header
  // could even invalidate S3's signature check.
  const uploadResponse = await fetch(upload_url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });

  if (!uploadResponse.ok) {
    throw new Error("Upload to storage failed");
  }

  return {
    object_key,
    original_filename: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  };
}
