const http = require('http');
const https = require('https');

// Keep-Alive HTTP/HTTPS agents to avoid TLS/TCP handshake latency on every STK push request
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 10000,
});
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 10000,
});

// Pre-warm TCP/TLS connection to PayHero so first and recurring requests have zero handshake overhead
function prewarmPayHeroConnection() {
  try {
    const req = https.request({
      hostname: 'backend.payhero.co.ke',
      port: 443,
      path: '/api/v2/payments',
      method: 'OPTIONS',
      agent: httpsAgent,
      timeout: 5000,
    }, (res) => {
      res.resume(); // Discard data to release socket to keep-alive pool
    });
    req.on('error', () => {});
    req.end();
  } catch (e) {}
}

// Keep connection warm every 25 seconds
setInterval(prewarmPayHeroConnection, 25000).unref();
setTimeout(prewarmPayHeroConnection, 1000).unref();

// PayHero Kenya API v2 integration service
const PAYHERO_API_BASE = process.env.PAYHERO_API_BASE || 'https://backend.payhero.co.ke/api/v2';
const PAYHERO_API_KEY = process.env.PAYHERO_API_KEY || process.env.PAYHERO_API_USERNAME || '';
const PAYHERO_API_SECRET = process.env.PAYHERO_API_SECRET || process.env.PAYHERO_API_PASSWORD || '';
const PAYHERO_CHANNEL_ID = process.env.PAYHERO_CHANNEL_ID || '';
const PAYHERO_CREDENTIAL_ID = process.env.PAYHERO_CREDENTIAL_ID || '';
const PAYHERO_CALLBACK_URL = process.env.PAYHERO_CALLBACK_URL || 'https://api.betzion.site/api/payments/payhero/callback';
const PAYHERO_CALLBACK_TOKEN = process.env.PAYHERO_CALLBACK_TOKEN || '';

const PAYHERO_BASIC_AUTH = process.env.PAYHERO_BASIC_AUTH || process.env.PAYHERO_BASIC_AUTH_TOKEN || process.env.PAYHERO_AUTH_TOKEN || '';

function payHeroUrl(endpoint) {
  return new URL(`${PAYHERO_API_BASE.replace(/\/+$/, '')}${endpoint}`);
}

function isConfigured() {
  return Boolean(
    PAYHERO_CHANNEL_ID &&
    PAYHERO_CALLBACK_URL &&
    PAYHERO_CALLBACK_TOKEN &&
    (PAYHERO_BASIC_AUTH || (PAYHERO_API_KEY && PAYHERO_API_SECRET))
  );
}

function getConfigurationError() {
  if (!PAYHERO_CHANNEL_ID) return 'PAYHERO_CHANNEL_ID is not configured.';
  if (!PAYHERO_CALLBACK_URL) return 'PAYHERO_CALLBACK_URL is not configured.';
  if (!PAYHERO_CALLBACK_TOKEN) return 'PAYHERO_CALLBACK_TOKEN is not configured.';
  if (!PAYHERO_BASIC_AUTH && !(PAYHERO_API_KEY && PAYHERO_API_SECRET)) {
    return 'PayHero authentication is not configured.';
  }
  return null;
}

function getCallbackUrl() {
  if (!PAYHERO_CALLBACK_URL) return '';
  try {
    const callbackUrl = new URL(PAYHERO_CALLBACK_URL);
    if (PAYHERO_CALLBACK_TOKEN) callbackUrl.searchParams.set('token', PAYHERO_CALLBACK_TOKEN);
    return callbackUrl.toString();
  } catch {
    return PAYHERO_CALLBACK_URL;
  }
}

/**
 * Normalize Kenyan mobile number to 07... or 01... format expected by PayHero v2
 */
function formatPayHeroPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('254')) {
    digits = digits.slice(3);
  }
  if (digits.startsWith('0')) {
    return digits;
  }
  return `0${digits}`;
}

/**
 * Format authorization header for PayHero API.
 */
