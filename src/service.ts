import { InputBudget, RESOURCE_LIMITS, assertOutputBudget } from './resource-limits.js';
import {
  BASKET_REQUEST_BUDGET,
  MAX_PAGE_INDEX,
  locationShape,
  endpoints,
  schemas,
  validateResponse,
  type Category,
  type EndpointId,
  type History,
  type Operation,
  type Product,
  type SearchResponse
} from './contracts.js';
import { type Config } from './config.js';
import type { ZodObject } from 'zod';
import { AppError } from './errors.js';
import { MAX_PENDING_REQUESTS, type Payload, type SourceMeta, type Transport } from './transport.js';
import { compareBasket, compareOffers, filterCategories, summarizeHistory } from './analysis.js';
import { mapLinks } from './maps.js';
import type { HttpAttemptCounts } from './request-metrics.js';
import {
  observeProducts,
  offerAssessmentLinks,
  responseWarningCodes,
  WARNING_CODES,
  type WarningCode
} from './observations.js';

export type Envelope = {
  data: unknown;
  meta: Record<string, unknown>;
  warnings: string[];
};
const priceScopeWarning =
  'Prices apply to returned offers in the supplied location and depot selection; stock and promotion eligibility are not guaranteed.';

function offerScopeWarnings(response: SearchResponse, depots: string[]): string[] {
  const selected = new Set(depots),
    outside = new Set<string>();
  for (const product of response.content)
    for (const offer of product.productDepotInfoList) if (!selected.has(offer.depotId)) outside.add(offer.depotId);
  if (!outside.size) return [];
  const sample = [...outside].slice(0, 20);
  return [
    `Upstream data includes ${outside.size} depot IDs outside the supplied selection: ${JSON.stringify(sample)}${outside.size > sample.length ? ' (first 20 shown)' : ''}. Offers are retained; do not claim all results are within the selected scope.`
  ];
}

