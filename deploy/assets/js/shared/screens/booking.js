// How a booking is shown: the status badge, the account trip card, the payment-result page.
import { html } from '../html.js';
import { statusBadge } from '../components/statusBadge.js';
import { notice } from '../components/notice.js';
import { photo } from '../components/photo.js';
import { formatDateRangeFa, formatNumberFa, toFaDigits } from '../format.js';

/** { kind, label } for the status badge of a booking row (payment_status first, then the admin's status). */
export function bookingStatus(b) {
  if (b.status === 'cancelled') return { kind: 'hidden', label: 'لغو شده' };
  switch (b.paymentStatus) {
    case 'paid': return { kind: 'active', label: 'پرداخت‌شده' };
    case 'paid_no_capacity': return { kind: 'rejected', label: 'پرداخت شد، ظرفیت تکمیل بود' };
    case 'failed': return { kind: 'rejected', label: 'پرداخت ناموفق' };
    case 'canceled': return { kind: 'hidden', label: 'لغو شده' };
    default: return { kind: 'pending', label: 'در انتظار پرداخت' };
  }
}

export const editionText = (b) => formatDateRangeFa(b.startsOn, b.endsOn) || b.dateLabel || '';

/** The trip card on the account page. `b` is a row of GET /api/bookings/me; `cover` an optional described image. */
export function tripCard(b, cover) {
  const st = bookingStatus(b);
  const when = editionText(b);
  const meta = [when, `${toFaDigits(b.guests)} نفر`].filter(Boolean).join(' · ');
  return html`<article class="ac-trip">
    ${cover ? html`<div class="ac-trip__media">${photo(cover, { alt: b.tourTitle, sizes: '(max-width: 720px) 100vw, 360px' })}</div>` : ''}
    <div class="ac-trip__body">
      <div class="ac-trip__top">${statusBadge(st.kind, st.label)}<span class="ac-trip__ref">کد رزرو <span class="ck-latin">${b.ref}</span></span></div>
      <h3 class="ac-trip__title">${b.tourTitle}</h3>
      <p class="ac-trip__meta">${meta}</p>
      <div class="ac-trip__foot"><span class="ck-num">${formatNumberFa(b.total)} <small>تومان</small></span><a class="ck-btn ck-btn--secondary" href="/booking/result?ref=${encodeURIComponent(b.ref)}">جزئیات رزرو</a></div>
    </div>
  </article>`;
}

const RESULT_NOTICE = {
  paid: { tone: 'success', title: 'رزرو شما ثبت شد', text: 'پرداخت با موفقیت انجام شد.' },
  pending: { tone: 'pending', title: 'پرداخت هنوز تأیید نشده', text: 'اگر مبلغی از حساب شما کسر شده، چند دقیقه صبر کنید و این صفحه را دوباره باز کنید.' },
  failed: { tone: 'error', title: 'پرداخت انجام نشد', text: 'پرداخت تکمیل یا تأیید نشد. می‌توانید دوباره تلاش کنید.' },
  paid_no_capacity: { tone: 'error', title: 'پرداخت شما ثبت شد، اما ظرفیت این تاریخ تکمیل شده بود', text: 'برای پیگیری با پشتیبانی چکمه تماس بگیرید و کد رزرو را اعلام کنید.' },
  canceled: { tone: 'pending', title: 'این رزرو لغو شده است', text: null },
  // an old, still pending booking while the site-wide online booking switch is off: it is never confirmed or paid
  online_off: { tone: 'pending', title: 'رزرو آنلاین فعلاً فعال نیست', text: 'این رزرو تأیید نشده است و پرداختی برای آن ثبت نمی‌شود.' }
};

/** `onlineOpen`: whether an online booking can be made right now (false while the switch is off); only a pending booking changes. */
export function resultNotice(b, { onlineOpen = true } = {}) {
  const key = b.status === 'cancelled' ? 'canceled' : (b.paymentStatus === 'pending' && !onlineOpen ? 'online_off' : b.paymentStatus);
  const n = RESULT_NOTICE[key] || RESULT_NOTICE.pending;
  return notice({ tone: n.tone, title: n.title, text: n.text });
}

/**
 * The payment-result page body for one real booking. `onlineOpen` is the API's `onlineBookingOpen`: while it is false the
 * page does not offer "try again" and a pending booking says that online booking is off.
 */
export function resultView(b, { onlineOpen = true } = {}) {
  const st = bookingStatus(b);
  const paid = b.paymentStatus === 'paid' && b.status !== 'cancelled';
  const retry = onlineOpen && !paid && b.tourPublic && b.status !== 'cancelled' && b.paymentStatus !== 'paid_no_capacity';
  const rows = [
    ['تجربه', html`<a href="/tour/${encodeURIComponent(b.tourSlug)}">${b.tourTitle}</a>`],
    ['تاریخ اجرا', editionText(b) || null],
    ['تعداد نفرات', `${toFaDigits(b.guests)} نفر`],
    ['مبلغ', html`<span class="ck-num">${formatNumberFa(b.total)} تومان</span>`],
    ['وضعیت', statusBadge(st.kind, st.label)],
    ['کد رزرو', html`<span class="ck-latin">${b.ref}</span>`]
  ].filter(([, v]) => v);
  return html`<div class="au-card br-card"><h1 class="au-title">رزرو شما</h1>
    ${resultNotice(b, { onlineOpen })}
    <dl class="br-list">${rows.map(([k, v]) => html`<div class="br-row"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
    <div class="br-actions">
      ${retry ? html`<a class="ck-btn ck-btn--primary" href="/tour/${encodeURIComponent(b.tourSlug)}">تلاش دوباره برای رزرو</a>` : ''}
      <a class="ck-btn ${retry ? 'ck-btn--secondary' : 'ck-btn--primary'}" href="/account">سفرهای من</a>
    </div></div>`;
}

/** Shown for an unknown ref, someone else's ref, or a malformed one: the same words for all three. */
export function resultNotFound(message = null) {
  return html`<div class="au-card br-card"><h1 class="au-title">رزرو پیدا نشد</h1>
    ${notice({ tone: 'error', title: message || 'رزروی با این کد برای حساب شما پیدا نشد', text: null })}
    <div class="br-actions"><a class="ck-btn ck-btn--primary" href="/account">سفرهای من</a><a class="ck-btn ck-btn--secondary" href="/experiences">دیدن تجربه‌ها</a></div></div>`;
}

export function resultGatewayError() {
  return html`<div class="au-card br-card"><h1 class="au-title">پرداخت تکمیل نشد</h1>
    ${notice({ tone: 'error', title: 'بازگشت از درگاه پرداخت با خطا روبه‌رو شد', text: 'اگر مبلغی از حساب شما کسر شده، با پشتیبانی چکمه تماس بگیرید.' })}
    <div class="br-actions"><a class="ck-btn ck-btn--primary" href="/account">سفرهای من</a></div></div>`;
}

