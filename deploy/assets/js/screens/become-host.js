import { mount, $, $$, app, api, currentUser, withBusy, phoneMask, rememberAfterLogin } from '/assets/js/screens/lib.js';
import { becomeHostView, becomeHostDone } from '/assets/js/shared/screens/becomeHost.js';
import { showErrors, setNotice } from '/assets/js/shared/screens/forms.js';

const FIELD_MESSAGES = {
  fullName: 'نام را کامل وارد کنید.', instagramHandle: 'نام کاربری اینستاگرام معتبر نیست؛ فقط حروف، عدد، نقطه و زیرخط.', expertise: 'زمینهٔ تخصص طولانی‌تر از حد مجاز است.',
  lodgingType: 'نوع مکان طولانی‌تر از حد مجاز است.', region: 'منطقه را وارد کنید (حداکثر ۱۲۰ نویسه).', capacityGuests: 'ظرفیت باید عددی بین ۱ تا ۵۰۰ باشد.',
  description: 'توضیحات را کامل‌تر بنویسید (حداقل ۱۰ و حداکثر ۲۰۰۰ نویسه).'
};

(async () => {
  const user = await currentUser();
  const root = app();
  const phone = user ? phoneMask(user.phone) : '';
  let kind = null;

  function render() {
    mount(root, becomeHostView({ signedIn: !!user, maskedPhone: phone, kind }));
    $$('[data-gate]', root).forEach((a) => a.addEventListener('click', () => rememberAfterLogin('/become-host')));
    $$('[data-kind]', root).forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; render(); const f = $('#fullName', root); if (f) f.focus(); }));
    const form = $('[data-form]', root);
    if (!form || !kind) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      showErrors(form, {}); setNotice(form, '');
      const payload = { kind, fullName: form.fullName.value.trim(), instagramHandle: form.instagramHandle.value.trim(), description: form.description.value.trim(), website: form.website.value };
      if (kind === 'place') {
        payload.region = form.region.value.trim(); payload.lodgingType = form.lodgingType.value;
        const cap = form.capacityGuests.value.trim(); if (cap) payload.capacityGuests = Number(cap);
      } else payload.expertise = form.expertise.value.trim();
      withBusy($('[data-submit]', form), async () => {
        try {
          const r = await api('POST', '/host-applications', payload);
          if (r.status === 201) {
            // the API answers identically for a stored, a duplicate and a honeypot submission
            mount($('.bh-card', root), becomeHostDone());
            $('[data-another]', root).addEventListener('click', () => { kind = null; render(); });
            return;
          }
          if (r.status === 422 && r.data.fields) {
            const errs = {}; for (const f of Object.keys(r.data.fields)) if (FIELD_MESSAGES[f]) errs[f] = FIELD_MESSAGES[f];
            showErrors(form, errs); setNotice(form, 'لطفاً موارد مشخص‌شده را اصلاح کنید.'); return;
          }
          setNotice(form, r.status === 429 ? 'تعداد درخواست‌های شما زیاد بوده است. لطفاً فردا دوباره تلاش کنید.'
            : r.status === 401 ? 'برای ارسال درخواست ابتدا وارد شوید.' : 'ارسال درخواست ممکن نشد. لطفاً دوباره تلاش کنید.');
        } catch { setNotice(form, 'ارتباط با سرور برقرار نشد.'); }
      });
    });
  }
  render();
})();
