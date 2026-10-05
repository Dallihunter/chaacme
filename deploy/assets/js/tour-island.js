// Progressive enhancement for the server-rendered experience page.
// The page is complete without this file: it adds the gallery lightbox, the
// share button, the sticky-bar jump and the booking card. No innerHTML anywhere:
// every value from the page or the API is written with textContent / attributes.
import { formatNumberFa, toFaDigits } from '/assets/js/shared/format.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ lightbox
function initLightbox() {
  const links = $$('[data-lb]');
  if (!links.length || typeof HTMLDialogElement === 'undefined') return;
  const items = links.map((a) => ({ src: a.dataset.lbSrc || a.href, alt: a.dataset.lbAlt || '', caption: a.dataset.lbCaption || '' }));
  let dialog = null; let img; let cap; let count; let index = 0; let opener = null;

  const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function build() {
    dialog = make('dialog', 'tp-lb');
    dialog.setAttribute('aria-label', 'گالری عکس‌ها');
    const fig = make('figure', 'tp-lb__fig');
    img = document.createElement('img');
    cap = make('figcaption', 'tp-lb__cap');
    fig.append(img, cap);
    const mk = (cls, label, glyph, fn) => { const b = make('button', `tp-lb__btn ${cls}`, glyph); b.type = 'button'; b.setAttribute('aria-label', label); b.addEventListener('click', fn); return b; };
    count = make('span', 'tp-lb__count');
    dialog.append(fig, mk('tp-lb__close', 'بستن', '×', () => dialog.close()), mk('tp-lb__prev', 'عکس قبلی', '›', () => show(index - 1)), mk('tp-lb__next', 'عکس بعدی', '‹', () => show(index + 1)), count);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { if (opener) opener.focus(); });
    dialog.addEventListener('keydown', (e) => {
      // RTL: the "next" arrow points left
      if (e.key === 'ArrowLeft') show(index + 1);
      else if (e.key === 'ArrowRight') show(index - 1);
    });
    document.body.append(dialog);
  }

  function show(i) {
    index = (i + items.length) % items.length;
    const it = items[index];
    img.src = it.src; img.alt = it.alt;
    cap.textContent = it.caption; cap.hidden = !it.caption;
    count.textContent = `${toFaDigits(index + 1)} / ${toFaDigits(items.length)}`;
  }

  function open(i, from) {
    if (!dialog) build();
    opener = from || null;
    show(i);
    if (!dialog.open) dialog.showModal();
  }

  links.forEach((a, i) => a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); open(i, a);
  }));
  const all = $('[data-lb-open]');
  if (all) all.addEventListener('click', (e) => { e.preventDefault(); open(0, all); });
}

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
        showError(booking.data.error === 'not_enough_seats' || booking.data.error === 'date_in_past'
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
