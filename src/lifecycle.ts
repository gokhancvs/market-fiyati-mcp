import type { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { publicError } from './errors.js';

export function bindShutdown(
  server: { close(): Promise<void> },
  input: Readable,
  signals: EventEmitter,
  onError: (error: unknown) => void = (error) => {
    process.stderr.write(`${JSON.stringify(publicError(error))}\n`);
    process.exitCode = 1;
  }
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
    // Keep signal listeners until close settles; overlapping events are harmless.
    void Promise.resolve()
      .then(() => server.close())
      .catch(onError)
      .finally(dispose);
  };
  input.on('end', shutdown);
  input.on('close', shutdown);
  signals.on('SIGINT', shutdown);
  signals.on('SIGTERM', shutdown);
  if (input.readableEnded || input.destroyed) shutdown();
  return dispose;
}
