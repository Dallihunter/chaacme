// The public experience page: view model -> full HTML document. Plain functions,
// no DOM, so the server renders them today and a browser could tomorrow.
//
// Rules this file follows:
//  * every block is hidden when its data is empty; there is no placeholder text;
//  * every value goes through html`` (escaped); URLs through safeUrl();
//  * the page reads fine without JavaScript — tour-island.js only enhances.
import { html, toHtmlString } from '../html.js';
import { documentHtml, pageFrame } from '../layout.js';
import { photo } from '../components/photo.js';
import { regionStamp } from '../components/regionStamp.js';
import { statusBadge } from '../components/statusBadge.js';
import { emptyState } from '../components/emptyState.js';
import { notice } from '../components/notice.js';
import { experienceCard } from '../components/experienceCard.js';
import { partnerCard } from '../components/partnerCard.js';
import { pairing } from '../pairing.js';
import { formatDateRangeFa, formatNumberFa, toFaDigits } from '../format.js';

export const MAX_GUESTS = 8;
const MAX_MOSAIC = 5;

const editionText = (e) => formatDateRangeFa(e.startsOn, e.endsOn) || e.label;
const dayLabel = (it, i) => it.label || `روز ${toFaDigits(i + 1)}`;
const altOf = (img, fallback) => (img && img.alt) || fallback;

/** Which state the booking card is in; shared by the card, the sticky bar and the island. */
export function bookingState(page) {
  const open = page.editions.filter((e) => !e.full && e.available > 0);
  if (page.comingSoon || !page.editions.length) return { kind: 'none', open, reason: 'تاریخ بعدی اعلام می‌شود' };
  if (!open.length) return { kind: 'full', open, reason: 'ظرفیت تکمیل است' };
  if (!(page.price > 0)) return { kind: 'no_price', open, reason: 'قیمت به‌زودی اعلام می‌شود' };
  return { kind: 'open', open, reason: null };
}

function guestOptions(max, selected = 1) {
  const n = Math.max(1, Math.min(MAX_GUESTS, max));
  return Array.from({ length: n }, (_, i) => html`<option value="${i + 1}"${i + 1 === selected ? html` selected` : ''}>${toFaDigits(i + 1)} نفر</option>`);
}

