/** @OnlyCurrentDoc */
/**
 * TFAA Stipend Dashboard feedback intake.
 *
 * Bound to the private "TFAA Stipend Feedback" Sheet (Extensions > Apps Script).
 * Deploy as a web app: Execute as: Me    Who has access: Anyone
 *
 * The dashboard sends one report as a text/plain POST. This script checks it, adds one row
 * to the Reports tab, and emails Tim the kind and tab only (never the note or an email address).
 * It answers {"ok":true} or {"ok":false,"error":"..."} and never returns stored reports.
 * A daily trigger runs purgeOld, which deletes rows older than 180 days.
 *
 * Security Light 10/28/2026: bound script, scopes spreadsheets.currentonly + script.send_mail only,
 * doPost is the only public function, alert recipient hardcoded, district checked against the member list.
 */

const ALERT_TO_ = 'tlinley@cadenzastrategy.com';
const TAB_ = 'Reports';
const HEADERS_ = ['Id', 'Received', 'Kind', 'Note', 'Email', 'Tab', 'Filters', 'District', 'Version', 'Status'];
const KINDS_ = {
  wrong_number: 'A number looks wrong',
  missing: 'Something is missing',
  page: "A button or page didn't work",
  confusing: 'Something is confusing',
  idea: 'An idea or request',
  other: 'Something else'
};
const MAX_ = { note: 1000, email: 120, tab: 60, filters: 300, version: 40 };
const MIN_SECONDS_ON_PAGE_ = 5;
const LIMIT_HOUR_ = 20, LIMIT_DAY_ = 100;
const KEEP_DAYS_ = 180;
const DISTRICTS_ = [
  "Abilene ISD",
  "Aldine ISD",
  "Alief ISD",
  "Allen ISD",
  "Alvin ISD",
  "Amarillo ISD",
  "Anaheim Union High School District (California)",
  "Angleton ISD",
  "Arlington ISD",
  "Austin ISD",
  "Azle ISD",
  "Bastrop ISD",
  "Beaumont ISD",
  "Belton ISD",
  "Birdville ISD",
  "Boerne ISD",
  "Bridgeport ISD",
  "Bryan ISD",
  "Carrollton-Farmers Branch ISD",
  "Celina ISD",
  "Channelview ISD",
  "Clear Creek ISD",
  "Cleburne ISD",
  "Clint ISD",
  "College Station ISD",
  "Comal ISD",
  "Commerce ISD",
  "Conroe ISD",
  "Coppell ISD",
  "Corpus Christi ISD",
  "Cypress-Fairbanks ISD",
  "Deer Park ISD",
  "Denison ISD",
  "Denton ISD",
  "DeSoto ISD",
  "Dickinson ISD",
  "Dripping Springs ISD",
  "Duncanville ISD",
  "Eagle Mountain-Saginaw ISD",
  "Ector County ISD",
  "Edcouch-Elsa ISD",
  "Edinburg CISD",
  "Elgin ISD",
  "Flour Bluff ISD",
  "Forney ISD",
  "Fort Bend ISD",
  "Fort Worth ISD",
  "Frenship ISD",
  "Frisco ISD",
  "Galena Park ISD",
  "Georgetown ISD",
  "Grand Prairie ISD",
  "Greenville County School District (South Carolina)",
  "Gregory-Portland ISD",
  "Harleton ISD",
  "Hays CISD",
  "Houston ISD",
  "Humble ISD",
  "Hurst-Euless-Bedford ISD",
  "Hutto ISD",
  "Irving ISD",
  "Judson ISD",
  "Katy ISD",
  "Keller ISD",
  "Kerrville ISD",
  "Killeen ISD",
  "Klein ISD",
  "La Porte ISD",
  "Lake Dallas ISD",
  "Lake Travis ISD",
  "Lamar CISD",
  "Laredo ISD",
  "Leander ISD",
  "Lewisville ISD",
  "Little Elm ISD",
  "Lockhart ISD",
  "Lubbock ISD",
  "Lubbock-Cooper ISD",
  "Magnolia ISD",
  "Mansfield ISD",
  "Manor ISD",
  "McAllen ISD",
  "McKinney ISD",
  "Medina Valley ISD",
  "Mesquite ISD",
  "Midway ISD",
  "Nacogdoches ISD",
  "New Braunfels ISD",
  "New Caney ISD",
  "North East ISD",
  "Northside ISD",
  "Northwest ISD",
  "Pasadena ISD",
  "Pearland ISD",
  "Pflugerville ISD",
  "Plano ISD",
  "Ponder ISD",
  "Prosper ISD",
  "Quinlan ISD",
  "Red Oak ISD",
  "Richardson ISD",
  "Rockwall ISD",
  "Round Rock ISD",
  "Royse City ISD",
  "Salem-Keizer Public Schools (Oregon)",
  "San Angelo ISD",
  "San Antonio ISD",
  "San Benito CISD",
  "San Felipe Del Rio CISD",
  "Santa Fe ISD",
  "Schertz-Cibolo-Universal City ISD",
  "Sharyland ISD",
  "Sheldon ISD",
  "Shepherd ISD",
  "Socorro ISD",
  "South Texas ISD",
  "Southwest ISD",
  "Spring ISD",
  "Springtown ISD",
  "Taylor ISD",
  "Temple ISD",
  "Texas City ISD",
  "Tomball ISD",
  "Tyler ISD",
  "United ISD",
  "Waller ISD",
  "Waxahachie ISD",
  "Weatherford ISD",
  "Wichita Falls ISD",
  "Willis ISD",
  "Wylie ISD",
  "Zapata County ISD"
];

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.website) return answer_(true);                       // honeypot: pretend it worked
    if (!(Number(body.seconds) >= MIN_SECONDS_ON_PAGE_)) return answer_(false, 'too_fast');
    const kind = String(body.kind || '');
    if (!KINDS_[kind]) return answer_(false, 'kind');
    const note = clean_(body.note, MAX_.note);
    if (!note) return answer_(false, 'note');
    const email = clean_(body.email, MAX_.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return answer_(false, 'email');
    const district = DISTRICTS_.indexOf(String(body.district || '')) >= 0 ? String(body.district) : (body.district ? 'Other' : '');

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (!underLimit_()) return answer_(false, 'busy');
      const sh = sheet_();
      const id = Utilities.getUuid().slice(0, 8);
      sh.appendRow([id, new Date(), kind, note, email, clean_(body.tab, MAX_.tab), clean_(body.filters, MAX_.filters),
        district, clean_(body.version, MAX_.version), 'open']);
    } finally {
      lock.releaseLock();
    }
    MailApp.sendEmail(ALERT_TO_, 'New TFAA Stipend Dashboard feedback',
      'Kind: ' + KINDS_[kind] + '\nTab: ' + clean_(body.tab, MAX_.tab) + '\n\nOpen App Feedback to read it.');
    return answer_(true);
  } catch (err) {
    return answer_(false, 'error');
  }
}

