// /about /terms /refund /privacy: plain text from the site settings, one <p> per paragraph.
import { html, toHtmlString } from '../html.js';
import { documentHtml, pageFrame } from '../layout.js';
import { telHref, mailHref } from '../site.js';
import { toFaDigits } from '../format.js';

export function infoDescription(model) {
  const first = model.contact ? (model.contact.address[0] || model.contact.hours[0] || '') : model.paragraphs[0];
  const t = String(first || '').replace(/\s+/g, ' ').trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

/** «تماس با ما»: only the rows that have a value; phone and e-mail are real tel: / mailto: links (validated again here). */
function contactBody(c) {
  const tel = c.phone ? telHref(c.phone) : null;
  const mail = c.email ? mailHref(c.email) : null;
  const rows = [
    c.phone ? ['تلفن', tel ? html`<a href="${tel}" dir="ltr" class="in-ltr">${toFaDigits(c.phone)}</a>` : toFaDigits(c.phone)] : null,
    c.email ? ['ایمیل', mail ? html`<a href="${mail}" dir="ltr" class="in-ltr">${c.email}</a>` : c.email] : null,
    c.address.length ? ['نشانی', html`${c.address.map((l) => html`<span class="in-line">${l}</span>`)}`] : null,
    c.hours.length ? ['ساعت کاری', html`${c.hours.map((l) => html`<span class="in-line">${l}</span>`)}`] : null
  ].filter(Boolean);
  return html`<dl class="in-contact">${rows.map(([k, v]) => html`<div class="in-contact__row"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

export function renderInfoPage(model, { assets, site = {}, canonical }) {
  const main = html`<article class="in-doc"><h1 class="ex-title">${model.title}</h1>
    ${model.contact ? contactBody(model.contact) : html`<div class="in-body">${model.paragraphs.map((p) => html`<p>${p}</p>`)}</div>`}</article>`;
  const body = pageFrame({ main, mainClass: 'ex-main', site, headerOptions: {} });
  return toHtmlString(documentHtml({ title: `${model.title} — CHAACME`, description: infoDescription(model), canonical, assets, body }));
}
