import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { searchResponseSchema } from '../src/contracts.js';
import { outputSchema, outputSchemas } from '../src/output-schemas.js';

const metricsOutput = outputSchema.extend({
  meta: z.looseObject({
    requestMetrics: z.looseObject({
      httpAttempts: z.number().int().nonnegative(),
      retries: z.number().int().nonnegative(),
      durationMs: z.number().nonnegative()
    })
  })
});

export const testOutputSchemas = {
  status: outputSchemas.status.extend({ data: outputSchemas.status.shape.data.unwrap() }),
  basket: outputSchemas.compareBasket.extend({ data: outputSchemas.compareBasket.shape.data.unwrap() }),
  products: outputSchema.extend({ data: searchResponseSchema }),
  pagination: outputSchema.extend({
    meta: z.looseObject({ pagination: z.looseObject({ nextPage: z.number().int().nonnegative().nullable() }) })
  }),
  error: metricsOutput.extend({
    data: z.null(),
    error: z.looseObject({
      code: z.string(),
      status: z.number().int().optional(),
      syntheticAcceptance: z.boolean().optional()
    })
  })
};

export function readToolOutput<S extends z.ZodType>(result: unknown, schema: S): z.output<S> {
  const toolResult = CallToolResultSchema.parse(result);
  return schema.parse(toolResult.structuredContent);
}
