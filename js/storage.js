/* =====================================================================
   storage.js – סנכרון ענן (Google Apps Script) ותפקידי משתמש.
   viewer (ברירת מחדל): צפייה בלבד. admin (מרכזת פדגוגית): עריכה + פרסום לצוות.
   כל מצב היישום מתכנס ל-JSON אחד (buildState) שנדחף / נמשך מהענן, ומוצפן אופציונלית בקוד בית-ספר.
   ===================================================================== */
const CloudSync = {
  LS: { url: 'sd.cloud.url', pass: 'sd.cloud.passcode', token: 'sd.cloud.adminToken', auto: 'sd.cloud.autoPublish', meta: 'sd.cloud.meta', role: 'pedagogical_role' },
  status: { kind: 'none', text: '', updatedAt: 0 },
  _suppress: 0,
  _dirty: false,
  _timer: null,

  /* ---------- הגדרות ותפקיד ---------- */
  _get(k) { try { return localStorage.getItem(this.LS[k]) || ''; } catch (e) { return ''; } },
  _set(k, v) { try { if (v) localStorage.setItem(this.LS[k], v); else localStorage.removeItem(this.LS[k]); } catch (e) { /* noop */ } },
  url() { return (this._get('url') || Config.CLOUD_SYNC_URL || '').trim(); },
  passcode() { return this._get('pass'); },
  adminToken() { return this._get('token'); },
  autoPublish() { return this._get('auto') === '1'; },
  isAdmin() { return this._get('role') === 'admin'; },
  setRole(admin) { this._set('role', admin ? 'admin' : ''); },
  saveSettings({ url, passcode, adminToken, auto }) {
    if (url !== undefined) this._set('url', String(url).trim());
    if (passcode !== undefined) this._set('pass', passcode);
    if (adminToken !== undefined) this._set('token', adminToken);
    if (auto !== undefined) this._set('auto', auto ? '1' : '');
  },
  meta() { try { return JSON.parse(localStorage.getItem(this.LS.meta)) || {}; } catch (e) { return {}; } },
  _setMeta(m) { try { localStorage.setItem(this.LS.meta, JSON.stringify({ ...this.meta(), ...m })); } catch (e) { /* noop */ } },
  hasUnpublished() { return !!this.meta().dirty; },

  /** שינויים מקומיים של מרכזת (אחרי טעינה / עריכה) מסומנים כלא-מפורסמים; ניתן לפרסום אוטומטי */
  markDirty() {
    if (this._suppress || !this.isAdmin()) return;
    this._setMeta({ dirty: true });
    this.emitStatus();
    if (this.autoPublish() && this.url() && this.adminToken()) {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.pushCloudState({ silent: true }).catch(() => {}), 3000);
    }
  },
  emitStatus(patch) {
    if (patch) this.status = { ...this.status, ...patch };
    window.dispatchEvent(new CustomEvent('sd:cloud-status', { detail: this.status }));
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
      customQuestionnaires: Config.data.bagrutRules,
      classNicknames: Config.data.classNicknames, specialEdClasses: Config.data.specialEdClasses,
      rosterMismatchDismissed: Config.data.rosterMismatchDismissed,
      fileTimestamps: Object.fromEntries(['masterRoster', ...Config.DATASET_KEYS].map(k => {
        const e = k === 'masterRoster' ? Config.getRosterEntry() : ds(k);
        return [k, e ? { uploadedAt: e.uploadedAt || 0, fileName: e.fileName || '' } : null];
      }))
    };
  },

  async applyState(s) {
    if (!s || s.app !== 'schoolDashboard') throw new Error('קובץ / תמונת מצב לא תקינים');
    if (s.customQuestionnaires) {
      const err = Config.validateRules(s.customQuestionnaires);
      if (err) throw new Error(`כללי הזכאות בתמונת המצב לא תקינים: ${err}`);
    }
    this._suppress++;
    try {
      const d = Config.data;
      const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      d.rosterOverrides = obj(s.rosterOverrides);
      d.traineeExceptions = obj(s.studentMeta);
      d.classNicknames = obj(s.classNicknames);
      d.specialEdClasses = obj(s.specialEdClasses);
      d.rosterMismatchDismissed = obj(s.rosterMismatchDismissed);
      if (s.customQuestionnaires) d.bagrutRules = s.customQuestionnaires;
      Config._syncQuestionnaires();
      const saved = Config.save();
      if (!saved.ok) throw new Error(saved.error);
      if (s.rosterData && Array.isArray(s.rosterData.data)) {
        const w = Config._write(Config.KEYS.masterRoster, s.rosterData);
        if (!w.ok) throw new Error(w.error);
        Config._cache.masterRoster = s.rosterData;
        Config.setRosterCleared(false);
      }
      for (const key of Config.DATASET_KEYS) {
        const e = s[key];
        if (e && Array.isArray(e.data)) {
          const r = await Config._storePut(key, e);
          if (!r.ok) throw new Error(r.error);
          Config._cache[key] = e;
        } else if (e === null) {
          try { await Config._storeDelete(key); } catch (err) { /* noop */ }
          Config._cache[key] = null;
        }
      }
      Config._cache = { ...Config._cache };
      Config._invalidateRoster();
    } finally { this._suppress--; }
  },

  /* ---------- הצפנה (קוד בית-ספר) ---------- */
  _b64(buf) { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); },
  _unb64(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); },
  async _key(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  /** XOR + base64: גיבוי להצפנה כשאין crypto.subtle (הסתרה בלבד, לא הצפנה חזקה) */
  _xor(bytes, pass) {
    const k = new TextEncoder().encode(pass);
    return bytes.map((b, i) => b ^ k[i % k.length]);
  },
  async seal(obj) {
    const text = JSON.stringify(obj), pass = this.passcode();
    if (!pass) return { enc: 'none', data: text };
    const bytes = new TextEncoder().encode(text);
    if (window.crypto && crypto.subtle) {
      const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this._key(pass, salt), bytes);
      return { enc: 'aes1', salt: this._b64(salt), iv: this._b64(iv), data: this._b64(ct) };
    }
    return { enc: 'xor1', data: this._b64(this._xor(bytes, pass)) };
  },
  async open(env) {
    if (!env || typeof env !== 'object') throw new Error('תמונת מצב ריקה בענן');
    if (env.enc === 'none') return JSON.parse(env.data);
    const pass = this.passcode();
    if (!pass) throw new Error('הנתונים בענן מוצפנים – יש להזין קוד בית-ספר בהגדרות הסנכרון');
    try {
      if (env.enc === 'aes1') {
        if (!(window.crypto && crypto.subtle)) throw new Error('הדפדפן אינו תומך בפענוח');
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this._unb64(env.iv) }, await this._key(pass, this._unb64(env.salt)), this._unb64(env.data));
        return JSON.parse(new TextDecoder().decode(pt));
      }
      if (env.enc === 'xor1') return JSON.parse(new TextDecoder().decode(this._xor(this._unb64(env.data), pass)));
    } catch (e) { throw new Error('קוד בית-ספר שגוי או נתונים פגומים'); }
    throw new Error('פורמט הצפנה לא מוכר');
  },

  /* ---------- תקשורת ---------- */
  async _post(body) {
    const url = this.url();
    if (!url) throw new Error('לא הוגדרה כתובת סנכרון ענן');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'השרת דחה את הבקשה');
    return json;
  },

  /** אימות סיסמת מרכזת מול השרת */
  async verifyAdmin(token) {
    if (!this.url()) return true;
    await this._post({ action: 'verify', adminToken: token });
    return true;
  },

  async pushCloudState(opts = {}) {
    if (!this.isAdmin()) throw new Error('פרסום זמין רק במצב עריכה');
    const state = this.buildState();
    this.emitStatus({ kind: 'busy', text: '☁️ מפרסם…' });
    try {
      const payload = await this.seal(state);
      const r = await this._post({ action: 'push', adminToken: this.adminToken(), updatedAt: state.updatedAt, payload });
      this._setMeta({ dirty: false, syncedAt: r.updatedAt || state.updatedAt });
      this.emitStatus({ kind: 'ok', updatedAt: r.updatedAt || state.updatedAt, text: '' });
      return r;
    } catch (e) {
      this.emitStatus({ kind: 'error', text: `☁️ הפרסום נכשל` });
      throw e;
    }
  },

  /** מושך את תמונת המצב האחרונה; force מתעלם מהשוואת updatedAt. מחזיר 'applied' | 'current' | 'kept-local' | 'empty' */
  async pullCloudState(opts = {}) {
    this.emitStatus({ kind: 'busy', text: '☁️ מסנכרן…' });
    try {
      const res = await fetch(`${this.url()}${this.url().includes('?') ? '&' : '?'}action=pull`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'השרת דחה את הבקשה');
      if (!json.payload) { this.emitStatus({ kind: 'none', text: '☁️ אין עדיין נתונים בענן' }); return 'empty'; }
      const meta = this.meta();
      if (!opts.force && json.updatedAt && json.updatedAt <= (meta.syncedAt || 0)) {
        this.emitStatus({ kind: 'ok', updatedAt: meta.syncedAt, text: '' });
        return 'current';
      }
      if (!opts.force && this.isAdmin() && meta.dirty) {
        this.emitStatus({ kind: 'warn', updatedAt: meta.syncedAt || 0, text: '☁️ יש שינויים שלא פורסמו' });
        return 'kept-local';
      }
      await this.applyState(await this.open(json.payload));
      this._setMeta({ dirty: false, syncedAt: json.updatedAt || Date.now() });
      this.emitStatus({ kind: 'ok', updatedAt: json.updatedAt || Date.now(), text: '' });
      return 'applied';
    } catch (e) {
      this.emitStatus({ kind: 'error', text: '☁️ הסנכרון נכשל' });
      throw e;
    }
  },

  /* ---------- גיבוי לקובץ ---------- */
  exportBackup() {
    const blob = new Blob([JSON.stringify(this.buildState())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `school-dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  async importBackup(text) {
    let s;
    try { s = JSON.parse(text); } catch (e) { throw new Error('קובץ JSON לא תקין'); }
    await this.applyState(s);
    this._setMeta({ dirty: true });
  },

  init() {
    ['dataset-changed', 'roster-changed', 'rules-changed', 'exceptions-changed'].forEach(n => window.addEventListener(`sd:${n}`, () => this.markDirty()));
  }
};
CloudSync.init();
