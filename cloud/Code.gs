/**
 * שרת סנכרון ל"לוח בקרה פדגוגי" – Google Apps Script (Web App).
 *
 * הגדרה:
 *  1. script.google.com ← פרויקט חדש ← הדביקו קובץ זה.
 *  2. Deploy ← New deployment ← Web app: Execute as "Me", Who has access "Anyone".
 *  3. העתיקו את כתובת ה-Web App להגדרות ← סנכרון ענן באפליקציה.
 *  בעדכון פרויקט קיים: Deploy ← Manage deployments ← Edit ← New version ← Deploy.
 *
 * קריאה (GET ?action=pull) וכתיבה (POST action=push) פתוחות לכל מי שמחזיק בכתובת, ללא סיסמה.
 * הנתונים מוצפנים בצד הלקוח רק אם הוגדר קוד בית-ספר. אין לשתף את הכתובת מחוץ לצוות.
 */
var FILE_NAME = 'school-dashboard-snapshot.json';

function snapshotFile_(create) {
  var it = DriveApp.getFilesByName(FILE_NAME);
  if (it.hasNext()) return it.next();
  return create ? DriveApp.createFile(FILE_NAME, '', MimeType.PLAIN_TEXT) : null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var f = snapshotFile_(false);
  if (!f) return json_({ ok: true, payload: null, updatedAt: 0 });
  var text = f.getBlob().getDataAsString();
  if (!text) return json_({ ok: true, payload: null, updatedAt: 0 });
  var snap = JSON.parse(text);
  return json_({ ok: true, updatedAt: snap.updatedAt, payload: snap.payload });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action !== 'push') return json_({ ok: false, error: 'פעולה לא מוכרת' });
    var updatedAt = Number(body.updatedAt) || Date.now();
    snapshotFile_(true).setContent(JSON.stringify({ updatedAt: updatedAt, payload: body.payload }));
    return json_({ ok: true, updatedAt: updatedAt });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
