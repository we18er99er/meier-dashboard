// Shared library: Google service-account auth + GA4 + Search Console fetch helpers.
// Node 22+ (uses global fetch + crypto). No external dependencies.
const crypto = require('crypto');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'sa-key.json');
const GA4_PROPERTY = '333068678';
const SC_SITE = 'https://www.meier-shk.com/';

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function loadKey() {
  // Cloud (GitHub Actions): key comes from the GA_SA_KEY secret as a JSON string.
  if (process.env.GA_SA_KEY) return JSON.parse(process.env.GA_SA_KEY);
  // Local: read the key file next to the scripts.
  return require(KEY_PATH);
}

async function getAccessToken(scopes) {
  const key = loadKey();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: key.client_email,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key);
  const jwt = unsigned + '.' + b64url(sig);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Token-Fehler: ' + JSON.stringify(j));
  return j.access_token;
}

// --- date helpers (local time) ---
function iso(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }

async function ga4RunReport(token, body) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY}:runReport`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const j = await res.json();
  if (j.error) throw new Error('GA4-Fehler: ' + JSON.stringify(j.error));
  return j;
}

async function scQuery(token, body) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SC_SITE)}/searchAnalytics/query`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const j = await res.json();
  if (j.error) throw new Error('SC-Fehler: ' + JSON.stringify(j.error));
  return j;
}

module.exports = { getAccessToken, ga4RunReport, scQuery, iso, daysAgo, GA4_PROPERTY, SC_SITE };
