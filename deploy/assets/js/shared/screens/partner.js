// The partner panel (08). Templates only; behaviour is in screens/partner.js.
import { html } from '../html.js';
import { notice } from '../components/notice.js';
import { statusBadge } from '../components/statusBadge.js';
import { emptyState } from '../components/emptyState.js';
import { photo } from '../components/photo.js';
import { textField, selectField } from './forms.js';
import { toFaDigits } from '../format.js';

export const KIND = { person: 'شخص', place: 'مکان' };
const STATUS = { active: ['active', 'فعال'], hidden: ['hidden', 'پنهان'] };
const ROLE = { lead: 'برگزارکننده', co_host: 'همراه برگزارکننده', venue: 'محل برگزاری' };
const PHASE = { upcoming: 'پیشِ رو', past: 'برگزار شده', undated: 'تاریخ مشخص نشده' };
const PROPOSAL = { new: ['pending', 'جدید'], in_discussion: ['pending', 'در حال گفتگو'], accepted: ['active', 'پذیرفته شد'], declined: ['rejected', 'در این مرحله ممکن نشد'] };
export const COUNTERPART = { none: 'فرقی نمی‌کند', person: 'یک برگزارکننده', place: 'یک مکان' };

/** An upload still waiting for review is previewed through an authenticated route; the stored id stays the logical path. */
const PENDING = /^\/images\/host-([a-z0-9-]+)\/pending\/([A-Za-z0-9_-][A-Za-z0-9_.-]*)$/;
export const imageSrc = (path) => { const m = PENDING.exec(path || ''); return m ? `/api/partner/profiles/${m[1]}/pending/${m[2]}` : path; };
const img = (path, alt = '') => (path ? photo({ path: imageSrc(path), variants: [], width: 0, height: 0 }, { alt }) : null);

export function layout({ profiles, current = null, section, body }) {
  const cur = profiles.find((p) => p.slug === current) || profiles[0] || null;
  const link = (key, href, label, attrs = '') => html`<a href="${href}"${section === key ? html` aria-current="page"` : ''}>${label}</a>`;
  return html`<div class="pp">
    <nav class="pp-side" aria-label="پنل همکار">
      <div class="pp-group"><span class="ck-field__label">پروفایل‌های من</span>
        ${profiles.map((p) => html`<a class="pp-prof${cur && p.slug === cur.slug ? ' is-current' : ''}" href="/partner/profile/${encodeURIComponent(p.slug)}">
          <span class="pp-prof__media${p.kind === 'person' ? ' is-round' : ''}">${p.photoPath ? img(p.photoPath) : html`<span aria-hidden="true">${String(p.displayName || '').trim().charAt(0)}</span>`}</span>
          <span class="pp-prof__txt"><b>${p.displayName}</b><span>${KIND[p.kind] || ''} · ${(STATUS[p.status] || STATUS.hidden)[1]}${p.hasPendingRevision ? ' · در انتظار بررسی' : ''}</span></span></a>`)}
      </div>
      <div class="pp-links">
        ${cur ? link('profile', `/partner/profile/${encodeURIComponent(cur.slug)}`, 'ویرایش پروفایل') : ''}
        ${link('experiences', '/partner/experiences', 'تجربه‌های من')}
        ${link('propose', '/partner/propose', 'پیشنهاد یک تجربه')}
        ${cur && cur.status === 'active' ? html`<a href="/host/${encodeURIComponent(cur.slug)}">مشاهدهٔ صفحهٔ عمومی ↗</a>` : ''}
      </div>
    </nav>
    <div class="pp-main" id="pp-main">${body}</div>
  </div>`;
}

export function message(text, linkHref = null, linkLabel = null) {
  return html`<div class="pp-sec"><p class="pp-p">${text}</p>${linkHref ? html`<p><a class="ck-btn ck-btn--primary" href="${linkHref}">${linkLabel}</a></p>` : ''}</div>`;
}

