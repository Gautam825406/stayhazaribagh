// StayHazaribagh — approximate "Near Me" distances.
// No listing carries GPS coordinates, so distance is APPROXIMATE: each known
// locality is mapped to its rough centre (publicly known town geography) and
// the haversine distance from the user's position is shown as "~X km".
// Unknown localities fall back to their city centre. Never presented as exact.

export interface LatLng {
  lat: number
  lng: number
}

export const CITY_CENTRES: Record<string, LatLng> = {
  Hazaribagh: { lat: 23.992, lng: 85.361 },
  Ranchi: { lat: 23.352, lng: 85.324 },
}

/** Approximate centre of each locality (degrees). */
export const LOCALITY_COORDS: Record<string, LatLng> = {
  // Hazaribagh
  Matwari: { lat: 23.995, lng: 85.365 },
  Korrah: { lat: 23.985, lng: 85.375 },
  Babugaon: { lat: 24.005, lng: 85.35 },
  'Near VBU': { lat: 24.005, lng: 85.39 },
  'Jhanda Chowk': { lat: 23.992, lng: 85.361 },
  Hirabag: { lat: 23.988, lng: 85.355 },
  Ompuri: { lat: 23.998, lng: 85.37 },
  // Ranchi
  Lalpur: { lat: 23.365, lng: 85.325 },
  Bariatu: { lat: 23.385, lng: 85.345 },
  'Kanke Road': { lat: 23.4, lng: 85.31 },
  Harmu: { lat: 23.355, lng: 85.3 },
  Doranda: { lat: 23.335, lng: 85.315 },
  'Ashok Nagar': { lat: 23.36, lng: 85.335 },
  Argora: { lat: 23.35, lng: 85.29 },
  Kokar: { lat: 23.375, lng: 85.335 },
  Morabadi: { lat: 23.395, lng: 85.325 },
  Kadru: { lat: 23.34, lng: 85.31 },
}

export function localityCoords(locality: string, city: string): LatLng {
  return LOCALITY_COORDS[locality] ?? CITY_CENTRES[city] ?? CITY_CENTRES.Hazaribagh
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Approx distance in km from the user to a listing's locality, 1 decimal. */
export function approxDistanceKm(userLoc: LatLng, locality: string, city: string): number {
  return Math.round(haversineKm(userLoc, localityCoords(locality, city)) * 10) / 10
}
