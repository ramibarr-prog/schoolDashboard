/**
 * שרת סנכרון ל"לוח בקרה פדגוגי" – Google Apps Script (Web App).
 *
 * הגדרה:
 *  1. script.google.com ← פרויקט חדש ← הדביקו קובץ זה.
 *  2. Deploy ← New deployment ← Web app: Execute as "Me", Who has access "Anyone".
 *  3. הגדירו ALLOWED_EMAILS ב-Script Properties, ובמידת הצורך GOOGLE_CLIENT_ID.
 *  4. הגדירו באפליקציה כתובת Web App וקוד בית-ספר, והתחברו עם Google.
 *  הגדירו FILE_ID לקובץ קיים או הריצו initCloudFile פעם אחת מעורך הסקריפטים.
 *  בעדכון פרויקט קיים: Deploy ← Manage deployments ← Edit ← New version ← Deploy.
 *
 * כל הפעולות דורשות POST עם Google ID token של איש צוות מורשה.
 */
var FILE_NAME = 'school-dashboard-snapshot.json';
var DEFAULT_GOOGLE_CLIENT_ID = '567539420558-c7ciqfeis5vr320bjhsh47o2af0ltntb.apps.googleusercontent.com';

function snapshotFile_() {
  var props = PropertiesService.getScriptProperties();
  var fileId = props.getProperty('FILE_ID');
  // An inaccessible configured file is an error, not permission to replace it.
  if (fileId) return DriveApp.getFileById(fileId);
  // FILE_ID is missing: adopt an existing snapshot instead of creating an empty file next to it.
  var found = [];
  var matches = DriveApp.getFilesByName(FILE_NAME);
  while (matches.hasNext()) {
    var candidate = matches.next();
    if (!candidate.isTrashed()) found.push(candidate);
  }
  if (found.length > 1) return { error: 'multiple_files' };
  if (found.length === 1) {
    props.setProperty('FILE_ID', found[0].getId());
    return found[0];
  }
  return { error: 'file_id_missing' };
}

function initCloudFile() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var file = snapshotFile_();
    if (!file.error) return file.getId();
    if (file.error !== 'file_id_missing') throw new Error(file.error);
    file = DriveApp.createFile(FILE_NAME, '', MimeType.PLAIN_TEXT);
    PropertiesService.getScriptProperties().setProperty('FILE_ID', file.getId());
    return file.getId();
  } finally { lock.releaseLock(); }
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
  return json_({ ok: false, error: 'method_not_allowed' });
}

function deny_(reason) {
  console.warn(new Date().toISOString() + ' ' + reason);
  return { error: reason };
}

function allowedEmail_(props, email) {
  return (props.getProperty('ALLOWED_EMAILS') || '').split(/[,\r\n]+/)
    .map(function (item) { return item.trim().toLowerCase(); }).indexOf(email) !== -1;
}

function authenticate_(body, props) {
  if (!body || typeof body.idToken !== 'string' || !body.idToken) return deny_('unauthorized');
  var response, info;
  try {
    response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(body.idToken), { muteHttpExceptions: true });
    var code = response.getResponseCode();
    if (code !== 200) return deny_(code === 400 || code === 401 ? 'unauthorized' : 'auth_unavailable');
    info = JSON.parse(response.getContentText());
  } catch (err) { return deny_('auth_unavailable'); }
  if (!info || (info.iss !== 'https://accounts.google.com' && info.iss !== 'accounts.google.com') ||
      info.aud !== (props.getProperty('GOOGLE_CLIENT_ID') || DEFAULT_GOOGLE_CLIENT_ID) ||
      typeof info.sub !== 'string' || !info.sub || (info.email_verified !== true && info.email_verified !== 'true')) return deny_('unauthorized');
  var expires = Number(info.exp);
  if (!Number.isFinite(expires)) return deny_('unauthorized');
  if (expires * 1000 <= Date.now()) return deny_('token_expired');
  var email = typeof info.email === 'string' ? info.email.trim().toLowerCase() : '';
  var domain = email.split('@');
  if (domain.length !== 2 || !domain[0] || !domain[1] ||
      (domain[1] !== 'gmail.com' && domain[1] !== 'googlemail.com' && !(typeof info.hd === 'string' && info.hd.trim())) ||
      !allowedEmail_(props, email)) return deny_('forbidden');
  var subs = JSON.parse(props.getProperty('ALLOWED_SUBS') || '{}');
  if (!subs || typeof subs !== 'object' || Array.isArray(subs)) throw new Error('invalid subs');
  if (Object.prototype.hasOwnProperty.call(subs, email) && subs[email] !== info.sub) return deny_('forbidden');
  return { email: email, sub: info.sub };
}

function doPost(e) {
  var lock = null;
  try {
    var props = PropertiesService.getScriptProperties();
    var body;
    try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: deny_('unauthorized').error }); }
    var identity = authenticate_(body, props);
    if (identity.error) return json_({ ok: false, error: identity.error });
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    if (!allowedEmail_(props, identity.email)) return json_({ ok: false, error: deny_('forbidden').error });
    var subs = JSON.parse(props.getProperty('ALLOWED_SUBS') || '{}');
    if (!subs || typeof subs !== 'object' || Array.isArray(subs)) throw new Error('invalid subs');
    if (Object.prototype.hasOwnProperty.call(subs, identity.email) && subs[identity.email] !== identity.sub)
      return json_({ ok: false, error: deny_('forbidden').error });
    if (!Object.prototype.hasOwnProperty.call(subs, identity.email)) {
      subs[identity.email] = identity.sub;
      props.setProperty('ALLOWED_SUBS', JSON.stringify(subs));
    }
    var rev = Number(props.getProperty('REV')) || 0;
    var updatedAt = Number(props.getProperty('UPDATED_AT')) || 0;
    if (body.action === 'meta') return json_({ ok: true, rev: rev, updatedAt: updatedAt });
    if (body.action === 'pull') {
      var file = snapshotFile_();
      if (file.error) return json_({ ok: false, error: file.error });
      var text = file.getBlob().getDataAsString();
      var snap = text ? JSON.parse(text) : null;
      return json_({ ok: true, rev: rev, updatedAt: updatedAt || (snap && snap.updatedAt) || 0, payload: snap ? snap.payload : null });
    }
    if (body.action !== 'push') return json_({ ok: false, error: 'internal_error' });
    if (Number(body.baseRev) !== rev && body.force !== true) return json_({ ok: false, error: 'conflict', conflict: true, rev: rev, updatedAt: updatedAt });
    if (!body.payload || body.payload.enc !== 'aes2' || ['iv', 'salt', 'data'].some(function (key) {
      return typeof body.payload[key] !== 'string' || !body.payload[key].trim();
    })) return json_({ ok: false, error: 'invalid_envelope' });
    var target = snapshotFile_();
    if (target.error) return json_({ ok: false, error: target.error });
    backupDaily_(target, props, new Date().toISOString().slice(0, 10));
    var serverNow = Date.now();
    rev = rev + 1;
    target.setContent(JSON.stringify({ rev: rev, updatedAt: serverNow, payload: body.payload }));
    props.setProperties({ REV: String(rev), UPDATED_AT: String(serverNow) });
    return json_({ ok: true, rev: rev, updatedAt: serverNow });
  } catch (err) {
    return json_({ ok: false, error: 'internal_error' });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}