export function noProfiles({ pending }) {
  return html`<div class="pp pp--solo"><div class="pp-main">${pending.length
    ? html`<div class="pp-sec"><h1 class="pp-title">پنل همکار</h1>${notice({ tone: 'pending', title: 'درخواست شما در حال بررسی است', text: 'بعد از تأیید تیم چکمه، پروفایل شما اینجا ظاهر می‌شود.' })}
      <ul class="ac-list">${pending.map((a) => html`<li class="ac-item"><div class="ac-item__top"><b>${a.name}</b><span class="ac-kind">${KIND[a.kind] || ''}</span>${statusBadge('pending', 'در حال بررسی')}</div><p class="ac-item__body">ارسال‌شده در ${toFaDigits(String(a.createdAt || '').slice(0, 10))}</p></li>`)}</ul></div>`
    : html`<div class="pp-sec"><h1 class="pp-title">پنل همکار</h1><p class="pp-p">پنل همکار برای برگزارکنندگان و میزبانانی است که پروفایلشان توسط چکمه ساخته شده است. هنوز پروفایلی به حساب شما وصل نیست.</p></div>`}
    <p><a class="ck-btn ck-btn--primary" href="/become-host">درخواست همکاری با چکمه</a></p></div></div>`;
}

export function dashboardBody({ profiles, applications }) {
  const pend = applications.filter((a) => a.status === 'pending');
  return html`<div class="pp-head"><h1 class="pp-title">پروفایل‌های من</h1></div>
    <div class="pp-cards">${profiles.map((h) => {
    const [k, l] = STATUS[h.status] || STATUS.hidden;
    return html`<section class="pp-sec"><div class="pp-sec__top"><h2 class="pp-h2">${h.displayName}</h2>${statusBadge(k, l)}<span class="ac-kind">${KIND[h.kind] || ''}</span>${h.verified ? statusBadge('verified', 'تأییدشده') : ''}${h.hasPendingRevision ? statusBadge('pending', 'تغییرات در انتظار بازبینی') : ''}</div>
      ${h.status !== 'active' ? html`<p class="pp-p">این پروفایل تا زمانی که تیم چکمه آن را فعال کند روی سایت دیده نمی‌شود.</p>` : ''}
      <div class="pp-actions"><a class="ck-btn ck-btn--primary" href="/partner/profile/${encodeURIComponent(h.slug)}">ویرایش پروفایل</a>${h.status === 'active' ? html`<a class="ck-btn ck-btn--secondary" href="/host/${encodeURIComponent(h.slug)}">صفحهٔ عمومی</a>` : ''}</div></section>`;
  })}</div>
    ${pend.length ? html`<section class="pp-sec"><h2 class="pp-h2">درخواست‌های در حال بررسی</h2><ul class="ac-list">${pend.map((a) => html`<li class="ac-item"><div class="ac-item__top"><b>${a.name}</b><span class="ac-kind">${KIND[a.kind] || ''}</span>${statusBadge('pending', 'در حال بررسی')}</div></li>`)}</ul></section>` : ''}`;
}

// ---------------------------------------------------------------- profile editor
const changedKeys = (profile, pending) => {
  const out = new Set();
  if (!pending) return out;
  for (const [k, v] of Object.entries(pending.payload || {})) if (JSON.stringify(v ?? null) !== JSON.stringify(profile[k] ?? null)) out.add(k);
  return out;
};

/** The chips editor body: the chips, an input and the add button. Re-rendered by the screen on every change. */
export function chipsView(name, items, { max, placeholder = '' }) {
  return html`<div class="ck-chips">${items.map((t, i) => html`<span class="ck-chip">${t} <button class="ck-chip__remove" type="button" data-chip-remove="${name}" data-i="${i}" aria-label="حذف ${t}">×</button></span>`)}</div>
    ${items.length < max ? html`<div class="pp-chipadd"><input class="ck-input" type="text" data-chip-input="${name}" maxlength="40" placeholder="${placeholder}" aria-label="افزودن"><button type="button" class="ck-chip ck-chip--add" data-chip-add="${name}">+ افزودن</button></div>` : ''}`;
}

