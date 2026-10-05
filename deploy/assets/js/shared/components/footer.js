import { html, safeUrl } from '../html.js';
import { SITE, FOOTER_LINKS } from '../site.js';

export function footer() {
  return html`<footer class="ck-site-footer">
    <div class="ck-site-footer__in">
      <div>
        <div class="ck-latin ck-site-footer__logo">${SITE.name}</div>
        <p class="ck-site-footer__tag">${SITE.tagline}</p>
      </div>
      <nav class="ck-site-footer__nav" aria-label="پیوندهای پایین صفحه">
        ${FOOTER_LINKS.map((l) => html`<a href="${safeUrl(l.href)}"${/^https?:/.test(l.href) ? html` rel="noopener"` : ''}>${l.label}</a>`)}
      </nav>
    </div>
  </footer>`;
}
