import { html } from '../html.js';
import { photo } from './photo.js';
import { statusBadge } from './statusBadge.js';

const ROLE_LABEL = { lead: 'برگزارکننده', co_host: 'هم‌برگزارکننده', venue: 'محل برگزاری' };

/**
 * Card for a person or a place. `partner`: { slug, name, role?, roleLabel?, verified, expertise?, lodgingType?, region?, photo }.
 * kind 'person' (round avatar, expertise line) | 'place' (wide thumbnail, lodging type + locality line).
 */
export function partnerCard(partner, { kind = 'person' } = {}) {
  const isPlace = kind === 'place';
  const line = isPlace ? [partner.lodgingType, partner.region].filter(Boolean).join(' · ') : partner.expertise;
  const initial = String(partner.name || '').trim().charAt(0);
  // The label set for this person on this tour («موسیقی جز و بلوز») wins over the default role word.
  const role = partner.roleLabel || ROLE_LABEL[partner.role] || (isPlace ? ROLE_LABEL.venue : null);
  return html`<a class="ck-pcard ck-pcard--${isPlace ? 'place' : 'person'}" href="/host/${encodeURIComponent(partner.slug)}">
    <span class="ck-pcard__media${partner.photo ? '' : ' tp-initial'}">${partner.photo ? photo(partner.photo, { alt: partner.name, sizes: '88px' }) : initial}</span>
    <span>
      ${role ? html`<span class="ck-pcard__role" style="display:block">${role}</span>` : ''}
      <span class="ck-pcard__name">${partner.name} ${partner.verified ? statusBadge('verified', 'تأییدشده') : ''}</span>
      ${line ? html`<span class="ck-pcard__line" style="display:block">${line}</span>` : ''}
    </span>
  </a>`;
}