function getAuthHeader() {
  if (PAYHERO_BASIC_AUTH) {
    return PAYHERO_BASIC_AUTH.startsWith('Basic ') ? PAYHERO_BASIC_AUTH : `Basic ${PAYHERO_BASIC_AUTH}`;
  }
  if (PAYHERO_API_SECRET) {
    const credentials = `${PAYHERO_API_KEY}:${PAYHERO_API_SECRET}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }
  return `Bearer ${PAYHERO_API_KEY}`;
}

/**
 * Send HTTP POST request to PayHero API.
 */
function payHeroPost(endpoint, bodyData) {
  return new Promise((resolve, reject) => {
    const url = payHeroUrl(endpoint);
    const postData = JSON.stringify(bodyData);

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      agent: url.protocol === 'https:' ? httpsAgent : httpAgent,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(),
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 10000,
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('PayHero API request timed out'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Initiate an STK Push payment via PayHero API v2.
 * Official Docs: POST https://backend.payhero.co.ke/api/v2/payments
 */
async function initiateSTKPush({ amount, phone, reference, callbackUrl, customerName, credentialId }) {
  const finalCallback = callbackUrl || getCallbackUrl();

  const configurationError = getConfigurationError();
  if (configurationError || !isConfigured()) {
    return { success: false, configurationError: true, message: configurationError || 'PayHero is not configured for live payments.' };
  }

  // PayHero STK API expects Kenyan mobile numbers in local 07... / 01... format
  const phoneFormatted = formatPayHeroPhone(phone);

  const payload = {
    amount: Math.round(Number(amount)),
    phone_number: phoneFormatted,
    channel_id: Number(PAYHERO_CHANNEL_ID) || PAYHERO_CHANNEL_ID,
    provider: 'm-pesa',
    external_reference: String(reference),
    customer_name: customerName || 'Aviator Player',
    callback_url: finalCallback,
  };

  const activeCredentialId = credentialId || PAYHERO_CREDENTIAL_ID;
  if (activeCredentialId) {
    payload.credential_id = activeCredentialId;
  }

  try {
    console.log('PayHero STK Push request:', {
      amount: payload.amount,
      phone: `***${phoneFormatted.slice(-4)}`,
      channelId: payload.channel_id,
      reference: payload.external_reference,
    });
    const res = await payHeroPost('/payments', payload);
    const body = res?.data || {};
    const response = body.response || body.data || body;
    console.log(`PayHero STK Push response: HTTP ${res?.statusCode}`, {
      status: response?.status || body?.status || null,
      reference: response?.external_reference || response?.reference || body?.reference || reference,
    });

    if (res && (res.statusCode === 200 || res.statusCode === 201) && body.success !== false && response.success !== false && !body.error && !response.error) {
      return {
        success: true,
        status: response.status || body.status || 'QUEUED',
        checkoutRequestId: response.CheckoutRequestID || response.checkout_request_id || response.transaction_id || body.CheckoutRequestID || body.checkout_request_id || body.transaction_id || body.reference || reference,
        // PayHero's `reference` is the value required for transaction-status.
        // `external_reference` belongs to our application and is retained
        // separately for callback matching.
        reference: response.reference || body.reference || response.payment_reference || body.payment_reference || response.external_reference || body.external_reference || reference,
        externalReference: reference,
        message: response.message || body.message || 'STK Push sent successfully. Check your phone to enter M-Pesa PIN.',
        data: body,
      };
    }

    return {
      success: false,
      message: response.message || response.error_message || response.error || body.message || body.error_message || body.error || `PayHero returned HTTP ${res?.statusCode}`,
      data: body,
    };
  } catch (err) {
    console.error('PayHero STK Push connection failed:', err.message);
    return {
      success: false,
      retryable: true,
      message: err.message || 'Failed to connect to PayHero payment gateway',
    };
  }
}

/**
 * Send HTTP GET request to PayHero API.
 */
function payHeroGet(endpoint) {
  return new Promise((resolve) => {
    const url = payHeroUrl(endpoint);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      agent: url.protocol === 'https:' ? httpsAgent : httpAgent,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(),
      },
      timeout: 10000,
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', (err) => resolve({ statusCode: 500, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 500, error: 'timeout' }); });
    req.end();
  });
}

/**
 * Proactively query STK Push payment status directly from PayHero API v2.
 * Official Docs: GET https://backend.payhero.co.ke/api/v2/transaction-status?reference=...
 */
async function checkSTKPushStatusForReference(ref) {
  try {
    const res = await payHeroGet(`/transaction-status?reference=${encodeURIComponent(ref)}`);
    const data = res.data || {};
    let responseObj = data.response || data.data || data;
    if (Array.isArray(responseObj)) {
      responseObj = responseObj[0] || {};
    }

    const rawStatus = (
      responseObj.status ||
      responseObj.Status ||
      responseObj.payment_status ||
      data.status ||
      data.payment_status ||
      ''
    ).toString().toUpperCase();

    const receiptNumber =
      responseObj.third_party_reference ||
      responseObj.provider_reference ||
      responseObj.MpesaReceiptNumber ||
      responseObj.mpesa_code ||
      responseObj.receipt_number ||
      responseObj.transaction_reference ||
      data.third_party_reference ||
      data.provider_reference ||
      data.receipt_number ||
      data.transaction_reference ||
      null;

    // `success` can describe whether the status API call itself succeeded;
    // it is not proof that the customer approved the STK prompt. Credit only
    // after PayHero reports an explicit final payment status.
    const isSuccess = ['SUCCESS', 'SUCCESSFUL', 'COMPLETED'].includes(rawStatus);

    const isFailed = ['FAILED', 'CANCELLED', 'CANCELED', 'REJECTED', 'TIMEOUT', 'EXPIRED'].includes(rawStatus);

    if (isSuccess || isFailed) {
      return {
        checked: true,
        isSuccess: Boolean(isSuccess),
        isFailed: Boolean(!isSuccess && isFailed),
        status: isSuccess ? 'COMPLETED' : 'FAILED',
        receiptNumber: receiptNumber || null,
        amount: responseObj.Amount || responseObj.amount || responseObj.paid_amount || responseObj.transaction_amount || data.amount || data.paid_amount || null,
        reason: responseObj.ResultDesc || responseObj.result_desc || responseObj.message || data.message || null,
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function checkSTKPushStatus({ reference, checkoutRequestId, externalReference }) {
  if (!isConfigured()) return null;

  // PayHero responses can use a provider reference, a checkout ID, or the
  // merchant's external reference. Probe each distinct value so a delayed
  // callback cannot leave an otherwise-final payment stuck as pending.
  const references = [...new Set([reference, checkoutRequestId, externalReference]
    .map((value) => String(value || '').trim())
    .filter(Boolean))];

  for (const ref of references) {
    const result = await checkSTKPushStatusForReference(ref);
    if (result) return result;
  }
  return null;
}

module.exports = {
  isConfigured,
  getConfigurationError,
  getCallbackUrl,
  initiateSTKPush,
  checkSTKPushStatus,
};
