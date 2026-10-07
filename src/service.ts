import { InputBudget, RESOURCE_LIMITS } from './resource-limits.js';
import {
  BASKET_REQUEST_BUDGET,
  INPUT_LIMITS,
  locationShape,
  endpoints,
  schemas,
  validateResponse,
  type EndpointId,
  type Operation,
  type Offer,
  type Product,
  type ProductEndpoint,
  type ResponseOf,
  type SearchResponse
} from './contracts.js';
import { type Config } from './config.js';
import type { z, ZodObject } from 'zod';
import { AppError, reportInternalError, type HttpAttemptCounts } from './errors.js';
import { MAX_PENDING_REQUESTS, type Payload, type SourceMeta, type Transport } from './transport.js';
import { compareBasket, compareOffers, filterCategories, summarizeHistory } from './analysis.js';
import { depotMaps, mapLinks } from './maps.js';
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
type Input<O extends Operation> = z.output<(typeof schemas)[O]>;
type Call = { signal: AbortSignal | undefined; counts: HttpAttemptCounts; budget: InputBudget };
type Handlers = { [O in Operation]: (input: Input<O>, call: Call) => Promise<Envelope> };

/** Ordered warning text and trusted codes for one envelope. */
class Warnings {
  constructor(
    readonly texts: string[] = [],
    readonly codes: WarningCode[] = []
  ) {}
  /** Record a code with its text. */
  warn(code: WarningCode, text: string = WARNING_CODES[code]): void {
    this.codes.push(code);
    this.texts.push(text);
  }
  /** Record codes whose text, if any, envelope() derives; use this, not warn(), for the codes it derives. */
  code(...codes: WarningCode[]): void {
    this.codes.push(...codes);
  }
  /** Record text that has no code of its own. */
  note(...texts: string[]): void {
    this.texts.push(...texts);
  }
}
const EXPERIMENTAL_WARNING =
  'Experimental endpoint; operator enabled access does not certify live validation. See release verification notes.';
