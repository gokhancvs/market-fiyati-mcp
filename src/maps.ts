import type { Product } from './contracts.js';

export type MapLinks = { google: string; apple: string; yandex: string };

// Use branch coordinates only. Missing coordinates must never point at the user.
export function mapLinks(latitude: unknown, longitude: unknown): MapLinks | null {
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const latLon = `${latitude},${longitude}`,
    lonLat = `${longitude},${latitude}`;
  return {
    google: `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: latLon })}`,
    apple: `https://maps.apple.com/?${new URLSearchParams({ ll: latLon, q: latLon })}`,
    yandex: `https://yandex.com/maps/?${new URLSearchParams({ ll: lonLat, pt: lonLat, z: '16' })}`
  };
}

/**
 * One entry per depot in the offers. An entry is null unless every offer of that depot has the same valid
 * coordinates, so an inconsistent response never points at a guessed place.
 */
export function depotMaps(products: Product[]): Record<string, MapLinks | null> {
  const entries = new Map<string, MapLinks | null>();
  for (const product of products)
    for (const offer of product.productDepotInfoList) {
      const links = mapLinks(offer.latitude, offer.longitude);
      if (!entries.has(offer.depotId)) entries.set(offer.depotId, links);
      else if (JSON.stringify(entries.get(offer.depotId)) !== JSON.stringify(links)) entries.set(offer.depotId, null);
    }
  // fromEntries defines own properties, so a "__proto__" depot id stays an ordinary key.
  return Object.fromEntries(entries);
}
