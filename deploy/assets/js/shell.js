// Loaded on every page. Fills the header's login slot with the signed-in state.
// Pages are cached and identical for everyone, so who is signed in is only known
// here, in the browser. No innerHTML: every value is written with textContent.
const ME_URL = '/api/auth/me';
const PROFILES_URL = '/api/me/profiles';

function link(href, text, className) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  if (className) a.className = className;
  return a;
}

async function getJson(url) {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function init() {
  const slots = Array.from(document.querySelectorAll('[data-auth-slot]'));
  if (!slots.length) return;
  const me = await getJson(ME_URL);
  if (!me || !me.user) return;
  const profiles = await getJson(PROFILES_URL);
  const owns = !!(profiles && Array.isArray(profiles.profiles) && profiles.profiles.length);
  for (const slot of slots) {
    const nodes = [];
    if (owns) nodes.push(link('/partner', 'پنل همکار'));
    nodes.push(link('/account', 'حساب من', 'ck-btn ck-btn--secondary ck-btn--sm'));
    slot.replaceChildren(...nodes);
    slot.dataset.signedIn = 'true';
  }
}

init();
