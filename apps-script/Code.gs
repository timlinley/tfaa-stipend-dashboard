/** @OnlyCurrentDoc */
/**
 * TFAA Stipend Dashboard data feed.
 *
 * Sends the survey answers to the dashboard, without the names and emails of
 * the people who filled in the form. Paste this into the responses Sheet's
 * Apps Script editor (Extensions > Apps Script) and deploy it as a web app:
 *   Execute as: Me    Who has access: Anyone
 *
 * Sign-in: while REQUIRE_SIGN_IN is true, the feed only answers people who
 * signed in with Google on the dashboard and whose email is listed on the
 * Testers tab (one email per row in column A; "@district.org" lets in a whole
 * domain). Set REQUIRE_SIGN_IN to false to open the dashboard to everyone.
 *
 * Email codes: people who can't use Google sign-in can type their email and get
 * a 6-digit code instead. A code is only emailed to addresses on the Testers
 * tab, but the page always gives the same answer so nobody can probe the list.
 * Codes last 10 minutes and allow 5 tries. A code sign-in lasts SESSION_HOURS.
 *
 * To switch the dashboard off: Deploy > Manage deployments > Archive.
 */

// The Google sign-in Client ID from Google Cloud Console (ends in .apps.googleusercontent.com).
const CLIENT_ID = '863874017666-o6i3q2p6o1pjnv0flvh0r34l78rgl68h.apps.googleusercontent.com';
const REQUIRE_SIGN_IN = true;
const TESTERS_TAB = 'Testers';

const CODE_MINUTES = 10;       // how long an emailed code works
const CODE_TRIES = 5;          // wrong guesses allowed per code
const CODES_PER_HOUR = 5;      // codes one address can request per hour
const SESSION_HOURS = 8;       // how long a code sign-in lasts
const MAIL_NAME = 'TFAA Stipend Dashboard';

// Form columns that are never sent (matched on the header text).
const PRIVATE_COLUMNS = [/name of individual/i, /email/i];

// Opened without a sign-in (the old dashboard, or someone who found the address).
function doGet() {
  if (REQUIRE_SIGN_IN) return json_({ error: 'sign_in_required' });
  return json_(surveyData_());
}

// The dashboard sends the visitor's sign-in here (a Google sign-in or a code
// sign-in), or asks for / checks an emailed code.
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents) || {}; } catch (err) {}
  if (body.action === 'request_code') return json_(requestCode_(body.email));
  if (body.action === 'verify_code') return json_(verifyCode_(body.email, body.code));
  if (REQUIRE_SIGN_IN) {
    const token = String(body.token || '');
    const email = sessionEmail_(token) || verifiedEmail_(token);
    if (!email) return json_({ error: 'sign_in_required' });
    if (!isTester_(email)) return json_({ error: 'not_allowed', email: email });
  }
  return json_(surveyData_());
}

function surveyData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    responses: readTab_(ss, 'Form Responses 1', true),
    members: readTab_(ss, 'Member Districts', false),
    updated: new Date().toISOString()
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Asks Google whether the sign-in is genuine, current and made for this dashboard.
function verifiedEmail_(token) {
  if (!token || !CLIENT_ID) return null;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const p = JSON.parse(res.getContentText());
  if (p.aud !== CLIENT_ID) return null;
  if (String(p.email_verified) !== 'true') return null;
  if (!/^(https:\/\/)?accounts\.google\.com$/.test(p.iss)) return null;
  if (Number(p.exp) * 1000 < Date.now()) return null;
  return String(p.email).trim().toLowerCase();
}

function isTester_(email) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TESTERS_TAB);
  if (!sh) return false;
  return sh.getRange('A:A').getDisplayValues()
    .map(r => r[0].trim().toLowerCase())
    .filter(x => x.includes('@'))
    .some(x => x === email || (x.startsWith('@') && email.endsWith(x)));
}

// ---- Email codes ----

