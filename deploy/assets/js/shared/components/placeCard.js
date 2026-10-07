import { html } from '../html.js';
import { photo } from './photo.js';
import { statusBadge } from './statusBadge.js';

/**
 * Photo card for a place (home, /places): the photo fills the card, name and
 * «lodging type · region» sit on a dark panel. No photo = a plain dark card.
 * `place`: { slug, name, verified, lodgingType, region, photo }
 */
export function placeCard(place) {
  const line = [place.lodgingType, place.region].filter(Boolean).join(' · ');
  return html`<a class="pl-card${place.photo ? '' : ' pl-card--plain'}" href="/host/${encodeURIComponent(place.slug)}">
    ${place.photo ? photo(place.photo, { alt: place.photo.alt || place.name, sizes: '(max-width: 720px) 100vw, 560px', className: 'pl-card__img' }) : ''}
    <span class="pl-card__panel">
      <span class="pl-card__name">${place.name}${place.verified ? html` ${statusBadge('verified', 'تأییدشده')}` : ''}</span>
      ${line ? html`<span class="pl-card__line">${line}</span>` : ''}
    </span>
  </a>`;
}
