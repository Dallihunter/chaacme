// The account screen (07): greeting, tabs (trips / reviews / partnership), name editing.
import { html } from '../html.js';
import { emptyState } from '../components/emptyState.js';
import { statusBadge } from '../components/statusBadge.js';
import { notice } from '../components/notice.js';
import { tripCard } from './booking.js';
import { textField } from './forms.js';
import { toFaDigits } from '../format.js';

const REVIEW_STATUS = { pending: ['pending', 'در انتظار بررسی'], published: ['active', 'منتشر شده'], rejected: ['rejected', 'منتشر نشد'] };
const APP_STATUS = { pending: ['pending', 'در انتظار بررسی'], approved: ['active', 'پذیرفته شد'], rejected: ['rejected', 'رد شد'] };
const KIND = { person: 'برگزارکننده', place: 'مکان' };

export const TABS = [['trips', 'سفرهای من'], ['reviews', 'نظرهای من'], ['partner', 'همکاری با چکمه']];

export function accountShell({ user, maskedPhone, tab }) {
  return html`<div class="ac">
    <div class="ac-head">
      <div><h1 class="ac-title">سلام، ${user.firstName}</h1>
        <p class="ac-sub">${maskedPhone ? html`<span class="ck-latin" dir="ltr">${maskedPhone}</span> · ` : ''}<button type="button" class="au-link" data-edit-toggle aria-expanded="false" aria-controls="ac-edit">ویرایش اطلاعات</button></p></div>
      <nav class="ac-tabs" aria-label="بخش‌های حساب">${TABS.map(([k, label]) => html`<button type="button" class="ac-tab" data-tab="${k}"${k === tab ? html` aria-current="true"` : ''}>${label}</button>`)}</nav>
    </div>
    <section class="ac-edit" id="ac-edit" hidden>
      <h2 class="ac-h2">اطلاعات من</h2>
      <p class="ac-note">این صفحه خصوصی است و برای کسی نمایش داده نمی‌شود. شمارهٔ موبایل و نام کاربری از اینجا قابل تغییر نیستند.</p>
      <form data-name-form novalidate>
        <div class="fm-grid">${textField({ id: 'firstName', label: 'نام', value: user.firstName, maxlength: 60, autocomplete: 'given-name' })}${textField({ id: 'lastName', label: 'نام خانوادگی', value: user.lastName, maxlength: 60, autocomplete: 'family-name' })}</div>
        <div class="fm-grid">${textField({ id: 'username', label: 'نام کاربری', value: user.username, ltr: true, readonly: true })}${textField({ id: 'phone', label: 'شمارهٔ موبایل', value: user.phone, ltr: true, readonly: true })}</div>
        ${notice({ tone: 'error', hidden: true })}
        <div class="ac-actions"><button type="submit" class="ck-btn ck-btn--primary" data-save>ذخیرهٔ نام</button><button type="button" class="ck-btn ck-btn--secondary" data-logout>خروج از حساب</button></div>
      </form>
    </section>
    <div class="ac-panel" data-panel="trips"></div>
    <div class="ac-panel" data-panel="reviews" hidden></div>
    <div class="ac-panel" data-panel="partner" hidden></div>
  </div>`;
}

export function tripsView(bookings) {
  if (!bookings.length) {
    return html`${emptyState({ title: 'هنوز تجربه‌ای رزرو نکرده‌اید' })}<p class="ac-center"><a class="ck-btn ck-btn--primary" href="/experiences">دیدن تجربه‌ها</a></p>`;
  }
  const up = bookings.filter((b) => b.upcoming);
  const past = bookings.filter((b) => !b.upcoming);
  const cover = (b) => (b.coverPath ? { path: b.coverPath, variants: [], width: 0, height: 0 } : null);
  const list = (items) => html`<div class="ac-trips">${items.map((b) => tripCard(b, cover(b)))}</div>`;
  return html`<section class="ac-sec"><h2 class="ac-h2">پیش‌رو</h2>${up.length ? list(up) : emptyState({ title: 'سفر پیش‌رویی ندارید' })}</section>
    ${past.length ? html`<section class="ac-sec"><h2 class="ac-h2">گذشته</h2>${list(past)}</section>` : ''}`;
}

export function reviewsView(reviews) {
  if (!reviews.length) return emptyState({ title: 'هنوز نظری ثبت نکرده‌اید' });
  return html`<ul class="ac-list">${reviews.map((r) => {
    const [kind, label] = REVIEW_STATUS[r.status] || REVIEW_STATUS.pending;
    const n = Math.max(0, Math.min(5, Number(r.rating) || 0));
    return html`<li class="ac-item"><div class="ac-item__top"><b>${r.tourTitle || ''}</b>${statusBadge(kind, label)}</div>
      <div class="tp-review__stars" role="img" aria-label="امتیاز ${toFaDigits(n)} از ۵">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</div><p class="ac-item__body">${r.body || ''}</p></li>`;
  })}</ul>`;
}

export function partnerView({ profiles, applications }) {
  if (!profiles.length && !applications.length) {
    return html`${emptyState({ title: 'هنوز درخواست همکاری نفرستاده‌اید' })}<p class="ac-center"><a class="ck-btn ck-btn--primary" href="/become-host">برگزارکننده یا میزبان شوید</a></p>`;
  }
  return html`${profiles.length ? html`<section class="ac-sec"><div class="ac-sec__head"><h2 class="ac-h2">پروفایل‌های من</h2><a class="ck-btn ck-btn--secondary" href="/partner">ورود به پنل همکار</a></div>
      <ul class="ac-list">${profiles.map((h) => html`<li class="ac-item"><div class="ac-item__top"><b>${h.displayName}</b><span class="ac-kind">${KIND[h.kind] || ''}</span>
        ${h.status === 'active' ? statusBadge('active', 'منتشر شده') : statusBadge('pending', 'هنوز منتشر نشده')}${h.verified ? statusBadge('verified', 'تأییدشده') : ''}</div>
        ${h.status === 'active' ? html`<a href="/host/${encodeURIComponent(h.slug)}">صفحهٔ عمومی</a>` : html`<p class="ac-item__body">این پروفایل تا زمانی که تیم چکمه آن را فعال کند روی سایت دیده نمی‌شود.</p>`}</li>`)}</ul></section>` : ''}
    ${applications.length ? html`<section class="ac-sec"><h2 class="ac-h2">درخواست‌ها</h2><ul class="ac-list">${applications.map((a) => {
    const [kind, label] = APP_STATUS[a.status] || APP_STATUS.pending;
    return html`<li class="ac-item"><div class="ac-item__top"><b>${a.name}</b><span class="ac-kind">${KIND[a.kind] || ''}</span>${statusBadge(kind, label)}</div><p class="ac-item__body">ارسال‌شده در ${toFaDigits(String(a.createdAt || '').slice(0, 10))}</p></li>`;
  })}</ul></section>` : ''}`;
}
