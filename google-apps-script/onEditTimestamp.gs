/**
 * Silent Auction — auto-stamp "Last Bid Time".
 *
 * Whenever a staff member changes the "Current Bid" cell on the Items or
 * Tickets tab, this writes the current time into that row's "Last Bid Time"
 * column as a readable date-time (e.g. 6/12/2026 9:24:42 AM). The dashboard
 * uses that timestamp to drive the anti-snipe extension, so staff only ever
 * have to type the new bid (and bidder) — the clock takes care of itself.
 *
 * SETUP
 *   1. In your Google Sheet: Extensions > Apps Script.
 *   2. Delete any placeholder code, paste this whole file, and Save.
 *   3. Reload the sheet. The simple onEdit trigger runs automatically — no
 *      manual trigger or special permissions to configure.
 *
 * The timestamp uses the spreadsheet's own timezone
 * (File > Settings > Time zone), so make sure that matches your event.
 */

// Tabs to watch, and which columns to read/write (matched by header text).
var WATCHED_TABS = {
  Items: { bidHeader: 'Current Bid', stampHeader: 'Last Bid Time' },
  Tickets: { bidHeader: 'Current Bid', stampHeader: 'Last Bid Time' },
};

function onEdit(e) {
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  var cfg = WATCHED_TABS[sheet.getName()];
  if (!cfg) return;

  var row = e.range.getRow();
  if (row === 1) return; // header row

  // Ignore multi-cell pastes that don't touch the bid column.
  var headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(normalizeHeader_);

  var bidCol = headers.indexOf(normalizeHeader_(cfg.bidHeader)) + 1;
  var stampCol = headers.indexOf(normalizeHeader_(cfg.stampHeader)) + 1;
  if (bidCol === 0 || stampCol === 0) return; // headers not found

  var editedFirstCol = e.range.getColumn();
  var editedLastCol = editedFirstCol + e.range.getNumColumns() - 1;
  if (bidCol < editedFirstCol || bidCol > editedLastCol) return;

  // A real date-time value (not text), shown like "6/12/2026 9:24:42 AM" — a
  // format the dashboard parses. Sheets renders it in the spreadsheet's own
  // timezone (File > Settings), so keep that matched to the event.
  var now = new Date();

  // Stamp every row the edit spanned (usually just one).
  for (var r = row; r < row + e.range.getNumRows(); r++) {
    var cell = sheet.getRange(r, stampCol);
    cell.setValue(now);
    cell.setNumberFormat('M/d/yyyy h:mm:ss AM/PM');
  }
}

function normalizeHeader_(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}
