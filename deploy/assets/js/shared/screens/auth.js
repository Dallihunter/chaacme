// Login and signup views. Behaviour lives in screens/login.js and screens/signup.js.
import { html } from '../html.js';
import { notice } from '../components/notice.js';
import { textField } from './forms.js';

const phoneField = (id = 'phone') => textField({ id, name: 'phone', label: 'شماره موبایل', type: 'tel', ltr: true, inputmode: 'numeric', autocomplete: 'tel', placeholder: '09123456789' });

export function loginView({ mode, otpEnabled, step = 'phone', phone = '' }) {
  const tabs = otpEnabled ? html`<div class="au-tabs" role="group" aria-label="روش ورود">
      <button type="button" class="ck-btn ${mode === 'otp' ? 'ck-btn--primary' : 'ck-btn--secondary'}" data-mode="otp" aria-pressed="${String(mode === 'otp')}">کد تایید پیامکی</button>
      <button type="button" class="ck-btn ${mode === 'password' ? 'ck-btn--primary' : 'ck-btn--secondary'}" data-mode="password" aria-pressed="${String(mode === 'password')}">رمز عبور</button>
    </div>` : '';
  if (step === 'code') {
    return html`<div class="au-card"><h1 class="au-title">کد تایید را وارد کنید</h1>
      <p class="au-sub">کد برای شمارهٔ <span class="ck-latin">${phone}</span> ارسال شد. <button type="button" class="au-link" data-back>شمارهٔ شما نیست؟</button></p>
      <form data-form novalidate>${textField({ id: 'code', label: 'کد تایید', ltr: true, inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 5 })}
        ${notice({ tone: 'error', hidden: true })}
        <button type="submit" class="ck-btn ck-btn--primary ck-btn--block" data-submit>تایید</button>
        <button type="button" class="ck-btn ck-btn--secondary ck-btn--block" data-resend>دریافت مجدد کد</button></form></div>`;
  }
  if (step === 'profile') {
    return html`<div class="au-card"><h1 class="au-title">اطلاعات خود را وارد کنید</h1>
      <form data-form novalidate><div class="fm-grid">${textField({ id: 'firstName', label: 'نام', autocomplete: 'given-name', maxlength: 60 })}${textField({ id: 'lastName', label: 'نام خانوادگی', autocomplete: 'family-name', maxlength: 60 })}</div>
        ${textField({ id: 'username', label: 'نام کاربری', ltr: true, autocomplete: 'username', maxlength: 30 })}
        ${notice({ tone: 'error', hidden: true })}
        <button type="submit" class="ck-btn ck-btn--primary ck-btn--block" data-submit>ورود / ثبت‌نام</button></form></div>`;
  }
  const password = mode === 'password';
  return html`<div class="au-card"><h1 class="au-title">به چکمه خوش آمدید</h1>
    <p class="au-sub">${password ? 'شمارهٔ موبایل و رمز عبور خود را وارد کنید.' : 'شمارهٔ موبایلی که به نام خودتان ثبت شده را وارد کنید.'}</p>
    ${tabs}
    <form data-form novalidate>${phoneField()}${password ? textField({ id: 'password', label: 'رمز عبور', type: 'password', autocomplete: 'current-password' }) : ''}
      ${notice({ tone: 'error', hidden: true })}
      <button type="submit" class="ck-btn ck-btn--primary ck-btn--block" data-submit>${password ? 'ورود' : 'ادامه'}</button></form>
    <p class="au-alt">حساب ندارید؟ <a href="/signup" data-signup-link>ثبت‌نام کنید</a></p>
    <p class="au-terms">ورود شما به معنای پذیرش شرایط استفاده از چکمه است.</p></div>`;
}

export function signupView() {
  return html`<div class="au-card"><h1 class="au-title">ثبت‌نام در چکمه</h1><p class="au-sub">برای ثبت‌نام، اطلاعات زیر را وارد کنید.</p>
    <form data-form novalidate>${phoneField()}
      ${textField({ id: 'password', label: 'رمز عبور', type: 'password', autocomplete: 'new-password', hint: 'حداقل ۸ نویسه.' })}
      <div class="fm-grid">${textField({ id: 'firstName', label: 'نام', autocomplete: 'given-name', maxlength: 60 })}${textField({ id: 'lastName', label: 'نام خانوادگی', autocomplete: 'family-name', maxlength: 60 })}</div>
      ${textField({ id: 'username', label: 'نام کاربری', ltr: true, autocomplete: 'username', maxlength: 30 })}
      ${notice({ tone: 'error', hidden: true })}
      <button type="submit" class="ck-btn ck-btn--primary ck-btn--block" data-submit>ثبت‌نام</button></form>
    <p class="au-alt">قبلاً ثبت‌نام کرده‌اید؟ <a href="/login" data-login-link-alt>وارد شوید</a></p>
    <p class="au-terms">ثبت‌نام شما به معنای پذیرش شرایط استفاده از چکمه است.</p></div>`;
}
