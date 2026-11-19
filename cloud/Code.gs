/**
 * שרת סנכרון ל"לוח בקרה פדגוגי" – Google Apps Script (Web App).
 *
 * הגדרה:
 *  1. script.google.com ← פרויקט חדש ← הדביקו קובץ זה.
 *  2. Deploy ← New deployment ← Web app: Execute as "Me", Who has access "Anyone".
 *  3. הגדירו API_TOKEN אקראי וחזק ב-Project Settings → Script Properties.
 *  4. הגדירו באפליקציה כתובת Web App, אותו אסימון וקוד בית-ספר להצפנה.
 *  בשדרוג: הגדירו FILE_ID למזהה קובץ תמונת המצב הקיים לפני השימוש.
 *  בעדכון פרויקט קיים: Deploy ← Manage deployments ← Edit ← New version ← Deploy.
 *
 * כל הפעולות דורשות POST עם אסימון. אין לשתף אסימון או קישור הצטרפות מחוץ לצוות.
 */
var FILE_NAME = 'school-dashboard-snapshot.json';

function snapshotFile_(create) {
  var props = PropertiesService.getScriptProperties();
  var fileId = props.getProperty('FILE_ID');
  // An inaccessible configured file is an error, not permission to replace it.
  if (fileId) return DriveApp.getFileById(fileId);
  if (!create) return null;
  var file = DriveApp.createFile(FILE_NAME, '', MimeType.PLAIN_TEXT);
  props.setProperty('FILE_ID', file.getId());
  return file;
}

function backupDaily_(file, props, today) {
  if (props.getProperty('LAST_BACKUP_DAY') === today || !file.getBlob().getDataAsString()) return;
  var parents = file.getParents();
  var folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  file.makeCopy('school-dashboard-backup-' + today + '.json', folder);
  var cutoff = new Date(Date.parse(today + 'T00:00:00Z') - 14 * 86400000).toISOString().slice(0, 10);
  var backups = folder.getFiles();
  while (backups.hasNext()) {
    var backup = backups.next();
    var match = /^school-dashboard-backup-(\d{4}-\d{2}-\d{2})\.json$/.exec(backup.getName());
    if (match && match[1] < cutoff) backup.setTrashed(true);
  }
  props.setProperty('LAST_BACKUP_DAY', today);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return json_({ ok: false, error: 'Use POST with token' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('API_TOKEN');
    if (!token) return json_({ ok: false, error: 'Server token not configured' });
    var body = JSON.parse(e.postData.contents);
    if (!body || body.token !== token) return json_({ ok: false, error: 'Unauthorized' });
    var rev = Number(props.getProperty('REV')) || 0;
    var updatedAt = Number(props.getProperty('UPDATED_AT')) || 0;
    if (body.action === 'meta') return json_({ ok: true, rev: rev, updatedAt: updatedAt });
    if (body.action === 'pull') {
      var file = snapshotFile_(false);
      var text = file ? file.getBlob().getDataAsString() : '';
      var snap = text ? JSON.parse(text) : null;
      return json_({ ok: true, rev: rev, updatedAt: updatedAt || (snap && snap.updatedAt) || 0, payload: snap ? snap.payload : null });
    }
    if (body.action !== 'push') return json_({ ok: false, error: 'פעולה לא מוכרת' });
    if (Number(body.baseRev) !== rev && !body.force) return json_({ ok: false, conflict: true, rev: rev, updatedAt: updatedAt });
    if (!body.payload || body.payload.enc !== 'aes2') return json_({ ok: false, error: 'Encrypted aes2 payload required' });
    var target = snapshotFile_(true);
    backupDaily_(target, props, new Date().toISOString().slice(0, 10));
    var serverNow = Date.now();
    rev = rev + 1;
    target.setContent(JSON.stringify({ rev: rev, updatedAt: serverNow, payload: body.payload }));
    props.setProperties({ REV: String(rev), UPDATED_AT: String(serverNow) });
    return json_({ ok: true, rev: rev, updatedAt: serverNow });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
