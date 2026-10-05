import { html } from './html.js';

/**
 * «با {lead} در {venue}» / «با {lead}» / «در {venue}» / «طراحی چکمه».
 * Names are bold; returns template output.
 */
export function pairing(leadName, venueName) {
  const parts = [];
  if (leadName) parts.push(html`با <b>${leadName}</b>`);
  if (venueName) parts.push(html`در <b>${venueName}</b>`);
  if (!parts.length) return html`طراحی چکمه`;
  return parts.length === 2 ? html`${parts[0]} ${parts[1]}` : parts[0];
}
