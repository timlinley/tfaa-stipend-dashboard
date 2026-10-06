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
 * To switch the dashboard off: Deploy > Manage deployments > Archive.
 */

// The Google sign-in Client ID from Google Cloud Console (ends in .apps.googleusercontent.com).
const CLIENT_ID = '863874017666-o6i3q2p6o1pjnv0flvh0r34l78rgl68h.apps.googleusercontent.com';
const REQUIRE_SIGN_IN = true;
const TESTERS_TAB = 'Testers';

// Form columns that are never sent (matched on the header text).
const PRIVATE_COLUMNS = [/name of individual/i, /email/i];

// Opened without a sign-in (the old dashboard, or someone who found the address).
function doGet() {
  if (REQUIRE_SIGN_IN) return json_({ error: 'sign_in_required' });
  return json_(surveyData_());
}

// The dashboard sends the visitor's Google sign-in here.
function doPost(e) {
  if (REQUIRE_SIGN_IN) {
    let token = '';
    try { token = JSON.parse(e.postData.contents).token || ''; } catch (err) {}
    const email = verifiedEmail_(token);
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
  // Lets Apps Script ask for permission to check sign-ins with Google.
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', { muteHttpExceptions: true });
}
