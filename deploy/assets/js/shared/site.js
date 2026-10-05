// Where the shared header and footer point. Only destinations that exist today
// are listed: «مکان‌ها» (places listing), the refund policy and the privacy page
// have no page yet and join this list in the phase that builds them.
export const SITE = {
  name: 'chaacme',
  tagline: 'تجربه‌هایی که از آدم‌ها و مکان‌ها ساخته می‌شوند.',
  instagramUrl: 'https://instagram.com/chaacme'
};

export const NAV_LINKS = [
  { key: 'experiences', label: 'تجربه‌ها', href: '/' },
  { key: 'become-host', label: 'همکاری با چکمه', href: '/become-host' }
];

export const FOOTER_LINKS = [
  { label: 'همکاری با چکمه', href: '/become-host' },
  { label: 'اینستاگرام', href: SITE.instagramUrl }
];

/** The SPA owns /login; `next` brings the visitor back to a server-rendered page afterwards. */
export const loginHref = (next) => (next ? `/login?next=${encodeURIComponent(next)}` : '/login');
