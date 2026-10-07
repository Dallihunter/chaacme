import { html, safeUrl, cx } from '../html.js';
import { SITE, NAV_LINKS, loginHref } from '../site.js';

/**
 * The one site header.
 *
 *   variant  'site'            solid bar (default)
 *            'overlay'         transparent over a full-bleed hero (home); place it inside the hero
 *            'overlay-mobile'  solid on desktop, transparent over the hero on phones (experience page)
 *            'panel'           partner panel: wordmark + label + account link
 *            'admin'           dark bar for the admin
 *   active   key of the current NAV_LINKS entry
 *   next     where the login button should return to (only for the destinations in next.js)
 *   links    replaces NAV_LINKS (panel / admin); entries are { key, label, href, badge? }
 *   label    small text after the wordmark («پنل همکار», «ادمین»)
 *   authSlot render the login / «حساب من» slot (public pages); shell.js fills in the signed-in state
 *   extra    template output appended to the nav (admin: user name + logout)
 *
 * On phones the links collapse into a compact bar with a menu button. The menu is a
 * <details>, so it opens without JavaScript.
 */
export function header({ active = null, next = null, variant = 'site', links = NAV_LINKS, label = null, authSlot = true, extra = null, wide = false } = {}) {
  const items = links.map((l) => html`<a href="${safeUrl(l.href)}"${l.key && l.key === active ? html` aria-current="page"` : ''}>${l.label}${l.badge ? html` <span class="ck-badge ck-badge--pending ck-site-nav__badge">${l.badge}</span>` : ''}</a>`);
  const slot = authSlot
    ? html`<span class="ck-auth-slot" data-auth-slot><a href="${loginHref(next)}" class="ck-btn ck-btn--secondary ck-btn--sm" data-login-link>ورود</a></span>`
    : '';
  const classes = cx('ck-site-header', variant !== 'site' && `ck-site-header--${variant}`);
  return html`<header class="${classes}">
    <div class="ck-site-header__in${wide ? ' ck-site-header__in--wide' : ''}">
      <span class="ck-site-brand"><a href="/" class="ck-latin ck-site-logo">${SITE.name}</a>${label ? html`<span class="ck-site-label">${label}</span>` : ''}</span>
      <nav class="ck-site-nav" aria-label="ناوبری اصلی">${items}${slot}${extra}</nav>
      <details class="ck-menu">
        <summary class="ck-menu__btn" aria-label="منو"><span class="ck-menu__bars" aria-hidden="true"></span></summary>
        <nav class="ck-menu__panel" aria-label="ناوبری موبایل">${items}${slot}${extra}</nav>
      </details>
    </div>
  </header>`;
}
