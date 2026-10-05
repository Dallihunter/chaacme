// /about /terms /refund /privacy: plain text from the site settings, one <p> per paragraph.
import { html, toHtmlString } from '../html.js';
import { documentHtml, pageFrame } from '../layout.js';

export function infoDescription(model) {
  const t = String(model.paragraphs[0] || '').replace(/\s+/g, ' ').trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

export function renderInfoPage(model, { assets, site = {}, canonical }) {
  const main = html`<article class="in-doc"><h1 class="ex-title">${model.title}</h1>
    <div class="in-body">${model.paragraphs.map((p) => html`<p>${p}</p>`)}</div></article>`;
  const body = pageFrame({ main, mainClass: 'ex-main', site, headerOptions: {} });
  return toHtmlString(documentHtml({ title: `${model.title} — CHAACME`, description: infoDescription(model), canonical, assets, body }));
}
