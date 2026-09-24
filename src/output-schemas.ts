import { z } from 'zod';
import { BASKET_REQUEST_BUDGET } from './contracts.js';

export const outputSchema = z.strictObject({
  data: z.unknown(),
  meta: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
  error: z.record(z.string(), z.unknown()).optional()
});
const count = z.number().int().nonnegative();
const price = z.number().nonnegative();
const ids = z.array(z.string());
// Describe stable local fields; upstream extensions remain data, without coercion or removal.
const offer = z.looseObject({ depotId: z.string(), depotName: z.string(), marketAdi: z.string(), price });
const evidence = z.array(z.looseObject({ productId: z.string(), offer }));
const basket = z.looseObject({
  complete: z.boolean(),
  total: price.nullable(),
  subtotal: price,
  lines: z.array(
    z.looseObject({
      productId: z.string(),
      title: z.string(),
      quantity: count,
      offer,
      lineTotal: price
    })
  ),
  missingProductIds: ids,
  requiresMultipleDepots: z.boolean()
});
export const outputSchemas = {
  status: outputSchema.extend({
    data: z
      .looseObject({
        mode: z.enum(['offline', 'live']),
        liveRequestsEnabled: z.boolean(),
        experimentalEndpointsEnabled: z.boolean(),
        currency: z.literal('TRY'),
        limits: z.looseObject({ basketItems: count, basketRequestBudget: z.literal(BASKET_REQUEST_BUDGET) }),
        requestPolicy: z.looseObject({ retries: count, minIntervalMs: count, scope: z.string() }),
        api: z.looseObject({
          endpointCount: count,
          experimentalEndpointCount: count,
          liveValidationPerformed: z.literal(false),
          liveValidationScope: z.literal('runtime-session'),
          releaseVerificationReference: z.string()
        })
      })
      .nullable()
  }),
  compareBasket: outputSchema.extend({
    data: z
      .looseObject({
        currency: z.literal('TRY'),
        groupBy: z.enum(['market', 'depot']),
        groups: z.array(basket.extend({ id: z.string() })),
        splitBasket: basket,
        missingProductIds: ids,
        outOfScopeOffers: evidence,
        unavailableOffers: evidence,
        scope: z.string(),
        excludedCosts: z.array(z.string()),
        warning: z.string()
      })
      .nullable()
  }),
  compareProduct: outputSchema.extend({
    data: z
      .looseObject({
        productId: z.string(),
        title: z.string(),
        currency: z.literal('TRY'),
        cheapestPrice: price.nullable(),
        highestPrice: price.nullable(),
        priceSpread: price.nullable(),
        cheapestDepotIds: ids,
        offers: z.array(offer.extend({ savingIfCheapest: price })),
        unavailableOffers: z.array(offer),
        outOfScopeOffers: evidence,
        scope: z.string()
      })
      .nullable()
  }),
  priceHistory: outputSchema.extend({
    data: z
      .looseObject({
        series: z.array(
          z.looseObject({
            name: z.string(),
            series: z.array(z.looseObject({ name: z.string(), value: price.nullable() }))
          })
        ),
        summary: z.array(
          z.looseObject({
            market: z.string(),
            points: count,
            availablePoints: count,
            missingPoints: count,
            from: z.string().nullable(),
            to: z.string().nullable(),
            first: price.nullable(),
            latest: price.nullable(),
            min: price.nullable(),
            max: price.nullable(),
            change: z.number().nullable(),
            changePercent: z.number().nullable()
          })
        ),
        dateFilterAppliedLocally: z.boolean()
      })
      .nullable()
  })
};
