// Region keys a tour can carry. Adding a region = one line here (key, label,
// stamp colour class suffix) plus the matching `.ck-stamp--<tone>`, `.ck-photo--<tone>` and
// `.ex-dot--<tone>` rules in chaacme.css, the option in the admin's REGIONS list (deploy/admin-index.html,
// a plain script that cannot import this file) and the dot colour in pages/experiences.js; the server validates
// against this list. `tehran` is a city, not a landscape: its stamp uses the inverse tokens (ck-stamp--city).
export const REGIONS = {
  desert: { label: 'کویر', tone: 'desert' },
  forest: { label: 'جنگل شمال', tone: 'forest' },
  sea: { label: 'جزیره', tone: 'sea' },
  tehran: { label: 'تهران', tone: 'city' }
};

export const REGION_KEYS = Object.keys(REGIONS);
export const isRegion = (key) => typeof key === 'string' && Object.hasOwn(REGIONS, key);
export const regionInfo = (key) => (isRegion(key) ? { key, ...REGIONS[key] } : null);
