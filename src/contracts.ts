import { z } from 'zod';
import { AppError } from './errors.js';
import {
  invalidResponse,
  responseArray,
  responseJson,
  responseObject,
  responseRecord,
  responseValue
} from './response-validation.js';

export const API_ORIGIN = 'https://api.marketfiyati.org.tr';
export const MAP_ORIGIN = 'https://harita.marketfiyati.org.tr';
export type Endpoint = {
  method: 'GET' | 'POST';
  path: string;
  experimental: boolean;
  origin: string;
};
export const endpoints = {
  categories: {
    method: 'GET',
    path: '/api/v3/info/categories',
    experimental: false,
    origin: API_ORIGIN
  },
  search: {
    method: 'POST',
    path: '/api/v2/search',
    experimental: false,
    origin: API_ORIGIN
  },
  searchByCategories: {
    method: 'POST',
    path: '/api/v3/searchByCategories',
    experimental: false,
    origin: API_ORIGIN
  },
  product: {
    method: 'POST',
    path: '/api/v2/searchByIdentity',
    experimental: false,
    origin: API_ORIGIN
  },
  similar: {
    method: 'POST',
    path: '/api/v2/searchSimilarProduct',
    experimental: false,
    origin: API_ORIGIN
  },
  priceHistory: {
    method: 'POST',
    path: '/api/v3/price-history',
    experimental: false,
    origin: API_ORIGIN
  },
  nearest: {
    method: 'POST',
    path: '/api/v2/nearest',
    experimental: true,
    origin: API_ORIGIN
  },
  markets: {
    method: 'GET',
    path: '/api/v1/categories',
    experimental: true,
    origin: API_ORIGIN
  },
  alternative: {
    method: 'POST',
    path: '/api/v2/searchAlternative',
    experimental: true,
    origin: API_ORIGIN
  },
  sync: {
    method: 'POST',
    path: '/api/v1/list/sync',
    experimental: true,
    origin: API_ORIGIN
  },
  geocode: {
    method: 'GET',
    path: '/Service/api/v1/AutoSuggestion/Search',
    experimental: true,
    origin: MAP_ORIGIN
  },
  reverseGeocode: {
    method: 'GET',
    path: '/Service/api/v1/ReverseGeocode',
    experimental: true,
    origin: MAP_ORIGIN
  }
} as const satisfies Record<string, Endpoint>;
export type EndpointId = keyof typeof endpoints;

const text = z.string().trim().min(1).max(300);
const id = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}_-]+$/u);
const strings = z.array(text).max(100);
const uniqueIds = z
  .array(id)
  .min(1)
  .max(500)
  .refine((a) => new Set(a).size === a.length, 'IDs must be unique');
export const locationShape = {
  latitude: z.number().min(-90).max(90).describe('Explicit user-selected latitude.'),
  longitude: z.number().min(-180).max(180).describe('Explicit longitude.'),
  distance: z.number().positive().max(50).default(1).describe('Search radius in km. 50 is a local safety limit.')
};
const contextShape = {
  ...locationShape,
  depots: uniqueIds.describe('Selected branch IDs from nearest; required and never auto-expanded.')
};
export const MAX_PAGE_INDEX = 10000;
const pageShape = {
  pages: z.number().int().min(0).max(MAX_PAGE_INDEX).default(0).describe('Zero-based API page.'),
  size: z.number().int().min(1).max(100).default(25).describe('Page size, local maximum 100.')
};
const priceRange = text.refine((v) => {
  if (/^\d+(?:\.\d{1,2})?(?:\+|-\*)$/.test(v)) return true;
  const m = /^(\d+(?:\.\d{1,2})?)-(\d+(?:\.\d{1,2})?)$/.exec(v);
  return !!m && Number(m[1]) <= Number(m[2]);
}, 'Use low-high, low-* or low+, e.g. 10-50 or 100-*');
const filterShape = {
  menu_category: strings.optional(),
  main_category: strings.optional(),
  sub_category: strings.optional(),
  market_names: strings.optional(),
  brand: strings.optional(),
  refined_quantity_unit: strings.optional(),
  refined_volume_weight: strings.optional(),
  offer_price: z.array(priceRange).max(20).optional(),
  offer_discount: z
    .array(z.literal('true'))
    .max(1)
    .optional()
    .describe(
      'API discount filter ["true"]; matching does not override each offer\'s discount flag or confirm campaign eligibility. Preserve false or absent flags and separate reference-price fields. Omit to include all products.'
    ),
  order: z
    .strictObject({
      name: z.enum(['lowest_price', 'offer_unit_price']),
      type: z.enum(['asc', 'desc'])
    })
    .optional()
};
const categoryFilters = z.strictObject({
  ...contextShape,
  ...pageShape,
  ...filterShape
});
export const basketItemSchema = z.strictObject({
  id,
  quantity: z.number().int().min(1).max(50)
});
// Local per-call HTTP attempt budget, not an upstream rate-limit guarantee.
export const BASKET_REQUEST_BUDGET = 5;
export const basketItemsSchema = z
  .array(basketItemSchema)
  .min(1)
  .max(BASKET_REQUEST_BUDGET)
  .refine((items) => new Set(items.map((i) => i.id)).size === items.length, 'Combine duplicate product IDs first');
