/* =====================================================================
   storage.js – סנכרון ענן אוטומטי (Google Apps Script), עם הגנות אבטחה
   ומונע דריסות עיוורות באמצעות גרסאות שרת.
   ===================================================================== */
function sanitizeState(s) {
  const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!obj(s) || s.app !== 'schoolDashboard') throw new Error('קובץ / תמונת מצב לא תקינים');
  const text = v => typeof v === 'string' ? v : '';
  const number = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const id = v => typeof v === 'string' || typeof v === 'number' ? Util.normId(v) : '';
  const clean = v => {
    if (Array.isArray(v)) return v.map(clean);
    if (obj(v)) return Object.fromEntries(Object.entries(v)
      .filter(([k]) => !['__proto__', 'prototype', 'constructor'].includes(k))
      .map(([k, value]) => [k, k === 'tz' ? id(value) : clean(value)]));
    return v === null || ['string', 'boolean'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  };
  const result = clean(s);
  const bools = new Set(['isTeacher', 'derived', 'hidden', 'isException']);
  const numbers = new Set(['score', 'weight', 'declaredCount', 'updatedAt']);
  for (const key of ['rosterData', ...Config.DATASET_KEYS]) {
    const entry = s[key];
    if (entry === undefined) { delete result[key]; continue; }
    if (entry === null) { result[key] = null; continue; }
    if (!obj(entry) || !Array.isArray(entry.data)) throw new Error(`מבנה נתונים לא תקין: ${key}`);
    const rows = entry.data.filter(obj).map(row => {
      const rec = {};
      for (const [field, value] of Object.entries(row)) {
        if (['__proto__', 'prototype', 'constructor'].includes(field)) continue;
        if (field === 'tz') rec.tz = id(value);
        else if (bools.has(field)) rec[field] = value === true;
        else if (numbers.has(field)) rec[field] = typeof value === 'number' && Number.isFinite(value) ? value : null;
        else if (field === 'cls' && obj(value)) rec.cls = {
          kind: ['num', 'pass', 'none', 'fail'].includes(value.kind) ? value.kind : 'none',
          ...(value.block === true ? { block: true } : {}),
          ...(typeof value.num === 'number' && Number.isFinite(value.num) ? { num: value.num } : {})
        };
        else if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) rec[field] = field === 'scoreRaw' ? value : String(value);
      }
      return rec;
    }).filter(row => row.tz || (key === 'groupsData' && row.isTeacher));
    result[key] = {
      data: key === 'rosterData' ? Config.normalizeRosterRows(rows).rows : rows,
      fileName: text(entry.fileName), uploadedAt: number(entry.uploadedAt),
      ...(key === 'rosterData' ? { ignoredIds: Array.isArray(entry.ignoredIds) ? entry.ignoredIds.map(id).filter(Boolean) : [] } : {})
    };
  }
  const records = (source, convert) => Object.fromEntries(Object.entries(obj(source) ? source : {})
    .filter(([tz, value]) => id(tz) && obj(value)).map(([tz, value]) => [id(tz), convert(value, id(tz))]));
  result.rosterOverrides = records(s.rosterOverrides, (v, tz) => ({
    tz, grade: Util.GRADE_KEYS.includes(v.grade) ? v.grade : '',
    homeroom: text(v.homeroom), track: Config.TRACKS.includes(v.track) ? v.track : '',
    hidden: v.hidden === true, name: text(v.name), note: text(v.note).slice(0, 200), updatedAt: number(v.updatedAt)
  }));
  result.studentMeta = records(s.studentMeta, v => ({
    isException: v.isException === true,
    overrideStatus: Config.OVERRIDE_STATUSES.some(status => status.value === v.overrideStatus) ? v.overrideStatus : '',
    trackOverride: Config.TRACKS.includes(v.trackOverride) ? v.trackOverride : '',
    reason: text(v.reason), note: text(v.note)
  }));
  for (const [key, type] of [['classNicknames', 'string'], ['specialEdClasses', 'boolean'], ['rosterMismatchDismissed', 'string']]) {
    result[key] = Object.fromEntries(Object.entries(obj(s[key]) ? s[key] : {})
      .filter(([k, v]) => !['__proto__', 'prototype', 'constructor'].includes(k) && typeof v === type)
      .map(([k, v]) => [key === 'rosterMismatchDismissed' ? id(k) : k, v]).filter(([k]) => k));
  }
  return result;
}

