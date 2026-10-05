// The two pages every visitor can land on by accident: not found and "something broke".
import { html, toHtmlString } from '../html.js';
import { emptyState } from '../components/emptyState.js';
import { documentHtml, pageFrame } from '../layout.js';

function errorPage({ title, heading, text, linkLabel, href, assets, site }) {
  const main = html`${emptyState({ title: heading, text })}<a class="ck-btn ck-btn--primary ck-btn--block" href="${href}">${linkLabel}</a>`;
  const body = pageFrame({ main, mainClass: 'tp-main tp-404', headerOptions: {}, site });
  return toHtmlString(documentHtml({ title: `${title} — CHAACME`, robots: 'noindex', assets, body }));
}

/** 404. `what` names the thing that was not found («این تجربه», «این مکان», «این صفحه»). */
export function renderNotFoundPage({ assets, site = {}, what = 'این صفحه', linkLabel = 'بازگشت به صفحهٔ اول', href = '/' } = {}) {
  return errorPage({
    title: `${what} پیدا نشد`, heading: `${what} پیدا نشد`,
    text: 'ممکن است نشانی اشتباه باشد یا این صفحه دیگر منتشر نشده باشد.', linkLabel, href, assets, site
  });
}

/** Generic 500. No detail about what failed is ever shown. */
export function renderErrorPage({ assets, site = {} }) {
  return errorPage({
    title: 'خطا', heading: 'مشکلی پیش آمد',
    text: 'لطفاً چند لحظهٔ دیگر دوباره تلاش کنید.', linkLabel: 'بازگشت به صفحهٔ اول', href: '/', assets, site
  });
}
