/**
 * Behavioural instrument — MVP write endpoint (§6.2).
 * Accept a POST, append one row, nothing else. No validation, no auth: see §2.
 */
const SHEET_ID   = '1d_iqVet3HQdW-Hdg_z9iOcCLpwoQ5Za0jOfB_1HRavw';
const SHEET_NAME = 'responses';
const HEADERS    = ['timestamp', 'participant_id', 'item_id', 'choice_id'];

function doGet() {
  return ContentService.createTextOutput('endpoint alive');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const row  = JSON.parse(e.postData.contents);
    const book = SpreadsheetApp.openById(SHEET_ID);
    let sheet  = book.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = book.insertSheet(SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, sheet.getMaxRows(), HEADERS.length).setNumberFormat('@');
      sheet.setFrozenRows(1);
    }

    const values = HEADERS.map(function (h) {
      return row[h] === undefined || row[h] === null ? '' : String(row[h]);
    });

    const r = sheet.getLastRow() + 1;
    sheet.getRange(r, 1, 1, HEADERS.length)
         .setNumberFormat('@')
         .setValues([values]);

    return ContentService.createTextOutput('ok');
  } finally {
    lock.releaseLock();
  }
}