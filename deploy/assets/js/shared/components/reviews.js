import { html } from '../html.js';
import { emptyState } from './emptyState.js';
import { formatDateRangeFa, toFaDigits } from '../format.js';

/**
 * «نظر مسافران»: the published reviews, or the designed empty state.
 * reviews: { count, average, items: [{ displayName, rating, body, createdAt, tourTitle? }] }
 */
export function reviewsSection(reviews, { emptyText = 'نظرها فقط از مسافرانی می‌آیند که این تجربه را رفته‌اند.' } = {}) {
  const r = reviews;
  return html`<section class="tp-sec"><div class="ck-section-head" style="margin-bottom:0"><h2>نظر مسافران</h2></div>
    ${r.items.length ? html`
      ${r.average != null ? html`<p class="tp-rev-sum">${toFaDigits(String(r.average).replace('.', '٫'))} از ۵ · ${toFaDigits(r.count)} نظر</p>` : ''}
      <ul class="tp-reviews">${r.items.map((x) => html`<li class="tp-review"><div class="tp-review__head"><span class="tp-review__name">${x.displayName}</span><span class="tp-review__stars" role="img" aria-label="امتیاز ${toFaDigits(x.rating)} از ۵">${'★'.repeat(x.rating)}${'☆'.repeat(5 - x.rating)}</span></div><p class="tp-review__body">${x.body}</p>${x.tourTitle ? html`<span class="tp-review__date">دربارهٔ ${x.tourTitle}</span>` : ''}${formatDateRangeFa(x.createdAt) ? html`<span class="tp-review__date">${formatDateRangeFa(x.createdAt)}</span>` : ''}</li>`)}</ul>`
    : emptyState({ title: 'هنوز نظری ثبت نشده', text: emptyText })}
  </section>`;
}
