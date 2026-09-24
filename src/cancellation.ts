import { AppError } from './errors.js';

export type RequestId = string | number;

/** Live request ownership only; no result or user-context retention. */
export class RequestCancellation {
  private readonly controllers = new Map<RequestId, { owner: AbortController; tool: boolean }>();
  private closed = false;
  begin(id: RequestId, tool = true): AbortController {
    if (this.closed || this.controllers.has(id))
      throw new AppError('INVALID_ARGUMENT', 'Duplicate or closed request ID.');
    const owner = new AbortController();
    this.controllers.set(id, { owner, tool });
    return owner;
  }
  current(id: RequestId): AbortController | undefined {
    return this.controllers.get(id)?.owner;
  }
  isTool(id: RequestId): boolean {
    return this.controllers.get(id)?.tool === true;
  }
  cancel(id: RequestId): void {
    this.controllers.get(id)?.owner.abort();
  }
  finish(id: RequestId, owner: AbortController): void {
    if (this.controllers.get(id)?.owner === owner) this.controllers.delete(id);
  }
  close(): void {
    this.closed = true;
    for (const { owner } of this.controllers.values()) owner.abort();
    this.controllers.clear();
  }
}
