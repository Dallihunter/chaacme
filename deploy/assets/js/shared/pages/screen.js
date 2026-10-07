// The shell of a client-rendered screen (login, account, partner panel, …): the real header and footer,
// an empty #app that the screen's script fills with the SAME shared templates, and a no-JavaScript note.
// The shell itself holds no user data, so it is identical for everyone.
import { html, toHtmlString } from '../html.js';
import { documentHtml, pageFrame } from '../layout.js';

export const SCREENS = {
  login: { title: 'ورود', header: {}, mainClass: 'sc-main' },
  signup: { title: 'ثبت‌نام', header: {}, mainClass: 'sc-main' },
  account: { title: 'حساب من', header: {}, mainClass: 'sc-main sc-main--wide' },
  'become-host': { title: 'همکاری با چکمه', header: { active: 'become-host' }, mainClass: 'sc-main sc-main--wide' },
  'booking-result': { title: 'رزرو شما', header: {}, mainClass: 'sc-main' },
  partner: {
    title: 'پنل همکار',
    header: { variant: 'panel', label: 'پنل همکار', authSlot: false, wide: true, links: [{ key: 'account', label: 'حساب من', href: '/account' }] },
    mainClass: 'sc-main sc-main--panel', footer: false
  }
};

export function renderScreenShell(name, { assets, site = {} }) {
  const def = SCREENS[name];
  const main = html`<div id="app" class="sc-app" data-screen="${name}"><noscript><p class="sc-noscript">برای استفاده از این صفحه، جاوااسکریپت مرورگر باید روشن باشد.</p></noscript></div>`;
  const body = pageFrame({ main, mainClass: def.mainClass, site, headerOptions: def.header, withFooter: def.footer !== false });
  return toHtmlString(documentHtml({ title: `${def.title} — CHAACME`, robots: 'noindex, nofollow', assets, body }));
}
