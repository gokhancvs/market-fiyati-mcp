import type { Category, History, Offer, Product } from './contracts.js';
import { toCents as cents, fromCents as money } from './money.js';

const available = (offer: Offer) => Number.isFinite(offer.price) && offer.price > 0 && cents(offer.price) > 0;
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Visit original offers at their final output paths, before clones lose identity. */
type OfferVisitor = (productId: string, offer: Offer, path: string) => void;
export function compareOffers(product: Product, visitOffer?: OfferVisitor, selectedDepots?: ReadonlySet<string>) {
  const eligible = product.productDepotInfoList.filter((o) => !selectedDepots || selectedDepots.has(o.depotId));
  const outOfScopeOffers = product.productDepotInfoList
    .filter((o) => selectedDepots && !selectedDepots.has(o.depotId))
    .map((offer) => ({ productId: product.id, offer }));
  const offers = eligible
    .filter(available)
    .slice()
    .sort((a, b) => cents(a.price) - cents(b.price));
  const low = offers[0] ? cents(offers[0].price) : null;
  const high = offers.at(-1) ? cents(offers.at(-1)!.price) : null;
  const result = {
    productId: product.id,
    title: product.title,
    currency: 'TRY',
    cheapestPrice: low === null ? null : money(low),
    highestPrice: high === null ? null : money(high),
    priceSpread: low === null || high === null ? null : money(high - low),
    cheapestDepotIds: offers.filter((o) => cents(o.price) === low).map((o) => o.depotId),
    offers: offers.map((o) => ({
      ...o,
      savingIfCheapest: money(cents(o.price) - (low ?? 0))
    })),
    unavailableOffers: eligible.filter((o) => !available(o)),
    outOfScopeOffers,
    scope:
      'Only returned offers in selected depots; not every branch or guaranteed stock. Zero prices are treated as unavailable.'
  };
  if (visitOffer) {
    outOfScopeOffers.forEach((entry, i) =>
      visitOffer(entry.productId, entry.offer, `/data/outOfScopeOffers/${i}/offer`)
    );
    offers.forEach((offer, i) => visitOffer(product.id, offer, `/data/offers/${i}`));
    result.unavailableOffers.forEach((offer, i) => visitOffer(product.id, offer, `/data/unavailableOffers/${i}`));
  }
  return result;
}
type BasketItem = { id: string; quantity: number };
type BasketLine = {
  productId: string;
  title: string;
  quantity: number;
  offer: Offer;
  lineTotal: number;
};
export function compareBasket(
  items: BasketItem[],
  products: Product[],
  groupBy: 'market' | 'depot',
  visitOffer?: OfferVisitor,
  selectedDepots?: ReadonlySet<string>
) {
  const byId = new Map(products.map((p) => [p.id, p]));
  type Minimum = {
    price: number;
    byDepot: Map<string, Offer>;
    fallback: Offer;
  };
  type Choices = Map<string, Minimum>;
  const groups = new Map<string, Choices>(),
    split = new Map<string, Minimum>();
  const outOfScopeOffers: { productId: string; offer: Offer }[] = [];
  const unavailableOffers: typeof outOfScopeOffers = [];
  const add = (choices: Choices, id: string, offer: Offer, price: number) => {
    let minimum = choices.get(id);
    if (!minimum || price < minimum.price) {
      minimum = { price, byDepot: new Map(), fallback: offer };
      choices.set(id, minimum);
    }
    if (price !== minimum.price) return;
    // Retain the first duplicate at a tied depot, matching stable sorting.
    if (!minimum.byDepot.has(offer.depotId)) minimum.byDepot.set(offer.depotId, offer);
    if (compareIds(offer.depotId, minimum.fallback.depotId) < 0) minimum.fallback = offer;
  };
  for (const item of items)
    for (const offer of byId.get(item.id)?.productDepotInfoList ?? []) {
      if (selectedDepots && !selectedDepots.has(offer.depotId)) {
        outOfScopeOffers.push({ productId: item.id, offer });
        continue;
      }
      const key = groupBy === 'market' ? offer.marketAdi : offer.depotId;
      let choices = groups.get(key);
      if (!choices) {
        choices = new Map();
        groups.set(key, choices);
      }
      if (!available(offer)) {
        unavailableOffers.push({ productId: item.id, offer });
        continue;
      }
      const price = cents(offer.price);
      add(choices, item.id, offer, price);
      add(split, item.id, offer, price);
    }
  const calculate = (indexed: Choices) => {
    const lines: BasketLine[] = [];
    const missingProductIds: string[] = [];
    let subtotal = 0;
    const found = items.flatMap((item) => {
      const minimum = indexed.get(item.id);
      return minimum ? [minimum] : [];
    });
    // Set membership avoids rescanning all tied offers for each candidate depot.
    let commonDepot: string | undefined;
    if (found.length)
      for (const depot of found[0]!.byDepot.keys())
        if (
          (commonDepot === undefined || compareIds(depot, commonDepot) < 0) &&
          found.every((minimum) => minimum.byDepot.has(depot))
        )
          commonDepot = depot;
    for (const item of items) {
      const product = byId.get(item.id),
        minimum = indexed.get(item.id);
      const offer = commonDepot === undefined ? minimum?.fallback : minimum?.byDepot.get(commonDepot);
      if (!product || !offer || !minimum) {
        missingProductIds.push(item.id);
        continue;
      }
      const lineCents = minimum.price * item.quantity;
      subtotal += lineCents;
      lines.push({
        productId: item.id,
        title: product.title,
        quantity: item.quantity,
        offer,
        lineTotal: money(lineCents)
      });
    }
    return {
      complete: missingProductIds.length === 0,
      total: missingProductIds.length ? null : money(subtotal),
      subtotal: money(subtotal),
      lines,
      missingProductIds,
      requiresMultipleDepots: new Set(lines.map((l) => l.offer.depotId)).size > 1
    };
  };
  const results = [...groups]
    .map(([id, choices]) => ({ id, ...calculate(choices) }))
    .sort(
      (a, b) =>
        Number(b.complete) - Number(a.complete) ||
        b.lines.length - a.lines.length ||
        a.subtotal - b.subtotal ||
        compareIds(a.id, b.id)
    );
  const splitBasket = calculate(split);
  if (visitOffer) {
    outOfScopeOffers.forEach((entry, i) =>
      visitOffer(entry.productId, entry.offer, `/data/outOfScopeOffers/${i}/offer`)
    );
    unavailableOffers.forEach((entry, i) =>
      visitOffer(entry.productId, entry.offer, `/data/unavailableOffers/${i}/offer`)
    );
    results.forEach((group, i) =>
      group.lines.forEach((line, j) => visitOffer(line.productId, line.offer, `/data/groups/${i}/lines/${j}/offer`))
    );
    splitBasket.lines.forEach((line, i) =>
      visitOffer(line.productId, line.offer, `/data/splitBasket/lines/${i}/offer`)
    );
  }
  return {
    currency: 'TRY',
    groupBy,
    groups: results,
    splitBasket,
    outOfScopeOffers,
    unavailableOffers,
    missingProductIds: items.filter((i) => !byId.has(i.id)).map((i) => i.id),
    scope:
      groupBy === 'market'
        ? 'Cheapest offer per item within each chain; may require multiple branches.'
        : 'Every group is one physical depot.',
    excludedCosts: ['travel', 'delivery', 'membership conditions'],
    warning:
      'Incomplete baskets have total=null; subtotal only includes available items. Product availability is not guaranteed.'
  };
}
export function summarizeHistory(history: History, from?: string, to?: string) {
  const series = history.map((market) => ({
    ...market,
    series: market.series
      .filter((p) => (!from || p.name >= from) && (!to || p.name <= to))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  }));
  return {
    series,
    summary: series.map((market) => {
      // Keep gaps in the returned timeline, but never treat missing prices as zero.
      const available = market.series.filter(
        (point): point is typeof point & { value: number } => point.value !== null
      );
      const first = available[0],
        last = available.at(-1);
      let min: number | null = null,
        max: number | null = null;
      for (const point of available) {
        min = min === null ? point.value : Math.min(min, point.value);
        max = max === null ? point.value : Math.max(max, point.value);
      }
      const baseline = first ? cents(first.value) : null;
      const differenceCents = last && baseline !== null ? cents(last.value) - baseline : null;
      const difference = differenceCents === null ? null : money(differenceCents);
      return {
        market: market.name,
        points: market.series.length,
        availablePoints: available.length,
        missingPoints: market.series.length - available.length,
        from: first?.name ?? null,
        to: last?.name ?? null,
        first: first?.value ?? null,
        latest: last?.value ?? null,
        min,
        max,
        change: difference,
        changePercent:
          baseline !== null && baseline > 0 && differenceCents !== null
            ? Math.round((differenceCents / baseline) * 10000) / 100
            : null
      };
    }),
    dateFilterAppliedLocally: !!(from || to)
  };
}
export function filterCategories(
  categories: Category[],
  options: {
    query?: string | undefined;
    parentId?: number | undefined;
    flat: boolean;
  }
): Category[] {
  const find = (nodes: Category[]): Category | undefined => {
    for (const node of nodes) {
      if (node.id === options.parentId) return node;
      const found = find(node.children);
      if (found) return found;
    }
    return undefined;
  };
  const root = options.parentId === undefined ? categories : (find(categories)?.children ?? []);
  const query = options.query?.toLocaleLowerCase('tr-TR');
  if (options.flat) {
    const result: Category[] = [];
    const walk = (nodes: Category[], path: string[]) => {
      for (const node of nodes) {
        const next = [...path, node.name];
        if (!query || node.name.toLocaleLowerCase('tr-TR').includes(query))
          result.push({ ...node, children: [], path: next });
        walk(node.children, next);
      }
    };
    walk(root, []);
    return result;
  }
  if (!query) return root;
  const filter = (nodes: Category[]): Category[] =>
    nodes.flatMap((node) => {
      if (node.name.toLocaleLowerCase('tr-TR').includes(query)) return [node];
      const children = filter(node.children);
      return children.length ? [{ ...node, children }] : [];
    });
  return filter(root);
}
