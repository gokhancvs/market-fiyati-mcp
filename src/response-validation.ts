import { z } from 'zod';
import { AppError } from './errors.js';
import { RESOURCE_LIMITS } from './resource-limits.js';

export function invalidResponse(): never {
  throw new AppError('INVALID_RESPONSE', 'Upstream response does not match the expected contract.');
}

export function responseValue<S extends z.ZodType>(schema: S) {
  return z.unknown().transform((value): z.output<S> => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return invalidResponse();
    return parsed.data;
  });
}

export function responseArray<S extends z.ZodType>(element: S, min = 0) {
  return responseValue(z.array(element).min(min));
}

export function responseObject<S extends z.ZodRawShape>(shape: S) {
  return responseValue(z.looseObject(shape).catchall(responseJson));
}

export function responseRecord<S extends z.ZodType>(value: S) {
  return responseValue(z.record(z.string(), value));
}

function checkJson(root: unknown): void {
  let values = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++values > RESOURCE_LIMITS.inputValues || depth > RESOURCE_LIMITS.inputDepth) return invalidResponse();
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return invalidResponse();
      return;
    }
    if (typeof value !== 'object') return invalidResponse();
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) visit(value[i], depth + 1);
    } else {
      for (const key of Object.keys(value)) visit((value as Record<string, unknown>)[key], depth + 1);
    }
  };
  visit(root, 0);
}

export const responseJson = z.unknown().transform((value): unknown => {
  checkJson(value);
  return value;
});