/** Main photo + gallery manager. state: { photoPath, gallery: [{photoPath, caption, alt}] }; place = gallery allowed. */
export function galleryView(state, { place, slug }) {
  const main = state.photoPath;
  return html`<div class="pp-gal">
    ${main ? html`<figure class="pp-tile pp-tile--main"><div class="pp-tile__img">${img(main, '')}<span class="ck-badge pp-tile__badge">عکس اصلی</span></div>
      <div class="pp-tile__row"><button type="button" class="ck-btn ck-btn--ghost" data-photo-remove>حذف</button></div></figure>` : ''}
    ${place ? state.gallery.map((g, i) => html`<figure class="pp-tile"><div class="pp-tile__img">${img(g.photoPath, '')}</div>
      <input class="ck-input pp-tile__cap" type="text" value="${g.caption || ''}" maxlength="120" data-cap="${i}" aria-label="زیرنویس عکس ${toFaDigits(i + 1)}" placeholder="زیرنویس کوتاه">
      <div class="pp-tile__row"><button type="button" class="ck-btn ck-btn--ghost" data-main="${i}">عکس اصلی</button>
        <button type="button" class="ck-btn ck-btn--ghost" data-up="${i}" aria-label="بالا"${i === 0 ? html` disabled` : ''}>↑</button>
        <button type="button" class="ck-btn ck-btn--ghost" data-down="${i}" aria-label="پایین"${i === state.gallery.length - 1 ? html` disabled` : ''}>↓</button>
        <button type="button" class="ck-btn ck-btn--ghost" data-del="${i}" aria-label="حذف">×</button></div></figure>`) : ''}
    ${!main || (place && state.gallery.length < 24) ? html`<label class="pp-add"><span class="pp-add__plus" aria-hidden="true">+</span><span>${main && place ? 'افزودن عکس' : (main ? 'تغییر عکس' : (place ? 'افزودن عکس' : 'افزودن عکس'))}</span><small>JPG، PNG یا WebP تا ۵ مگابایت</small>
      <input type="file" accept="image/jpeg,image/png,image/webp" ${place ? html`multiple ` : ''}data-upload class="ck-visually-hidden"></label>` : ''}
  </div>
  <p class="ck-field__help" data-gallery-msg role="status"></p>
  <span class="ck-field__error" data-error="media" hidden></span><span class="ck-field__error" data-error="photoPath" hidden></span>`;
}

