// Gallery lightbox, shared by the experience page and the profile pages.
// Progressive enhancement: the thumbnails are real links to the full image, so without
// JavaScript they still open it. No innerHTML: every value is written with textContent / attributes.
import { toFaDigits } from '/assets/js/shared/format.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function initLightbox() {
  const links = $$('[data-lb]');
  if (!links.length || typeof HTMLDialogElement === 'undefined') return;
  const items = links.map((a) => ({ src: a.dataset.lbSrc || a.href, alt: a.dataset.lbAlt || '', caption: a.dataset.lbCaption || '' }));
  let dialog = null; let img; let cap; let count; let index = 0; let opener = null;

  const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function build() {
    dialog = make('dialog', 'tp-lb');
    dialog.setAttribute('aria-label', 'گالری عکس‌ها');
    const fig = make('figure', 'tp-lb__fig');
    img = document.createElement('img');
    cap = make('figcaption', 'tp-lb__cap');
    fig.append(img, cap);
    const mk = (cls, label, glyph, fn) => { const b = make('button', `tp-lb__btn ${cls}`, glyph); b.type = 'button'; b.setAttribute('aria-label', label); b.addEventListener('click', fn); return b; };
    count = make('span', 'tp-lb__count');
    dialog.append(fig, mk('tp-lb__close', 'بستن', '×', () => dialog.close()), mk('tp-lb__prev', 'عکس قبلی', '›', () => show(index - 1)), mk('tp-lb__next', 'عکس بعدی', '‹', () => show(index + 1)), count);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { if (opener) opener.focus(); });
    dialog.addEventListener('keydown', (e) => {
      // RTL: the "next" arrow points left
      if (e.key === 'ArrowLeft') show(index + 1);
      else if (e.key === 'ArrowRight') show(index - 1);
    });
    document.body.append(dialog);
  }

  function show(i) {
    index = (i + items.length) % items.length;
    const it = items[index];
    img.src = it.src; img.alt = it.alt;
    cap.textContent = it.caption; cap.hidden = !it.caption;
    count.textContent = `${toFaDigits(index + 1)} / ${toFaDigits(items.length)}`;
  }

  function open(i, from) {
    if (!dialog) build();
    opener = from || null;
    show(i);
    if (!dialog.open) dialog.showModal();
  }

  links.forEach((a, i) => a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); open(i, a);
  }));
  const all = $('[data-lb-open]');
  if (all) all.addEventListener('click', (e) => { e.preventDefault(); open(0, all); });
}
