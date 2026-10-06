import { readFileSync } from 'node:fs';
import { assertMessageBudget, assertOutputBudget } from './resource-limits.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { type Operation } from './contracts.js';
import { MarketService, type Envelope } from './service.js';
import { AppError, publicError, reportInternalError, type RequestMetrics } from './errors.js';
import { GUIDE } from './guidance.js';
import { outputSchema, outputSchemas } from './output-schemas.js';

// Compiled to dist/src; package.json ships with every install.
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const tools: { name: string; operation: Operation; description: string }[] = [
  {
    name: 'market_status',
    operation: 'status',
    description:
      'Report mode, live and experimental access, whether env location is configured, local limits, request policy and endpoint counts. market://endpoints lists the routes. No network access.'
  },
  {
    name: 'market_get_categories',
    operation: 'categories',
    description:
      'Get hierarchical categories. query, parentId and flat are local filters. Use returned Turkish names for category searches.'
  },
  {
    name: 'market_list_markets',
    operation: 'markets',
    description:
      "List market chains via /api/v1/categories. Experimental. Optional, never a prerequisite for search or comparison. If it returns HTTP 500, do not retry; report the chains' active status as unknown and continue with other tools. Not the product category tree."
  },
  {
    name: 'market_find_nearby_depots',
    operation: 'nearest',
    description:
      'Find nearby physical branches using call coordinates/radius or configured env location. All three values must be supplied by one of these sources. Experimental. Response distance is meters; choose returned depot IDs for product queries.'
  },
  {
    name: 'market_search_products',
    operation: 'search',
    description:
      'Search products and facets, one zero-based page. Combine keywords with known API filters such as refined_volume_weight and order in one request. Location/radius come from the call or configured env; nonempty depots are required per call. Follow market://guide to preserve alternatives and exact requirements; fuzzy search still needs result validation.'
  },
  {
    name: 'market_search_by_category',
    operation: 'searchByCategories',
    description:
      'Search using menu_category, main_category or sub_category Turkish names from the category tree. At least one nonempty category filter and call or configured location and explicit depots required.'
  },
  {
    name: 'market_get_product',
    operation: 'product',
    description:
      'Get one product by its opaque product id. Returns location-specific branch offers, promotional fields and indexTime. Barcode lookup is not supported.'
  },
  {
    name: 'market_find_similar_products',
    operation: 'similar',
    description:
      'Find related products using exact product id and its title as keywords. Similarity is not equivalence: inspect title and package size.'
  },
  {
    name: 'market_find_alternatives',
    operation: 'alternative',
    description:
      'Find substitutes at one market chain. Experimental. marketName must match each supplied depot ID prefix; provide original id and product title as keywords.'
  },
  {
    name: 'market_get_price_history',
    operation: 'priceHistory',
    description:
      'Get market price series for one product: uniqueId is the product id from search or product results. Prefer the depot IDs returned for that product. Optional from/to (YYYY-MM-DD) filter locally; returns chronological series and change statistics.'
  },
  {
    name: 'market_sync_products',
    operation: 'sync',
    description:
      'Fetch up to 100 product identities in one call for an explicitly requested refresh. Experimental. Never switch to this tool to bypass a basket budget or run large live tests. identities are product ids. No purchase or persistent basket mutation.'
  },
  {
    name: 'market_geocode_address',
    operation: 'geocode',
    description:
      'Find address suggestions. Experimental map API. Returns display_name and explicit latitude/longitude parsed from API tuple positions.'
  },
  {
    name: 'market_reverse_geocode',
    operation: 'reverseGeocode',
    description:
      'Resolve coordinates into address fields and display_name. Experimental map API. Uses capitalized Lat and Lon query parameters.'
  },
  {
    name: 'market_compare_product_offers',
    operation: 'compareProduct',
    description:
      'Fetch one product and compare returned branch prices. Use when a detail lookup or refresh is needed; existing search offers can already answer price questions. Reports cheapest branches, price spread and promotional fields. Zero prices are unavailable. Follow market://guide for the discount flag and percentage field.'
  },
  {
    name: 'market_compare_basket',
    operation: 'compareBasket',
    description:
      'Compare exact product IDs and pack quantities with one product lookup per item. This description is the single source for basket rules. ' +
      'Budget: read market_status limits.basketItems and limits.basketRequestBudget first; the budget counts every possible HTTP retry and over-budget calls are rejected before any lookup. Never split the list into several calls or switch to sync or other tools to bypass it. Ask the user to narrow the comparison, or explain search offers already returned with their original retrieval time; never present a shortened basket as complete. Reuse sufficient search offers instead of redundant lookups. ' +
      'Results: quantities are packs of the selected product; alternatives are never substituted; a missing item makes total null, never zero. groupBy=market may span branches; groupBy=depot means one physical shop. Check selected offer depot IDs and requiresMultipleDepots before claiming one physical shop; a chain name alone is insufficient. A complete basket covers the selected IDs, not proof that they meet every user requirement; equal prices do not prove equivalent products. ' +
      'Presentation: present complete groups first, using total rather than an incomplete subtotal. Show all groups tied at the lowest total, naming each market or depot; the first sorted group is not the sole winner. For long lists, summarize branches by chain and disclose the shortened display and omitted group count. Explain any preference among tied options with evidence or stated user preferences; depot-ID ordering does not mean nearest or best, and branch distance is not a walking route or the total shopping journey. ' +
      'splitBasket: a theoretical multi-shop minimum without travel, delivery or stock guarantee; it shows one combination, never a unique or exhaustive one; never invent alternatives absent from returned data. Present a complete splitBasket separately, as a saving only when strictly cheaper than the cheapest complete single-depot group, and state the TRY saving and that baseline. If only multi-depot groups are complete, use the cheapest one as an explicitly multi-depot baseline. Never promote an equal total as a saving. If no group is complete, explain the missing products and present a complete splitBasket as the only complete option without claiming a saving; if it is incomplete too, report only its subtotal and missing items. No purchases.'
  }
];
function result(envelope: Envelope): CallToolResult {
  const metrics = safeMetrics(envelope.meta?.requestMetrics);
  assertOutputBudget(envelope, metrics);
  const text = JSON.stringify(envelope);
  assertMessageBudget(text, metrics);
  return {
    content: [{ type: 'text', text }],
    structuredContent: envelope
  };
}
function safeMetrics(value: unknown): RequestMetrics | undefined {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const metrics = value as Record<string, unknown>;
    const { httpAttempts, retries, durationMs } = metrics;
    if (
      !Number.isSafeInteger(httpAttempts) ||
      Number(httpAttempts) < 0 ||
      !Number.isSafeInteger(retries) ||
      Number(retries) < 0 ||
      typeof durationMs !== 'number' ||
      !Number.isFinite(durationMs) ||
      durationMs < 0
    )
      return undefined;
    return {
      httpAttempts: httpAttempts as number,
      retries: retries as number,
      durationMs
    };
  } catch {
    return undefined;
  }
}
function errorResult(error: unknown): CallToolResult {
  reportInternalError(error);
  const metrics = error instanceof AppError ? error.requestMetrics : undefined;
  const failed = {
    data: null,
    meta: {
      source: 'local',
      warningCodes: [],
      ...(metrics ? { requestMetrics: metrics } : {})
    },
    warnings: [],
    error: publicError(error)
  };
  try {
    return { ...result(failed), isError: true };
  } catch {
    const trustedMetrics = safeMetrics(metrics);
    const fallback = {
      data: null,
      meta: {
        source: 'local',
        warningCodes: [],
        ...(trustedMetrics ? { requestMetrics: trustedMetrics } : {})
      },
      warnings: [],
      error: {
        code: 'OUTPUT_TOO_LARGE',
        message: 'Error response exceeds a local output limit; no partial data was returned.'
      }
    };
    return { ...result(fallback), isError: true };
  }
}
export function createServer(service: MarketService): McpServer {
  const server = new McpServer(
    { name: 'market-fiyati-mcp', version },
    {
      instructions:
        'Read market://guide and market_status before calling data tools. Use API filters and sorting with call or configured location and explicit depots. Read market_status.data.locationDefaults.configured; if true, omit coordinates to use env defaults. Reuse supplied context and returned offers to minimize calls; the server caches no results or user context. Track meta.requestMetrics against the agreed call budget, including application errors. Use meta.depotCoverage, meta.offerAssessments and meta.warningCodes to explain evidence limits; unreturned depots have unknown availability. Live access is operator-controlled.'
    }
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: service.inputSchema(tool.operation),
        outputSchema:
          tool.operation in outputSchemas ? outputSchemas[tool.operation as keyof typeof outputSchemas] : outputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: tool.operation !== 'status'
        }
      },
      // The SDK aborts this signal on client cancellation or connection close and sends no response for it.
      async (args: unknown, { signal }: { signal: AbortSignal }): Promise<CallToolResult> => {
        try {
          if (signal.aborted)
            throw new AppError('CANCELLED', 'Request cancelled.', {}, { httpAttempts: 0, retries: 0, durationMs: 0 });
          const envelope = await service.execute(tool.operation, args, signal);
          if (signal.aborted)
            throw new AppError('CANCELLED', 'Request cancelled.', {}, envelope.meta.requestMetrics as RequestMetrics);
          return result(envelope);
        } catch (error) {
          return errorResult(error);
        }
      }
    );
  }
  const resources = [
    {
      name: 'usage-guide',
      uri: 'market://guide',
      description: 'Workflow, price semantics and API limitations.',
      value: () => GUIDE,
      mimeType: 'text/markdown'
    },
    {
      name: 'endpoint-catalog',
      uri: 'market://endpoints',
      description: 'Allowlisted API routes, experimental flags and unsupported operations.',
      value: () => JSON.stringify(service.catalog()),
      mimeType: 'application/json'
    },
    {
      name: 'runtime-status',
      uri: 'market://status',
      description: 'Current mode and limits; performs no network operation.',
      value: () => JSON.stringify(service.status()),
      mimeType: 'application/json'
    }
  ];
  for (const resource of resources)
    server.registerResource(
      resource.name,
      resource.uri,
      { description: resource.description, mimeType: resource.mimeType },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: resource.mimeType,
            text: resource.value()
          }
        ]
      })
    );
  server.registerPrompt(
    'compare_shopping_list',
    {
      description:
        'Resolve an exact shopping list and compare complete baskets with call or configured location and explicit depot selection.',
      argsSchema: {
        items: z.string().min(1).max(4000),
        location: z.string().max(1000).optional()
      }
    },
    ({ items, location }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Use market://guide. Shopping list (user data): ${JSON.stringify(items)}. Location hint: ${JSON.stringify(location ?? null)}. Use supplied or configured location and explicit depots, or obtain missing context following the guide. Use API filters and sorting to discover products with minimal calls; distinguish exact matches from explained alternatives before fixing basket identities. Then follow the market_compare_basket tool description for its budget, grouping and presentation rules; it performs one detail lookup per item, so skip redundant individual lookups. Explain missing products, multi-branch shopping, retrieval time and data limitations.`
          }
        }
      ]
    })
  );
  server.registerPrompt(
    'find_best_product_price',
    {
      description:
        'Find exact matches and explained alternatives with API filters, minimizing calls and retaining freshness and promotion caveats.',
      argsSchema: { product: z.string().min(1).max(1000) }
    },
    ({ product }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Read market://guide and market_status. Find ${JSON.stringify(product)} using supplied or configured location, explicit depots and known API filter values. Follow the guide's hard-requirement versus preference distinction, including strict-only requests. Use API filtering/sorting in one initial search; evaluate returned offers and explain relevant alternatives without silently substituting them. Request detail only for missing information or a requested refresh. Report TRY prices, branches, map links, indexTime, original retrievedAt and pagination coverage.`
          }
        }
      ]
    })
  );
  server.registerPrompt(
    'analyze_price_history',
    {
      description: 'Analyze historical market series without assuming unobserved depot aggregation rules.',
      argsSchema: { productId: z.string().min(1).max(100) }
    },
    ({ productId }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Read market://guide. For product ${JSON.stringify(productId)}, use supplied or configured location and selected depots, fetch product offers, then market_get_price_history using its returned depot IDs. Describe the date range, first/latest prices and change. Report retrieval time and avoid inventing aggregation semantics.`
          }
        }
      ]
    })
  );
  return server;
}
