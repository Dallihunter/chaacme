import { html } from '../html.js';

const KINDS = new Set(['active', 'pending', 'hidden', 'rejected', 'verified']);

/** Status pill; `kind` must be one of the design system's badge variants. */
export function statusBadge(kind, text) {
  if (!KINDS.has(kind) || !text) return null;
  return html`<span class="ck-badge ck-badge--${kind}">${text}</span>`;
}
