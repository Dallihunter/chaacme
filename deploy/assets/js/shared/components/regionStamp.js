import { html } from '../html.js';
import { regionInfo } from '../regions.js';

/** Coloured region pill. `region` is a key ('forest') or a regionInfo() object; unknown / empty renders nothing. */
export function regionStamp(region, { className = '' } = {}) {
  const info = typeof region === 'string' ? regionInfo(region) : region;
  if (!info || !info.label || !regionInfo(info.key)) return null;
  return html`<span class="ck-stamp ck-stamp--${info.tone}${className ? ` ${className}` : ''}">${info.label}</span>`;
}
