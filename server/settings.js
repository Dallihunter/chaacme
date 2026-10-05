// Site-wide content the admin edits (home page copy, footer, the four info pages).
// siteContext() is what every server-rendered page needs for its footer.
import { INFO_PAGES, instagramUrl } from '../deploy/assets/js/shared/site.js';

/** { footerLinks: [{ label, href }] } — only destinations that exist. */
export function siteContext() {
  const footerLinks = [{ label: 'همکاری با چکمه', href: '/become-host' }];
  void INFO_PAGES; void instagramUrl;
  return { footerLinks };
}