// The product endpoint takes one exact id; these wire fields are fixed.
const exactIdPayload = (identity: string) => ({ identity, identityType: 'id', pages: 0, size: 1 });
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
        pageSize: INPUT_LIMITS.pageSize,
        basketItems: Math.floor(BASKET_REQUEST_BUDGET / (this.config.retries + 1)),
        basketRequestBudget: BASKET_REQUEST_BUDGET,
        quantityPerItem: INPUT_LIMITS.quantityPerItem,
        radiusKm: INPUT_LIMITS.radiusKm,
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
  private async get<E extends EndpointId>(
    endpoint: E,
    payload: Payload,
    { signal, counts, budget }: Call
  ): Promise<{ data: ResponseOf<E>; meta: SourceMeta }> {
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
    return { data: validateResponse(endpoint, result.data), meta: result.meta };
  }
  /** Fetch a product response and check it against the request. Map links come from depotMaps(). */
  private async getProducts(endpoint: ProductEndpoint, payload: Payload, call: Call, requestedIds: string[]) {
    const { data: response, meta } = await this.get(endpoint, payload, call);
    if (endpoints[endpoint].kind === 'productPage') {
      const offset = Number(payload.pages) * Number(payload.size);
      if (response.content.length > 0 && response.numberOfFound < offset + response.content.length)
        throw new AppError('INVALID_RESPONSE', 'Upstream total is inconsistent with the returned page.', { endpoint });
    } else {
      const requested = new Set(requestedIds);
      const seen = new Set<string>();
      for (const product of response.content) {
        if (!requested.has(product.id) || seen.has(product.id))
          throw new AppError('INVALID_RESPONSE', 'Exact lookup returned unexpected or duplicate product identities.', {
            endpoint
          });
        seen.add(product.id);
      }
    }
    const data: SearchResponse = {
      ...response,
      content: response.content.map((product) => ({
        ...product,
        // An upstream maps field must not pass for links generated by this server.
        productDepotInfoList: product.productDepotInfoList.map(
          ({ maps: _, ...offer }: Offer & { maps?: unknown }) => offer
        )
      }))
    };
    return { data, meta };
  }
  private envelope(data: unknown, meta: Record<string, unknown>, log = new Warnings()): Envelope {
    if (meta.experimental) log.warn('EXPERIMENTAL_ENDPOINT', EXPERIMENTAL_WARNING);
    const codes = new Set(log.codes);
    for (const code of ['DEPOT_AVAILABILITY_UNKNOWN', 'PARTIAL_RESULTS', 'PAGINATION_LIMIT_REACHED'] as const)
      if (codes.has(code)) log.texts.push(WARNING_CODES[code]);
    return { data, meta: { ...meta, warningCodes: [...codes] }, warnings: log.texts };
  }
  async execute(operation: Operation, args: unknown, signal?: AbortSignal): Promise<Envelope> {
    const counts: HttpAttemptCounts = { httpAttempts: 0, retries: 0 };
    const started = performance.now();
    const snapshot = () => ({
      ...counts,
      durationMs: Math.max(0, performance.now() - started)
    });
    try {
      const result = await this.run(operation, args, {
        signal,
        counts,
        budget: new InputBudget(this.config.maxResponseBytes)
      });
      return {
        ...result,
        meta: { ...result.meta, requestMetrics: snapshot() }
      };
    } catch (error) {
      reportInternalError(error);
      const safe = error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'Unexpected internal error.');
      throw new AppError(safe.code, safe.message, safe.details, snapshot());
    }
  }
  private async run<O extends Operation>(operation: O, args: unknown, call: Call): Promise<Envelope> {
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
    // Indexing with a generic key widens the schema union; the schema table fixes each input type.
    const parsed = (schemas[operation] as ZodObject).safeParse(args);
    if (!parsed.success)
      throw new AppError('INVALID_ARGUMENT', 'Invalid tool arguments.', {
        issues: parsed.error.issues.slice(0, 15).map((i) => ({ path: i.path.join('.'), message: i.message }))
      });
    return this.handlers[operation](parsed.data as Input<O>, call);
  }
  private readonly handlers: Handlers = {
    status: async () => this.envelope(this.status(), { source: 'local' }),
    compareBasket: async ({ items, groupBy, ...context }, call) => {
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
      const times = new Map<string, string>();
      const upstream: ReturnType<typeof upstreamContext>['record'][] = [];
      const log = new Warnings(
        [
          priceScopeWarning,
          'Scope is the supplied products, location and selected depots. No substitute products are silently selected.'
        ],
        ['BASKET_SCOPE_LIMITED']
      );
      // Use bounded individual lookups without choosing substitute products.
      for (const item of items) {
        const result = await this.getProducts('product', { ...context, ...exactIdPayload(item.id) }, call, [item.id]);
        const found = result.data.content.find((p) => p.id === item.id);
        if (found) products.push(found);
        sources.push(result.meta);
        times.set(item.id, result.meta.retrievedAt);
        const source = upstreamContext(result.data, item.id, context.depots);
        upstream.push(source.record);
        log.code(...source.warningCodes);
        log.note(...source.warnings);
      }
      const observations = observeProducts(
        products,
        context.depots,
        times,
        items.map((item) => item.id)
      );
      log.codes.unshift(...observations.warningCodes);
      const links = offerAssessmentLinks(products);
      const comparison = compareBasket(items, products, groupBy, links.visitOffer, new Set(context.depots));
      return this.envelope(
        { ...comparison, depotMaps: depotMaps(products) },
        {
          source: this.transport.mode,
          derived: true,
          lookupCount: items.length,
          sources,
          upstream,
          currency: 'TRY',
          // envelope() replaces warningCodes and keeps its position.
          ...observations,
          offerAssessmentRefs: links.references
        },
        log
      );
    },
    compareProduct: async (input, call) => {
      const result = await this.getProducts('product', { ...input, ...exactIdPayload(input.identity) }, call, [
        input.identity
      ]);
      const product = result.data.content.find((p) => p.id === input.identity);
      if (!product)
        throw new AppError('PRODUCT_NOT_FOUND', 'Product not returned for this location and depot selection.');
      const source = upstreamContext(result.data, input.identity, input.depots);
      const observations = observeProducts([product], input.depots, new Map([[product.id, result.meta.retrievedAt]]), [
        input.identity
      ]);
      const links = offerAssessmentLinks([product]);
      const comparison = compareOffers(product, links.visitOffer, new Set(input.depots));
      return this.envelope(
        { ...comparison, depotMaps: depotMaps([product]) },
        {
          ...result.meta,
          currency: 'TRY',
          derived: true,
          upstream: [source.record],
          ...observations,
          offerAssessmentRefs: links.references
        },
        new Warnings([priceScopeWarning, ...source.warnings], [...observations.warningCodes, ...source.warningCodes])
      );
    },
    categories: async (input, call) => {
      const result = await this.get('categories', {}, call);
      return this.envelope({ ...result.data, content: filterCategories(result.data.content, input) }, result.meta);
    },
    priceHistory: async ({ from, to, ...payload }, call) => {
      const result = await this.get('priceHistory', payload, call);
      const data = summarizeHistory(result.data, from, to);
      const log = new Warnings();
      log.warn(
        'HISTORY_AGGREGATION_UNKNOWN',
        'Series are grouped by upstream market name; the aggregation across selected depots is not documented.'
      );
      if (data.summary.some((market) => market.missingPoints > 0)) log.warn('HISTORY_MISSING_VALUES');
      return this.envelope(data, { ...result.meta, currency: 'TRY' }, log);
    },
    nearest: async (input, call) => {
      const result = await this.get('nearest', input, call);
      const data = result.data.map((branch) => ({
        ...branch,
        maps: mapLinks(branch.location.lat, branch.location.lon)
      }));
      return this.envelope(data, result.meta);
    },
    markets: async (input, call) => {
      const result = await this.get('markets', input, call);
      return this.envelope(result.data, result.meta);
    },
    geocode: async (input, call) => {
      const result = await this.get('geocode', input, call);
      const content = result.data.map((row) => {
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
    },
    reverseGeocode: async (input, call) => {
      const result = await this.get('reverseGeocode', { Lat: input.latitude, Lon: input.longitude }, call);
      const address = result.data;
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
    },
    search: (input, call) => this.productQuery('search', input, input, call, []),
    searchByCategories: (input, call) => this.productQuery('searchByCategories', input, input, call, []),
    similar: (input, call) => this.productQuery('similar', input, input, call, []),
    alternative: (input, call) => this.productQuery('alternative', input, input, call, []),
    product: (input, call) =>
      this.productQuery('product', input, { ...input, ...exactIdPayload(input.identity) }, call, [input.identity]),
    sync: (input, call) =>
      this.productQuery(
        'sync',
        input,
        { ...input, identityType: 'id', pages: 0, size: input.identities.length },
        call,
        input.identities
      )
  };
  private async productQuery(
    operation: ProductEndpoint,
    input: { depots: string[]; offer_discount?: string[] | undefined },
    payload: Payload,
    call: Call,
    requestedIds: string[]
  ): Promise<Envelope> {
    const result = await this.getProducts(operation, payload, call, requestedIds);
    const data = result.data;
    const pages = Number(payload.pages ?? 0),
      size = Number(payload.size ?? 1);
    const observations = observeProducts(
      data.content,
      input.depots,
      new Map(data.content.map((product) => [product.id, result.meta.retrievedAt])),
      requestedIds
    );
    // envelope() replaces the observation warningCodes and keeps their position.
    const meta: Record<string, unknown> = { ...result.meta, ...observations };
    const log = new Warnings([], [...observations.warningCodes, ...responseWarningCodes(data)]);
    const pageable = endpoints[operation].kind === 'productPage';
    if (pageable && (pages > 0 || data.content.length < data.numberOfFound)) log.code('PARTIAL_RESULTS');
    const hasNext = pageable && data.content.length > 0 && (pages + 1) * size < data.numberOfFound;
    const limitReached = hasNext && pages === INPUT_LIMITS.maxPageIndex;
    if (limitReached) log.code('PAGINATION_LIMIT_REACHED');
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
      meta.missingProductIds = requestedIds.filter((id) => !returned.has(id));
    }
    log.note(priceScopeWarning, ...offerScopeWarnings(data, input.depots));
    if (input.offer_discount?.includes('true'))
      log.warn(
        'DISCOUNT_FILTER_UNVERIFIED',
        'The offer_discount filter is forwarded to the API, but its semantics are not fully verified. Returned offers are not proof of a confirmed discount or promotion eligibility.'
      );
    if (operation === 'search')
      log.warn(
        'SEARCH_MAY_BE_FUZZY',
        'Search may be fuzzy. Confirm title, category and package size before comparing products.'
      );
    if (data.searchResultType === 2 || data.searchResultType === 3)
      log.note(`Upstream fuzzy search result type: ${data.searchResultType}.`);
    return this.envelope({ ...data, depotMaps: depotMaps(data.content) }, meta, log);
  }
  catalog() {
    return {
      endpoints: Object.fromEntries(Object.entries(endpoints).map(([id, { kind: _, ...endpoint }]) => [id, endpoint])),
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
