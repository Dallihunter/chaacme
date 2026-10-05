import { html, toHtmlString } from '../html.js';
import { documentHtml, pageFrame } from '../layout.js';
import { placeCard } from '../components/placeCard.js';
import { emptyState } from '../components/emptyState.js';

export function renderPlacesPage(model, { assets, site = {}, canonical }) {
  const main = html`<div class="ex-head"><h1 class="ex-title">مکان‌ها</h1></div>
    ${model.places.length ? html`<div class="pl-grid pl-grid--wide">${model.places.map(placeCard)}</div>` : emptyState({ title: 'هنوز مکانی منتشر نشده' })}`;
  const body = pageFrame({ main, mainClass: 'ex-main', site, headerOptions: { active: 'places' } });
  return toHtmlString(documentHtml({ title: 'مکان‌ها — CHAACME', canonical, assets, body }));
}
