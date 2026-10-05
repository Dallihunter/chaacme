import { html, safeUrl } from '../html.js';

/**
 * Responsive <img> for a described image (server/images.js describeImage()):
 * srcset over the generated WebP widths, explicit width/height (no layout
 * shift), lazy by default, and the original file when no variants exist.
 * `alt` is required for content images; pass '' only for purely decorative ones.
 */
export function photo(image, { alt, sizes = '100vw', eager = false, className = null } = {}) {
  if (!image || !image.path) return null;
  const variants = Array.isArray(image.variants) ? image.variants : [];
  const largest = variants[variants.length - 1];
  const src = safeUrl(largest ? largest.url : image.path, '');
  if (!src) return null;
  const srcset = variants.map((v) => `${safeUrl(v.url, '')} ${v.width}w`).join(', ');
  const text = alt !== undefined ? alt : image.alt || '';
  const dims = image.width > 0 && image.height > 0;
  return html`<img${className ? html` class="${className}"` : ''} src="${src}"${srcset ? html` srcset="${srcset}" sizes="${sizes}"` : ''}${dims ? html` width="${image.width}" height="${image.height}"` : ''} loading="${eager ? 'eager' : 'lazy'}" decoding="async"${eager ? html` fetchpriority="high"` : ''} alt="${text}">`;
}
