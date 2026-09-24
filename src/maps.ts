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
