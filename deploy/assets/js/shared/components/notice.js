import { html } from '../html.js';

const TONES = new Set(['pending', 'error', 'success']);

/** Notice banner. tone: undefined (info) | 'pending' | 'error' | 'success'. role="alert" for errors. */
export function notice({ title = null, text = null, tone = null, hidden = false, actions = null } = {}) {
  const cls = `ck-notice${TONES.has(tone) ? ` ck-notice--${tone}` : ''}`;
  return html`<div class="${cls}"${tone === 'error' ? html` role="alert"` : html` role="status"`}${hidden ? html` hidden` : ''}><span>${title ? html`<span class="ck-notice__title">${title}</span>` : ''}<span data-notice-text>${text}</span></span>${actions ? html`<span class="ck-notice__actions">${actions}</span>` : ''}</div>`;
}
