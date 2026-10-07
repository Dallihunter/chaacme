import { mount, $, app, api, currentUser, afterLoginTarget, withBusy } from '/assets/js/screens/lib.js';
import { loginView } from '/assets/js/shared/screens/auth.js';
import { setNotice } from '/assets/js/shared/screens/forms.js';

// The OTP backend is switched off (api.js OTP_AUTH_DISABLED): the tab stays hidden and password is the default.
// Flip both flags together to bring the SMS code flow back; the code and profile steps below already exist.
const OTP_LOGIN_DISABLED = true;
let mode = OTP_LOGIN_DISABLED ? 'password' : 'otp';
let phone = '';
let ticket = null;

const MESSAGES = {
  bad: 'شماره موبایل یا رمز عبور اشتباه است.', phone: 'شماره موبایل نامعتبر است.', rate: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
  code: 'کد وارد شده صحیح نیست.', exists: 'این نام کاربری قبلاً استفاده شده است.', generic: 'انجام نشد. دوباره تلاش کنید.', network: 'ارتباط با سرور برقرار نشد.'
};
const done = () => location.assign(afterLoginTarget());

function render(step = 'phone') {
  const root = app();
  mount(root, loginView({ mode, otpEnabled: !OTP_LOGIN_DISABLED, step, phone }));
  const form = $('[data-form]', root);
  const fail = (key) => setNotice(form, MESSAGES[key] || MESSAGES.generic);
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; render('phone'); }));
  const back = $('[data-back]', root); if (back) back.addEventListener('click', () => render('phone'));
  const first = $('input', form); if (first) first.focus();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setNotice(form, '');
    withBusy($('[data-submit]', form), async () => {
      try {
        if (step === 'phone' && mode === 'password') {
          phone = form.phone.value.trim();
          const r = await api('POST', '/auth/login', { phone, password: form.password.value });
          if (r.ok) return done();
          return fail(r.status === 429 ? 'rate' : 'bad');
        }
        if (step === 'phone') {
          phone = form.phone.value.trim();
          const r = await api('POST', '/auth/otp/request', { phone });
          if (r.ok) return render('code');
          return fail(r.status === 429 ? 'rate' : 'phone');
        }
        if (step === 'code') {
          const r = await api('POST', '/auth/otp/verify', { phone, code: form.code.value.trim() });
          if (!r.ok) return fail('code');
          if (r.data.status === 'existing') return done();
          ticket = r.data.ticket;
          return render('profile');
        }
        const r = await api('POST', '/auth/profile', { ticket, firstName: form.firstName.value.trim(), lastName: form.lastName.value.trim(), username: form.username.value.trim() });
        if (r.ok) return done();
        return fail(r.data.error === 'already_exists' ? 'exists' : 'generic');
      } catch { fail('network'); }
    });
  });
  const resend = $('[data-resend]', root);
  if (resend) resend.addEventListener('click', async () => { resend.disabled = true; await api('POST', '/auth/otp/request', { phone }); resend.textContent = 'کد دوباره ارسال شد'; });
}

(async () => {
  if (await currentUser()) return done();
  render('phone');
})();
