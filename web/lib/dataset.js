// Static dataset access. One ZIP3 shard per lookup (~3 KB gzip); the 2.3 MB
// search index is fetched lazily and only when a search actually needs it.

const shardCache = new Map();
let buildPromise = null;
let indexPromise = null;

export function build() {
  buildPromise ??= fetch('./data/BUILD.json').then((r) => r.json());
  return buildPromise;
}

export async function getZip(zip) {
  const key = String(zip).trim();
  if (!/^\d{5}$/.test(key)) return { zip: key, record: null, invalid: true };
  const shardKey = key.slice(0, 3);
  if (!shardCache.has(shardKey)) {
    shardCache.set(
      shardKey,
      fetch(`./data/zips/${shardKey}.json`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
    );
  }
  const shard = await shardCache.get(shardKey);
  return { zip: key, record: shard[key] ?? null, invalid: false };
}

/** The slim index: one row per ZIP, null where the source has no value. */
export function searchIndex() {
  indexPromise ??= fetch('./data/index/search-index.json').then((r) => r.json());
  return indexPromise;
}

const R_EARTH_MI = 3958.8;
export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_MI * Math.asin(Math.sqrt(a));
}
