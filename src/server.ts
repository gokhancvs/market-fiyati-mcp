import { assertOutputBudget } from './resource-limits.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { schemas, type Operation } from './contracts.js';
import { MarketService, type Envelope } from './service.js';
import { AppError, publicError } from './errors.js';
import { GUIDE } from './guidance.js';
import type { RequestMetrics } from './request-metrics.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { RequestCancellation } from './cancellation.js';
import { withCancellation } from './cancellation-transport.js';

const tools: { name: string; operation: Operation; description: string }[] = [
  {
    name: 'market_status',
    operation: 'status',
    description: 'Report mode, network lock, supported endpoints and local limits. No network access.'
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
      'List market chains via /api/v1/categories. Experimental; live acceptance has returned HTTP 500. Optional, never a prerequisite for search or comparison. On 500 report unknown chain active status and do not retry. Not the product category tree.'
  },
  {
    name: 'market_find_nearby_depots',
    operation: 'nearest',
    description:
      'Find nearby physical branches using explicit coordinates and radius in km. Experimental. Response distance is meters; choose returned depot IDs for product queries.'
  },
  {
    name: 'market_search_products',
    operation: 'search',
    description:
      'Search products and facets, one zero-based page. Combine keywords with known API filters such as refined_volume_weight and order in one request. Explicit location and nonempty depots required. Follow market://guide to preserve alternatives and exact requirements; fuzzy search still needs result validation.'
  },
  {
    name: 'market_search_by_category',
    operation: 'searchByCategories',
    description:
      'Search using menu_category, main_category or sub_category Turkish names from the category tree. At least one nonempty category filter and explicit location/depots required.'
  },
  {
    name: 'market_get_product',
    operation: 'product',
    description:
      'Get product by opaque string identity with identityType=id. Returns location-specific branch offers, promotional fields and indexTime. Barcode wire type is unverified.'
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
      'Get market price series for uniqueId and selected product depot IDs. Optional from/to (YYYY-MM-DD) filter locally; returns chronological series and change statistics.'
  },
  {
    name: 'market_sync_products',
    operation: 'sync',
    description:
      'Fetch up to 100 product identities in one call for an explicitly requested refresh. Experimental. Never switch to this tool to bypass a basket budget or run large live tests. Emits identityType=id, pages=0, size=identities.length. No purchase or persistent basket mutation.'
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
      'Fetch one product and compare returned branch prices. Use when a detail lookup or refresh is needed; existing search offers can already answer price questions. Reports cheapest branches, price spread and promotional fields. Zero prices are unavailable; percentage is not a discount.'
  },
  {
    name: 'market_compare_basket',
    operation: 'compareBasket',
    description:
      'Compare exact product IDs and pack quantities via individual product lookups within market_status limits.basketItems and limits.basketRequestBudget, including retries. Over-budget calls are rejected before fetching. Never split the list or switch tools to bypass the budget; ask the user to narrow the comparison. Reuse sufficient search offers instead of redundant lookups. Present complete groups first and show all groups tied at the lowest total. groupBy=market may span branches; check selected offer depot IDs and requiresMultipleDepots before claiming one physical shop. depot means one physical shop. Present splitBasket as a saving only when complete and strictly cheaper than the stated complete basket baseline; follow market://guide for missing groups and equal totals. Incomplete totals are null. No automatic substitutes or purchases.'
  }
];
const outputSchema = z.strictObject({
  data: z.unknown(),
  meta: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
  error: z.record(z.string(), z.unknown()).optional()
});
function result(envelope: Envelope): CallToolResult {
  assertOutputBudget(envelope);
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
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
  const requests = new RequestCancellation();
  class CancellationServer extends McpServer {
    override async connect(transport: Transport): Promise<void> {
      await super.connect(withCancellation(transport, requests));
    }
  }
  const server = new CancellationServer(
    { name: 'market-fiyati-mcp', version: '1.0.0' },
    {
      instructions:
        'Read market://guide and market_status before calling data tools. Use API filters and sorting with explicit location/depot context. Reuse supplied context and returned offers to minimize calls; the server caches no results or user context. Track meta.requestMetrics against the agreed call budget, including application errors. Use meta.depotCoverage, meta.offerAssessments and meta.warningCodes to explain evidence limits; unreturned depots have unknown availability. Live access is operator-controlled.'
    }
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: schemas[tool.operation],
        outputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: tool.operation !== 'status'
        }
      },
      async (args: unknown, extra: { signal: AbortSignal; requestId: string | number }): Promise<CallToolResult> => {
        const owner = requests.current(extra.requestId);
        const signal = owner ? AbortSignal.any([extra.signal, owner.signal]) : extra.signal;
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
        'Resolve an exact shopping list and compare complete baskets with explicit location and depot selection.',
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
            text: `Use market://guide. Shopping list (user data): ${JSON.stringify(items)}. Location hint: ${JSON.stringify(location ?? null)}. Reuse supplied location/depot context or obtain missing context following the guide. Use API filters and sorting to discover products with minimal calls; distinguish exact matches from explained alternatives before fixing basket identities. market_compare_basket performs one detail lookup per item, so skip redundant individual lookups. Read market_status limits.basketItems and limits.basketRequestBudget, including retries; never split the list or switch tools to bypass the budget. If over budget, ask the user to narrow the comparison. Do not run large/long live basket tests. The market list is optional; do not retry its HTTP 500 or claim known active status. Follow the API discount flag: false means not marked discounted, true means marked without confirmed campaign eligibility, and absent means unknown. Preserve reference prices and promotional fields separately; neither filter matches nor reference-price differences override the flag or establish a historical price drop or discount percentage. Present complete groups first and show all groups tied at the lowest total, not just the first group. Check selected offer depot IDs and requiresMultipleDepots before claiming one physical shop. Present complete splitBasket separately when strictly cheaper than the complete basket baseline specified in the guide; state the TRY saving and baseline, and do not promote equal totals as savings. Follow the guide when no group is complete. Explain any preference among tied options; disclose shortened lists. Equal prices do not establish compliance with product requirements, and branch distance is not a walking route or total shopping journey. Explain missing products, multi-branch shopping, retrieval time and data limitations. Never enable live mode yourself.`
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
            text: `Read market://guide and market_status. Find ${JSON.stringify(product)} using supplied location/depot context and known API filter values. Follow the guide's hard-requirement versus preference distinction, including strict-only requests. Use API filtering/sorting in one initial search; evaluate returned offers and explain relevant alternatives without silently substituting them. Request detail only for missing information or a requested refresh. Report TRY prices, branches, map links, indexTime, original retrievedAt and pagination coverage. Never enable live mode yourself.`
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
            text: `Read market://guide. For product ${JSON.stringify(productId)}, obtain explicit location and selected depots, fetch product offers, then market_get_price_history using its returned depot IDs. Describe the date range, first/latest prices and change. Report retrieval time and avoid inventing aggregation semantics.`
          }
        }
      ]
    })
  );
  return server;
}