const CloudSync = {
  LS: { url: 'sd.cloud.url', token: 'sd.cloud.token', pass: 'sd.cloud.passcode', meta: 'sd.cloud.meta' },
  status: { kind: 'none', text: '', updatedAt: 0 },
  _suppress: 0,
  _timer: null,
  _revision: 0,
  /* גרסת הענן שהלשונית הזו עצמה סנכרנה לאחרונה; localStorage משותף לכל הלשוניות ולכן אינו משמש לבדיקת דריסה */
  _tabRev: 0,
  _settingsRevision: 0,
  _ready: false,
  _wiping: false,
  _requestController: null,
  _queue: Promise.resolve(),

  /* ---------- הגדרות ---------- */
  _get(k) { try { return localStorage.getItem(this.LS[k]) || ''; } catch (e) { return ''; } },
  _set(k, v) { if (v) localStorage.setItem(this.LS[k], v); else localStorage.removeItem(this.LS[k]); },
  url() { return (this._get('url') || '').trim(); },
  apiToken() { return this._get('token'); },
  passcode() { return this._get('pass'); },
  configured() { return !!(this.url() && this.apiToken()); },
  saveSettings({ url, apiToken, passcode }) {
    const previousUrl = this.url(), previousPass = this.passcode(), previousToken = this.apiToken();
    if (url && new URL(String(url).trim()).protocol !== 'https:') throw new Error('כתובת הענן חייבת להשתמש ב-HTTPS');
    if (url !== undefined) this._set('url', String(url).trim());
    if (apiToken !== undefined) this._set('token', String(apiToken).trim());
    if (passcode !== undefined) this._set('pass', passcode);
    if (this.url() !== previousUrl || this.passcode() !== previousPass || this.apiToken() !== previousToken) {
      clearTimeout(this._timer);
      this._revision++;
      this._settingsRevision++;
      this._ready = false;
      this._tabRev = 0;
      this._setMeta({ syncedAt: 0, rev: 0 });
      this.emitStatus({ kind: 'none', text: '', updatedAt: 0 });
    }
  },
  meta() {
    let m;
    try { m = JSON.parse(localStorage.getItem(this.LS.meta)); } catch (e) { console.error('cloud metadata', e); }
    return { syncedAt: Number(m?.syncedAt) || 0, dirty: !!m?.dirty, rev: Number.isSafeInteger(m?.rev) && m.rev >= 0 ? m.rev : 0 };
  },
  _setMeta(m) { localStorage.setItem(this.LS.meta, JSON.stringify({ ...this.meta(), ...m })); },
  hasUnpublished() { return !!this.meta().dirty; },

  markDirty() {
    if (this._suppress) return;
    this._revision++;
    this._setMeta({ dirty: true });
    this.emitStatus();
    this._schedulePush();
  },
  _schedulePush() {
    if (!this._suppress && !this._wiping && this.configured() && this.hasUnpublished() && this.status.kind !== 'conflict') {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.pushCloudState().catch(e => console.error('cloud push', e)), 1000);
    }
  },
  _enqueue(fn) {
    const operation = this._queue.then(() => {
      if (this._wiping) throw new Error('הסנכרון חסום בזמן מחיקת הנתונים המקומיים');
      return fn();
    });
    this._queue = operation.catch(e => console.error('cloud sync', e));
    return operation;
  },
  emitStatus(patch) {
    if (patch) this.status = { ...this.status, ...patch };
    window.dispatchEvent(new CustomEvent('sd:cloud-status', { detail: this.status }));
  },
  _conflict(remote) {
    clearTimeout(this._timer);
    this.emitStatus({ kind: 'conflict', text: 'נשמרו שינויים ממחשב אחר (או מלשונית אחרת). כדי לא למחוק עבודה של אף אחד, השמירה האוטומטית נעצרה — בחרו כיצד להמשיך:' });
    window.dispatchEvent(new CustomEvent('sd:cloud-conflict', { detail: remote }));
    return 'kept-local';
  },
  async checkCloudMeta() {
    return this._enqueue(async () => {
      const revision = this._revision;
      try {
        const remote = await this._post({ action: 'meta' });
        if (revision !== this._revision) return;
        if (remote.rev > this._tabRev) this._conflict(remote);
      } catch (e) {
        this.emitStatus({ kind: 'error', text: '☁️ בדיקת הענן נכשלה', error: e.message });
        throw e;
      }
    });
  },
  teamJoinLink() {
    if (!this.configured() || !this.passcode()) throw new Error('יש להגדיר כתובת, אסימון וקוד בית-ספר לפני שיתוף');
    const json = JSON.stringify({ url: this.url(), token: this.apiToken(), pass: this.passcode() });
    const hash = this._b64(new TextEncoder().encode(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${location.origin}${location.pathname}${location.search}#cloud=${hash}`;
  },

  /* ---------- בניית מצב מלא וטעינתו ---------- */
  buildState() {
    const ds = k => Config.getDataset(k);
    return {
      app: 'schoolDashboard', version: 1, updatedAt: Date.now(),
      rosterData: Config.getRosterEntry(),
      bagrutData: ds('bagrutData'), groupsData: ds('groupsData'), sadinData: ds('sadinData'),
      rosterOverrides: Config.data.rosterOverrides,
      studentMeta: Config.data.traineeExceptions,
      customQuestionnaires: Config.rulesForGrade('12'),
      cohortProfiles: Config.data.cohortProfiles, gradeCohortMap: Config.data.gradeCohortMap,
      classNicknames: Config.data.classNicknames, specialEdClasses: Config.data.specialEdClasses,
      rosterMismatchDismissed: Config.data.rosterMismatchDismissed,
      fileTimestamps: Object.fromEntries(['masterRoster', ...Config.DATASET_KEYS].map(k => {
        const e = k === 'masterRoster' ? Config.getRosterEntry() : ds(k);
        return [k, e ? { uploadedAt: e.uploadedAt || 0, fileName: e.fileName || '' } : null];
      }))
    };
  },

  async applyState(s) {
    if (this._wiping) throw new Error('לא ניתן לטעון נתונים בזמן מחיקת ההפעלה המקומית');
    s = sanitizeState(s);
    if (s.customQuestionnaires) {
      const err = Config.validateRules(s.customQuestionnaires);
      if (err) throw new Error(`כללי הזכאות בתמונת המצב לא תקינים: ${err}`);
    }
    if (s.cohortProfiles) {
      const list = Array.isArray(s.cohortProfiles) ? s.cohortProfiles : Object.values(s.cohortProfiles || {});
      const bad = list.find(p => p && p.rules && Config.validateRules(p.rules));
      if (bad) throw new Error(`כללי המחזור "${bad.name || bad.id}" בתמונת המצב לא תקינים: ${Config.validateRules(bad.rules)}`);
    }
    const revision = this._revision;
    const written = [];
    let committed = false;
    try {
      for (const key of Config.DATASET_KEYS) {
        if (!(key in s)) continue;
        written.push(key);
        if (s[key] === null) await Config._storeDelete(key);
        else {
          const r = await Config._storePut(key, s[key]);
          if (!r.ok) throw new Error(r.error);
        }
        if (revision !== this._revision) return 'kept-local';
      }
      // Suppress only our synchronous commit, never user edits during IndexedDB awaits.
      const previous = Config.data, activeCohort = Config._activeCohort;
      const savedKeys = [Config.KEYS.config, Config.KEYS.masterRoster, Config.KEYS.rosterCleared];
      const previousStorage = savedKeys.map(key => localStorage.getItem(key));
      const previousRoster = Config._cache.masterRoster;
      this._suppress++;
      try {
        Config.data = Util.clone(previous);
        const d = Config.data;
        d.rosterOverrides = s.rosterOverrides;
        d.traineeExceptions = s.studentMeta;
        d.classNicknames = s.classNicknames;
        d.specialEdClasses = s.specialEdClasses;
        d.rosterMismatchDismissed = s.rosterMismatchDismissed;
        Config.applyCohortState(s.cohortProfiles, s.gradeCohortMap, s.customQuestionnaires);
        Config._syncQuestionnaires();
        const saved = Config.save();
        if (!saved.ok) throw new Error(saved.error);
        if (s.rosterData !== undefined) {
          if (s.rosterData === null) {
            localStorage.removeItem(Config.KEYS.masterRoster);
            localStorage.setItem(Config.KEYS.rosterCleared, '1');
          } else {
            const w = Config._write(Config.KEYS.masterRoster, s.rosterData);
            if (!w.ok) throw new Error(w.error);
            localStorage.removeItem(Config.KEYS.rosterCleared);
          }
          Config._cache.masterRoster = s.rosterData;
        }
        for (const key of written) Config._cache[key] = s[key];
        Config._cache = { ...Config._cache };
        Config._invalidateRoster();
        committed = true;
        return 'applied';
      } catch (e) {
        Config.data = previous;
        Config._activeCohort = activeCohort;
        Config._cache.masterRoster = previousRoster;
        savedKeys.forEach((key, i) => {
          if (previousStorage[i] === null) localStorage.removeItem(key);
          else localStorage.setItem(key, previousStorage[i]);
        });
        Config._invalidateRoster();
        throw e;
      } finally { this._suppress--; }
    } finally {
      if (!committed && !this._wiping) {
        // The cache still holds the latest local edits, including edits made while awaiting.
        for (const key of written) {
          let current;
          do {
            current = Config.getDataset(key);
            if (current) {
              const r = await Config._storePut(key, current);
              if (!r.ok) throw new Error(`שחזור הנתונים המקומיים נכשל: ${r.error}`);
            } else await Config._storeDelete(key);
          } while (current !== Config.getDataset(key));
        }
      }
    }
  },

  /* ---------- הצפנה (קוד בית-ספר) - מבוססת AES-GCM בלבד ---------- */
  _b64(buf) { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); },
  _unb64(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); },
  async _key(pass, salt, iterations = 600000) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async seal(obj, { requirePasscode = true } = {}) {
    const text = JSON.stringify(obj), pass = this.passcode();
    if (!pass) {
      if (requirePasscode) throw new Error('יש להגדיר קוד בית-ספר להצפנה לפני העלאה לענן');
      return { enc: 'none', data: text };
    }
    if (!(window.crypto && crypto.subtle)) throw new Error('הדפדפן אינו תומך בהצפנה מאובטחת');
    const bytes = new TextEncoder().encode(text);
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this._key(pass, salt), bytes);
    return { enc: 'aes2', salt: this._b64(salt), iv: this._b64(iv), data: this._b64(ct) };
  },
  async open(env) {
    if (!env || typeof env !== 'object') throw new Error('תמונת מצב ריקה בענן');
    if (env.enc === 'none') {
      if (this.passcode()) throw new Error('הנתונים בענן אינם מוצפנים, אך הוגדר קוד בית-ספר במכשיר זה');
      return JSON.parse(env.data);
    }
    const pass = this.passcode();
    if (!pass) throw new Error('הנתונים בענן מוצפנים – יש להזין קוד בית-ספר בהגדרות הסנכרון');
    try {
      if (env.enc === 'aes1' || env.enc === 'aes2') {
        if (!(window.crypto && crypto.subtle)) throw new Error('הדפדפן אינו תומך בפענוח');
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this._unb64(env.iv) }, await this._key(pass, this._unb64(env.salt), env.enc === 'aes1' ? 100000 : 600000), this._unb64(env.data));
        return JSON.parse(new TextDecoder().decode(pt));
      }
    } catch (e) { throw new Error('קוד בית-ספר שגוי או נתונים פגומים'); }
    throw new Error('פורמט הצפנה לא מוכר או שאינו נתמך מסיבות אבטחה');
  },

  /* ---------- תקשורת ---------- */
  async _post(body) {
    if (this._wiping) throw new Error('הסנכרון חסום בזמן מחיקת הנתונים המקומיים');
    const url = this.url();
    if (!url) throw new Error('לא הוגדרה כתובת סנכרון ענן');
    if (new URL(url).protocol !== 'https:') throw new Error('כתובת הענן חייבת להשתמש ב-HTTPS');
    const token = this.apiToken();
    if (!token) throw new Error('יש להזין אסימון API בהגדרות הענן');
    const controller = new AbortController();
    this._requestController = controller;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, token }), signal: controller.signal });
      if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
      const json = await res.json();
      if (!json.ok && !json.conflict) throw new Error(json.error || 'השרת דחה את הבקשה');
      return json;
    } finally {
      if (this._requestController === controller) this._requestController = null;
    }
  },

  pushCloudState(opts = {}) {
    return this._enqueue(async () => {
      await Config.ready;
      if (!opts.force && this.status.kind === 'conflict') return 'kept-local';
      if (!this._ready && !opts.force) {
        const result = await this._pullCloudState();
        if (result === 'kept-local') return result;
        this._ready = true;
      }
      return this._pushCloudState(opts);
    });
  },

  async _pushCloudState(opts = {}) {
    clearTimeout(this._timer);
    const revision = this._revision;
    const settingsRevision = this._settingsRevision;
    const state = this.buildState();
    this.emitStatus({ kind: 'busy', text: '☁️ מסנכרן...' });
    try {
      const payload = await this.seal(state);
      const bodyData = {
        action: 'push',
        baseRev: this._tabRev,
        force: opts.force === true,
        payload
      };
      if (revision !== this._revision) { this._schedulePush(); return 'kept-local'; }
      const r = await this._post(bodyData);
      if (settingsRevision !== this._settingsRevision) return 'kept-local';
      if (r.conflict) return this._conflict(r);
      this._ready = true;
      this._tabRev = r.rev;
      this._setMeta({ dirty: revision !== this._revision, syncedAt: r.updatedAt, rev: r.rev });
      this.emitStatus({ kind: 'ok', updatedAt: r.updatedAt, text: '' });
      this._schedulePush();
      return r;
    } catch (e) {
      this.emitStatus({ kind: 'error', text: '☁️ הסנכרון נכשל', error: e.message });
      throw e;
    }
  },

  pullCloudState(opts = {}) {
    return this._enqueue(async () => {
      await Config.ready;
      const result = await this._pullCloudState(opts);
      this._ready = result !== 'kept-local';
      if (result !== 'kept-local') this._schedulePush();
      return result;
    });
  },
  async _pullCloudState(opts = {}) {
    const revision = this._revision;
    this.emitStatus({ kind: 'busy', text: '☁️ מסנכרן...' });
    try {
      if (!this.url()) throw new Error('לא הוגדרה כתובת סנכרון ענן');
      const json = await this._post({ action: 'pull' });
      if (revision !== this._revision) return this._conflict(json);
      if (!json.payload) {
        this._tabRev = json.rev;
        this._setMeta({ rev: json.rev, syncedAt: json.updatedAt });
        this.emitStatus({ kind: 'none', text: '☁️ אין עדיין נתונים בענן' }); return 'empty';
      }
      const meta = this.meta();
      if (!opts.force && json.rev === this._tabRev && meta.syncedAt) {
        this.emitStatus({ kind: 'ok', updatedAt: meta.syncedAt, text: '' });
        return 'current';
      }
      const state = await this.open(json.payload);
      if (this._revision !== revision || (!opts.force && this.hasUnpublished())) {
        return this._conflict(json);
      }
      if (await this.applyState(state) === 'kept-local' || revision !== this._revision) return this._conflict(json);
      this._tabRev = json.rev;
      this._setMeta({ dirty: false, syncedAt: json.updatedAt, rev: json.rev });
      this.emitStatus({ kind: 'ok', updatedAt: json.updatedAt, text: '' });
      return 'applied';
    } catch (e) {
      this.emitStatus({ kind: 'error', text: '☁️ הסנכרון נכשל', error: e.message });
      throw e;
    }
  },

  /* ---------- גיבוי לקובץ ---------- */
  async exportBackup() {
    await Config.ready;
    if (this._wiping) throw new Error('לא ניתן לייצא בזמן מחיקת ההפעלה המקומית');
    const backupObj = { ...this.buildState(), mappingProfiles: Config.data.mappingProfiles };
    const backup = this.passcode() ? await this.seal(backupObj) : backupObj;
    if (this._wiping) throw new Error('הייצוא בוטל בזמן מחיקת ההפעלה המקומית');
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `school-dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  importBackup(text) { return this._enqueue(() => this._importBackup(text)); },
  async _importBackup(text) {
    await Config.ready;
    let s;
    try { s = JSON.parse(text); } catch (e) { throw new Error('קובץ JSON לא תקין'); }
    if (s && (s.enc === 'aes2' || s.enc === 'aes1')) {
      if (!this.passcode()) throw new Error("קובץ הגיבוי מוצפן — יש להזין את קוד בית-הספר למעלה וללחוץ על 'שמירת הגדרות' לפני השחזור.");
      s = await this.open(s);
    }
    if (this._wiping) throw new Error('השחזור בוטל בזמן מחיקת ההפעלה המקומית');
    const LEGACY_KEYS = ['masterRoster', 'bagrutRules', 'cohortProfiles', 'classNicknames', 'specialEdClasses', 'rosterOverrides', 'traineeExceptions', 'mappingProfiles'];
    const isFull = s && typeof s === 'object' && !Array.isArray(s) && ('fileTimestamps' in s || 'studentMeta' in s || 'rosterData' in s);
    if (s && typeof s === 'object' && !Array.isArray(s) && !isFull && LEGACY_KEYS.some(k => k in s)) {
      await Config.importJSON(JSON.stringify(s), { silent: true });
      this.markDirty();
      return 'legacy';
    }
    if (await this.applyState(s) === 'kept-local') throw new Error('בוצעו שינויים בזמן השחזור. הנתונים המקומיים נשמרו; יש לנסות שוב.');
    if (s.mappingProfiles && typeof s.mappingProfiles === 'object' && !Array.isArray(s.mappingProfiles)) {
      Config.data.mappingProfiles = s.mappingProfiles;
      const saved = Config.save();
      if (!saved.ok) throw new Error(saved.error);
    }
    this.markDirty();
    return 'full';
  },

  async wipeLocalSession() {
    this._suppress++;
    clearTimeout(this._timer);
    this._wiping = true;
    Config._sessionClosing = true;
    this._revision++;
    this._settingsRevision++;
    this._tabRev = 0;
    this._requestController?.abort();
    // Drain in-flight/queued work before deletion so late responses cannot restore data.
    await this._queue;
    await Config.ready;
    for (const key of Config.DATASET_KEYS) await Config._storeDelete(key);
    const dashboardKeys = new Set([...Object.keys(Config.KEYS), ...Object.values(Config.KEYS)]);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sd.') || dashboardKeys.has(key))) localStorage.removeItem(key);
    }
    Config._cache = {};
    Config.data = Config.defaults();
    Config._ignoredCache = null;
    Config._invalidateRoster();
    location.reload();
  },

  init() {
    this._tabRev = this.meta().rev || 0;
    if (location.hash.startsWith('#cloud=')) {
      const hash = location.hash.slice(7);
      history.replaceState(null, '', location.pathname + location.search);
      try {
        const settings = JSON.parse(new TextDecoder().decode(this._unb64(hash.replace(/-/g, '+').replace(/_/g, '/'))));
        if (!settings || typeof settings.url !== 'string' || typeof settings.token !== 'string' || typeof settings.pass !== 'string' ||
            !settings.url || !settings.token || !settings.pass) throw new Error('פרטי הצטרפות חסרים');
        this.saveSettings({ url: settings.url, apiToken: settings.token, passcode: settings.pass });
      } catch (e) {
        console.error('cloud onboarding', e);
        this.emitStatus({ kind: 'error', text: 'קישור ההצטרפות לענן אינו תקין', error: e.message });
      }
    }
    ['config-changed', 'dataset-changed', 'roster-changed', 'rules-changed', 'exceptions-changed'].forEach(n => window.addEventListener(`sd:${n}`, () => this.markDirty()));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.configured()) this.checkCloudMeta().catch(e => console.error('cloud meta', e));
    });
    window.addEventListener('beforeunload', e => {
      if (!this._wiping && this.hasUnpublished()) { e.preventDefault(); e.returnValue = ''; }
    });
  }
};
CloudSync.init();