function cleanEmail_(email) {
  const e = String(email || '').trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

// Always answers { ok: true } for a well-formed address, listed or not.
function requestCode_(email) {
  email = cleanEmail_(email);
  if (!email) return { error: 'bad_email' };
  if (MailApp.getRemainingDailyQuota() < 1) return { error: 'mail_unavailable' };
  const cache = CacheService.getScriptCache();
  const key = keyFor_(email);
  const sent = JSON.parse(cache.get('sent:' + key) || '[]').filter(t => t > Date.now() - 3600000);
  if (sent.length >= CODES_PER_HOUR) return { ok: true };
  sent.push(Date.now());
  cache.put('sent:' + key, JSON.stringify(sent), 3600);
  // Unlisted: wait about as long as sending takes, so the answer looks the same.
  if (!isTester_(email)) { Utilities.sleep(700 + Math.floor(Math.random() * 600)); return { ok: true }; }
  const code = String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 1e6 + 1e6).slice(1);
  cache.put('code:' + key, JSON.stringify({ h: codeHash_(email, code), n: 0 }), CODE_MINUTES * 60);
  try {
    MailApp.sendEmail({
      to: email,
      name: MAIL_NAME,
      subject: code + ' is your TFAA Stipend Dashboard code',
      body: 'Your sign-in code for the TFAA Stipend Dashboard is ' + code + '.\n\n' +
        'It works for ' + CODE_MINUTES + ' minutes. If you did not ask for it, you can ignore this email.'
    });
  } catch (err) {
    console.error('Code email failed: ' + err);
  }
  return { ok: true };
}

function verifyCode_(email, code) {
  email = cleanEmail_(email);
  code = String(code || '').replace(/\D/g, '');
  if (!email || code.length !== 6) return { error: 'bad_code' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    const key = 'code:' + keyFor_(email);
    const saved = JSON.parse(cache.get(key) || 'null');
    if (!saved) return { error: 'code_expired' };
    if (saved.h !== codeHash_(email, code)) {
      saved.n++;
      if (saved.n >= CODE_TRIES) { cache.remove(key); return { error: 'code_expired' }; }
      cache.put(key, JSON.stringify(saved), CODE_MINUTES * 60);
      return { error: 'bad_code', left: CODE_TRIES - saved.n };
    }
    cache.remove(key);
  } finally {
    lock.releaseLock();
  }
  if (!isTester_(email)) return { error: 'code_expired' };
  return { session: makeSession_(email) };
}

// A code sign-in, shaped like a Google sign-in (header.payload.signature) so
// the page can read when it runs out. Signed with a key only this script knows.
function makeSession_(email) {
  const head = b64_(JSON.stringify({ alg: 'HS256', typ: 'TFAA' }));
  const body = b64_(JSON.stringify({ email: email, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 }));
  return head + '.' + body + '.' + sign_(head + '.' + body);
}

function sessionEmail_(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[2] !== sign_(parts[0] + '.' + parts[1])) return null;
  try {
    const p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString());
    if (Number(p.exp) * 1000 < Date.now()) return null;
    return cleanEmail_(p.email) || null;
  } catch (err) {
    return null;
  }
}

function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SESSION_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', s);
  }
  return s;
}

function sign_(text) {
  return b64_(Utilities.computeHmacSha256Signature(text, secret_()));
}

function codeHash_(email, code) {
  return b64_(Utilities.computeHmacSha256Signature(email + '|' + code, secret_()));
}

function keyFor_(email) {
  return b64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email)).slice(0, 40);
}

function b64_(v) {
  return Utilities.base64EncodeWebSafe(v).replace(/=+$/, '');
}

function readTab_(ss, name, dropPrivate) {
  const sh = ss.getSheetByName(name);
  if (!sh) return [];
  const rows = sh.getDataRange().getDisplayValues().filter(r => r.some(c => c !== ''));
  if (!dropPrivate || !rows.length) return rows;
  const keep = rows[0].map((h, i) => PRIVATE_COLUMNS.some(p => p.test(h)) ? -1 : i).filter(i => i >= 0);
  return rows.map(r => keep.map(i => r[i]));
}

// Run this once from the editor to check what the dashboard will receive.
function testFeed() {
  const data = surveyData_();
  console.log('Columns sent: ' + data.responses[0].length + ', responses: ' + (data.responses.length - 1) + ', member districts: ' + (data.members.length - 1));
  console.log('Header check (no names or emails): ' + data.responses[0].slice(0, 6).join(' | '));
  if (REQUIRE_SIGN_IN) {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TESTERS_TAB);
    console.log('Sign-in required. Client ID ' + (CLIENT_ID ? 'is set' : 'is MISSING') + '. Testers tab ' + (sh ? 'lists ' + sh.getRange('A:A').getDisplayValues().filter(r => r[0].includes('@')).length + ' entries' : 'is MISSING') + '.');
  }
  // Lets Apps Script ask for permission to check sign-ins with Google and to email codes.
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', { muteHttpExceptions: true });
  console.log('Code emails left today: ' + MailApp.getRemainingDailyQuota());
  secret_();
}

// Run this from the editor to email yourself a code and check the email path works.
function testCodeEmail() {
  const me = Session.getEffectiveUser().getEmail();
  console.log(isTester_(me.toLowerCase()) ? 'Sending a code to ' + me : me + ' is not on the Testers tab, so no code will be sent.');
  console.log(JSON.stringify(requestCode_(me)));
}
