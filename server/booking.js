// Online booking switch and the effective booking state of a tour.
//
// BOOKING_ONLINE_ENABLED is the site-wide switch for the site's own booking and payment flow. It is read at
// call time, defaults to OFF and only the exact values `true` and `1` turn it on (anything else, including a
// typo, leaves it off). While it is off the API refuses to create bookings or start payments for every tour
// and no page renders a payment form or booking button (see api.js and pagemodels.js).
import { isBookingMode, bookingLink, DEFAULT_BOOKING_LABEL } from '../deploy/assets/js/shared/booking.js';

export function onlineBookingEnabled(env = process.env) {
  const v = String(env.BOOKING_ONLINE_ENABLED ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/**
 * What a tour's booking card does right now, from the stored row (booking_mode, booking_url, booking_label,
 * booking_note) and the switch:
 *   effective 'online'    the site's booking form (mode online, switch on)
 *   effective 'external'  dates as information + one button to a valid booking_url
 *   effective 'none'      dates and notes only; `soon` is true for an online tour while the switch is off
 * A stored value that is not a known mode, and an external tour whose link is not valid, fail closed to 'none'.
 */
export function effectiveBooking(row, env = process.env) {
  const stored = row && row.booking_mode;
  const mode = isBookingMode(stored) ? stored : (stored == null ? 'online' : 'none');
  const link = mode === 'external' ? bookingLink(row.booking_url) : null;
  const effective = mode === 'online' ? (onlineBookingEnabled(env) ? 'online' : 'none') : (link ? 'external' : 'none');
  return {
    mode,
    effective,
    soon: mode === 'online' && effective === 'none',
    link,
    label: (row && row.booking_label) || DEFAULT_BOOKING_LABEL,
    note: (row && row.booking_note) || null
  };
}
