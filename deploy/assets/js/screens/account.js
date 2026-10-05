import { mount, $, $$, app, api, currentUser, withBusy, phoneMask } from '/assets/js/screens/lib.js';
import { accountShell, tripsView, reviewsView, partnerView, TABS } from '/assets/js/shared/screens/account.js';
import { setNotice } from '/assets/js/shared/screens/forms.js';
import { loginHref } from '/assets/js/shared/site.js';
import { html } from '/assets/js/shared/html.js';

const KEYS = TABS.map(([k]) => k);

(async () => {
  const user = await currentUser();
  if (!user) { location.replace(loginHref()); return; }
  const root = app();
  const fromHash = location.hash.replace('#', '');
  let tab = KEYS.includes(fromHash) ? fromHash : 'trips';
  mount(root, accountShell({ user, maskedPhone: phoneMask(user.phone), tab }));

  const loaded = new Set();
  async function fill(key) {
    if (loaded.has(key)) return;
    loaded.add(key);
    const panel = $(`[data-panel="${key}"]`, root);
    try {
      if (key === 'trips') mount(panel, tripsView((await api('GET', '/bookings/me')).data.bookings || []));
      if (key === 'reviews') mount(panel, reviewsView((await api('GET', '/me/reviews')).data.reviews || []));
      if (key === 'partner') {
        const [p, a] = await Promise.all([api('GET', '/me/profiles'), api('GET', '/me/applications')]);
        mount(panel, partnerView({ profiles: p.data.profiles || [], applications: a.data.applications || [] }));
      }
    } catch { loaded.delete(key); mount(panel, html`<p class="ac-note">بارگذاری ممکن نشد. صفحه را دوباره باز کنید.</p>`); }
  }
  function show(key) {
    tab = key;
    $$('[data-tab]', root).forEach((b) => { if (b.dataset.tab === key) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    $$('[data-panel]', root).forEach((p) => { p.hidden = p.dataset.panel !== key; });
    history.replaceState(null, '', key === 'trips' ? location.pathname : `#${key}`);
    fill(key);
  }
  $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  show(tab);

  const toggle = $('[data-edit-toggle]', root);
  const edit = $('#ac-edit', root);
  toggle.addEventListener('click', () => { edit.hidden = !edit.hidden; toggle.setAttribute('aria-expanded', String(!edit.hidden)); if (!edit.hidden) $('#firstName', edit).focus(); });

  const form = $('[data-name-form]', root);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setNotice(form, '');
    withBusy($('[data-save]', form), async () => {
      const r = await api('PUT', '/auth/me', { firstName: form.firstName.value.trim(), lastName: form.lastName.value.trim() });
      if (r.ok) { setNotice(form, 'نام شما ذخیره شد.', 'success'); const h = $('.ac-title', root); h.textContent = `سلام، ${r.data.user.firstName}`; return; }
      setNotice(form, r.status === 422 ? 'نام و نام خانوادگی را وارد کنید (حداکثر ۶۰ نویسه).' : 'ذخیره نشد. دوباره تلاش کنید.');
    });
  });
  $('[data-logout]', root).addEventListener('click', async () => { await api('POST', '/auth/logout', {}); location.assign('/'); });
})();
