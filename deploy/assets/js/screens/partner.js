import { mount, $, $$, app, api, currentUser, withBusy, rememberAfterLogin } from '/assets/js/screens/lib.js';
import * as V from '/assets/js/shared/screens/partner.js';
import { showErrors, setNotice } from '/assets/js/shared/screens/forms.js';
import { loginHref } from '/assets/js/shared/site.js';
import { html } from '/assets/js/shared/html.js';

const ERR = {
  length: 'طول متن مجاز نیست.', range: 'مقدار خارج از محدوده است.', format: 'قالب مقدار درست نیست.', type: 'مقدار نامعتبر است.',
  item_length: 'یکی از موارد بیش از حد طولانی است.', incomplete: 'عرض و طول جغرافیایی را با هم وارد کنید.', missing_upload: 'یکی از تصویرها پیدا نشد؛ دوباره بارگذاری کنید.',
  required: 'این بخش را کامل کنید.', value: 'مقدار نامعتبر است.'
};
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROUTE = /^\/partner(?:\/(experiences|propose)|\/profile\/([a-z0-9-]+))?\/?$/;

const root = app();
const page = (profiles, current, section, body) => mount(root, V.layout({ profiles, current, section, body }));

async function main() {
  const user = await currentUser();
  if (!user) {
    mount(root, V.message('برای ورود به پنل همکار ابتدا وارد حساب‌تان شوید.', '/login', 'ورود به حساب'));
    const a = $('a', root); a.addEventListener('click', () => rememberAfterLogin('/partner'));
    return;
  }
  let profiles = []; let applications = [];
  try {
    const [p, a] = await Promise.all([api('GET', '/me/profiles'), api('GET', '/me/applications')]);
    if (p.status === 401) { location.replace(loginHref()); return; }
    // the panel list carries each profile's pending-revision flag
    profiles = (await api('GET', '/partner/profiles')).data.profiles || p.data.profiles || [];
    applications = a.data.applications || [];
  } catch { mount(root, V.message('بارگذاری پنل ممکن نشد. لطفاً دوباره تلاش کنید.')); return; }

  if (!profiles.length) { mount(root, V.noProfiles({ pending: applications.filter((a) => a.status === 'pending') })); return; }

  const m = ROUTE.exec(location.pathname) || [];
  if (m[2]) return profileScreen(profiles, m[2]);
  if (m[1] === 'experiences') return experiencesScreen(profiles);
  if (m[1] === 'propose') return proposeScreen(profiles);
  page(profiles, null, 'dashboard', V.dashboardBody({ profiles, applications }));
}

// ------------------------------------------------------------------------------------------ experiences
async function experiencesScreen(profiles) {
  const groups = [];
  for (const p of profiles) {
    const r = await api('GET', `/partner/profiles/${encodeURIComponent(p.slug)}/experiences`);
    groups.push({ profile: p, list: r.ok ? r.data.experiences || [] : [] });
  }
  page(profiles, null, 'experiences', V.experiencesBody(groups));
}

// ------------------------------------------------------------------------------------------ propose
async function proposeScreen(profiles) {
  page(profiles, null, 'propose', V.proposeBody(profiles));
  const form = $('[data-propose-form]', root);
  const paint = async () => {
    const r = await api('GET', '/partner/proposals');
    mount($('[data-proposals]', root), V.proposalsList(r.ok ? r.data.proposals || [] : []));
  };
  paint();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showErrors(form, {}); setNotice(form, '');
    withBusy($('[data-submit]', form), async () => {
      const body = {
        profileSlug: form.profileSlug ? form.profileSlug.value : profiles[0].slug, title: form.title.value.trim(), description: form.description.value.trim(),
        preferredMonths: form.preferredMonths.value.trim(), wantedCounterpartKind: form.wantedCounterpartKind.value
      };
      const r = await api('POST', '/partner/proposals', body);
      if (r.status === 201) {
        form.title.value = ''; form.description.value = ''; form.preferredMonths.value = ''; form.wantedCounterpartKind.value = 'none';
        setNotice(form, 'پیشنهاد شما ثبت شد. تیم چکمه آن را بررسی می‌کند.', 'success');
        return paint();
      }
      if (r.status === 422 && r.data.fields) {
        showErrors(form, Object.fromEntries(Object.entries(r.data.fields).map(([k, v]) => [k, ERR[v] || ERR.value])));
        return setNotice(form, 'لطفاً موارد مشخص‌شده را اصلاح کنید (عنوان ۳ تا ۱۲۰ و توضیح ۱۰ تا ۲۰۰۰ نویسه).');
      }
      setNotice(form, r.status === 429 ? 'تعداد پیشنهادها زیاد شده است. کمی بعد دوباره تلاش کنید.' : 'ارسال ممکن نشد. دوباره تلاش کنید.');
    });
  });
}