// Plain text only: strip control characters and markup brackets, trim, cap the length,
// and start any value that a spreadsheet could read as a formula with an apostrophe.
function clean_(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, '').trim().slice(0, max);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

// Global caps across all senders (the page has no sign-in, and Apps Script can't see IP addresses).
function underLimit_() {
  const c = CacheService.getScriptCache();
  const now = new Date();
  const hk = 'h' + Utilities.formatDate(now, 'UTC', 'yyyyMMddHH'), dk = 'd' + Utilities.formatDate(now, 'UTC', 'yyyyMMdd');
  const h = Number(c.get(hk) || 0), d = Number(c.get(dk) || 0);
  if (h >= LIMIT_HOUR_ || d >= LIMIT_DAY_) return false;
  c.put(hk, String(h + 1), 3700);
  c.put(dk, String(d + 1), 90000);
  return true;
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TAB_);
  if (!sh) {
    sh = ss.insertSheet(TAB_);
    sh.appendRow(HEADERS_);
    sh.setFrozenRows(1);
  }
  return sh;
}

function answer_(ok, error) {
  return ContentService.createTextOutput(JSON.stringify(ok ? { ok: true } : { ok: false, error: error }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Daily cleanup: delete reports older than 180 days. Tim adds the trigger once by hand
// (Triggers > Add Trigger > purgeOld, Time-driven, Day timer), so the script needs no trigger scope.
// This is the one other non-underscore function: time triggers can't call private (_) functions,
// and a web app only ever exposes doGet/doPost, so it can't be reached from the internet.
function purgeOld() {
  const sh = sheet_();
  const cutoff = new Date(Date.now() - KEEP_DAYS_ * 864e5);
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][1] instanceof Date && rows[i][1] < cutoff) sh.deleteRow(i + 1);
  }
}
