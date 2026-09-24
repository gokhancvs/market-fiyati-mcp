import { AppError } from './errors.js';
import type { EndpointId } from './contracts.js';

export const RESOURCE_LIMITS = {
  inputValues: 500_000,
  inputDepth: 64,
  productRecords: 100,
  offers: 10_000,
  warningEntries: 128,
  warningBytes: 64 * 1024,
  outputBytes: 8 * 1024 * 1024,
  outputValues: 2_000_000,
  outputDepth: 80
} as const;

/** Count JSON incrementally, before cloning/stringifying; no arrays of keys or values. */
class JsonBudget {
  private bytes = 0;
  private values = 0;
  constructor(
    private readonly maxBytes: number,
    private readonly maxValues: number,
    private readonly maxDepth: number,
    private readonly code: string
  ) {}
  private fail(resource: string, limit: number): never {
    throw new AppError(this.code, 'Result exceeds a local resource limit; no partial data was returned.', {
      resource,
      limit
    });
  }
  private add(bytes: number): void {
    this.bytes += bytes;
    if (this.bytes > this.maxBytes) this.fail('jsonBytes', this.maxBytes);
  }
  string(value: string): void {
    // Even ASCII needs at least this much space. Check before walking long strings.
    if (value.length + 2 > this.maxBytes - this.bytes) this.fail('jsonBytes', this.maxBytes);
    this.add(2);
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c === 34 || c === 92 || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) this.add(2);
      else if (c < 32) this.add(6);
      else if (c < 128) this.add(1);
      else if (c < 2048) this.add(2);
      else if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          this.add(4);
          i++;
        } else this.add(6);
      } else this.add(c >= 0xdc00 && c <= 0xdfff ? 6 : 3);
    }
  }
  visit(value: unknown, depth = 0): void {
    if (depth > this.maxDepth) this.fail('jsonDepth', this.maxDepth);
    if (++this.values > this.maxValues) this.fail('jsonValues', this.maxValues);
    if (value === null || value === undefined) {
      this.add(4);
      return;
    }
    if (typeof value === 'string') {
      this.string(value);
      return;
    }
    if (typeof value === 'boolean') {
      this.add(value ? 4 : 5);
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) this.fail('jsonNumber', 0);
      this.add(String(value).length);
      return;
    }
    if (typeof value !== 'object') this.fail('jsonType', 0);
    this.add(2);
    if (Array.isArray(value)) {
      if (value.length > this.maxValues - this.values) this.fail('jsonValues', this.maxValues);
      for (let i = 0; i < value.length; i++) {
        if (i) this.add(1);
        this.visit(value[i], depth + 1);
      }
    } else {
      let first = true;
      for (const key in value)
        if (Object.hasOwn(value, key)) {
          const entry = (value as Record<string, unknown>)[key];
          if (entry === undefined) continue;
          if (!first) this.add(1);
          first = false;
          this.string(key);
          this.add(1);
          this.visit(entry, depth + 1);
        }
    }
  }
}

/** One instance per tool call; basket sources consume the same budget. */
export class InputBudget {
  private readonly json: JsonBudget;
  private readonly warnings = new JsonBudget(RESOURCE_LIMITS.warningBytes, Infinity, 0, 'RESOURCE_LIMIT_EXCEEDED');
  private warningEntries = 0;
  private offers = 0;
  private products = 0;
  constructor(maxBytes: number) {
    this.json = new JsonBudget(
      maxBytes,
      RESOURCE_LIMITS.inputValues,
      RESOURCE_LIMITS.inputDepth,
      'RESOURCE_LIMIT_EXCEEDED'
    );
  }
  private countWarnings(value: unknown): void {
    if (value === undefined) return;
    const count = Array.isArray(value) ? value.length : 1;
    this.warningEntries += count;
    if (this.warningEntries > RESOURCE_LIMITS.warningEntries)
      throw new AppError(
        'RESOURCE_LIMIT_EXCEEDED',
        'Too many upstream warning entries; no partial data was returned.',
        { resource: 'warningEntries', limit: RESOURCE_LIMITS.warningEntries }
      );
    if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === 'string') this.warnings.string(entry);
    } else if (typeof value === 'string') this.warnings.string(value);
  }
  accept(data: unknown, endpoint?: EndpointId): void {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const response = data as Record<string, unknown>;
      this.countWarnings(response.warnings);
      if (Array.isArray(response.content)) {
        if (
          endpoint &&
          ['search', 'searchByCategories', 'product', 'similar', 'alternative', 'sync'].includes(endpoint)
        ) {
          this.products += response.content.length;
          if (this.products > RESOURCE_LIMITS.productRecords)
            throw new AppError('RESOURCE_LIMIT_EXCEEDED', 'Too many source products; no partial data was returned.', {
              resource: 'productRecords',
              limit: RESOURCE_LIMITS.productRecords
            });
        }
        if (response.content.length > RESOURCE_LIMITS.inputValues)
          throw new AppError('RESOURCE_LIMIT_EXCEEDED', 'Too many source records; no partial data was returned.', {
            resource: 'jsonValues',
            limit: RESOURCE_LIMITS.inputValues
          });
        for (const product of response.content)
          if (product && typeof product === 'object') {
            this.countWarnings(product.warnings);
            if (Array.isArray(product.productDepotInfoList)) this.offers += product.productDepotInfoList.length;
            if (this.offers > RESOURCE_LIMITS.offers)
              throw new AppError('RESOURCE_LIMIT_EXCEEDED', 'Too many source offers; no partial data was returned.', {
                resource: 'offers',
                limit: RESOURCE_LIMITS.offers
              });
          }
      }
    }
    this.json.visit(data);
  }
}

export function assertOutputBudget(value: unknown): void {
  // Input has already bounded all source collections before derived arrays exist.
  // Check the final logical envelope before text and structuredContent duplicate it.
  new JsonBudget(
    RESOURCE_LIMITS.outputBytes,
    RESOURCE_LIMITS.outputValues,
    RESOURCE_LIMITS.outputDepth,
    'OUTPUT_TOO_LARGE'
  ).visit(value);
}
