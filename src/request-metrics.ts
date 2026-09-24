/** Invocation-owned counters; no user session or process-wide usage state. */
export type HttpAttemptCounts = { httpAttempts: number; retries: number };
export type RequestMetrics = HttpAttemptCounts & { durationMs: number };
