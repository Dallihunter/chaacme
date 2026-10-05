// Display formatting shared by the server renderer and the browser island.
// Persian digits, thousands separator and the Jalali calendar all come from
// Intl so the two sides can never disagree.

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Replaces ASCII digits with Persian digits. */
export function toFaDigits(value) {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[d]);
}

/** 23000000 -> "۲۳٬۰۰۰٬۰۰۰". Returns '' for anything that is not a finite number. */
export function formatNumberFa(value) {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return '';
  return toFaDigits(Math.round(n).toLocaleString('en-US').replace(/,/g, '٬'));
}

/** Price in Toman, number only (the currency word is rendered separately). */
export const formatPriceFa = formatNumberFa;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const jalali = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
const jalaliMonth = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'UTC', month: 'long' });

function parts(iso) {
  const m = ISO_DATE.exec(String(iso || ''));
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  // reject rolled-over dates such as 2026-13-45 or 2026-02-30
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== +m[2] - 1 || date.getUTCDate() !== +m[3]) return null;
  const p = Object.fromEntries(jalali.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: Number(p.day), month: Number(p.month), year: Number(p.year), monthName: jalaliMonth.format(date) };
}

/** "2026-10-30" -> "۸ آبان ۱۴۰۵" (Jalali). '' for a missing or invalid date. */
export function formatDateFa(iso, { year = true } = {}) {
  const p = parts(iso);
  if (!p) return '';
  return toFaDigits(`${p.day} ${p.monthName}${year ? ` ${p.year}` : ''}`);
}

/** Range such as "۸ تا ۱۰ آبان ۱۴۰۵" / "۲۸ مهر تا ۱ آبان ۱۴۰۵"; a single date when end is absent or equal. */
export function formatDateRangeFa(startIso, endIso) {
  const a = parts(startIso);
  if (!a) return '';
  const b = endIso && endIso !== startIso ? parts(endIso) : null;
  if (!b) return toFaDigits(`${a.day} ${a.monthName} ${a.year}`);
  if (a.year === b.year && a.month === b.month) return toFaDigits(`${a.day} تا ${b.day} ${a.monthName} ${a.year}`);
  if (a.year === b.year) return toFaDigits(`${a.day} ${a.monthName} تا ${b.day} ${b.monthName} ${a.year}`);
  return toFaDigits(`${a.day} ${a.monthName} ${a.year} تا ${b.day} ${b.monthName} ${b.year}`);
}

/** "2026-10-30" -> "1405-08": the Jalali year-month an edition starts in (filter key). null for an invalid date. */
export function jalaliMonthKey(iso) {
  const p = parts(iso);
  return p ? `${p.year}-${String(p.month).padStart(2, '0')}` : null;
}

/** "2026-10-30" -> "آبان ۱۴۰۵": label of that edition's Jalali month. '' for an invalid date. */
export function jalaliMonthLabel(iso) {
  const p = parts(iso);
  return p ? toFaDigits(`${p.monthName} ${p.year}`) : '';
}
