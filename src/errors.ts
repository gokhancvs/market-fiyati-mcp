/** Invocation-owned counters; no user session or process-wide usage state. */
export type HttpAttemptCounts = { httpAttempts: number; retries: number };
export type RequestMetrics = HttpAttemptCounts & { durationMs: number };

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly requestMetrics?: RequestMetrics
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function publicError(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) return { code: error.code, message: error.message, ...error.details };
  // Never echo upstream HTML, headers, filesystem paths or arbitrary thrown messages.
  return {
    code: 'INTERNAL_ERROR',
    message: 'Unexpected internal error.'
  };
}

export const MAX_DIAGNOSTIC_CHARS = 4000;
// Operator diagnostics go to stderr only; tool results keep the generic INTERNAL_ERROR.
export function reportInternalError(
  error: unknown,
  write: (line: string) => void = (line) => process.stderr.write(line)
): void {
  if (error instanceof AppError) return;
  let detail: string;
  try {
    detail = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
  } catch {
    detail = 'Unprintable thrown value.';
  }
  try {
    write(`${JSON.stringify({ code: 'INTERNAL_ERROR', detail: detail.slice(0, MAX_DIAGNOSTIC_CHARS) })}\n`);
  } catch {
    // A broken stderr must not replace the original failure.
  }
}
