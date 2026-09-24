#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfig } from './config.js';
import { createTransport } from './transport.js';
import { MarketService } from './service.js';
import { createServer } from './server.js';
import { publicError } from './errors.js';
import { bindShutdown } from './lifecycle.js';

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'Market Fiyati MCP (stdio)\nConfigure MARKET_FIYATI_MODE=offline|live (default offline).\nSee README.md.\n'
    );
    return;
  }
  const config = readConfig();
  const server = createServer(new MarketService(await createTransport(config), config));
  const cleanup = bindShutdown(server, process.stdin, process);
  server.server.onclose = cleanup;
  await server.connect(new StdioServerTransport());
}
main().catch((error) => {
  process.stderr.write(`${JSON.stringify(publicError(error))}\n`);
  process.exitCode = 1;
});
