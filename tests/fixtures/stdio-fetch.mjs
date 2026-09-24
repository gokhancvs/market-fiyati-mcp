// Runs AFTER no-network.mjs in a child process. This fake never opens a socket.
// Keeping IPC unref'd lets the real entrypoint exit naturally after shutdown.
process.channel?.unref();
globalThis.fetch = async () =>
  new Response(
    new ReadableStream({
      start() {
        process.send?.({ type: 'fetch-started' });
      },
      cancel() {
        process.send?.({ type: 'body-cancelled' });
      }
    }),
    { headers: { 'content-type': 'application/json' } }
  );
