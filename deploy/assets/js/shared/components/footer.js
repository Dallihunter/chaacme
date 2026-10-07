import { html, safeUrl } from '../html.js';
import { SITE } from '../site.js';

/**
 * Site footer. `links` comes from the server (server/settings.js siteContext()):
 * [{ label, href }] where every href is a page that exists. Nothing is invented here.
 */
export function footer({ links = [] } = {}) {
  return html`<footer class="ck-site-footer">
    <div class="ck-site-footer__in">
      <div>
        <div class="ck-latin ck-site-footer__logo">${SITE.name}</div>
        <p class="ck-site-footer__tag">${SITE.tagline}</p>
      </div>
      ${links.length ? html`<nav class="ck-site-footer__nav" aria-label="پیوندهای پایین صفحه">
        ${links.map((l) => html`<a href="${safeUrl(l.href)}"${/^https?:/.test(l.href) ? html` rel="noopener"` : ''}>${l.label}</a>`)}
      </nav>` : ''}
    </div>
  </footer>`;
}
