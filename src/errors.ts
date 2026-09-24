import type { RequestMetrics } from './request-metrics.js';

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
    message: 'Unexpected internal error. See local diagnostics.'
  };
}
