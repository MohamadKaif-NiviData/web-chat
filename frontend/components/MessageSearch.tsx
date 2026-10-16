"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiJson } from "@/lib/api";
import type { MessageSearchPage, MessageSearchResult } from "@/types";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

export function MessageSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced the same way typing events are throttled in lib/websocket.ts —
  // a plain setTimeout, no new pattern. Search is a point-in-time REST query
  // (see MESSAGE_SEARCH_PLAN.md), not a live subscription, so there's no
  // WebSocket involvement here at all.
  useEffect(() => {
    const term = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (term.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setNextCursor(null);
      setError(null);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);
      apiJson<MessageSearchPage>(`/conversations/search?q=${encodeURIComponent(term)}`)
        .then((page) => {
          setResults(page.results);
          setNextCursor(page.next_cursor);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Search failed"))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function handleLoadMore() {
    const term = query.trim();
    if (term.length < MIN_QUERY_LENGTH || nextCursor === null) return;
    try {
      const page = await apiJson<MessageSearchPage>(
        `/conversations/search?q=${encodeURIComponent(term)}&cursor=${nextCursor}`,
      );
      setResults((prev) => [...prev, ...page.results]);
      setNextCursor(page.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    }
  }

  const showResults = query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="border-b p-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search messages…"
        className="w-full rounded-full border px-4 py-2 text-sm"
      />

      {showResults && (
        <div className="mt-2">
          {loading && <p className="px-1 text-sm text-zinc-500">Searching…</p>}
          {error && <p className="px-1 text-sm text-red-600">{error}</p>}
          {!loading && !error && results.length === 0 && (
            <p className="px-1 text-sm text-zinc-500">No messages found.</p>
          )}
          {results.length > 0 && (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {results.map((result) => (
                <li key={result.message_id}>
                  <Link
                    href={`/chat/${result.conversation_id}?around=${result.message_id}`}
                    className="flex flex-col gap-0.5 px-1 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <span className="text-xs text-zinc-500">
                      {result.conversation_name}
                      {result.is_group && ` — ${result.sender_display_name}`}
                    </span>
                    <span className="truncate text-sm">{result.content}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {nextCursor !== null && (
            <button
              onClick={handleLoadMore}
              className="mx-auto mt-2 block rounded-full border px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              Load more results
            </button>
          )}
        </div>
      )}
    </div>
  );
}
