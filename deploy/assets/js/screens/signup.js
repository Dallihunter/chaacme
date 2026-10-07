import { mount, $, app, api, currentUser, afterLoginTarget, withBusy } from '/assets/js/screens/lib.js';
import { signupView } from '/assets/js/shared/screens/auth.js';
import { setNotice } from '/assets/js/shared/screens/forms.js';

const done = () => location.assign(afterLoginTarget());

(async () => {
  if (await currentUser()) return done();
  const root = app();
  mount(root, signupView());
  const form = $('[data-form]', root);
  // keep ?next= on the way to the other screen
  const qs = location.search;
  const alt = $('[data-login-link-alt]', root); if (alt && qs) alt.href = `/login${qs}`;
  form.phone.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setNotice(form, '');
    withBusy($('[data-submit]', form), async () => {
      try {
        const r = await api('POST', '/auth/signup', {
          phone: form.phone.value.trim(), password: form.password.value,
          firstName: form.firstName.value.trim(), lastName: form.lastName.value.trim(), username: form.username.value.trim()
        });
        if (r.ok) return done();
        setNotice(form, r.data.error === 'already_exists' ? 'این شماره یا نام کاربری قبلاً ثبت شده است.'
          : r.status === 429 ? 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.' : 'ثبت‌نام انجام نشد. اطلاعات را بررسی کنید.');
      } catch { setNotice(form, 'ارتباط با سرور برقرار نشد.'); }
    });
  });
})();