// ---------------------------------------------------------------- hero
function hero(page) {
  const imgs = page.gallery.length ? page.gallery : (page.cover ? [page.cover] : []);
  if (!imgs.length) return null;
  const shown = imgs.slice(0, MAX_MOSAIC);
  const rest = imgs.slice(MAX_MOSAIC);
  const tile = (img, i) => html`<a class="tp-hero__tile" href="${img.path}" data-lb data-lb-src="${(img.variants[img.variants.length - 1] || {}).url || img.path}" data-lb-alt="${altOf(img, `${page.name} — عکس ${toFaDigits(i + 1)}`)}" data-lb-caption="${img.caption || ''}">${photo(img, { alt: altOf(img, `${page.name} — عکس ${toFaDigits(i + 1)}`), sizes: i === 0 ? '(max-width: 720px) 100vw, 600px' : '(max-width: 720px) 0px, 300px', eager: i === 0 })}</a>`;
  return html`<div class="tp-hero tp-hero--n${shown.length}">
    ${shown.map(tile)}
    ${rest.map((img, i) => html`<a hidden href="${img.path}" data-lb data-lb-src="${(img.variants[img.variants.length - 1] || {}).url || img.path}" data-lb-alt="${altOf(img, `${page.name} — عکس ${toFaDigits(MAX_MOSAIC + i + 1)}`)}" data-lb-caption="${img.caption || ''}">${altOf(img, page.name)}</a>`)}
    ${imgs.length > 1 ? html`<a class="tp-hero__all" href="${imgs[0].path}" data-lb-open>همهٔ عکس‌ها (${toFaDigits(imgs.length)})</a>` : ''}
    <div class="tp-hero__tools">
      <a class="tp-hero__btn" href="/" aria-label="بازگشت"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"></path></svg></a>
      <button class="tp-hero__btn" type="button" aria-label="اشتراک‌گذاری" data-share hidden><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13"></path><path d="M7 8l5-5 5 5"></path><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"></path></svg></button>
    </div>
    ${imgs.length > 1 ? html`<span class="tp-hero__count" aria-hidden="true">${toFaDigits(1)} / ${toFaDigits(imgs.length)}</span>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- sections
function titleBlock(page) {
  const lead = page.people.find((p) => p.role === 'lead') || page.people[0] || null;
  const venue = page.venue;
  const people = lead || venue;
  const capacity = page.editions.length ? Math.max(...page.editions.map((e) => e.capacity || 0)) : 0;
  const facts = [
    ['مدت', page.duration],
    ['محل', venue && venue.region ? venue.region : null],
    ['ظرفیت هر اجرا', capacity > 0 ? `${toFaDigits(capacity)} نفر` : null],
    ['سطح', page.level]
  ].filter(([, v]) => v);
  return html`<section class="tp-sec tp-sec--head">
    ${page.region || page.experienceType ? html`<div class="tp-tags">${regionStamp(page.region)}${page.experienceType ? html`<span class="ck-chip">${page.experienceType}</span>` : ''}</div>` : ''}
    <h1 class="tp-title">${page.name}</h1>
    <p class="tp-pair">${pairing(lead ? lead.name : null, venue ? venue.name : null)}${venue && venue.region ? html`، ${venue.region}` : ''}${people ? html` · طراحی و هماهنگی: چکمه` : ''}</p>
    ${facts.length ? html`<div class="tp-facts">${facts.map(([k, v]) => html`<div class="tp-fact"><div class="tp-fact__k">${k}</div><div class="tp-fact__v">${v}</div></div>`)}</div>` : ''}
  </section>`;
}

const story = (page) => page.story ? html`<section class="tp-sec"><h2 class="tp-h2">داستان این تجربه</h2><p class="tp-story">${page.story}</p></section>` : null;

function highlights(page) {
  if (!page.highlights.length) return null;
  const hasImages = page.highlights.some((h) => h.image);
  return html`<section class="tp-sec${hasImages ? ' tp-hl--scroll' : ''}"><h2 class="tp-h2">در این تجربه</h2>
    <ul class="tp-hl">${page.highlights.map((h) => html`<li class="tp-hl__item"><span class="tp-hl__dot" aria-hidden="true"></span><span><span class="tp-hl__name">${h.name}</span>${h.description ? html`<span class="tp-hl__desc">${h.description}</span>` : ''}</span></li>`)}</ul>
    ${hasImages ? html`<ul class="tp-hl-scroll">${page.highlights.map((h) => h.image
    ? html`<li class="tp-hl-scroll__item">${photo(h.image, { alt: altOf(h.image, h.name), sizes: '220px' })}<p>${h.name}</p>${h.image.caption ? html`<small class="tp-cap">${h.image.caption}</small>` : ''}</li>`
    : html`<li class="tp-hl-scroll__item tp-hl-scroll__item--text"><p>${h.name}</p></li>`)}</ul>` : ''}
  </section>`;
}

function itinerary(page) {
  if (!page.itinerary.length) return null;
  const imgs = (it) => it.images.length ? html`<div class="tp-day__imgs">${it.images.map((img) => html`<figure class="tp-fig">${photo(img, { alt: altOf(img, it.title), sizes: '160px' })}${img.caption ? html`<figcaption>${img.caption}</figcaption>` : ''}</figure>`)}</div>` : '';
  return html`<section class="tp-sec"><h2 class="tp-h2">برنامهٔ سفر</h2>
    <div class="tp-days">${page.itinerary.map((it, i) => html`<div class="tp-day"><div class="tp-day__label">${dayLabel(it, i)}</div><div class="tp-day__body"><div class="tp-day__text"><div class="ck-xcard__title tp-day__title">${it.title}</div>${it.description ? html`<p class="tp-day__desc">${it.description}</p>` : ''}</div>${imgs(it)}</div></div>`)}</div>
    <div class="tp-acc">${page.itinerary.map((it, i) => html`<details class="tp-acc__item"${i === 0 ? html` open` : ''}><summary><span class="tp-acc__day">${dayLabel(it, i)}</span> · ${it.title}</summary><div class="tp-acc__body">${it.description ? html`<p>${it.description}</p>` : ''}${imgs(it)}</div></details>`)}</div>
  </section>`;
}

function venue(page) {
  const v = page.venue;
  if (!v) return null;
  const line = [v.lodgingType, v.region].filter(Boolean).join(' · ');
  return html`<section class="tp-sec"><h2 class="tp-h2">محل برگزاری</h2>
    <a class="tp-venue" href="/host/${encodeURIComponent(v.slug)}">
      ${v.photo ? photo(v.photo, { alt: altOf(v.photo, v.name), sizes: '(max-width: 720px) 100vw, 480px' }) : ''}
      <div class="tp-venue__body">
        <div class="tp-venue__head"><span class="tp-venue__name">${v.name}</span>${v.verified ? statusBadge('verified', 'تأییدشده توسط چکمه') : ''}</div>
        ${line ? html`<p class="tp-venue__line">${line}</p>` : ''}
        ${v.amenities.length ? html`<div class="ck-chips tp-venue__chips">${v.amenities.slice(0, 6).map((a) => html`<span class="ck-chip">${a}</span>`)}</div>` : ''}
        <span class="tp-venue__more">دربارهٔ این مکان ←</span>
      </div>
    </a></section>`;
}

function people(page) {
  if (!page.people.length) return null;
  return html`<section class="tp-sec"><h2 class="tp-h2">برگزارکنندگان</h2>
    <div class="tp-people">${page.people.map((p) => partnerCard(p, { kind: 'person' }))}</div>
    <p class="tp-note">طراحی و هماهنگی: <b>چکمه</b> — از انتخاب مکان و برنامه تا رفت‌وآمد و سفره.</p></section>`;
}

function reviews(page) {
  const r = page.reviews;
  return html`<section class="tp-sec"><div class="ck-section-head" style="margin-bottom:0"><h2>نظر مسافران</h2></div>
    ${r.items.length ? html`
      ${r.average != null ? html`<p class="tp-rev-sum">${toFaDigits(String(r.average).replace('.', '٫'))} از ۵ · ${toFaDigits(r.count)} نظر</p>` : ''}
      <ul class="tp-reviews">${r.items.map((x) => html`<li class="tp-review"><div class="tp-review__head"><span class="tp-review__name">${x.displayName}</span><span class="tp-review__stars" role="img" aria-label="امتیاز ${toFaDigits(x.rating)} از ۵">${'★'.repeat(x.rating)}${'☆'.repeat(5 - x.rating)}</span></div><p class="tp-review__body">${x.body}</p>${formatDateRangeFa(x.createdAt) ? html`<span class="tp-review__date">${formatDateRangeFa(x.createdAt)}</span>` : ''}</li>`)}</ul>`
    : emptyState({ title: 'هنوز نظری ثبت نشده', text: 'نظرها فقط از مسافرانی می‌آیند که این تجربه را رفته‌اند.' })}
  </section>`;
}

function conditions(page) {
  const items = [['چه چیزهایی در هزینه است', page.included], ['چه با خودم بیاورم', page.bringList]].filter(([, v]) => v);
  if (!items.length) return null;
  return html`<section class="tp-sec"><h2 class="tp-h2">شرایط</h2><div>${items.map(([t, v]) => html`<details class="tp-cond"><summary><span>${t}</span><span class="tp-cond__mark" aria-hidden="true">‹</span></summary><div class="tp-cond__body">${v}</div></details>`)}</div></section>`;
}

// ---------------------------------------------------------------- booking card
function bookingCard(page) {
  const st = bookingState(page);
  const price = formatNumberFa(page.price);
  const first = st.open[0] || null;
  const fine = html`پرداخت امن با زرین‌پال`;
  const head = html`<div>
      ${price ? html`<div class="tp-book__k">هزینهٔ هر نفر</div><div class="tp-book__price ck-num">${price} <small>تومان</small></div>` : ''}
      ${page.included && st.kind === 'open' ? html`<div class="tp-book__incl">${String(page.included).split(/\s*·\s*/).slice(0, 3).join(' · ')}</div>` : ''}
    </div>`;
  if (st.kind !== 'open') {
    const full = page.editions.filter((e) => e.full);
    return html`<div class="tp-book" id="booking">${head}
      ${full.length ? html`<ul class="tp-eds">${full.map((e) => html`<li class="tp-ed tp-ed--full"><span class="tp-ed__main"><b>${editionText(e)}</b></span>${statusBadge('hidden', 'تکمیل')}</li>`)}</ul>` : ''}
      <p class="tp-book__reason">${st.reason}</p>
    </div>`;
  }
  const maxFirst = Math.min(MAX_GUESTS, first.available);
  return html`<form class="tp-book" id="booking" method="get" action="/login" data-booking data-tour="${page.slug}" data-price="${page.price}" data-max-guests="${MAX_GUESTS}">
    ${head}
    <input type="hidden" name="next" value="/tour/${page.slug}">
    <fieldset class="tp-eds"><legend class="ck-field__label">انتخاب تاریخ</legend>
      ${page.editions.map((e) => {
    const disabled = e.full || e.available <= 0;
    const checked = first && e.id === first.id;
    return html`<label class="tp-ed${disabled ? ' tp-ed--full' : ''}${checked ? ' is-selected' : ''}"><span class="tp-ed__main"><input type="radio" name="edition" value="${e.id}" data-available="${e.available}"${checked ? html` checked` : ''}${disabled ? html` disabled` : ''}><span><b>${editionText(e)}</b>${page.duration ? html`<span class="tp-ed__sub">${page.duration}</span>` : ''}</span></span>${disabled ? statusBadge('hidden', 'تکمیل') : statusBadge('active', `${toFaDigits(e.available)} جای خالی`)}</label>`;
  })}
    </fieldset>
    <label class="ck-field"><span class="ck-field__label">تعداد نفرات</span><select class="ck-input" name="guests" data-guests>${guestOptions(maxFirst)}</select></label>
    <div class="tp-book__total" data-total-row><span>مبلغ کل</span><b class="ck-num" data-total>${formatNumberFa(page.price)} تومان</b></div>
    ${notice({ tone: 'error', hidden: true })}
    <button type="submit" class="ck-btn ck-btn--primary ck-btn--block tp-book__cta" data-submit>رزرو این تجربه</button>
    <p class="tp-book__fine">${fine}</p>
  </form>`;
}

function stickyBar(page) {
  const st = bookingState(page);
  const price = formatNumberFa(page.price);
  if (!price && st.kind === 'none') return null;
  const first = st.open[0] || null;
  const sub = first ? [editionText(first), `${toFaDigits(first.available)} جای خالی`].join(' · ') : st.reason;
  return html`<div class="tp-sticky" data-sticky>
    <div>${price ? html`<div class="tp-sticky__price ck-num">${price} <small>تومان / نفر</small></div>` : ''}${sub ? html`<div class="tp-sticky__sub">${sub}</div>` : ''}</div>
    ${st.kind === 'open' ? html`<a href="#booking" class="ck-btn ck-btn--primary" data-jump-booking>انتخاب تاریخ</a>` : ''}
  </div>`;
}

function related(page) {
  if (!page.related.length) return null;
  return html`<section class="tp-related"><div class="ck-section-head"><h2>تجربه‌های دیگر</h2><a href="/">همهٔ تجربه‌ها</a></div><div class="tp-related__grid">${page.related.map(experienceCard)}</div></section>`;
}

// ---------------------------------------------------------------- document
export function ogImageUrl(page) {
  const c = page.cover;
  if (!c) return null;
  if (c.og) return c.og.url;
  return (c.variants[c.variants.length - 1] || {}).url || c.path;
}

export function metaDescription(page) {
  const text = String(page.seoDescription || page.story || page.description || '').replace(/\s+/g, ' ').trim();
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/** Full experience page. `assets` = { css, font, scripts, imports }; `site` = { footerLinks }. */
export function renderTourPage(page, { assets, site = {}, canonical, ogImage, description }) {
  const sticky = stickyBar(page);
  const heroBlock = hero(page);
  const main = html`<p class="tp-crumbs"><a href="/">تجربه‌ها</a> / ${page.name}</p>
    ${heroBlock}
    <div class="tp-body">
      <article class="tp-article">
        ${titleBlock(page)}
        ${story(page)}
        ${highlights(page)}
        ${itinerary(page)}
        ${venue(page)}
        ${people(page)}
        ${reviews(page)}
        ${conditions(page)}
      </article>
      <aside class="tp-aside" aria-label="رزرو">${bookingCard(page)}</aside>
    </div>
    ${related(page)}`;
  const body = pageFrame({
    main, mainClass: 'tp-main', site, after: sticky, rootClass: sticky ? 'has-sticky' : '',
    headerOptions: { variant: heroBlock ? 'overlay-mobile' : 'site', active: 'experiences', next: `/tour/${page.slug}` }
  });
  return toHtmlString(documentHtml({ title: `${page.name} — CHAACME`, description, canonical, ogImage, ogType: 'article', assets, body }));
}
