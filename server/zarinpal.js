// ZarinPal payment gateway client. Sandbox vs. production is a single env
// flag resolved here — nowhere else in the codebase should hardcode a
// zarinpal.com URL, so flipping to production later is a config change, not
// a code change. Uses the platform's built-in fetch — no SDK, no dependency.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSandbox(env = process.env) {
  const v = (env.ZARINPAL_SANDBOX ?? 'true').trim().toLowerCase();
  return v !== 'false' && v !== '0';
}

export function looksLikeMerchantId(value) {
  return UUID_RE.test(String(value || '').trim());
}

/** Single source of truth for ZarinPal base URLs — see module comment above. */
export function zarinpalConfig(env = process.env) {
  const sandbox = isSandbox(env);
  // Test-only escape hatch so scripts/smoke.js can point this at a local
  // mock instead of the real sandbox network — never set in dev/production.
  const override = (env.ZARINPAL_BASE_URL_OVERRIDE || '').trim();
  const base = override || (sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com');
  return {
    sandbox,
    merchantId: (env.ZARINPAL_MERCHANT_ID || '').trim(),
    callbackUrl: (env.ZARINPAL_CALLBACK_URL || '').trim(),
    requestUrl: `${base}/pg/v4/payment/request.json`,
    verifyUrl: `${base}/pg/v4/payment/verify.json`,
    startPayUrl: (authority) => `${base}/pg/StartPay/${authority}`
  };
}

/**
 * Toman -> Rial conversion happens here and only here, at the point of
 * building the ZarinPal payload. Everywhere else in the system (DB, admin
 * panel, frontend display) stays in Toman exactly as stored.
 */
export function tomanToRial(amountToman) {
  return amountToman * 10;
}

export class ZarinpalError extends Error {
  constructor(message, { code, raw } = {}) {
    super(message);
    this.code = code;
    this.raw = raw;
  }
}

/** Starts a payment: returns { authority, redirectUrl }. Throws ZarinpalError on failure — never exposes `raw` to the caller's response. */
export async function requestPayment({ amountToman, description, mobile, orderId }, env = process.env) {
  const cfg = zarinpalConfig(env);
  let res, data;
  try {
    res = await fetch(cfg.requestUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        merchant_id: cfg.merchantId,
        amount: tomanToRial(amountToman),
        description,
        callback_url: cfg.callbackUrl,
        metadata: { order_id: orderId, ...(mobile ? { mobile } : {}) }
      })
    });
    data = await res.json();
  } catch (err) {
    throw new ZarinpalError('zarinpal_request_network_error', { raw: String(err && err.message || err) });
  }
  const code = data?.data?.code;
  const authority = data?.data?.authority;
  if (!res.ok || code !== 100 || !authority) {
    throw new ZarinpalError('zarinpal_request_failed', { code, raw: data });
  }
  return { authority, redirectUrl: cfg.startPayUrl(authority) };
}

/** Verifies a completed payment: returns { refId, alreadyVerified }. Throws ZarinpalError on failure. */
export async function verifyPayment({ amountToman, authority }, env = process.env) {
  const cfg = zarinpalConfig(env);
  let res, data;
  try {
    res = await fetch(cfg.verifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ merchant_id: cfg.merchantId, amount: tomanToRial(amountToman), authority })
    });
    data = await res.json();
  } catch (err) {
    throw new ZarinpalError('zarinpal_verify_network_error', { raw: String(err && err.message || err) });
  }
  const code = data?.data?.code;
  // 100 = verified now, 101 = already verified (e.g. a retried callback) —
  // both count as success; the callback handler still idempotency-guards on
  // the booking's own payment_status before touching it again.
  if (!res.ok || (code !== 100 && code !== 101)) {
    throw new ZarinpalError('zarinpal_verify_failed', { code, raw: data });
  }
  return { refId: data.data.ref_id, alreadyVerified: code === 101 };
}