export function profileBody({ view, state, chips }) {
  const prof = view.profile; const pending = view.pendingRevision; const last = view.lastReview;
  const place = prof.kind === 'place';
  const src = pending ? { ...prof, ...pending.payload } : prof;
  const ch = changedKeys(prof, pending);
  const [sk, sl] = STATUS[prof.status] || STATUS.hidden;
  const banner = pending
    ? notice({ tone: 'pending', title: 'یک نسخهٔ در انتظار بررسی داری', text: `تغییرات ارسال‌شده در ${toFaDigits(String(pending.createdAt || '').slice(0, 10))} منتظر تأیید است. صفحهٔ عمومی تا تأیید همان نسخهٔ قبلی است.`,
      actions: html`<button class="ck-btn ck-btn--ghost" type="button" data-withdraw>پس گرفتن</button>` })
    : last && last.status === 'rejected'
      ? notice({ tone: 'error', title: 'آخرین تغییرات شما پذیرفته نشد', text: last.adminNote || null })
      : notice({ text: 'هر تغییری که ذخیره کنید ابتدا توسط تیم چکمه بازبینی می‌شود و بعد روی صفحهٔ عمومی منتشر می‌شود.' });
  const f = (key, props) => textField({ ...props, changed: ch.has(key) });
  return html`<div class="pp-head">
      <div><div class="pp-head__title"><h1 class="pp-title">${prof.displayName}</h1>${statusBadge(sk, sl)}${prof.verified ? statusBadge('verified', 'تأییدشده') : ''}</div>
        <p class="pp-sub">${KIND[prof.kind] || ''}</p></div>
      <div class="pp-actions">${prof.status === 'active' ? html`<a class="ck-btn ck-btn--secondary" href="/host/${encodeURIComponent(prof.slug)}">صفحهٔ عمومی</a>` : ''}<button type="submit" form="pf-form" class="ck-btn ck-btn--primary" data-submit>ارسال برای بررسی</button></div>
    </div>
    ${banner}
    <form id="pf-form" data-profile-form novalidate autocomplete="off">
      <section class="pp-sec"><h2 class="pp-h2">${place ? 'گالری' : 'عکس'}</h2>
        <p class="pp-p">${place ? 'عکس اصلی بالای صفحهٔ عمومی دیده می‌شود. برای هر عکس یک زیرنویس کوتاه بنویسید.' : 'عکس شما روی صفحهٔ عمومی و کارت‌ها دیده می‌شود.'}</p>
        <div data-gallery>${galleryView(state, { place, slug: prof.slug })}</div></section>
      <section class="pp-sec pp-grid"><h2 class="pp-h2 fm-span">${place ? 'اطلاعات مکان' : 'اطلاعات شما'}</h2>
        ${f('displayName', { id: 'displayName', label: place ? 'نام مکان' : 'نام نمایشی', value: src.displayName, maxlength: 80 })}
        ${place ? f('lodgingType', { id: 'lodgingType', label: 'نوع اقامت', value: src.lodgingType, maxlength: 60 }) : f('expertise', { id: 'expertise', label: 'زمینهٔ تخصص', value: src.expertise, maxlength: 120 })}
        ${place ? f('region', { id: 'region', label: 'منطقه', value: src.region, maxlength: 120 }) : ''}
        ${place ? f('capacityGuests', { id: 'capacityGuests', label: 'ظرفیت گروه (نفر)', value: src.capacityGuests, type: 'number', ltr: true, min: 1, max: 500, hint: 'عددی بین ۱ تا ۵۰۰.' }) : ''}
        ${f('bio', { id: 'bio', label: place ? 'معرفی' : 'دربارهٔ شما', value: src.bio, area: true, maxlength: 1500, span: true, hint: 'تا ۱۵۰۰ نویسه.' })}
        ${f('instagramHandle', { id: 'instagramHandle', label: 'اینستاگرام', value: src.instagramHandle, ltr: true, maxlength: 30, hint: 'فقط نام کاربری، بدون @ و بدون لینک.', span: place })}
        ${place ? html`<div class="ck-field fm-span${ch.has('amenities') ? ' ck-field--changed' : ''}"><span class="ck-field__label">امکانات</span><div data-chips="amenities">${chipsView('amenities', chips.amenities, { max: 20, placeholder: 'مثلاً آب گرم' })}</div><span class="ck-field__error" data-error="amenities" hidden></span></div>
          ${f('houseRules', { id: 'houseRules', label: 'قوانین مکان', value: src.houseRules, area: true, maxlength: 1000, span: true, hint: 'روی صفحهٔ عمومی نمایش داده می‌شود. تا ۱۰۰۰ نویسه.' })}
          <div class="ck-field fm-span"><span class="ck-field__label">چه تجربه‌هایی را می‌پذیرید؟</span><div data-chips="acceptsExperienceTypes">${chipsView('acceptsExperienceTypes', chips.acceptsExperienceTypes, { max: 10, placeholder: 'مثلاً ریتریت حرکتی' })}</div><span class="ck-field__help">فقط برای تیم چکمه است و منتشر نمی‌شود.</span><span class="ck-field__error" data-error="acceptsExperienceTypes" hidden></span></div>`
    : html`${f('credentials', { id: 'credentials', label: 'سوابق و گواهینامه‌ها', value: src.credentials, area: true, maxlength: 600, span: true, hint: 'روی صفحهٔ عمومی شما نمایش داده می‌شود. تا ۶۰۰ نویسه.' })}
          <div class="ck-field fm-span"><span class="ck-field__label">چه نوع مکانی می‌خواهید؟</span><div data-chips="seekingPlaceTypes">${chipsView('seekingPlaceTypes', chips.seekingPlaceTypes, { max: 10, placeholder: 'مثلاً اقامتگاه جنگلی' })}</div><span class="ck-field__help">فقط برای تیم چکمه و هنگام جور کردن برنامه‌ها است و منتشر نمی‌شود.</span><span class="ck-field__error" data-error="seekingPlaceTypes" hidden></span></div>`}
      </section>
      ${place ? html`<section class="pp-sec"><h2 class="pp-h2">موقعیت</h2>
        <div class="fm-grid">${f('latitude', { id: 'latitude', label: 'عرض جغرافیایی', value: src.latitude, type: 'number', ltr: true, step: 'any' })}${f('longitude', { id: 'longitude', label: 'طول جغرافیایی', value: src.longitude, type: 'number', ltr: true, step: 'any' })}</div>
        <span class="ck-field__error" data-error="coordinates" hidden></span>
        ${notice({ title: 'موقعیت دقیق عمومی نمی‌شود', text: 'مختصاتی که اینجا وارد می‌کنید فقط برای شما و تیم چکمه قابل مشاهده است. روی صفحهٔ عمومی فقط محدودهٔ تقریبی (حدود ۱ کیلومتر) نمایش داده می‌شود.' })}</section>` : ''}
      ${notice({ tone: 'error', hidden: true })}
    </form>`;
}

