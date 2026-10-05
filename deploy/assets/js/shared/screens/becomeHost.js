// /become-host (06): intro + steps on one side, the kind choice and a short form on the other.
import { html } from '../html.js';
import { notice } from '../components/notice.js';
import { textField, selectField } from './forms.js';

export const LODGING_OPTIONS = ['اقامتگاه بوم‌گردی', 'باغ', 'ویلا', 'فضای برگزاری بدون اقامت'];
const KINDS = [['person', 'برگزارکننده‌ام', 'مربی، راهنما یا هنرمند'], ['place', 'میزبانم', 'اقامتگاه، باغ یا فضای برگزاری']];

export function becomeHostView({ signedIn, maskedPhone, kind = null }) {
  const place = kind === 'place';
  const form = html`<form data-form class="bh-form" autocomplete="off" novalidate${kind ? '' : html` hidden`}>
    <div class="fm-grid">
      ${textField({ id: 'fullName', label: place ? 'نام مکان' : 'نام نمایشی', hint: place ? 'نامی که مکان با آن روی سایت معرفی می‌شود.' : 'نامی که روی صفحهٔ عمومی نمایش داده می‌شود.', maxlength: 80, span: true })}
      ${place ? html`${selectField({ id: 'lodgingType', label: 'نوع اقامت', options: LODGING_OPTIONS.map((o) => ({ value: o, label: o })) })}
        ${textField({ id: 'capacityGuests', label: 'ظرفیت تقریبی گروه', ltr: true, inputmode: 'numeric', placeholder: 'نفر' })}
        ${textField({ id: 'region', label: 'منطقه', hint: 'فقط منطقه؛ نشانی دقیق روی سایت منتشر نمی‌شود.', maxlength: 120, placeholder: 'روستا، شهرستان، استان', span: true })}`
    : textField({ id: 'expertise', label: 'زمینهٔ تخصص', maxlength: 120, placeholder: 'مثلاً انیمال فلو، عکاسی، کوهنوردی', span: true })}
      ${textField({ id: 'instagramHandle', label: html`اینستاگرام <small>(اختیاری)</small>`, ltr: true, maxlength: 30, placeholder: 'username', hint: 'فقط نام کاربری، بدون @ و بدون لینک.', span: true })}
      ${textField({ id: 'description', label: place ? 'چه چیزی این مکان را خاص می‌کند؟' : 'چه تجربه‌ای می‌خواهی برگزار کنی؟', area: true, maxlength: 2000, span: true })}
      ${textField({ id: 'accountPhone', name: 'accountPhone', label: html`شمارهٔ موبایل <small>(از حساب شما)</small>`, value: maskedPhone, ltr: true, readonly: true, hint: 'فقط تیم چکمه این شماره را می‌بیند و برای هماهنگی همکاری استفاده می‌شود.', span: true })}
    </div>
    <div class="bh-hp" aria-hidden="true"><label for="website">Website</label><input type="text" id="website" name="website" tabindex="-1" autocomplete="off"></div>
    ${notice({ tone: 'error', hidden: true })}
    <button type="submit" class="ck-btn ck-btn--primary ck-btn--block bh-submit" data-submit>ارسال درخواست</button>
  </form>`;
  const card = signedIn
    ? html`<div><div class="bh-step">قدم ۱ از ۲</div><h2 class="bh-h2">تو کدامی؟</h2></div>
      <div class="ck-kinds" role="group" aria-label="نوع همکاری">${KINDS.map(([k, title, desc]) => html`<button class="ck-kind ck-kind--${k}" type="button" data-kind="${k}" aria-pressed="${String(kind === k)}"><span class="ck-kind__mark" aria-hidden="true"></span><span class="ck-kind__title">${title}</span><span class="ck-kind__desc">${desc}</span></button>`)}</div>
      ${form}`
    : html`<h2 class="bh-h2">ابتدا وارد شوید</h2>${notice({ text: 'یک پروفایل همکار به یک حساب تعلق دارد؛ برای درخواست همکاری ابتدا وارد شوید یا ثبت‌نام کنید.' })}
      <div class="bh-gate"><a class="ck-btn ck-btn--primary" href="/login" data-gate>ورود به حساب</a><a class="ck-btn ck-btn--secondary" href="/signup" data-gate>ساخت حساب</a></div>`;
  return html`<div class="bh">
    <section class="bh-intro"><h1 class="bh-title">با چکمه تجربه بساز</h1>
      <p class="bh-lead">اگر مربی، راهنما یا هنرمندی، یا مکانی داری که آدم‌ها باید تجربه‌اش کنند، چکمه تو را با نیمهٔ دیگرِ تجربه کنار هم می‌گذارد. طراحی، فروش و هماهنگی با ماست.</p>
      <ol class="bh-steps"><li><span class="bh-n" aria-hidden="true">۱</span><span>فرم کوتاه را بفرست.</span></li><li><span class="bh-n" aria-hidden="true">۲</span><span>تیم چکمه بررسی می‌کند و تماس می‌گیرد.</span></li><li><span class="bh-n" aria-hidden="true">۳</span><span>پروفایل کاملت را در پنل همکار می‌سازی.</span></li></ol></section>
    <section class="bh-card" aria-live="polite">${card}</section>
  </div>`;
}

export function becomeHostDone() {
  return html`<h2 class="bh-h2">درخواست شما ثبت شد</h2>${notice({ tone: 'success', text: 'تیم چکمه درخواست را بررسی می‌کند و در صورت نیاز با شمارهٔ حساب شما تماس می‌گیرد. بعد از تأیید، پروفایل شما ساخته می‌شود و از «پنل همکار» می‌توانید آن را کامل کنید. هر تغییر قبل از انتشار توسط تیم چکمه بازبینی می‌شود.' })}
    <div class="bh-gate"><a class="ck-btn ck-btn--primary" href="/partner">رفتن به پنل همکار</a><button type="button" class="ck-btn ck-btn--secondary" data-another>ارسال درخواست دیگر</button></div>`;
}
