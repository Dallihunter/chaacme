// The home page: view model (server/pagemodels.js buildHomePage) -> HTML.
// Every section is hidden when its data is empty; there is no placeholder text.
import { html, toHtmlString, safeUrl } from '../html.js';
import { documentHtml, pageFrame } from '../layout.js';
import { header } from '../components/header.js';
import { photo } from '../components/photo.js';
import { experienceCard } from '../components/experienceCard.js';
import { placeCard } from '../components/placeCard.js';

const bestUrl = (img) => (img ? safeUrl((img.variants[img.variants.length - 1] || {}).url || img.path, '') : '');

function hero(model, site) {
  const h = model.hero;
  if (!h) return null;
  const poster = bestUrl(h.poster || h.image);
  const media = h.video
    ? html`<video class="hm-hero__media" src="${safeUrl(h.video, '')}"${poster ? html` poster="${poster}"` : ''} autoplay muted loop playsinline preload="metadata" aria-hidden="true" tabindex="-1" data-hero-video></video>`
    : (h.image || h.poster) ? photo(h.image || h.poster, { alt: '', sizes: '100vw', eager: true, className: 'hm-hero__media' }) : '';
  const how = model.explainer ? html`<a href="#how" class="ck-btn hm-btn hm-ghost">${h.ctaSecondary}</a>` : '';
  return html`<section class="hm-hero${media ? '' : ' hm-hero--plain'}">
    ${media}
    <div class="hm-hero__scrim"></div>
    ${header({ variant: 'overlay', active: null })}
    <div class="hm-hero__copy">
      <div class="hm-hero__in">
        ${h.headline ? html`<h1 class="hm-hero__title">${h.headline}</h1>` : html`<h1 class="ck-visually-hidden">چکمه</h1>`}
        ${h.subline ? html`<p class="hm-hero__sub">${h.subline}</p>` : ''}
        ${h.ctaPrimary || (h.ctaSecondary && model.explainer) ? html`<div class="hm-hero__cta">
          ${h.ctaPrimary ? html`<a href="/experiences" class="ck-btn ck-btn--primary hm-btn">${h.ctaPrimary}</a>` : ''}
          ${h.ctaSecondary ? how : ''}
        </div>` : ''}
      </div>
    </div>
  </section>`;
}

function upcoming(model) {
  if (!model.upcoming.length) return null;
  return html`<section class="hm-sec hm-sec--first"><div class="ck-section-head"><h2>تجربه‌های پیش‌رو</h2><a href="/experiences">همهٔ تجربه‌ها</a></div>
    <div class="hm-grid">${model.upcoming.map((c) => experienceCard(c))}</div></section>`;
}

const MARKS = ['hm-mark hm-mark--forest', 'hm-mark hm-mark--clay', 'hm-mark hm-mark--saffron'];

function explainer(model) {
  const e = model.explainer;
  if (!e) return null;
  const cards = e.cards.map((c, i) => html`<div class="hm-step">
      ${c.image ? photo(c.image, { alt: '', sizes: '(max-width: 720px) 100vw, 360px', className: 'hm-step__img' }) : ''}
      ${c.title || c.text ? html`<div class="hm-step__body"><span class="${MARKS[i % 3]}" aria-hidden="true"></span><div>${c.title ? html`<div class="hm-step__title">${c.title}</div>` : ''}${c.text ? html`<p class="hm-step__text">${c.text}</p>` : ''}</div></div>` : ''}
    </div>`);
  const spaced = [];
  cards.forEach((c, i) => { if (i) spaced.push(html`<div class="hm-times" aria-hidden="true">×</div>`); spaced.push(c); });
  return html`<section class="hm-sec hm-how" id="how">
    ${e.title || e.text ? html`<div class="hm-how__intro">${e.title ? html`<h2 class="hm-h2">${e.title}</h2>` : ''}${e.text ? html`<p class="hm-lead">${e.text}</p>` : ''}</div>` : ''}
    ${spaced.length ? html`<div class="hm-steps">${spaced}</div>` : ''}
  </section>`;
}

function places(model) {
  if (!model.places.length) return null;
  return html`<section class="hm-sec"><div class="ck-section-head"><h2>مکان‌ها</h2><a href="/places">همهٔ مکان‌ها</a></div>
    <div class="pl-grid">${model.places.map(placeCard)}</div></section>`;
}

function band(model) {
  const b = model.hostBand;
  if (!b) return null;
  return html`<section class="hm-band">
    <div class="hm-band__copy">${b.title ? html`<h2 class="hm-h2 hm-h2--band">${b.title}</h2>` : ''}${b.text ? html`<p class="hm-lead">${b.text}</p>` : ''}</div>
    ${b.cta ? html`<a href="/become-host" class="ck-btn ck-btn--primary hm-btn">${b.cta}</a>` : ''}
  </section>`;
}

export function renderHomePage(model, { assets, site = {}, canonical, ogImage, description }) {
  const heroBlock = hero(model, site);
  const main = html`${upcoming(model)}${explainer(model)}${places(model)}${band(model)}`;
  const body = pageFrame({
    main, mainClass: 'hm-main', site, before: heroBlock,
    headerOptions: heroBlock ? false : { active: null }
  });
  return toHtmlString(documentHtml({
    title: 'چکمه — تجربه‌هایی از آدم‌ها و مکان‌ها', description, canonical, ogImage, ogType: 'website', assets, body, bodyClass: heroBlock ? 'has-hero' : ''
  }));
}
