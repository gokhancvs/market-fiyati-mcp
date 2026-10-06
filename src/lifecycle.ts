import type { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { AppError, publicError, reportInternalError } from './errors.js';

export const SHUTDOWN_TIMEOUT_MS = 5000;
export type ShutdownTimeout = { timeoutMs?: number; onTimeout?: () => void };

export function bindShutdown(
  server: { close(): Promise<void> },
  input: Readable,
  signals: EventEmitter,
  onError: (error: unknown) => void = (error) => {
    reportInternalError(error);
    process.stderr.write(`${JSON.stringify(publicError(error))}\n`);
    process.exitCode = 1;
  },
  { timeoutMs = SHUTDOWN_TIMEOUT_MS, onTimeout = () => process.exit(1) }: ShutdownTimeout = {}
): () => void {
  let closing = false;
  const dispose = () => {
    input.off('end', shutdown);
    input.off('close', shutdown);
    signals.off('SIGINT', shutdown);
    signals.off('SIGTERM', shutdown);
  };
  const shutdown = () => {
    if (closing) return;
    closing = true;
    // A transport that never finishes closing must not keep the process alive.
    const timer = setTimeout(() => {
      try {
        onError(new AppError('SHUTDOWN_TIMEOUT', `Shutdown did not finish within ${timeoutMs} ms.`));
      } catch {
        // A broken reporter must not keep the process alive.
      }
      onTimeout();
    }, timeoutMs);
    timer.unref();
    // Keep signal listeners until close settles; overlapping events are harmless.
    void Promise.resolve()
      .then(() => server.close())
      .catch(onError)
      .finally(() => {
        clearTimeout(timer);
        dispose();
      });
  };
  input.on('end', shutdown);
  input.on('close', shutdown);
  signals.on('SIGINT', shutdown);
  signals.on('SIGTERM', shutdown);
  if (input.readableEnded || input.destroyed) shutdown();
  return dispose;
}
