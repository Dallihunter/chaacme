// Region keys a tour can carry. Adding a region = one line here (key, label,
// stamp colour class suffix) plus the matching `.ck-stamp--<key>` and
// `.ck-photo--<key>` rules in chaacme.css; the server validates against this list.
export const REGIONS = {
  desert: { label: 'کویر', tone: 'desert' },
  forest: { label: 'جنگل شمال', tone: 'forest' },
  sea: { label: 'جزیره', tone: 'sea' }
};

export const REGION_KEYS = Object.keys(REGIONS);
export const isRegion = (key) => typeof key === 'string' && Object.hasOwn(REGIONS, key);
export const regionInfo = (key) => (isRegion(key) ? { key, ...REGIONS[key] } : null);
