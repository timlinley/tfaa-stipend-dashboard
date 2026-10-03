/**
 * TFAA Stipend Dashboard data feed.
 *
 * Sends the survey answers to the dashboard, without the names and emails of
 * the people who filled in the form. Paste this into the responses Sheet's
 * Apps Script editor (Extensions > Apps Script) and deploy it as a web app:
 *   Execute as: Me    Who has access: Anyone
 *
 * To switch the dashboard off: Deploy > Manage deployments > Archive.
 */

// Form columns that are never sent (matched on the header text).
const PRIVATE_COLUMNS = [/name of individual/i, /email/i];

function doGet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = {
    responses: readTab_(ss, 'Form Responses 1', true),
    members: readTab_(ss, 'Member Districts', false),
    updated: new Date().toISOString()
  };
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
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
  const data = JSON.parse(doGet().getContent());
  console.log('Columns sent: ' + data.responses[0].length + ', responses: ' + (data.responses.length - 1) + ', member districts: ' + (data.members.length - 1));
  console.log('Header check (no names or emails): ' + data.responses[0].slice(0, 6).join(' | '));
}
