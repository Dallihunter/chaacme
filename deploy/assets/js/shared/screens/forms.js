// Form pieces for the client-rendered screens. Plain template functions; the screen scripts attach behaviour.
// Error text is written into [data-error="<name>"] with textContent.
import { html } from '../html.js';

const attr = (name, value) => (value === undefined || value === null || value === false ? '' : html` ${name}="${value}"`);

/**
 * Text-like field. `area` renders a textarea; `ltr` is for phone numbers, handles and URLs.
 * Every field has a visible <label>, an optional hint and an error slot wired with aria-describedby.
 */
export function textField({ id, name = id, label, hint = null, value = '', type = 'text', ltr = false, area = false, maxlength = null, inputmode = null, autocomplete = null, readonly = false, placeholder = null, min = null, max = null, step = null, span = false, rows = null, changed = false }) {
  const cls = `ck-input${ltr ? ' ck-input--ltr' : ''}`;
  const common = html`${attr('id', id)}${attr('name', name)}${attr('maxlength', maxlength)}${attr('inputmode', inputmode)}${attr('autocomplete', autocomplete)}${attr('placeholder', placeholder)}${readonly ? html` readonly` : ''} aria-describedby="${id}-msg"`;
  const control = area
    ? html`<textarea class="${cls}"${common}${attr('rows', rows)}>${value ?? ''}</textarea>`
    : html`<input class="${cls}" type="${type}"${common}${attr('min', min)}${attr('max', max)}${attr('step', step)} value="${value ?? ''}">`;
  return html`<div class="ck-field${span ? ' fm-span' : ''}${changed ? ' ck-field--changed' : ''}"><label class="ck-field__label" for="${id}">${label}</label>${control}<span id="${id}-msg">${changed ? html`<span class="ck-field__help">تغییر کرده · در انتظار بررسی</span>` : ''}${hint ? html`<span class="ck-field__help">${hint}</span>` : ''}<span class="ck-field__error" data-error="${name}" hidden></span></span></div>`;
}

export function selectField({ id, name = id, label, options, value = '', span = false, hint = null }) {
  return html`<div class="ck-field${span ? ' fm-span' : ''}"><label class="ck-field__label" for="${id}">${label}</label>
    <select class="ck-input" id="${id}" name="${name}" aria-describedby="${id}-msg">${options.map((o) => html`<option value="${o.value}"${String(o.value) === String(value) ? html` selected` : ''}>${o.label}</option>`)}</select>
    <span id="${id}-msg">${hint ? html`<span class="ck-field__help">${hint}</span>` : ''}<span class="ck-field__error" data-error="${name}" hidden></span></span></div>`;
}

/** Writes server field errors into the [data-error] slots under `root`; returns true if any slot was filled. */
export function showErrors(root, errors) {
  let any = false;
  root.querySelectorAll('[data-error]').forEach((n) => { n.hidden = true; n.textContent = ''; const i = root.querySelector(`#${CSS.escape(n.dataset.error)}`); if (i) i.removeAttribute('aria-invalid'); });
  for (const [name, text] of Object.entries(errors || {})) {
    const slot = root.querySelector(`[data-error="${CSS.escape(name)}"]`);
    if (!slot) continue;
    slot.textContent = text; slot.hidden = false; any = true;
    const input = root.querySelector(`[name="${CSS.escape(name)}"]`);
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  return any;
}

/** Fills / hides a notice made by components/notice.js. */
export function setNotice(root, text, tone = 'error') {
  const boxes = root.querySelectorAll('.ck-notice');
  const box = boxes[boxes.length - 1]; // the form's error notice is always its last one
  if (!box) return;
  box.hidden = !text;
  box.className = `ck-notice${tone ? ` ck-notice--${tone}` : ''}`;
  if (tone === 'error') box.setAttribute('role', 'alert'); else box.setAttribute('role', 'status');
  const t = box.querySelector('[data-notice-text]');
  if (t) t.textContent = text || '';
}
