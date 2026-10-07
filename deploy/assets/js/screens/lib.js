// Helpers shared by the client-rendered screens. No innerHTML anywhere: templates are mounted with mount().
import { mount } from '/assets/js/shared/mount.js';
import { safeNext } from '/assets/js/shared/next.js';

export { mount };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const app = () => document.getElementById('app');

/** JSON / FormData request to /api. Resolves { status, data } for any HTTP status; rejects only on network failure. */
export async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, opts);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data: data || {}, ok: res.ok };
}

export async function currentUser() {
  try {
    const r = await api('GET', '/auth/me');
    return r.ok && r.data.user ? r.data.user : null;
  } catch { return null; }
}

/** Where login / signup send the browser afterwards: an allowed ?next=, else a remembered destination, else /account. */
export function afterLoginTarget() {
  const fromQuery = safeNext(new URLSearchParams(location.search).get('next'));
  if (fromQuery) return fromQuery;
  return takeAfterLogin() || '/account';
}

// The become-host and partner gates remember where the visitor was going. The value never comes from the URL:
// only these fixed paths are ever stored or read back.
const REMEMBER_KEY = 'chaacme:after-login';
const REMEMBERED = new Set(['/become-host', '/partner']);
export function rememberAfterLogin(path) { try { if (REMEMBERED.has(path)) sessionStorage.setItem(REMEMBER_KEY, path); } catch { /* storage blocked */ } }
function takeAfterLogin() {
  try {
    const v = sessionStorage.getItem(REMEMBER_KEY);
    sessionStorage.removeItem(REMEMBER_KEY);
    return REMEMBERED.has(v) ? v : null;
  } catch { return null; }
}

/** Debounce-free busy guard for a submit button. */
export async function withBusy(button, fn) {
  if (button) button.disabled = true;
  try { return await fn(); } finally { if (button) button.disabled = false; }
}

export const phoneMask = (phone) => {
  const p = String(phone || '');
  return p.length >= 8 ? `${p.slice(0, 4)} *** ${p.slice(-4)}` : '';
};
