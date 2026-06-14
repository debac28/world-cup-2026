// Geo helpers for the Watch Together tab — no deps.
// A zip is turned into a lat/lng via the free, no-key zippopotam.us API; "use my location"
// uses the browser geolocation API (works worldwide, unlike US-only zips). Distances are
// great-circle miles, good enough to sort venues by "nearest".

// Turn a US zip code into a coordinate + a human label. Throws on an unknown zip.
export async function geocodeZip(zip) {
  const clean = String(zip).trim()
  if (!/^\d{5}$/.test(clean)) throw new Error('Enter a 5-digit US zip code')
  const res = await fetch(`https://api.zippopotam.us/us/${clean}`)
  if (!res.ok) throw new Error("Couldn't find that zip")
  const data = await res.json()
  const p = data.places?.[0]
  if (!p) throw new Error("Couldn't find that zip")
  const state = p['state abbreviation'] || p.state || ''
  return {
    lat: +p.latitude,
    lng: +p.longitude,
    label: `${clean} · ${p['place name']}${state ? ', ' + state : ''}`,
  }
}

// Forward-geocode a free-text street address via Photon (komoot). Photon runs on
// OpenStreetMap data, so it's worldwide, keyless, and CORS-friendly — unlike geocodeZip,
// which is US-only. Used by the Watch tab's "host at my place" flow to validate the typed
// address and build a tidy invite line + map link. Throws if nothing matches.
export async function geocodeAddress(query) {
  const q = String(query).trim()
  if (q.length < 4) throw new Error('Enter a street address')
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`)
  if (!res.ok) throw new Error("Couldn't find that address")
  const data = await res.json()
  const f = data.features?.[0]
  const [lng, lat] = f?.geometry?.coordinates || []
  if (lat == null || lng == null) throw new Error("Couldn't find that address")
  // International results are often partial — build the label defensively so a sparse hit
  // still reads cleanly instead of "undefined, undefined".
  const p = f.properties || {}
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const label = [
    street || p.name,
    p.city || p.town || p.village || p.county,
    p.state,
    p.country,
  ]
    .filter(Boolean)
    .join(', ')
  return { lat: +lat, lng: +lng, label: label || q }
}

// Resolve the device's current position. Rejects if denied/unavailable.
export function getMyLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location not available on this device'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'your location' }),
      () => reject(new Error('Location permission denied')),
      { timeout: 8000, maximumAge: 60000 },
    )
  })
}

// Great-circle distance in miles between two {lat,lng} points (haversine).
export function haversineMiles(a, b) {
  const R = 3958.8 // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
