import { html } from '../html.js';

export function emptyState({ title, text = null, compact = false }) {
  if (!title) return null;
  return html`<div class="ck-empty"><span class="ck-empty__mark"></span><p class="ck-empty__title">${title}</p>${text ? html`<p class="ck-empty__text">${text}</p>` : ''}</div>`;
}