// ---------------------------------------------------------------- experiences & proposals
export function experiencesBody(groups) {
  const any = groups.some((g) => g.list.length);
  return html`<div class="pp-head"><h1 class="pp-title">تجربه‌های من</h1></div>
    <p class="pp-p">تجربه‌هایی که پروفایل شما در آن‌ها حضور دارد. فقط تعداد رزروها نمایش داده می‌شود، نه اطلاعات مسافران.</p>
    ${any ? groups.filter((g) => g.list.length).map((g) => html`<h2 class="pp-h2">${g.profile.displayName}</h2>
      ${g.list.map((t) => html`<section class="pp-sec"><div class="pp-sec__top"><h3 class="pp-h2">${t.name}</h3><span class="ac-kind">${ROLE[t.role] || ''}</span></div>
        ${t.editions.length ? html`<ul class="pp-editions">${t.editions.map((e) => html`<li><span>${e.startsOn ? toFaDigits(e.startsOn) : (e.label || '')}</span><span class="pp-phase${e.phase === 'past' ? ' is-past' : ''}">${PHASE[e.phase] || ''}</span><span class="ck-field__help">${toFaDigits(e.bookings)} رزرو · ${toFaDigits(e.guests)} نفر</span></li>`)}</ul>`
    : html`<p class="pp-p">هنوز تاریخی برای این تجربه ثبت نشده است.</p>`}</section>`)}`)
    : emptyState({ title: 'هنوز پروفایل شما به تجربه‌ای وصل نشده', text: 'از «پیشنهاد یک تجربه» ایده‌تان را برای چکمه بفرستید.' })}`;
}

export function proposeBody(profiles) {
  return html`<div class="pp-head"><h1 class="pp-title">پیشنهاد یک تجربه</h1></div>
    <p class="pp-p">ایدهٔ یک تجربه دارید؟ آن را برای تیم چکمه بفرستید.</p>
    <section class="pp-sec"><form data-propose-form novalidate autocomplete="off"><div class="fm-grid">
      ${profiles.length > 1 ? selectField({ id: 'profileSlug', label: 'از طرف کدام پروفایل؟', options: profiles.map((p) => ({ value: p.slug, label: p.displayName })), span: true }) : ''}
      ${textField({ id: 'title', label: 'عنوان', maxlength: 120, hint: 'مثلاً «سه روز انیمال فلو در جنگل».', span: true })}
      ${textField({ id: 'description', label: 'توضیح', area: true, maxlength: 2000, span: true, hint: 'برنامه، مخاطب و آنچه از چکمه یا مکان انتظار دارید.' })}
      ${textField({ id: 'preferredMonths', label: 'ماه‌های مناسب (اختیاری)', maxlength: 60 })}
      ${selectField({ id: 'wantedCounterpartKind', label: 'همکار دلخواه', options: Object.entries(COUNTERPART).map(([value, label]) => ({ value, label })), hint: 'اگر ترجیح می‌دهید با یک برگزارکننده یا یک مکان جور شوید.' })}
      </div>${notice({ tone: 'error', hidden: true })}<button type="submit" class="ck-btn ck-btn--primary" data-submit>ارسال پیشنهاد</button></form></section>
    <h2 class="pp-h2">پیشنهادهای من</h2><div data-proposals></div>`;
}

export function proposalsList(items) {
  if (!items.length) return emptyState({ title: 'هنوز پیشنهادی نفرستاده‌اید' });
  return html`<ul class="ac-list">${items.map((p) => {
    const [k, l] = PROPOSAL[p.status] || PROPOSAL.new;
    return html`<li class="ac-item"><div class="ac-item__top"><b>${p.title}</b>${statusBadge(k, l)}</div>
      ${p.host ? html`<p class="ac-item__meta">از طرف: ${p.host.displayName} · ${toFaDigits(String(p.createdAt || '').slice(0, 10))}</p>` : ''}<p class="ac-item__body">${p.description}</p></li>`;
  })}</ul>`;
}
