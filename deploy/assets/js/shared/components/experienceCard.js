import { html } from '../html.js';
import { photo } from './photo.js';
import { regionStamp } from './regionStamp.js';
import { pairing } from '../pairing.js';
import { formatDateRangeFa, formatNumberFa, toFaDigits } from '../format.js';

/**
 * Card for one experience (view-model "card": slug, name, region, comingSoon, cover, leadName,
 * venueName, nextEdition, price, duration). `meta` picks what follows the date: 'duration' (home,
 * profiles) or 'seats' (the experiences listing). No cover = the tinted frame only, never a label.
 */
export function experienceCard(card, { meta = 'duration' } = {}) {
  const tone = card.region ? card.region.tone : null;
  const photoClass = tone === 'forest' || tone === 'sea' ? ` ck-photo--${tone}` : '';
  const next = card.nextEdition
    ? (formatDateRangeFa(card.nextEdition.startsOn, card.nextEdition.endsOn) || card.nextEdition.label)
    : null;
  const tail = meta === 'seats'
    ? (card.nextEdition && card.nextEdition.available > 0 ? `${toFaDigits(card.nextEdition.available)} جای خالی` : null)
    : card.duration;
  const dateLine = card.comingSoon ? 'به‌زودی' : next ? [next, tail].filter(Boolean).join(' · ') : 'اعلام می‌شود';
  const price = formatNumberFa(card.price);
  return html`<a class="ck-xcard" href="/tour/${encodeURIComponent(card.slug)}">
    <div class="ck-photo${photoClass}">${photo(card.cover, { alt: card.cover && card.cover.alt ? card.cover.alt : card.name, sizes: '(max-width: 720px) 100vw, 360px' })}${card.region ? regionStamp(card.region, { className: 'ck-xcard__stamp' }) : ''}</div>
    <div class="ck-xcard__body">
      <h3 class="ck-xcard__title">${card.name}</h3>
      <p class="ck-xcard__pair">${pairing(card.leadName, card.venueName)}</p>
      <div class="ck-xcard__meta"><span class="ck-xcard__date">${dateLine}</span>${price && !card.comingSoon ? html`<span class="ck-xcard__price ck-num">${price} <small>تومان</small></span>` : html`<span class="ck-xcard__price">اعلام می‌شود</span>`}</div>
    </div>
  </a>`;
}
