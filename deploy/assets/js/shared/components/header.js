import { html, safeUrl } from '../html.js';
import { SITE, NAV_LINKS, loginHref } from '../site.js';

/** Site header. `active` is a NAV_LINKS key; `next` is where the login button should return to. */
export function header({ active = null, next = null } = {}) {
  return html`<header class="ck-site-header">
    <div class="ck-site-header__in">
      <a href="/" class="ck-latin ck-site-logo">${SITE.name}</a>
      <nav class="ck-site-nav" aria-label="ناوبری اصلی">
        ${NAV_LINKS.map((l) => html`<a href="${safeUrl(l.href)}"${l.key === active ? html` aria-current="page"` : ''}>${l.label}</a>`)}
        <a href="${loginHref(next)}" class="ck-btn ck-btn--secondary" data-login-link>ورود</a>
      </nav>
    </div>
  </header>`;
}
