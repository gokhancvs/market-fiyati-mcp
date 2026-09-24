import '../no-network.mjs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfig } from '../../dist/src/config.js';
import { LiveTransport } from '../../dist/src/transport.js';
import { MarketService } from '../../dist/src/service.js';
import { createServer } from '../../dist/src/server.js';
import { bindShutdown } from '../../dist/src/lifecycle.js';
import { AppError, publicError } from '../../dist/src/errors.js';
import { acceptanceFetch } from '../../dist/tests/fixtures/acceptance.js';

const notice = 'Synthetic acceptance data only; no live API request or live validation.';
async function main() {
  if (process.env.MARKET_FIYATI_MODE !== 'offline')
    throw new AppError('CONFIG_ERROR', 'Synthetic acceptance requires MARKET_FIYATI_MODE=offline.');
  const scenario = process.argv[2] ?? 'shopping';
  if (!['shopping', 'slow', 'timeout', 'error'].includes(scenario))
    throw new AppError('CONFIG_ERROR', 'Unknown synthetic acceptance scenario.');
  const config = readConfig({
    ...process.env,
    MARKET_FIYATI_MODE: 'offline',
    MARKET_FIYATI_RETRIES: '0',
    MARKET_FIYATI_MIN_INTERVAL_MS: '0'
  });
  const adapter = new LiveTransport(
    {
      ...config,
      mode: 'live',
      timeoutMs: scenario === 'timeout' ? 50 : 15_000
    },
    acceptanceFetch(scenario, (event) => {
      process.stderr.write(`synthetic-acceptance:${scenario}:${event}\n`);
    })
  );
  const transport = {
    mode: 'offline',
    request: (...args) => adapter.request(...args)
  };
  class AcceptanceService extends MarketService {
    status() {
      return { ...super.status(), syntheticAcceptance: true, notice };
    }
    async execute(operation, args, signal) {
      try {
        const result = await super.execute(operation, args, signal);
        return {
          ...result,
          meta: { ...result.meta, syntheticAcceptance: true, notice }
        };
      } catch (error) {
        if (error instanceof AppError)
          throw new AppError(
            error.code,
            error.message,
            { ...error.details, syntheticAcceptance: true, notice },
            error.requestMetrics
          );
        throw error;
      }
    }
  }
  const server = createServer(new AcceptanceService(transport, config));
  const cleanup = bindShutdown(server, process.stdin, process);
  server.server.onclose = cleanup;
  const stdio = new StdioServerTransport();
  const send = stdio.send.bind(stdio);
  // SDK validation and early cancellation can bypass AcceptanceService.execute.
  stdio.send = (message) => {
    const result = message.result;
    if (result?.isError && Array.isArray(result.content))
      return send({
        ...message,
        result: {
          ...result,
          content: [...result.content, { type: 'text', text: notice }],
          _meta: { ...result._meta, syntheticAcceptance: true }
        }
      });
    return send(message);
  };
  await server.connect(stdio);
}
main().catch((error) => {
  process.stderr.write(`${JSON.stringify(publicError(error))}\n`);
  process.exitCode = 1;
});
