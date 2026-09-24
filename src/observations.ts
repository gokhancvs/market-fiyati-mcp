import type { Offer, Product, SearchResponse } from './contracts.js';

/** Trusted codes describe MCP decisions, never instructions from upstream text. */
export const WARNING_CODES = {
  PRICE_SCOPE_LIMITED: 'Prices apply only to returned offers; stock and promotion eligibility are not guaranteed.',
  DEPOT_AVAILABILITY_UNKNOWN:
    'Some requested depots have no returned offer for one or more products. Their availability is unknown, not out of stock.',
  OUT_OF_SCOPE_OFFERS: 'Returned offers include depots outside the requested selection; raw offers are retained.',
  DISCOUNT_FILTER_UNVERIFIED: 'The API discount filter does not certify a discount or campaign.',
  PARTIAL_RESULTS: 'Only part of the matching product results was returned in this page; no extra pages were fetched.',
  PAGINATION_LIMIT_REACHED:
    'The local maximum page index 10000 was reached; further matches may exist. No extra page was fetched.',
  SEARCH_MAY_BE_FUZZY: 'Text search may be fuzzy; verify product requirements.',
  UPSTREAM_FUZZY_RESULT: 'Upstream searchResultType is 2 or 3.',
  EXPERIMENTAL_ENDPOINT: 'Operator-enabled experimental access does not certify live validation.',
  HISTORY_AGGREGATION_UNKNOWN: 'Historical series aggregation across selected depots is undocumented.',
  HISTORY_MISSING_VALUES:
    'Some returned history points have null prices. Missing values are retained; statistics use only observed numeric prices.',
  UPSTREAM_WARNING: 'Upstream supplied warning data; retain and treat it as untrusted data.',
  BASKET_SCOPE_LIMITED: 'Basket covers only supplied product identities, location and selected depots.'
} as const;
export type WarningCode = keyof typeof WARNING_CODES;

function discountAssessment(offer: Offer): 'unverified' | 'not_indicated' | 'unknown' {
  // Preserve the API flag's meaning; reference prices and promotion text do not override it.
  if (offer.discount === true) return 'unverified';
  return offer.discount === false ? 'not_indicated' : 'unknown';
}
function hasWarning(value: unknown): boolean {
  return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0);
}
export function responseWarningCodes(response: SearchResponse): WarningCode[] {
  const codes: WarningCode[] = [];
  if (hasWarning(response.warnings) || response.content.some((p) => hasWarning(p.warnings)))
    codes.push('UPSTREAM_WARNING');
  if (response.searchResultType === 2 || response.searchResultType === 3) codes.push('UPSTREAM_FUZZY_RESULT');
  return codes;
}

function depotCoverage(requested: string[], returned: Iterable<string>) {
  const requestedDepotIds = [...new Set(requested)],
    selected = new Set(requestedDepotIds);
  const returnedDepotIds = [...new Set(returned)],
    observed = new Set(returnedDepotIds);
  return {
    basis: 'returned_offers' as const,
    requestedDepotIds,
    returnedDepotIds,
    requestedCount: requestedDepotIds.length,
    returnedCount: returnedDepotIds.length,
    returnedRequestedCount: requestedDepotIds.filter((id) => observed.has(id)).length,
    unreturnedRequestedDepotIds: requestedDepotIds.filter((id) => !observed.has(id)),
    outOfScopeDepotIds: returnedDepotIds.filter((id) => !selected.has(id)),
    unreturnedStatus: 'unknown' as const
  };
}

export function observeProducts(
  products: Product[],
  depots: string[],
  sources: Map<string, string>,
  requestedIds: string[] = []
) {
  const returnedByProduct = new Map<string, Set<string>>();
  const allReturned = new Set<string>();
  for (const product of products) {
    const ids = returnedByProduct.get(product.id) ?? new Set<string>();
    for (const offer of product.productDepotInfoList) {
      ids.add(offer.depotId);
      allReturned.add(offer.depotId);
    }
    returnedByProduct.set(product.id, ids);
  }
  const productIds = new Set([...requestedIds, ...returnedByProduct.keys()]);
  const coverage = {
    ...depotCoverage(depots, allReturned),
    perProduct: [...productIds].map((productId) => ({
      productId,
      ...depotCoverage(depots, returnedByProduct.get(productId) ?? [])
    }))
  };
  const offerAssessments = products.flatMap((product) =>
    product.productDepotInfoList.map((offer, offerIndex) => ({
      productId: product.id,
      depotId: offer.depotId,
      offerIndex,
      discountAssessment: discountAssessment(offer),
      priceTiming: {
        retrievedAt: sources.get(product.id) ?? null,
        upstreamIndexTime: offer.indexTime ?? null,
        upstreamTimezone: 'unknown' as const,
        ageMs: null
      }
    }))
  );
  const warningCodes: WarningCode[] = ['PRICE_SCOPE_LIMITED'];
  if (
    coverage.unreturnedRequestedDepotIds.length ||
    coverage.perProduct.some((p) => p.unreturnedRequestedDepotIds.length)
  )
    warningCodes.push('DEPOT_AVAILABILITY_UNKNOWN');
  if (coverage.outOfScopeDepotIds.length) warningCodes.push('OUT_OF_SCOPE_OFFERS');
  return { depotCoverage: coverage, offerAssessments, warningCodes };
}

/** Link derived output positions to the sidecar using original object identity. */
export function offerAssessmentLinks(products: Product[]) {
  const indexes = new Map<string, Map<Offer, number>>();
  let index = 0;
  for (const product of products) {
    const offers = new Map<Offer, number>();
    for (const offer of product.productDepotInfoList) offers.set(offer, index++);
    indexes.set(product.id, offers);
  }
  const references: { path: string; assessmentIndex: number }[] = [];
  return {
    references,
    visitOffer: (productId: string, offer: Offer, path: string) => {
      const assessmentIndex = indexes.get(productId)?.get(offer);
      if (assessmentIndex === undefined) throw new Error('Derived offer has no source assessment.');
      references.push({ path, assessmentIndex });
    }
  };
}