function upstreamContext(response: SearchResponse, requestedIdentity: string, depots: string[]) {
  const { content, ...responseFields } = response;
  const productFields = content.map(({ productDepotInfoList: _, ...fields }) => fields);
  const warnings = offerScopeWarnings(response, depots);
  const collect = (value: unknown, label: string) => {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries)
      if (typeof entry === 'string') warnings.push(`Upstream data (${label}): ${JSON.stringify(entry)}`);
  };
  collect(response.warnings, `lookup ${JSON.stringify(requestedIdentity)}`);
  for (const product of content) collect(product.warnings, `product ${JSON.stringify(product.id)}`);
  if (response.searchResultType === 2 || response.searchResultType === 3)
    warnings.push(
      `Upstream fuzzy search result type: ${response.searchResultType} (lookup ${JSON.stringify(requestedIdentity)}).`
    );
  return {
    record: { requestedIdentity, responseFields, productFields },
    warnings,
    warningCodes: responseWarningCodes(response)
  };
}
export class MarketService {
  constructor(
    public readonly transport: Transport,
    private readonly config: Config
  ) {}
  inputSchema(operation: Operation): ZodObject {
    const schema: ZodObject = schemas[operation];
    if (!this.config.defaultLocation || !('latitude' in schema.shape)) return schema;
    return schema.safeExtend({
      latitude: locationShape.latitude.optional(),
      longitude: locationShape.longitude.optional(),
      ...('distance' in schema.shape ? { distance: locationShape.distance.optional() } : {})
    });
  }
  status() {
    return {
      mode: this.transport.mode,
      liveRequestsEnabled: this.transport.mode === 'live',
      experimentalEndpointsEnabled: this.config.enableExperimental,
      currency: 'TRY',
      locationDefaults: { configured: !!this.config.defaultLocation },
      limits: {
        pageSize: 100,
        basketItems: Math.floor(BASKET_REQUEST_BUDGET / (this.config.retries + 1)),
        basketRequestBudget: BASKET_REQUEST_BUDGET,
        quantityPerItem: 50,
        radiusKm: 50,
        pendingRequests: MAX_PENDING_REQUESTS,
        responseBytes: this.config.maxResponseBytes,
        inputBytesPerCall: this.config.maxResponseBytes,
        ...RESOURCE_LIMITS
      },
      requestPolicy: {
        retries: this.config.retries,
        minIntervalMs: this.config.minIntervalMs,
        scope:
          'Per-process spacing and per-basket attempt budget; not a global/IP quota or a guarantee against API blocking.'
      },
      api: {
        endpointCount: Object.keys(endpoints).length,
        experimentalEndpointCount: Object.values(endpoints).filter((e) => e.experimental).length,
        // Compatibility field: this runtime never performs automatic live validation.
        liveValidationPerformed: false,
        liveValidationScope: 'runtime-session',
        releaseVerificationReference: 'docs/verification.md'
      }
    };
  }
  private async get(
    endpoint: EndpointId,
    payload: Payload,
    signal: AbortSignal | undefined,
    counts: HttpAttemptCounts,
    budget: InputBudget
  ) {
    let result: Awaited<ReturnType<Transport['request']>>;
    try {
      result = await this.transport.request(endpoint, payload, signal, counts);
    } catch (error) {
      if (
        endpoint === 'markets' &&
        error instanceof AppError &&
        error.code === 'HTTP_ERROR' &&
        error.details.status === 500
      )
        throw new AppError(
          'HTTP_ERROR',
          'Market chain list is unavailable (upstream HTTP 500). Chain active status is unknown. Do not retry this lookup; search and price tools do not require it.',
          {
            ...error.details,
            endpoint,
            activeStatus: 'unknown'
          }
        );
      throw error;
    }
    budget.accept(result.data, endpoint);
    let data = validateResponse(endpoint, result.data);
    if (['search', 'searchByCategories', 'similar', 'alternative'].includes(endpoint)) {
      const response = data as SearchResponse;
      const offset = Number(payload.pages) * Number(payload.size);
      if (response.content.length > 0 && response.numberOfFound < offset + response.content.length)
        throw new AppError('INVALID_RESPONSE', 'Upstream total is inconsistent with the returned page.', { endpoint });
    }
    if (endpoint === 'product' || endpoint === 'sync') {
      const requested = new Set(endpoint === 'product' ? [String(payload.identity)] : (payload.identities as string[]));
      const seen = new Set<string>();
      for (const product of (data as SearchResponse).content) {
        if (!requested.has(product.id) || seen.has(product.id))
          throw new AppError('INVALID_RESPONSE', 'Exact lookup returned unexpected or duplicate product identities.', {
            endpoint
          });
        seen.add(product.id);
      }
    }
    if (endpoint === 'nearest') {
      data = (
        data as {
          location: { lat: number; lon: number };
          [key: string]: unknown;
        }[]
      ).map((branch) => ({
        ...branch,
        maps: mapLinks(branch.location.lat, branch.location.lon)
      }));
    } else if (['search', 'searchByCategories', 'product', 'similar', 'alternative', 'sync'].includes(endpoint)) {
      const response = data as SearchResponse;
      data = {
        ...response,
        content: response.content.map((product) => ({
          ...product,
          productDepotInfoList: product.productDepotInfoList.map((offer) => ({
            ...offer,
            maps: mapLinks(offer.latitude, offer.longitude)
          }))
        }))
      };
    }
    return { data, meta: result.meta };
  }
  private envelope(data: unknown, meta: SourceMeta | Record<string, unknown>, warnings: string[] = []): Envelope {
    const codes = new Set((meta as { warningCodes?: WarningCode[] }).warningCodes ?? []);
    if (meta.experimental) {
      warnings.push(
        'Experimental endpoint; operator enabled access does not certify live validation. See release verification notes.'
      );
      codes.add('EXPERIMENTAL_ENDPOINT');
    }
    for (const code of ['DEPOT_AVAILABILITY_UNKNOWN', 'PARTIAL_RESULTS', 'PAGINATION_LIMIT_REACHED'] as const)
      if (codes.has(code)) warnings.push(WARNING_CODES[code]);
    return { data, meta: { ...meta, warningCodes: [...codes] }, warnings };
  }
  async execute(operation: Operation, args: unknown, signal?: AbortSignal): Promise<Envelope> {
    const counts: HttpAttemptCounts = { httpAttempts: 0, retries: 0 };
    const started = performance.now();
    const snapshot = () => ({
      ...counts,
      durationMs: Math.max(0, performance.now() - started)
    });
    try {
      const result = await this.executeOperation(operation, args, signal, counts);
      const envelope = {
        ...result,
        meta: { ...result.meta, requestMetrics: snapshot() }
      };
      assertOutputBudget(envelope);
      return envelope;
    } catch (error) {
      const safe =
        error instanceof AppError
          ? error
          : new AppError('INTERNAL_ERROR', 'Unexpected internal error. See local diagnostics.');
      throw new AppError(safe.code, safe.message, safe.details, snapshot());
    }
  }
  private async executeOperation(
    operation: Operation,
    args: unknown,
    signal: AbortSignal | undefined,
    counts: HttpAttemptCounts
  ): Promise<Envelope> {
    const defaults = this.config.defaultLocation;
    const shape = schemas[operation].shape;
    if (defaults && 'latitude' in shape && args && typeof args === 'object' && !Array.isArray(args)) {
      const supplied = args as Record<string, unknown>;
      args = {
        ...supplied,
        ...(supplied.latitude === undefined && supplied.longitude === undefined
          ? { latitude: defaults.latitude, longitude: defaults.longitude }
          : {}),
        ...('distance' in shape && supplied.distance === undefined ? { distance: defaults.distance } : {})
      };
    }
    const parsed = schemas[operation].safeParse(args);
    if (!parsed.success)
      throw new AppError('INVALID_ARGUMENT', 'Invalid tool arguments.', {
        issues: parsed.error.issues.slice(0, 15).map((i) => ({ path: i.path.join('.'), message: i.message }))
      });
    const input = parsed.data as Payload;
    const budget = new InputBudget(this.config.maxResponseBytes);
    if (operation === 'status') return this.envelope(this.status(), { source: 'local' });
    if (operation === 'compareBasket') {
      const { items, groupBy, ...context } = schemas.compareBasket.parse(input);
      if (items.length * (this.config.retries + 1) > BASKET_REQUEST_BUDGET)
        throw new AppError(
          'REQUEST_BUDGET_EXCEEDED',
          'Basket request budget exceeded. Do not split the list or switch tools to bypass it.',
          {
            maxHttpAttempts: BASKET_REQUEST_BUDGET,
            maxItems: Math.floor(BASKET_REQUEST_BUDGET / (this.config.retries + 1))
          }
        );
      const products: Product[] = [];
      const sources: SourceMeta[] = [];
      const times = new Map<string, string>(),
        codes: WarningCode[] = ['BASKET_SCOPE_LIMITED'];
      const upstream: ReturnType<typeof upstreamContext>['record'][] = [];
      const warnings = [
        priceScopeWarning,
        'Scope is the supplied products, location and selected depots. No substitute products are silently selected.'
      ];
      // Use bounded individual lookups without choosing substitute products.
      for (const item of items) {
        const result = await this.get(
          'product',
          {
            ...context,
            identity: item.id,
            identityType: 'id',
            pages: 0,
            size: 1
          },
          signal,
          counts,
          budget
        );
        const found = (result.data as SearchResponse).content.find((p) => p.id === item.id);
        if (found) products.push(found);
        sources.push(result.meta);
        times.set(item.id, result.meta.retrievedAt);
        const source = upstreamContext(result.data as SearchResponse, item.id, context.depots);
        upstream.push(source.record);
        for (const code of source.warningCodes) codes.push(code);
        for (const warning of source.warnings) warnings.push(warning);
      }
      const observations = observeProducts(
        products,
        context.depots,
        times,
        items.map((item) => item.id)
      );
      const links = offerAssessmentLinks(products);
      const comparison = compareBasket(items, products, groupBy, links.visitOffer, new Set(context.depots));
      return this.envelope(
        comparison,
        {
          source: this.transport.mode,
          derived: true,
          lookupCount: items.length,
          sources,
          upstream,
          currency: 'TRY',
          ...observations,
          offerAssessmentRefs: links.references,
          warningCodes: [...observations.warningCodes, ...codes]
        },
        warnings
      );
    }
    if (operation === 'compareProduct') {
      const result = await this.get(
        'product',
        {
          ...input,
          identityType: 'id',
          pages: 0,
          size: 1
        },
        signal,
        counts,
        budget
      );
      const product = (result.data as SearchResponse).content.find((p) => p.id === input.identity);
      if (!product)
        throw new AppError('PRODUCT_NOT_FOUND', 'Product not returned for this location and depot selection.');
      const source = upstreamContext(result.data as SearchResponse, String(input.identity), input.depots as string[]);
      const observations = observeProducts(
        [product],
        input.depots as string[],
        new Map([[product.id, result.meta.retrievedAt]]),
        [String(input.identity)]
      );
      const links = offerAssessmentLinks([product]);
      const comparison = compareOffers(product, links.visitOffer, new Set(input.depots as string[]));
      return this.envelope(
        comparison,
        {
          ...result.meta,
          currency: 'TRY',
          derived: true,
          upstream: [source.record],
          ...observations,
          offerAssessmentRefs: links.references,
          warningCodes: [...observations.warningCodes, ...source.warningCodes]
        },
        [priceScopeWarning, ...source.warnings]
      );
    }
    if (operation === 'categories') {
      const result = await this.get('categories', {}, signal, counts, budget);
      const response = result.data as {
        content: Category[];
        [key: string]: unknown;
      };
      return this.envelope(
        {
          ...response,
          content: filterCategories(response.content, schemas.categories.parse(input))
        },
        result.meta
      );
    }
    if (operation === 'priceHistory') {
      const { from, to, ...payload } = schemas.priceHistory.parse(input);
      const result = await this.get('priceHistory', payload, signal, counts, budget);
      const data = summarizeHistory(result.data as History, from, to);
      const warningCodes: WarningCode[] = ['HISTORY_AGGREGATION_UNKNOWN'];
      const warnings = [
        'Series are grouped by upstream market name; the aggregation across selected depots is not documented.'
      ];
      if (data.summary.some((market) => market.missingPoints > 0)) {
        warningCodes.push('HISTORY_MISSING_VALUES');
        warnings.push(WARNING_CODES.HISTORY_MISSING_VALUES);
      }
      return this.envelope(data, { ...result.meta, currency: 'TRY', warningCodes }, warnings);
    }
    let payload = input;
    if (operation === 'sync')
      payload = {
        ...input,
        identityType: 'id',
        pages: 0,
        size: (input.identities as string[]).length
      };
    if (operation === 'reverseGeocode') payload = { Lat: input.latitude, Lon: input.longitude };
    const result = await this.get(operation, payload, signal, counts, budget);
    if (operation === 'geocode') {
      const rows = result.data as unknown[][];
      const content = rows.map((row) => {
        const numeric = (value: unknown) =>
          typeof value === 'number' ||
          (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()));
        if (typeof row[0] !== 'string' || !numeric(row[7]) || !numeric(row[8]))
          throw new AppError('INVALID_RESPONSE', 'Geocoder returned invalid address or coordinate types.');
        const latitude = Number(row[8]),
          longitude = Number(row[7]);
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          Math.abs(latitude) > 90 ||
          Math.abs(longitude) > 180
        )
          throw new AppError('INVALID_RESPONSE', 'Geocoder returned invalid coordinates.');
        return {
          display_name: String(row[0]),
          latitude,
          longitude,
          raw: row
        };
      });
      return this.envelope({ content }, result.meta);
    }
    if (operation === 'reverseGeocode') {
      const address = result.data as Payload;
      const parts = [
        ['Mahalle_Adi', '', ' Mh.'],
        ['Yol_Adi', '', ''],
        ['KapiNo', 'No: ', ''],
        ['Ilce_Adi', '', ''],
        ['Il_Adi', '', '']
      ] as const;
      const display_name = parts
        .filter(([key]) => address[key] !== null && address[key] !== undefined && address[key] !== '')
        .map(([key, prefix, suffix]) => `${prefix}${String(address[key])}${suffix}`)
        .join(' ');
      return this.envelope(
        {
          ...address,
          display_name,
          latitude: input.latitude,
          longitude: input.longitude
        },
        result.meta
      );
    }
    const warnings: string[] = [];
    const meta: Record<string, unknown> = { ...result.meta };
    if (['search', 'searchByCategories', 'similar', 'alternative', 'product', 'sync'].includes(operation)) {
      const data = result.data as SearchResponse;
      const pages = Number(payload.pages ?? 0),
        size = Number(payload.size ?? 1);
      const requestedIds =
        operation === 'sync' ? (input.identities as string[]) : operation === 'product' ? [String(input.identity)] : [];
      const observations = observeProducts(
        data.content,
        input.depots as string[],
        new Map(data.content.map((product) => [product.id, result.meta.retrievedAt])),
        requestedIds
      );
      Object.assign(meta, observations);
      const codes = [...observations.warningCodes, ...responseWarningCodes(data)];
      const pageable = operation !== 'product' && operation !== 'sync';
      if (pageable && (pages > 0 || data.content.length < data.numberOfFound)) codes.push('PARTIAL_RESULTS');
      const hasNext = pageable && data.content.length > 0 && (pages + 1) * size < data.numberOfFound;
      const limitReached = hasNext && pages === MAX_PAGE_INDEX;
      if (limitReached) codes.push('PAGINATION_LIMIT_REACHED');
      meta.currency = 'TRY';
      meta.pagination = {
        page: pages,
        size,
        returned: data.content.length,
        total: data.numberOfFound,
        nextPage: hasNext && !limitReached ? pages + 1 : null
      };
      if (operation === 'sync') {
        const returned = new Set(data.content.map((p) => p.id));
        meta.missingProductIds = (input.identities as string[]).filter((id) => !returned.has(id));
      }
      warnings.push(priceScopeWarning);
      warnings.push(...offerScopeWarnings(data, input.depots as string[]));
      if ((input.offer_discount as string[] | undefined)?.includes('true')) {
        warnings.push(
          'The offer_discount filter is forwarded to the API, but its semantics are not fully verified. Returned offers are not proof of a confirmed discount or promotion eligibility.'
        );
        codes.push('DISCOUNT_FILTER_UNVERIFIED');
      }
      if (operation === 'search') {
        warnings.push('Search may be fuzzy. Confirm title, category and package size before comparing products.');
        codes.push('SEARCH_MAY_BE_FUZZY');
      }
      if (data.searchResultType === 2 || data.searchResultType === 3)
        warnings.push(`Upstream fuzzy search result type: ${data.searchResultType}.`);
      meta.warningCodes = codes;
    }
    return this.envelope(result.data, meta, warnings);
  }
  catalog() {
    return {
      endpoints,
      excluded: [
        {
          path: '/api/v1/store',
          methods: ['GET', 'POST'],
          reason: 'Request and response contracts are not supported.'
        },
        {
          path: '/api/v1/generate',
          reason: 'Operation contract is not supported.'
        },
        {
          path: '/Service/api/v1/Map/Default',
          reason: 'Map image tiles; not a data tool.'
        },
        {
          feature: 'barcode identityType',
          reason: 'Supported wire value not established.'
        }
      ]
    };
  }
}
