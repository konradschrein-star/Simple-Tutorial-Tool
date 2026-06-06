"use client";
// Realtime job events are not wired in the standalone tool; the UI polls
// instead. This no-op keeps components that referenced SSE compiling.
export function useSSE(..._args: unknown[]): {
  isConnected: boolean;
  connected: boolean;
  lastEvent: unknown | null;
  events: unknown[];
} {
  return { isConnected: false, connected: false, lastEvent: null, events: [] };
}
export default useSSE;
