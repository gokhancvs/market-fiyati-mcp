import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CancelledNotificationSchema,
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse
} from '@modelcontextprotocol/sdk/types.js';
import { RequestCancellation } from './cancellation.js';

/** Reserve request IDs before SDK dispatch; own cancellation only for tools. */
export function withCancellation(inner: Transport, requests: RequestCancellation): Transport {
  const wrapped: Transport = {
    get sessionId() {
      return inner.sessionId!;
    },
    setProtocolVersion(version) {
      inner.setProtocolVersion?.(version);
    },
    async start() {
      inner.onmessage = (message, extra) => {
        if (isJSONRPCRequest(message)) {
          // An unrelated request can share a tool ID. Reject it before the SDK
          // can replace that ID's abort owner or send a colliding response.
          if (requests.current(message.id)) {
            void inner
              .send({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                  code: -32600,
                  message: 'Duplicate active request ID.'
                }
              })
              .catch((error) => wrapped.onerror?.(error));
            return;
          }
          try {
            requests.begin(message.id, message.method === 'tools/call');
          } catch {
            void inner
              .send({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                  code: -32600,
                  message: 'Duplicate active request ID.'
                }
              })
              .catch((error) => wrapped.onerror?.(error));
            return;
          }
        } else {
          const cancellation = CancelledNotificationSchema.safeParse(message);
          if (cancellation.success) {
            const id = cancellation.data.params.requestId;
            if (id !== undefined && requests.current(id)) {
              if (requests.isTool(id)) {
                requests.cancel(id);
                return;
              }
              // SDK suppresses a non-tool response after handling a truthy-ID
              // cancellation. Release after its scheduled handler aborts;
              // falsy IDs remain reserved until their eventual response/close.
              if (id) {
                const owner = requests.current(id)!;
                wrapped.onmessage?.(message, extra);
                queueMicrotask(() => requests.finish(id, owner));
                return;
              }
            }
          }
        }
        wrapped.onmessage?.(message, extra);
      };
      inner.onerror = (error) => wrapped.onerror?.(error);
      inner.onclose = () => {
        requests.close();
        wrapped.onclose?.();
      };
      await inner.start();
    },
    async send(message, options) {
      const response = isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message);
      const id = response ? message.id : undefined;
      const owner = id !== undefined ? requests.current(id) : undefined;
      // A transport may deliver synchronously. Once this final response is
      // visible to the client the ID is reusable, even from its callback.
      if (id !== undefined && owner) requests.finish(id, owner);
      await inner.send(message, options);
    },
    async close() {
      requests.close();
      await inner.close();
    }
  };
  return wrapped;
}