const date = z.iso.date();
export const schemas = {
  categories: z.strictObject({
    query: text.optional(),
    parentId: z.number().int().nonnegative().optional(),
    flat: z.boolean().default(false)
  }),
  search: z.strictObject({
    ...contextShape,
    ...pageShape,
    ...filterShape,
    keywords: text
  }),
  searchByCategories: categoryFilters.refine(
    (v) => !!(v.menu_category?.length || v.main_category?.length || v.sub_category?.length),
    'At least one category name is required'
  ),
  product: z.strictObject({
    ...contextShape,
    identity: id,
    identityType: z.literal('id').default('id'),
    pages: z.literal(0).default(0),
    size: z.literal(1).default(1)
  }),
  similar: z.strictObject({
    ...contextShape,
    ...pageShape,
    id,
    keywords: text
  }),
  priceHistory: z
    .strictObject({
      ...contextShape,
      uniqueId: id,
      from: date.optional(),
      to: date.optional()
    })
    .refine((v) => !v.from || !v.to || v.from <= v.to, 'from must not be after to'),
  nearest: z.strictObject(locationShape),
  markets: z.strictObject({}),
  alternative: z
    .strictObject({
      ...contextShape,
      ...pageShape,
      id,
      keywords: text,
      marketName: id
    })
    .refine(
      (v) => v.depots.every((d) => d.startsWith(`${v.marketName}-`)),
      'Alternative depots must belong to marketName'
    ),
  sync: z.strictObject({
    ...contextShape,
    identities: uniqueIds.refine((v) => v.length <= 100, 'Maximum 100 products')
  }),
  geocode: z.strictObject({
    words: text.describe('Address/place text; encoded as a query parameter.')
  }),
  reverseGeocode: z.strictObject({
    latitude: locationShape.latitude,
    longitude: locationShape.longitude
  }),
  compareProduct: z.strictObject({ ...contextShape, identity: id }),
  compareBasket: z.strictObject({
    ...contextShape,
    items: basketItemsSchema,
    groupBy: z.enum(['market', 'depot']).default('market')
  }),
  status: z.strictObject({})
};
export type Operation = keyof typeof schemas;

export const offerSchema = responseObject({
  depotId: responseValue(z.string()),
  depotName: responseValue(z.string()),
  marketAdi: responseValue(z.string().refine((value) => value.trim().length > 0)),
  price: responseValue(z.number().nonnegative()),
  unitPrice: responseValue(z.string()).optional(),
  unitPriceValue: responseValue(z.number().nonnegative()).optional(),
  latitude: responseValue(z.number()).optional(),
  longitude: responseValue(z.number()).optional(),
  indexTime: responseValue(z.string()).optional(),
  percentage: responseValue(z.number()).optional(),
  discount: responseValue(z.boolean()).optional(),
  discountlessPrice: responseValue(z.number().nonnegative()).nullable().optional(),
  discountRatio: responseValue(z.number()).nullable().optional(),
  promotionText: responseValue(z.string()).nullable().optional()
});
export const productSchema = responseObject({
  id: responseValue(z.string()),
  title: responseValue(z.string()),
  brand: responseValue(z.string()).optional(),
  imageUrl: responseValue(z.string()).optional(),
  refinedVolumeOrWeight: responseValue(z.string()).optional(),
  refinedQuantityUnit: responseValue(z.string()).optional(),
  menu_category: responseValue(z.string()).optional(),
  main_category: responseValue(z.string()).optional(),
  sub_category: responseValue(z.string()).optional(),
  categories: responseArray(responseValue(z.string())).optional(),
  productDepotInfoList: responseArray(offerSchema)
});
export type Offer = z.infer<typeof offerSchema>;
export type Product = z.infer<typeof productSchema>;
export const searchResponseSchema = responseObject({
  numberOfFound: responseValue(z.number().int().nonnegative()),
  searchResultType: responseValue(z.number().int()),
  content: responseArray(productSchema),
  facetMap: responseRecord(responseArray(responseJson)).nullable().optional()
}).transform((data) => {
  if (data.numberOfFound < data.content.length) return invalidResponse();
  return data;
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type Category = {
  id: number;
  parentId: number | null;
  name: string;
  children: Category[];
  [key: string]: unknown;
};
const categorySchema: z.ZodType<Category> = z.lazy(() =>
  responseObject({
    id: responseValue(z.number().int()),
    parentId: responseValue(z.number().int()).nullable(),
    name: responseValue(z.string()),
    children: responseArray(categorySchema)
  })
);
export const historySchema = responseArray(
  responseObject({
    name: responseValue(z.string()),
    series: responseArray(
      responseObject({
        name: responseValue(date),
        value: responseValue(z.number().nonnegative()).nullable()
      })
    )
  })
);
export type History = z.infer<typeof historySchema>;
const responseSchemas: Record<EndpointId, z.ZodType> = {
  categories: responseObject({ content: responseArray(categorySchema) }),
  search: searchResponseSchema,
  searchByCategories: searchResponseSchema,
  product: searchResponseSchema,
  similar: searchResponseSchema,
  alternative: searchResponseSchema,
  sync: searchResponseSchema,
  priceHistory: historySchema,
  nearest: responseArray(
    responseObject({
      id: responseValue(z.string()),
      marketName: responseValue(z.string()),
      sellerName: responseValue(z.string()).optional(),
      distance: responseValue(z.number()),
      location: responseObject({
        lat: responseValue(z.number()),
        lon: responseValue(z.number())
      })
    })
  ),
  markets: responseObject({
    content: responseArray(
      responseObject({
        marketAdi: responseValue(z.string()),
        name: responseValue(z.string()).optional(),
        isActive: responseValue(z.boolean()).optional()
      })
    )
  }),
  geocode: responseArray(responseArray(responseJson, 9)),
  reverseGeocode: responseRecord(responseJson)
};
export function validateResponse(endpoint: EndpointId, data: unknown): unknown {
  try {
    const result = responseSchemas[endpoint].safeParse(data);
    if (!result.success) return invalidResponse();
    return result.data;
  } catch (error) {
    if (error instanceof AppError && error.code === 'INVALID_RESPONSE')
      throw new AppError('INVALID_RESPONSE', 'Upstream response does not match the expected contract.', { endpoint });
    throw error;
  }
}
