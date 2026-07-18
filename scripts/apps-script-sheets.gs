/**
 * Айым → Google Sheets adapter.
 *
 * Owner setup (~20 minutes, no code needed after pasting):
 *  1. Create a Google Sheet.
 *  2. Extensions → Apps Script, delete the sample, paste this file, Save.
 *  3. Deploy → New deployment → type "Web app".
 *     Execute as: Me. Who has access: Anyone.
 *  4. Copy the Web app URL and send it to us — it goes into the salon's
 *     crm_config as {"sheets":{"url":"<that URL>"}}.
 *
 * Every booking, cancellation and lead is appended as a new row.
 */
function doPost(e) {
  var data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "bad json" })).setMimeType(
      ContentService.MimeType.JSON,
    );
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Айым") || ss.insertSheet("Айым");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Получено", "Тип", "Услуга", "Когда", "Мастер", "Клиент", "Телефон", "Комментарий"]);
  }
  sheet.appendRow([
    new Date(),
    data.type || "",
    data.service || "",
    data.label || "",
    data.master || "",
    data.client_name || "",
    data.client_phone || "",
    data.summary || "",
  ]);

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}
