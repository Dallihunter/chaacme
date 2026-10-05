import { html } from '../html.js';
import { toFaDigits } from '../format.js';

const fa = (n) => toFaDigits(Number(n).toFixed(2)).replace('.', '٫');

/**
 * The approximate location of a place, drawn as a plain SVG: a graticule whose cells are the
 * rounding unit (0.01° ≈ 1 km) and a dashed circle over the middle one. No map tiles, no
 * third-party script. `area` = { lat, lng } already rounded by the server; `label` = the region text.
 */
export function mapArea(area, label = null) {
  if (!area || !Number.isFinite(Number(area.lat)) || !Number.isFinite(Number(area.lng))) return null;
  const coords = `${fa(area.lat)}، ${fa(area.lng)}`;
  const lines = [];
  for (let i = 1; i < 6; i++) lines.push(html`<path d="M${i * 80} 0V280"/><path d="M0 ${i * 46.6}H480"/>`);
  return html`<div class="pf-map" role="img" aria-label="${`محدودهٔ تقریبی${label ? `: ${label}` : ''} (${coords})`}">
    <svg viewBox="0 0 480 280" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <g class="pf-map__grid" fill="none" stroke-width="1">${lines}</g>
      <circle class="pf-map__area" cx="240" cy="140" r="64" stroke-width="1.5" stroke-dasharray="5 5"></circle>
    </svg>
    ${label ? html`<span class="pf-map__label">${label}</span>` : ''}
    <span class="pf-map__coords ck-num">${coords}</span>
  </div>`;
}
