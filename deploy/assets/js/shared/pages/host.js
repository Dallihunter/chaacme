// /host/<slug>: a place profile or a person profile (same route, branched on `kind`).
// View model: server/pagemodels.js buildHostPage. Every block is hidden when its data is empty.
import { html, toHtmlString, safeUrl } from '../html.js';
import { documentHtml, pageFrame } from '../layout.js';
import { photo } from '../components/photo.js';
import { regionStamp } from '../components/regionStamp.js';
import { statusBadge } from '../components/statusBadge.js';
import { experienceCard } from '../components/experienceCard.js';
import { reviewsSection } from '../components/reviews.js';
import { mapArea } from '../components/mapArea.js';
import { instagramUrl } from '../site.js';
import { toFaDigits } from '../format.js';

const MAX_TILES = 6;
const lbSrc = (img) => (img.variants[img.variants.length - 1] || {}).url || img.path;

function instagramButton(page) {
  const url = instagramUrl(page.instagram);
  return url ? html`<a class="ck-btn ck-btn--secondary" href="${url}" rel="noopener"><span class="pf-handle" dir="ltr">@${page.instagram}</span></a>` : '';
}

function placeHero(page) {
  const line = [page.lodgingType, page.regionText].filter(Boolean).join(' · ');
  const hasExp = page.experiences.length > 0;
  return html`<section class="pf-hero${page.photo ? '' : ' pf-hero--solo'}">
    <div class="pf-hero__copy">
      ${page.region || page.verified ? html`<div class="pf-tags">${regionStamp(page.region)}${page.verified ? statusBadge('verified', 'تأییدشده توسط چکمه') : ''}</div>` : ''}
      <h1 class="pf-title">${page.name}</h1>
      ${line ? html`<p class="pf-line">${line}</p>` : ''}
      ${page.bio ? html`<p class="pf-intro">${page.bio}</p>` : ''}
      ${hasExp || page.instagram ? html`<div class="pf-actions">${hasExp ? html`<a class="ck-btn ck-btn--primary" href="#experiences">تجربه‌های این مکان</a>` : ''}${instagramButton(page)}</div>` : ''}
    </div>
    ${page.photo ? html`<div class="pf-hero__media">${photo(page.photo, { alt: page.photo.alt || page.name, sizes: '(max-width: 900px) 100vw, 640px', eager: true })}</div>` : ''}
  </section>`;
}

function personHero(page) {
  const initial = String(page.name || '').trim().charAt(0);
  return html`<section class="pf-hero pf-hero--person">
    <div class="pf-portrait${page.photo ? '' : ' pf-portrait--initial'}">${page.photo ? photo(page.photo, { alt: page.photo.alt || page.name, sizes: '240px', eager: true }) : html`<span aria-hidden="true">${initial}</span>`}</div>
    <div class="pf-hero__copy">
      ${page.verified ? html`<div class="pf-tags">${statusBadge('verified', 'تأییدشده توسط چکمه')}</div>` : ''}
      <h1 class="pf-title">${page.name}</h1>
      ${page.expertise ? html`<p class="pf-line">${page.expertise}</p>` : ''}
      ${page.bio ? html`<p class="pf-intro">${page.bio}</p>` : ''}
      ${page.experiences.length || page.instagram ? html`<div class="pf-actions">${page.experiences.length ? html`<a class="ck-btn ck-btn--primary" href="#experiences">تجربه‌های ${page.name}</a>` : ''}${instagramButton(page)}</div>` : ''}
    </div>
  </section>`;
}

function facts(page) {
  const items = page.kind === 'place'
    ? [['نوع اقامت', page.lodgingType], ['ظرفیت گروه', page.capacity ? `تا ${toFaDigits(page.capacity)} نفر` : null], ['تجربه‌ها با چکمه', page.experiences.length ? `${toFaDigits(page.experiences.length)} تجربه` : null]]
    : [['تجربه‌ها با چکمه', page.experiences.length ? `${toFaDigits(page.experiences.length)} تجربه` : null]];
  const shown = items.filter(([, v]) => v);
  if (!shown.length) return null;
  return html`<section class="pf-facts">${shown.map(([k, v]) => html`<div class="pf-fact"><div class="pf-fact__k">${k}</div><div class="pf-fact__v">${v}</div></div>`)}</section>`;
}

