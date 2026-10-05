// /experiences: filters (a GET form, so they work without JavaScript and every result is a shareable URL),
// the count line, the card grid or the empty state.
import { html, toHtmlString, cx } from '../html.js';
import { documentHtml, pageFrame } from '../layout.js';
import { experienceCard } from '../components/experienceCard.js';
import { emptyState } from '../components/emptyState.js';
import { toFaDigits } from '../format.js';

const DOT = { desert: 'clay', forest: 'forest', sea: 'sea' };

function regionChips(model) {
  const { regions } = model.options;
  if (regions.length < 2 && !model.filters.region) return null;
  const chip = (value, label, tone, checked) => html`<label class="ex-chip"><input type="radio" name="region" value="${value}"${checked ? html` checked` : ''}><span class="ex-chip__in">${tone ? html`<i class="ex-dot ex-dot--${tone}" aria-hidden="true"></i>` : ''}${label}</span></label>`;
  return html`<fieldset class="ex-group"><legend class="ck-field__label">منطقه</legend>
    <div class="ex-chips">${chip('', 'همه', null, !model.filters.region)}${regions.map((r) => chip(r.key, r.label, DOT[r.tone] || null, model.filters.region === r.key))}</div></fieldset>`;
}

function select(name, label, options, current, allLabel) {
  if (!options.length) return null;
  return html`<label class="ck-field ex-select"><span class="ck-field__label">${label}</span>
    <select class="ck-input" name="${name}"><option value="">${allLabel}</option>${options.map((o) => html`<option value="${o.value}"${o.value === current ? html` selected` : ''}>${o.label}</option>`)}</select></label>`;
}

function filterBar(model) {
  const o = model.options;
  const parts = [
    regionChips(model),
    select('type', 'نوع تجربه', o.types.map((t) => ({ value: t, label: t })), model.filters.type, 'همه'),
    select('month', 'ماه', o.months.map((m) => ({ value: m.key, label: m.label })), model.filters.month, 'همهٔ ماه‌ها'),
    o.canFilterOpen ? html`<label class="ex-check"><input type="checkbox" name="open" value="1"${model.filters.open ? html` checked` : ''}> فقط تاریخ‌های باز</label>` : null
  ].filter(Boolean);
  if (!parts.length) return null;
  return html`<form class="ex-filters" method="get" action="/experiences" data-filters>
    ${parts}
    <div class="ex-filters__actions"><button type="submit" class="ck-btn ck-btn--secondary" data-apply>اعمال فیلترها</button>${model.active ? html`<a class="ex-clear" href="/experiences">حذف فیلترها</a>` : ''}</div>
  </form>`;
}

function countLine(model) {
  if (!model.count) return null;
  const bits = [`${toFaDigits(model.count)} تجربه`];
  if (model.openEditions) bits.push(`${toFaDigits(model.openEditions)} اجرای باز`);
  return html`<p class="ex-count" role="status">${bits.join(' · ')}</p>`;
}

export function renderExperiencesPage(model, { assets, site = {}, canonical }) {
  const results = model.count
    ? html`<div class="ex-grid">${model.cards.map((c) => experienceCard(c, { meta: 'seats' }))}</div>`
    : model.active
      ? html`${emptyState({ title: 'تجربه‌ای با این فیلترها پیدا نشد', text: 'فیلترها را کم کنید یا همه را حذف کنید.' })}<p class="ex-empty-link"><a class="ck-btn ck-btn--secondary" href="/experiences">حذف فیلترها</a></p>`
      : emptyState({ title: 'هنوز تجربه‌ای منتشر نشده' });
  const main = html`<div class="ex-head"><h1 class="ex-title">تجربه‌ها</h1><p class="ex-sub">ظرفیت هر اجرا محدود است؛ تاریخ‌ها را زود ببین.</p></div>
    ${filterBar(model)}${countLine(model)}${results}`;
  const body = pageFrame({ main, mainClass: cx('ex-main'), site, headerOptions: { active: 'experiences' } });
  return toHtmlString(documentHtml({
    title: 'تجربه‌ها — CHAACME', description: 'ظرفیت هر اجرا محدود است؛ تاریخ‌ها را زود ببین.', canonical,
    robots: model.active ? 'noindex, follow' : null, assets, body
  }));
}
