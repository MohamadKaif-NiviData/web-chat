"use client";

import { API_BASE_URL } from "./config";
import { getAccessToken, refreshAccessToken, clearTokens } from "./auth";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.detail ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

// Attaches the access token, and on a 401 tries exactly one silent refresh +
// retry before giving up — `retry` guards against looping if the refresh
// itself is what's failing.
export async function apiFetch(path: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const accessToken = getAccessToken();
  const headers = new Headers(options.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401 && retry) {
    try {
      await refreshAccessToken();
    } catch {
      clearTokens();
      throw new ApiError(401, "Session expired");
    }
    return apiFetch(path, options, false);
  }

  return response;
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    throw new ApiError(response.status, await extractErrorMessage(response));
  }
  return response.json();
}