function gallery(page) {
  const imgs = page.gallery;
  if (!imgs.length) return null;
  const shown = imgs.slice(0, MAX_TILES);
  const rest = imgs.slice(MAX_TILES);
  const alt = (img) => img.alt || page.name;
  const tile = (img, i) => html`<figure class="pf-tile"><a href="${safeUrl(img.path, '#')}" data-lb data-lb-src="${lbSrc(img)}" data-lb-alt="${alt(img)}" data-lb-caption="${img.caption || ''}">${photo(img, { alt: alt(img), sizes: i === 0 ? '(max-width: 720px) 50vw, 600px' : '(max-width: 720px) 50vw, 300px' })}</a>${img.caption ? html`<figcaption>${img.caption}</figcaption>` : ''}</figure>`;
  return html`<section class="pf-sec"><div class="ck-section-head" style="margin-bottom:0"><h2>${page.kind === 'place' ? 'فضا و حال‌وهوا' : 'گالری'}</h2>${imgs.length > 1 ? html`<a href="${safeUrl(imgs[0].path, '#')}" data-lb-open>همهٔ عکس‌ها</a>` : ''}</div>
    <div class="pf-mosaic pf-mosaic--n${Math.min(shown.length, 4)}">${shown.map(tile)}${rest.map((img) => html`<a hidden href="${safeUrl(img.path, '#')}" data-lb data-lb-src="${lbSrc(img)}" data-lb-alt="${alt(img)}" data-lb-caption="${img.caption || ''}">${alt(img)}</a>`)}</div>
  </section>`;
}

function placeDetails(page) {
  const left = page.amenities.length || page.houseRules;
  const map = mapArea(page.area, page.regionText);
  if (!left && !map) return null;
  return html`<section class="pf-cols">
    ${left ? html`<div class="pf-col">
      ${page.amenities.length ? html`<h2 class="tp-h2">امکانات</h2><div class="ck-chips">${page.amenities.map((a) => html`<span class="ck-chip">${a}</span>`)}</div>` : ''}
      ${page.houseRules ? html`<h3 class="pf-h3">قوانین مکان</h3><p class="pf-rules">${page.houseRules}</p>` : ''}
    </div>` : ''}
    ${map ? html`<div class="pf-col"><h2 class="tp-h2">کجاست</h2>${map}<p class="pf-note">محدودهٔ تقریبی (حدود ۱ کیلومتر). نشانی دقیق منتشر نمی‌شود.</p></div>` : ''}
  </section>`;
}

function credentials(page) {
  return page.credentials ? html`<section class="pf-sec"><h2 class="tp-h2">سوابق و گواهینامه‌ها</h2><p class="pf-rules">${page.credentials}</p></section>` : null;
}

function experiences(page) {
  if (!page.experiences.length) return null;
  return html`<section class="pf-sec" id="experiences"><div class="ck-section-head" style="margin-bottom:0"><h2>${page.kind === 'place' ? `تجربه‌ها در ${page.name}` : `تجربه‌های ${page.name}`}</h2></div>
    <div class="ex-grid">${page.experiences.map((c) => experienceCard(c))}</div></section>`;
}

export function ogImageUrl(page) {
  const img = page.photo || page.gallery[0] || null;
  if (!img) return null;
  return img.og ? img.og.url : lbSrc(img);
}

export function metaDescription(page) {
  const fallback = page.kind === 'place' ? [page.lodgingType, page.regionText].filter(Boolean).join(' · ') : page.expertise;
  const text = String(page.bio || fallback || '').replace(/\s+/g, ' ').trim();
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export function renderHostPage(page, { assets, site = {}, canonical, ogImage, description }) {
  const main = html`<div class="pf">
    ${page.kind === 'place' ? placeHero(page) : personHero(page)}
    ${facts(page)}
    ${gallery(page)}
    ${page.kind === 'place' ? placeDetails(page) : credentials(page)}
    ${experiences(page)}
    ${reviewsSection(page.reviews, { emptyText: 'نظر مسافرانِ تجربه‌هایی که با این پروفایل برگزار شده‌اند این‌جا جمع می‌شود.' })}
  </div>`;
  const body = pageFrame({ main, mainClass: 'pf-main', site, headerOptions: { active: page.kind === 'place' ? 'places' : null } });
  return toHtmlString(documentHtml({
    title: `${page.name} — CHAACME`, description, canonical, ogImage, ogType: 'profile', assets, body
  }));
}
