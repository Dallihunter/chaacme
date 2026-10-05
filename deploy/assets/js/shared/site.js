// Where the shared header and footer point. Only destinations that exist are
// listed; footer entries for the legal/info pages are added by the footer only
// when their body has been written (see components/footer.js and server/settings.js).
export const SITE = {
  name: 'chaacme',
  tagline: 'تجربه‌هایی که از آدم‌ها و مکان‌ها ساخته می‌شوند.'
};

export const NAV_LINKS = [
  { key: 'experiences', label: 'تجربه‌ها', href: '/experiences' },
  { key: 'places', label: 'مکان‌ها', href: '/places' },
  { key: 'become-host', label: 'همکاری با چکمه', href: '/become-host' }
];

/** The four text pages. `setting` is the site_settings key holding the body. */
export const INFO_PAGES = [
  { key: 'about', path: '/about', label: 'درباره چکمه', setting: 'page_about' },
  { key: 'terms', path: '/terms', label: 'قوانین و مقررات', setting: 'page_terms' },
  { key: 'refund', path: '/refund', label: 'شرایط استرداد', setting: 'page_refund' },
  { key: 'privacy', path: '/privacy', label: 'حریم خصوصی', setting: 'page_privacy' },
  // structured instead of free text: phone, e-mail, address, hours (settings contact_*); see settings.contactDetails()
  { key: 'contact', path: '/contact', label: 'تماس با ما', setting: null }
];

/** The login screen lives at /login; `next` brings the visitor back to a page afterwards (see next.js for what is allowed). */
export const loginHref = (next) => (next ? `/login?next=${encodeURIComponent(next)}` : '/login');

const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
/** Instagram profile URL for a stored bare handle; null when there is no usable handle. */
export const instagramUrl = (handle) => (typeof handle === 'string' && HANDLE.test(handle) ? `https://instagram.com/${handle}` : null);

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** Persian / Arabic-Indic digits -> ASCII. */
export const asciiDigits = (v) => String(v).replace(/[۰-۹٠-٩]/g, (d) => { const i = PERSIAN_DIGITS.indexOf(d); return String(i >= 0 ? i : ARABIC_DIGITS.indexOf(d)); });

/** tel: link for a phone number as typed ("۰۲۱ ۱۲۳۴ ۵۶۷۸", "+98 21 …"); null unless it is 5-15 digits with an optional leading +. */
export function telHref(phone) {
  const t = asciiDigits(phone || '').replace(/[\s\-().]/g, '');
  return /^\+?[0-9]{5,15}$/.test(t) ? `tel:${t}` : null;
}

const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
export const isEmail = (v) => typeof v === 'string' && v.length <= 100 && EMAIL.test(v);
/** mailto: link; null for anything that is not a plain address. */
export const mailHref = (email) => (isEmail(email) ? `mailto:${email}` : null);
