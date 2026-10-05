// The page frame every server-rendered screen shares: <head> (title, meta, OG, assets),
// skip link, header, <main>, footer. Plain functions, no DOM.
import { html, jsonForScript } from './html.js';
import { header } from './components/header.js';
import { footer } from './components/footer.js';

/**
 * `assets`: { css, font, scripts: [url], imports: { '/assets/js/…': '/assets/js/…?v=…' } }
 * Every value that reaches the head (title, description, URLs) is escaped by html``.
 */
export function documentHtml({ title, description = '', canonical = null, ogImage = null, ogType = 'website', robots = null, assets, body, bodyClass = '' }) {
  const scripts = assets.scripts || [];
  return html`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${description ? html`<meta name="description" content="${description}">` : ''}
${robots ? html`<meta name="robots" content="${robots}">` : ''}
${canonical ? html`<link rel="canonical" href="${canonical}">` : ''}
<meta property="og:site_name" content="CHAACME">
<meta property="og:locale" content="fa_IR">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${title}">
${description ? html`<meta property="og:description" content="${description}">` : ''}
${canonical ? html`<meta property="og:url" content="${canonical}">` : ''}
${ogImage ? html`<meta property="og:image" content="${ogImage}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${ogImage}">` : html`<meta name="twitter:card" content="summary">`}
<meta name="twitter:title" content="${title}">
${description ? html`<meta name="twitter:description" content="${description}">` : ''}
<link rel="preload" href="${assets.font}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${assets.css}">
${scripts.length ? html`<script type="importmap">${jsonForScript({ imports: assets.imports || {} })}</script>${scripts.map((s) => html`<script type="module" src="${s}"></script>`)}` : ''}
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}

/**
 * Header + main + footer inside .ck-root.
 *   headerOptions  passed to header(); false = the page renders its own (home puts it inside the hero)
 *   site           { footerLinks } from siteContext()
 *   footer         false for the partner panel
 *   before/after   template output placed before <main> / after the footer (sticky bar)
 */
export function pageFrame({ main, mainClass = '', mainId = 'main', headerOptions = {}, site = {}, withFooter = true, rootClass = '', after = null, mainAttrs = null }) {
  return html`<div class="ck-root ${rootClass}" dir="rtl">
  <a class="ck-skip" href="#${mainId}">پرش به محتوا</a>
  ${headerOptions === false ? '' : header(headerOptions)}
  <main class="${mainClass}" id="${mainId}"${mainAttrs}>${main}</main>
  ${withFooter ? footer({ links: site.footerLinks || [] }) : ''}
  ${after}
</div>`;
}