// ------------------------------------------------------------------------------------------ profile editor
async function profileScreen(profiles, slug) {
  if (!SLUG.test(slug)) return page(profiles, null, 'profile', V.message('این پروفایل پیدا نشد یا به حساب شما تعلق ندارد.', '/partner', 'بازگشت به پنل'));
  const r = await api('GET', `/partner/profiles/${encodeURIComponent(slug)}`);
  if (!r.ok) return page(profiles, null, 'profile', V.message('این پروفایل پیدا نشد یا به حساب شما تعلق ندارد.', '/partner', 'بازگشت به پنل'));
  const view = r.data;
  const prof = view.profile;
  const place = prof.kind === 'place';
  const src = view.pendingRevision ? { ...prof, ...view.pendingRevision.payload } : prof;

  const state = {
    photoPath: src.photoPath || null,
    gallery: place ? (src.media || []).map((g) => ({ photoPath: g.photoPath, caption: g.caption || '', alt: g.alt || '' })) : []
  };
  const chips = {
    amenities: [...(src.amenities || [])], acceptsExperienceTypes: [...(src.acceptsExperienceTypes || [])], seekingPlaceTypes: [...(src.seekingPlaceTypes || [])]
  };
  page(profiles, slug, 'profile', V.profileBody({ view, state, chips }));
  const form = $('[data-profile-form]', root);
  const note = (text, tone) => setNotice(form, text, tone);

  const paintGallery = () => { mount($('[data-gallery]', root), V.galleryView(state, { place, slug })); };
  const msg = (t) => { const n = $('[data-gallery-msg]', root); if (n) n.textContent = t; };
  const paintChips = (name) => {
    const c = $(`[data-chips="${name}"]`, root);
    const max = name === 'amenities' ? 20 : 10;
    mount(c, V.chipsView(name, chips[name], { max, placeholder: name === 'amenities' ? 'مثلاً آب گرم' : '' }));
  };

  async function upload(file) {
    const fd = new FormData(); fd.append('file', file);
    const u = await api('POST', `/partner/profiles/${encodeURIComponent(slug)}/upload`, fd);
    if (!u.ok) throw new Error(u.status === 422 || u.status === 413 ? 'type' : 'fail');
    return u.data.path;
  }

  // Gallery: one delegated listener, re-rendering only on structural changes (typing a caption does not re-render).
  const gal = $('[data-gallery]', root);
  gal.addEventListener('input', (e) => { const i = e.target.dataset && e.target.dataset.cap; if (i !== undefined) state.gallery[Number(i)].caption = e.target.value; });
  gal.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if ('photoRemove' in d) { state.photoPath = null; return paintGallery(); }
    const i = Number(d.main ?? d.up ?? d.down ?? d.del);
    if (d.main !== undefined) { const old = state.photoPath; const item = state.gallery[i]; state.photoPath = item.photoPath; if (old) state.gallery[i] = { photoPath: old, caption: '', alt: '' }; else state.gallery.splice(i, 1); return paintGallery(); }
    if (d.up !== undefined && i > 0) { state.gallery.splice(i - 1, 0, state.gallery.splice(i, 1)[0]); return paintGallery(); }
    if (d.down !== undefined && i < state.gallery.length - 1) { state.gallery.splice(i + 1, 0, state.gallery.splice(i, 1)[0]); return paintGallery(); }
    if (d.del !== undefined) { state.gallery.splice(i, 1); return paintGallery(); }
  });
  gal.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-upload]')) return;
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      msg('در حال بارگذاری…');
      try {
        const path = await upload(f);
        if (!state.photoPath) state.photoPath = path;
        else if (place) { if (state.gallery.length >= 24) { msg('حداکثر ۲۴ تصویر.'); break; } state.gallery.push({ photoPath: path, caption: '', alt: '' }); }
        else state.photoPath = path;
        paintGallery(); msg('بارگذاری شد؛ بعد از تأیید چکمه منتشر می‌شود.');
      } catch (err) { msg(err.message === 'type' ? 'فقط تصویر JPG، PNG یا WebP تا ۵ مگابایت.' : 'بارگذاری ممکن نشد.'); }
    }
  });

  // chips
  form.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-chip-remove]');
    if (rm) { chips[rm.dataset.chipRemove].splice(Number(rm.dataset.i), 1); return paintChips(rm.dataset.chipRemove); }
    const add = e.target.closest('[data-chip-add]');
    if (add) commitChip(add.dataset.chipAdd);
  });
  form.addEventListener('keydown', (e) => {
    const inp = e.target.closest && e.target.closest('[data-chip-input]');
    if (inp && (e.key === 'Enter' || e.key === ',')) { e.preventDefault(); commitChip(inp.dataset.chipInput); }
  });
  function commitChip(name) {
    const inp = $(`[data-chip-input="${name}"]`, root);
    const v = inp ? inp.value.trim() : '';
    if (v && !chips[name].includes(v)) chips[name].push(v);
    paintChips(name);
    const again = $(`[data-chip-input="${name}"]`, root); if (again) again.focus();
  }
  const pendingChip = (name) => { const inp = $(`[data-chip-input="${name}"]`, root); if (inp && inp.value.trim()) commitChip(name); };

  const credBox = $('#credentialsPublic', root);
  if (credBox) credBox.addEventListener('change', () => { $('[data-cred-hint]', root).textContent = credBox.checked ? V.CRED_PUBLIC : V.CRED_PRIVATE; });

  const w = $('[data-withdraw]', root);
  if (w) w.addEventListener('click', async () => { w.disabled = true; await api('DELETE', `/partner/profiles/${encodeURIComponent(slug)}/revision`); profileScreen(profiles, slug); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showErrors(form, {}); note('');
    Object.keys(chips).forEach(pendingChip);
    const num = (v) => (v.trim() === '' ? null : Number(v));
    const body = { displayName: form.displayName.value.trim(), bio: form.bio.value.trim(), photoPath: state.photoPath || '', instagramHandle: form.instagramHandle.value.trim() };
    if (place) {
      Object.assign(body, {
        lodgingType: form.lodgingType.value.trim(), region: form.region.value.trim(), capacityGuests: num(form.capacityGuests.value),
        amenities: chips.amenities, houseRules: form.houseRules.value.trim(), acceptsExperienceTypes: chips.acceptsExperienceTypes,
        latitude: num(form.latitude.value), longitude: num(form.longitude.value),
        media: state.gallery.map((g) => ({ photoPath: g.photoPath, caption: (g.caption || '').trim(), alt: g.alt || '' }))
      });
    } else {
      Object.assign(body, { expertise: form.expertise.value.trim(), credentials: form.credentials.value.trim(), credentialsPublic: form.credentialsPublic.checked, seekingPlaceTypes: chips.seekingPlaceTypes });
    }
    withBusy($('[data-submit]'), async () => {
      try {
        const res = await api('PUT', `/partner/profiles/${encodeURIComponent(slug)}/revision`, body);
        if (res.status === 201) { await profileScreen(profiles, slug); const n = $('.ck-notice', root); if (n) $('[data-notice-text]', n).textContent = 'تغییرات برای بازبینی ارسال شد. بعد از تأیید تیم چکمه منتشر می‌شود.'; return; }
        if (res.status === 422 && res.data.fields) {
          const errs = {};
          for (const [k, v] of Object.entries(res.data.fields)) errs[k.startsWith('media.') ? 'media' : k] = ERR[v] || ERR.value;
          showErrors(form, errs);
          return note('لطفاً موارد مشخص‌شده را اصلاح کنید.');
        }
        note(res.status === 429 ? 'تعداد ارسال‌ها زیاد بوده است. کمی بعد دوباره تلاش کنید.' : res.status === 401 ? 'نشست شما تمام شده است؛ دوباره وارد شوید.' : 'ارسال ممکن نشد. دوباره تلاش کنید.');
      } catch { note('ارتباط با سرور برقرار نشد.'); }
    });
  });
  void html;
}

main();
