// Progressive enhancement for the server-rendered experience page.
// The page is complete without this file: it adds the gallery lightbox, the
// share button, the sticky-bar jump and the booking card. No innerHTML anywhere:
// every value from the page or the API is written with textContent / attributes.
import { formatNumberFa, toFaDigits } from '/assets/js/shared/format.js';
import { initLightbox } from '/assets/js/lightbox.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --------------------------------------------------------------------- share
function initShare() {
  const btn = $('[data-share]');
  if (!btn) return;
  const canShare = typeof navigator.share === 'function';
  const canCopy = navigator.clipboard && typeof navigator.clipboard.writeText === 'function';
  if (!canShare && !canCopy) return;
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    const data = { title: document.title, url: location.href };
    try {
      if (canShare) await navigator.share(data);
      else await navigator.clipboard.writeText(location.href);
    } catch { /* cancelled */ }
  });
}

// ------------------------------------------------------------- sticky -> card
function initJump() {
  const link = $('[data-jump-booking]');
  const card = $('#booking');
  if (!link || !card) return;
  link.addEventListener('click', (e) => {
    e.preventDefault();
    card.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    const target = $('input[name="edition"]:checked', card) || $('button, input, select', card);
    if (target) target.focus({ preventScroll: true });
  });
}

// ------------------------------------------------------------------- booking
function initBooking() {
  const form = $('[data-booking]');
  if (!form) return;
  const tourId = form.dataset.tour;
  const price = Number(form.dataset.price) || 0;
  const maxGuests = Number(form.dataset.maxGuests) || 8;
  const guests = $('[data-guests]', form);
  const total = $('[data-total]', form);
  const submit = $('[data-submit]', form);
  const errorBox = $('.ck-notice--error', form);
  const errorText = errorBox && $('[data-notice-text]', errorBox);
  const radios = $$('input[name="edition"]', form);
  let busy = false;

  const selected = () => radios.find((r) => r.checked) || null;

  function showError(message) {
    if (!errorBox) return;
    errorText.textContent = message;
    errorBox.hidden = false;
  }
  const clearError = () => { if (errorBox) errorBox.hidden = true; };

  function syncGuests() {
    const r = selected();
    const max = Math.max(1, Math.min(maxGuests, r ? Number(r.dataset.available) || 1 : 1));
    const keep = Math.min(Number(guests.value) || 1, max);
    guests.replaceChildren();
    for (let n = 1; n <= max; n++) {
      const o = document.createElement('option');
      o.value = String(n); o.textContent = `${toFaDigits(n)} نفر`;
      if (n === keep) o.selected = true;
      guests.append(o);
    }
    syncTotal();
  }
  function syncTotal() { if (total) total.textContent = `${formatNumberFa(price * (Number(guests.value) || 1))} تومان`; }
  function syncSelection() {
    radios.forEach((r) => r.closest('.tp-ed').classList.toggle('is-selected', r.checked));
  }

  radios.forEach((r) => r.addEventListener('change', () => { syncSelection(); syncGuests(); clearError(); }));
  guests.addEventListener('change', () => { syncTotal(); clearError(); });

  const loginUrl = () => `/login?next=${encodeURIComponent(location.pathname)}`;
  async function call(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    return { status: res.status, data: data || {} };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const edition = selected();
    if (!edition) { showError('یکی از تاریخ‌ها را انتخاب کنید.'); return; }
    busy = true; submit.disabled = true; clearError();
    try {
      const me = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (me.status === 401) { location.assign(loginUrl()); return; }

      const booking = await call('/bookings', { tourId, tourDateId: Number(edition.value), guests: Number(guests.value) });
      if (booking.status === 401) { location.assign(loginUrl()); return; }
      if (booking.status !== 201) {
        showError(booking.data.error === 'online_booking_disabled' || booking.data.error === 'online_booking_unavailable'
          ? 'رزرو آنلاین فعلاً فعال نیست.'
          : booking.data.error === 'not_enough_seats' || booking.data.error === 'date_in_past'
          ? 'ظرفیت این تاریخ تکمیل شده است. لطفاً تاریخ دیگری انتخاب کنید.'
          : booking.status === 429 ? 'تعداد تلاش‌ها زیاد شده است. کمی بعد دوباره تلاش کنید.'
            : 'ثبت رزرو انجام نشد. لطفاً دوباره تلاش کنید.');
        return;
      }
      const pay = await call('/payments/zarinpal/request', { bookingId: booking.data.booking.id });
      const url = pay.status === 200 && typeof pay.data.redirectUrl === 'string' ? pay.data.redirectUrl : '';
      if (!/^https?:\/\//.test(url)) { showError('اتصال به درگاه پرداخت ممکن نشد. لطفاً دوباره تلاش کنید.'); return; }
      location.assign(url);
    } catch {
      showError('ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کنید.');
    } finally {
      busy = false; submit.disabled = false;
    }
  });

  syncSelection();
}

initLightbox();
initShare();
initJump();
initBooking();
