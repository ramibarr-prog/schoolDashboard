/* =====================================================================
   app.js – אתחול, סינון גלובלי, חמשת הפאנלים, ייבוא מבוזר עם רמזור עדכניות,
   מגירת כללי זכאות ומשקלים ומנגנון חריגים.

   הקוד מוגן: כל גישה ל-DOM מתבצעת דרך עזרים שמתעלמים מאלמנט חסר, והאפליקציה
   תופסת בעצמה את מעברי הטאבים, כפתורי ההעלאה והמגירה, כך שאינה תלויה בסקריפט מעטפת.
   המצבת העליונה היא מקור האמת: קובצי המשנה אינם משנים שכבה, כיתת אם או מי חניך פעיל.
   ===================================================================== */

const E = Util.esc;
const $ = id => document.getElementById(id);
const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

const TABS = ['overview', 'bagrut', 'groups', 'sadin', 'profile', 'settings'];
/* לשוניות שתוכנן תלוי בסינון הגלובלי ובהערכות הזכאות */
const FILTERED_TABS = ['overview', 'bagrut', 'groups', 'sadin', 'profile'];
const BAGRUT_CORE = [['hebrew', 'עברית'], ['history', 'היסטוריה'], ['civics', 'אזרחות'], ['tanach', 'תנ"ך'], ['literature', 'ספרות'], ['english', 'אנגלית'], ['math', 'מתמטיקה']];

/* סוג קובץ בממשק ← מפתח אחסון */
const DATASETS = {
  bagrutData: { type: 'bagrut', panel: 'bagrut', title: 'ציוני בגרות ושאלונים' },
  groupsData: { type: 'groups', panel: 'groups', title: 'קבוצות ושיבוצים' },
  sadinData: { type: 'sadin', panel: 'sadin', title: 'ציונים שוטפים' }
};
const PANEL_KEY = { bagrut: 'bagrutData', groups: 'groupsData', sadin: 'sadinData', roster: 'masterRoster' };
const WA_URL_MAX = 2000;
const MAIL_URL_MAX = 1900;

const App = {
  state: {
    tab: 'overview',
    filters: { grade: 'all', cls: 'all', track: 'all', q: '' },
    sim: { ignoreInternals: false, plus5: false, useCurrent: true, fullMode: false },
    bagrut: { chip: 'all', sort: 'tier', dir: -1, drill: 'all', mxSort: 'class', mxDir: 1, targetSort: 'subject', targetDir: 1, onlyPending: false, readinessClass: '', readinessFilter: 'all', sim100: false, workSort: { key: null, dir: 'asc' } },
    /* היקף השכבות בלשונית הבגרות כשסינון השכבה הגלובלי הוא "הכל": '12' (ברירת מחדל) / '11' / '10' / 'all' */
    bagrutScope: '12',
    bagrutScopeSet: false,
    groups: { subject: 'all', teacher: 'all', subjectKey: 'all', strip: 'all', groupId: '', missingSelected: false, rosterSort: 'room', anomSort: '', anomDir: 1 },
    /* בקרת קבוצות: 'anomalies' (מוקד חריגי שיבוץ, ברירת מחדל) / 'explorer' (סייר קבוצות ובדיקת תפוסה) */
    groupsViewMode: 'anomalies',
    /* קטגוריית חריגים במוקד: 'all' / 'missing' / 'duplicate' / 'suspect', וסינון מקצוע (תווית מקצוע או 'all') */
    anomalyCategoryFilter: 'all',
    anomalySubject: 'all',
    /* חריגות כפילות במקצועות שגרתיים (חינוך / מגדר / מפגש בוקר) מוסתרות כברירת מחדל */
    showRoutineDuplicates: false,
    /* מיון סדין הציונים השוטפים: class_name = כיתה ואז שם (ברירת מחדל) */
    sadinSort: { key: 'class_name', dir: 'asc' },
    /* רוחבי עמודות שהמשתמש גרר בסדין (לפי מפתח עמודה: name / homeroom / avg / negatives / subj:... / evt:...) */
    sadinColWidths: {},
    sadin: { subject: 'all', teacher: 'all', view: 'sheet', mode: 'early', strip: 'all', alertBy: 'teacher', initials: false },
    profileTz: null,
    selectedSearchTz: null,
    /* חניך שחלונית "מפת שיבוצים" הצפה פתוחה עבורו במסך שיבוצים לתיקון (null = סגורה) */
    studentMapTz: null,
    settingsView: 'roster',
    ovMode: 'organize',
    hrOpenClass: null,
    hrBankFilter: 'pending',
    hrBankSearch: '',
    hrBankSort: { col: 'name', dir: 1 },
    hrBankShowAll: false,
    hrPopSearch: ''
  },
  evals: new Map(),
  lastFiles: {},
  dirty: new Set(TABS),
  alertOut: [],
  formCtx: null,
  rosterReport: null,
  busy: false,
  _timer: null,
  _cloudWriteReady: false,

  canEdit() {
    const cloud = this.cloudService();
    return !!(this._cloudWriteReady && cloud.configured() && cloud.passcode() && cloud.status.kind !== 'conflict' &&
      this._cloudAccessSettingsRevision === cloud._settingsRevision);
  },

  requireEdit() {
    if (this.canEdit()) return true;
    this._cloudWriteReady = false;
    this.renderCloudAccess();
    this.openCloudAccess();
    return false;
  },

  renderCloudAccess() {
    const cloud = this.cloudService(), identity = cloud.identity();
    const status = $('headerCloudStatus');
    if (status) {
      status.textContent = !identity ? 'לא מחובר' : cloud.status.kind === 'conflict' ? 'נדרשת החלטה על התנגשות' :
        !cloud.url() ? 'חסרה כתובת ענן' : !cloud.passcode() ? 'חסר קוד בית ספר' :
        cloud.status.kind === 'error' ? (cloud.status.error || cloud.status.text) :
        cloud.status.kind === 'busy' ? 'מסנכרן...' :
        cloud.hasUnpublished() ? 'שינויים מקומיים טרם סונכרנו' : this.canEdit() ? 'מסונכרן' : 'טרם נבדקה עדכניות';
    }
    const banner = $('cloudReadOnly');
    if (banner) banner.hidden = this.canEdit();
    const message = $('cloudAccessMessage');
    if (message) message.textContent = !identity ? (cloud.status.error || 'יש להתחבר עם Google כדי לערוך ולסנכרן.') :
      cloud.status.kind === 'conflict' ? 'יש לפתור את ההתנגשות בהגדרות הענן לפני עריכה.' :
      !cloud.url() ? 'יש להגדיר כתובת ענן בהגדרות.' : !cloud.passcode() ? 'יש להגדיר קוד בית ספר בהגדרות.' :
      cloud.status.kind === 'error' ? (cloud.status.error || cloud.status.text) : 'יש לבדוק עדכניות לפני עריכה.';
    const button = $('cloudAccessGoogle'), dialog = $('cloudAccessDialog');
    if (button && dialog && !dialog.hidden) {
      const area = button.closest('.google-button-area');
      if (area) area.hidden = !!identity;
      button.innerHTML = '';
      if (!identity) cloud.renderGoogleButton(button);
    }
  },

  openCloudAccess() {
    const dialog = $('cloudAccessDialog');
    if (dialog) { dialog.hidden = false; this.renderCloudAccess(); $('cloudAccessContinue').focus(); }
  },

  completeCloudAccess(result) {
    const cloud = this.cloudService();
    if (!result || result === 'kept-local' || !cloud.configured() || !cloud.passcode() ||
      cloud.status.kind !== 'ok' || cloud.hasUnpublished()) return false;
    this._cloudWriteReady = true;
    this._cloudAccessSettingsRevision = cloud._settingsRevision;
    const dialog = $('cloudAccessDialog');
    if (dialog) dialog.hidden = true;
    this.renderSync();
    this.renderCloudAccess();
    return true;
  },

  async syncCloudAccess({ push = false } = {}) {
    const cloud = this.cloudService();
    this._cloudWriteReady = this.canEdit();
    this.renderCloudAccess();
    if (!cloud.identity() || !cloud.url() || !cloud.passcode()) { this.openCloudAccess(); return; }
    if (cloud.status.kind === 'conflict') {
      this.openCloudAccess();
      return 'kept-local';
    }
    const dirty = cloud.hasUnpublished();
    let result = await this.cloudRefresh(() => dirty ? cloud.pushCloudState() : cloud.pullCloudState(),
      { cloudAccess: true, action: dirty ? 'sync' : 'pull' });
    if (result && result !== 'kept-local' && push && !dirty) {
      result = await this.cloudRefresh(() => cloud.pushCloudState(), { cloudAccess: true, action: 'sync' });
    }
    if (!result || result === 'kept-local') {
      this._cloudWriteReady = false;
      this.openCloudAccess();
    }
    this.renderCloudAccess();
    return result;
  },

  /* ------------------------------------------------------------------
     אתחול
     ------------------------------------------------------------------ */
  /** מסך הפתיחה: מוצג לפחות SPLASH_MIN_MS ונסגר רק אחרי סיום האתחול והרינדור הראשוני של "היום"; SPLASH_MAX_MS הוא חסם בטיחות קשיח (למשל כשהענן/הרשת איטיים) */
  SPLASH_MIN_MS: 2350,
  SPLASH_MAX_MS: 8000,
  startSplash() {
    const t0 = window.__splashT0 || Date.now();
    this._splashT0 = t0;
    clearTimeout(this._splashFailsafe);
    this._splashFailsafe = setTimeout(() => this.hideSplash(), Math.max(0, this.SPLASH_MAX_MS - (Date.now() - t0)));
  },
  finishSplash() {
    clearTimeout(this._splashMin);
    let done = false;
    const schedule = () => {
      if (done) return;
      done = true;
      this._splashMin = setTimeout(() => this.hideSplash(), Math.max(0, this.SPLASH_MIN_MS - (Date.now() - (this._splashT0 || Date.now()))));
    };
    /* ממתינים לציור הראשון של הפאנל שעבר רינדור; אם הלשונית מוסתרת ואין פריים, מגבה טיימר קצר */
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(schedule));
    setTimeout(schedule, 250);
  },
  hideSplash() {
    clearTimeout(this._splashFailsafe); clearTimeout(this._splashMin);
    const s = $('appSplash');
    if (!s || s.classList.contains('splash-hidden')) return;
    s.classList.add('splash-hidden');
    setTimeout(() => s.remove(), 700);
  },

  async init() {
    this.startSplash();
    try { await this.initCore(); } finally { this.finishSplash(); }
  },

  async initCore() {
    try { await Config.ready; } catch (e) { console.warn('config storage', e); }
    this.renderSync();
    window.addEventListener('sd:cloud-status', () => {
      if (this.cloudService().status.kind === 'ok') this.completeCloudAccess('current');
      this.renderSync(); this.renderCloudAccess();
    });
    window.addEventListener('sd:cloud-auth', async () => {
      this.renderSync();
      this.renderCloudAuth();
      await this.syncCloudAccess();
    });
    window.addEventListener('sd:cloud-signedout', () => {
      this._cloudWriteReady = false;
      this.renderCloudAuth(); this.openCloudAccess();
    });
    window.addEventListener('sd:google-ready', () => { this.renderCloudAuth(); this.renderCloudAccess(); });
    window.addEventListener('sd:cloud-auto-error', e => {
      const message = `נשמר מקומית בלבד — ${(e.detail && e.detail.error) || 'הסנכרון לענן נכשל'}`, now = Date.now();
      if (this._autoErrorToast && this._autoErrorToast.message === message && now - this._autoErrorToast.at < 60000) return;
      this._autoErrorToast = { message, at: now };
      this.toast(message, 'warn');
    });
    window.addEventListener('sd:cloud-conflict', () => {
      this._cloudWriteReady = false;
      this.renderCloudAccess();
      this.toast('נשמרו שינויים ממחשב אחר (או מלשונית אחרת). כדי לא למחוק עבודה של אף אחד, השמירה האוטומטית נעצרה — בחרו כיצד להמשיך:', 'warn');
    });
    Store.refresh();
    SignalEngine.invalidate();
    this.bindEvents();
    this.syncFilters();
    this.showTab(this.state.tab);
    await this.syncCloudAccess();
    if ((Config.rules().version || 0) < RULES_VERSION) {
      this.toast('קטלוג השאלונים והמגמות עודכן לקודי משוב של בית הספר. כדי לקבל אותו: ⚙️ הגדרות ומצבת ← חוקי בגרות ושאלונים ← שחזור ברירות מחדל.', 'info');
    }
  },

  icons() { try { if (window.lucide) window.lucide.createIcons(); } catch (e) { /* noop */ } },

  toast(msg, kind = 'info') {
    const root = $('toast-root');
    if (!root) { console.log(msg); return; }
    const colors = { info: 'bg-slate-800', ok: 'bg-emerald-600', warn: 'bg-amber-600', error: 'bg-red-600' };
    const el = document.createElement('div');
    el.className = `${colors[kind] || colors.info} text-white text-sm px-4 py-2 rounded-lg shadow-lg max-w-sm`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' || kind === 'warn' ? 9000 : 4500);
  },

  openModal(html, wide = false) {
    if (this._rosterImportResolve) { this._rosterImportResolve(null); this._rosterImportResolve = null; }
    let root = $('modal-root');
    if (!root) { root = document.createElement('div'); root.id = 'modal-root'; document.body.appendChild(root); }
    root.innerHTML = `
      <div class="fixed inset-0 bg-slate-900/60 z-50 flex items-start justify-center overflow-auto p-4" data-act="modalBackdrop">
        <div class="card w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} mt-8 p-5" role="dialog" aria-modal="true">${html}</div>
      </div>`;
    this.icons();
  },
  closeModal() {
    if (this._rosterImportResolve) { this._rosterImportResolve(null); this._rosterImportResolve = null; }
    setHtml('modal-root', '');
    this.formCtx = null;
  },

  /** חלון טופס כללי: fields = [{ key, label, type, value, options, placeholder }] */
  formModal(title, fields, onSubmit, submitLabel = 'שמירה') {
    this.formCtx = { onSubmit };
    const input = f => f.type === 'select'
      ? `<select class="inp" data-f="${f.key}">${f.options.map(o => `<option value="${E(o.value)}" ${o.value === f.value ? 'selected' : ''}>${E(o.label)}</option>`).join('')}</select>`
      : `<input class="inp" data-f="${f.key}" type="${f.type || 'text'}" value="${E(f.value ?? '')}" placeholder="${E(f.placeholder || '')}">`;
    this.openModal(`
      <h3 class="text-lg font-semibold mb-3">${E(title)}</h3>
      <div class="grid gap-3">${fields.map(f => `<label class="flex flex-col gap-1 text-sm">${E(f.label)}${input(f)}</label>`).join('')}</div>
      <div id="formErr" class="text-sm text-red-600 mt-2" role="alert"></div>
      <div class="flex gap-2 mt-4"><button type="button" class="btn btn-primary" data-act="formSubmit">${E(submitLabel)}</button><button type="button" class="btn btn-ghost" data-act="closeModal">ביטול</button></div>`);
    const first = document.querySelector('#modal-root [data-f]');
    if (first) first.focus();
  },

  /** הודעה ארוכה מדי לקישור wa.me / mailto: ההודעה מועתקת ללוח, והאפליקציה נפתחת ריקה להדבקה */
  async sendViaClipboard(text, open) {
    const copied = await this.copyText(text);
    this.toast(copied ? 'ההודעה ארוכה מדי לקישור ישיר – הועתקה ללוח. יש להדביק אותה בחלון שנפתח.' : 'ההודעה ארוכה מדי לקישור ישיר וההעתקה ללוח נכשלה – יש להעתיק ידנית מהכרטיס.', copied ? 'info' : 'warn');
    if (copied) open();
  },

  async copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (err) { return false; }
    }
  },

  /* ------------------------------------------------------------------
     חישוב, מטמון ורינדור
     ------------------------------------------------------------------ */
  getEval(tz) {
    const key = JSON.stringify([Store.version, Config.rev, this.state.sim, BagrutEngine.decoratorVersion]);
    if (this._evalsKey !== key) { this._evalsKey = key; this.evals.clear(); }
    let e = this.evals.get(tz);
    if (!e) {
      e = BagrutEngine.evaluate(tz, this.state.sim);
      this.evals.set(tz, e);
    }
    return e;
  },

  invalidateAll() {
    SignalEngine.invalidate();
    this.evals.clear();
    TABS.forEach(t => this.dirty.add(t));
    this.renderChrome();
    this.renderTab(this.state.tab);
    const drawer = $('rulesDrawer');
    if (drawer && !drawer.classList.contains('hidden')) this.renderRulesDrawer();
  },

  schedule(fn) { clearTimeout(this._timer); this._timer = setTimeout(fn, 0); },

  afterDataChange() {
    Store.refresh();
    this.syncFilters();
    this.alertOut = [];
    this.invalidateAll();
  },

  renderTab(tab) {
    if (!this.dirty.has(tab)) return;
    this.dirty.delete(tab);
    const fn = {
      overview: this.renderOverviewPanel, bagrut: this.renderBagrutPanel, groups: this.renderGroupsPanel, sadin: this.renderSadinPanel,
      profile: this.renderTrainee360Panel, settings: this.renderSettingsPanel
    }[tab];
    try { fn.call(this); } catch (e) { console.error(e); this.toast(`שגיאה בהצגת הפאנל: ${e.message}`, 'error'); }
    this.icons();
    this.fitTables();
  },

  /**
   * טבלאות גדולות (בגרות, סדין, פירוט) ממלאות את גובה האזור הראשי עד שולי המסך, במקום תקרה קבועה שמשאירה מקום ריק למטה.
   * נמדד לפי מיקום הטבלה בפועל, כך שהוא מתעדכן כשסרגל הסינון נהיה גבוה יותר (שורה נוספת) או כשנוספים רכיבים מעליה.
   */
  fitTables() {
    if (this._fitFrame != null) return;
    this._fitFrame = window.requestAnimationFrame(() => {
      this._fitFrame = null;
      const main = $('mainContent');
      if (!main || window.innerWidth < 1024) return;
      const mr = main.getBoundingClientRect(), pad = parseFloat(getComputedStyle(main).paddingBottom) || 16;
      const sadin = $('sadin-table');
      if (sadin && !sadin.classList.contains('sticky-scroll')) sadin.style.maxHeight = '';
      document.querySelectorAll('#bagrut-table, #sadin-table.sticky-scroll, #sadin-table .sticky-scroll').forEach(el => {
        if (el.offsetParent === null) return;
        el.style.maxHeight = 'none';
        const top = el.getBoundingClientRect().top - mr.top + main.scrollTop;
        el.style.maxHeight = `${Math.max(240, Math.floor(main.clientHeight - top - pad - 4))}px`;
      });
    });
  },

  showTab(name) {
    if (!TABS.includes(name)) return;
    /* חלונית "מפת שיבוצים" שייכת למסך השיבוצים בלבד */
    if (name !== 'groups' && this.state.studentMapTz) GroupsView.closeStudentMap.call(this, false);
    /* יציאה מהכרטיס בדרך אחרת מהחזרה (למשל מהתפריט הצדדי) מבטלת את הקשר המקור */
    if (name !== 'profile' && this.state.navOrigin) { this.state.navOrigin = null; this._histPushed = false; this.dirty.add('profile'); }
    const changed = this.state.tab !== name;
    this.state.tab = name;
    const controls = $('localControls'), panel = $(`panel-${name}`);
    if (controls && panel) {
      panel.insertBefore(controls, panel.firstChild);
      controls.classList.toggle('hidden', !['groups', 'bagrut', 'sadin', 'profile'].includes(name));
    }
    const searchWrap = $('searchWrap');
    if (searchWrap) searchWrap.classList.toggle('hidden', !['groups', 'bagrut', 'sadin'].includes(name));
    document.body.classList.toggle('sadin-active', name === 'sadin');
    const toggle = (selector, on) => document.querySelectorAll(selector).forEach(el => el.classList.toggle('hidden', !on));
    toggle('[data-groups-only]', name === 'groups');
    toggle('[data-sadin-only]', name === 'sadin');
    toggle('[data-bagrut-only]', name === 'bagrut');
    toggle('[data-profile-only]', name === 'profile');
    toggle('[data-profile-exclude]', name !== 'profile');
    document.querySelectorAll('[data-hide-overview]').forEach(el => el.classList.toggle('hidden', !['groups', 'bagrut', 'sadin'].includes(name)));
    [['groupActions', 'groups'], ['sadinActions', 'sadin'], ['bagrutActions', 'bagrut'], ['profileSwitcher', 'profile']].forEach(([id, tab]) => {
      const el = $(id);
      if (el) el.classList.toggle('flex', name === tab);
    });
    this.syncGroupLayout();
    if (changed && $('mainContent')) $('mainContent').scrollTop = 0;
    document.body.classList.remove('nav-open');
    this.hideSuggestions();
    this.renderSearchChrome();
    if ($('navScrim')) $('navScrim').classList.add('hidden');
    const search = $('globalSearch');
    if (search) search.placeholder = name === 'groups' ? 'חיפוש חניך לפי שם, ת.ז או קוד קבוצה' : 'חיפוש חניך לפי שם או ת.ז';
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(
      b.dataset.tab === name && (!b.dataset.sadinMode || b.dataset.sadinMode === this.state.sadin.mode)
    )));
    TABS.forEach(t => { const p = $(`panel-${t}`); if (p) p.hidden = t !== name; });
    const sadinPanel = $('panel-sadin');
    if (sadinPanel) sadinPanel.setAttribute('aria-labelledby', this.state.sadin.mode === 'full' ? 'tab-sadin' : 'tab-weakness');
    this.syncFilters();
    this.renderChrome();
    this.renderTab(name);
    this.fitTables();
    if (name === 'overview' && changed) this.animateOverviewBars();
  },

  syncGroupLayout() {
    document.body.classList.toggle('group-explorer', this.state.tab === 'groups' && this.state.groupsViewMode === 'explorer' && Store.hasData() && Store.loaded.groups);
  },

  /* ------------------------------------------------------------------
     סינון גלובלי
     ------------------------------------------------------------------ */
  trackOf(t) { return Config.trackFor(t.tz, t.track, t.classKey); },

  sortTrainees(list) {
    return list.sort((a, b) => Util.ord(a.gradeKey) - Util.ord(b.gradeKey) || natural(a.classKey, b.classKey) || a.name.localeCompare(b.name, 'he'));
  },

  passesFilters(t, ignoreClass = false) {
    const f = this.state.filters;
    if (f.grade !== 'all' && t.gradeKey !== f.grade) return false;
    if (!ignoreClass && f.cls !== 'all' && t.classKey !== f.cls) return false;
    return ['groups', 'bagrut', 'sadin'].includes(this.state.tab) || f.track === 'all' || this.trackOf(t) === f.track;
  },

  /** חיפוש טקסט חי פעיל רק בלשוניות שבהן כל שורה היא חניך; בשאר הלשוניות הטקסט מזין רק את חלון ההשלמה */
  searchQuery() { return this.LIVE_SEARCH_TABS.includes(this.state.tab) ? this.state.filters.q : ''; },
  LIVE_SEARCH_TABS: ['bagrut', 'sadin'],

  lockedTrainee() { return this.state.selectedSearchTz ? Store.trainees.get(this.state.selectedSearchTz) || null : null; },

  /** התאמת חניך לטקסט: השם והשאילתה מנורמלים (גרשיים וגרשיים כפולים), בלי תלות בסדר שם פרטי/משפחה; ת.ז לפי ספרות */
  matchTrainee(t, query, normalized = false) {
    const q = normalized ? query : Util.norm(query).toLocaleLowerCase();
    if (!q) return true;
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 3 && t.tz.includes(digits)) return true;
    const name = t.nameKey !== undefined ? t.nameKey : Util.norm(t.name).toLocaleLowerCase();
    return q.split(' ').every(token => name.includes(token));
  },

  filtered(includeSearch = true, ignoreClass = false) {
    const lock = includeSearch ? this.state.selectedSearchTz : null;
    const q = includeSearch && !lock ? Util.norm(this.searchQuery()).toLocaleLowerCase() : '';
    return Store.sortedTrainees().filter(t => {
      if (!this.passesFilters(t, ignoreClass)) return false;
      if (lock) return t.tz === lock;
      return !q || this.matchTrainee(t, q, true);
    });
  },

  /** אוכלוסיית חדר הבקרה: שכבה וכיתת אם בלבד, ללא מסלול, חיפוש או חניך נעול */
  overviewList(...args) { return OverviewView.overviewList.call(this, ...args); },

  /** מעבר מחדר הבקרה ללשונית יעד: מאפס מסלול וחיפוש כדי שהיעד יציג את אותה אוכלוסייה שנספרה בכרטיס */
  resetOverviewDrillFilters() {
    const st = this.state;
    clearTimeout(this._searchTimer);
    st.filters.track = 'all';
    st.filters.q = '';
    st.selectedSearchTz = null;
    setVal('fTrack', 'all');
    setVal('globalSearch', '');
    FILTERED_TABS.forEach(tab => this.dirty.add(tab));
    this.renderSearchChrome();
  },

  /** בונה את רשימות הסינון הגלובלי; כיתת אם מוצגת עם הכינוי (שם הכיתה מהמצבת או כינוי שהוגדר) */
  syncFilters() {
    const f = this.state.filters;
    const grades = Store.gradeKeys();
    if (f.grade !== 'all' && !grades.includes(f.grade)) f.grade = 'all';
    const classes = Store.classes().filter(c => f.grade === 'all' || Util.parseClass('', c).gradeKey === f.grade);
    if (f.cls !== 'all' && !classes.includes(f.cls)) f.cls = 'all';
    const opt = (v, label, cur) => `<option value="${E(v)}" ${v === cur ? 'selected' : ''}>${E(label)}</option>`;
    setHtml('fGrade', opt('all', 'הכל', f.grade) + grades.map(g => opt(g, Util.gl(g), f.grade)).join(''));
    setHtml('fHomeroom', opt('all', 'כל הכיתות', f.cls) + classes.map(c => opt(c, Config.classLabel(c), f.cls)).join(''));
    document.querySelectorAll('[data-scope-controls]').forEach(box => {
      box.innerHTML = `<label>שכבה <select class="inp" data-chg="screenScope" data-field="grade" aria-label="שכבה">${opt('all', 'כל השכבות', f.grade)}${grades.map(g => opt(g, Util.gl(g), f.grade)).join('')}</select></label>
        <label>כיתת אם <select class="inp" data-chg="screenScope" data-field="cls" aria-label="כיתת אם">${opt('all', 'כל הכיתות', f.cls)}${classes.map(c => opt(c, Config.classLabel(c), f.cls)).join('')}</select></label>`;
    });
    setVal('fTrack', f.track);
    /* חניך נעול שנפל מחוץ לסינון (או נמחק מהמצבת) משחרר את הנעילה */
    const locked = this.lockedTrainee();
    if (this.state.selectedSearchTz && (!locked || !this.passesFilters(locked))) { this.state.selectedSearchTz = null; f.q = ''; }
    setVal('globalSearch', this.state.selectedSearchTz ? locked.name : f.q);
    this.renderSearchChrome();
  },

  /* ------------------------------------------------------------------
     חיפוש חכם: חלון השלמה אוטומטית, בחירת חניך נעולה (selectedSearchTz) וקפיצה לקבוצה
     ------------------------------------------------------------------ */
  _sg: { items: [], active: -1 },

  /** מדגיש בטקסט את האותיות התואמות לשאילתה (גרשיים בשם אינם מפריעים להתאמה) */
  highlightMatch(text, query) {
    const raw = String(text ?? '');
    const quote = '[\'"״׳”“’‘`]*';
    const ranges = [];
    Util.norm(query).toLocaleLowerCase().replace(/[\[\]]/g, '').split(' ').filter(Boolean).forEach(token => {
      const re = new RegExp([...token].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(quote), 'gi');
      let m;
      while ((m = re.exec(raw)) && m[0]) ranges.push([m.index, m.index + m[0].length]);
    });
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    ranges.forEach(r => { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); });
    let out = '', pos = 0;
    merged.forEach(([s, e]) => { out += E(raw.slice(pos, s)) + `<b class="sg-hit">${E(raw.slice(s, e))}</b>`; pos = e; });
    return out + E(raw.slice(pos));
  },

  /** קבוצות (קוד, מקצוע או מורה) התואמות לטקסט שהוקלד; כל מילה בשאילתה חייבת להופיע */
  matchGroups(raw) {
    const tokens = Util.norm(raw).toLocaleLowerCase().replace(/[\[\]]/g, '').split(' ').filter(Boolean);
    if (!tokens.length) return [];
    return GroupAnalyzer.explorerModel().groups.filter(g => {
      const hay = Util.norm(`${g.subject} ${g.teacher || ''} ${g.groupId}`).toLocaleLowerCase();
      return tokens.every(token => hay.includes(token));
    }).sort((a, b) => (tokens.includes(String(b.groupId).toLocaleLowerCase()) ? 1 : 0) - (tokens.includes(String(a.groupId).toLocaleLowerCase()) ? 1 : 0));
  },

  hideSuggestions() {
    clearTimeout(this._suggestTimer);
    this._suggestTimer = null;
    const pop = $('searchSuggestPopup');
    if (pop) { pop.classList.add('hidden'); pop.innerHTML = ''; }
    const input = $('globalSearch');
    if (input) { input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    this._sg = { items: [], active: -1 };
  },

  showSuggestions() {
    clearTimeout(this._suggestTimer);
    this._suggestTimer = null;
    const input = $('globalSearch'), pop = $('searchSuggestPopup');
    if (!input || !pop) return;
    const raw = input.value;
    if (this.state.selectedSearchTz || !Util.norm(raw) || !Store.hasData()) return this.hideSuggestions();
    const query = Util.norm(raw).toLocaleLowerCase(), first = query.split(' ')[0];
    const rank = t => { const n = t.nameKey; return n.startsWith(first) ? 0 : n.split(' ').some(w => w.startsWith(first)) ? 1 : 2; };
    const candidates = this.state.tab === 'profile' ? Store.traineeList() : this.filtered(false);
    const students = candidates.filter(t => this.matchTrainee(t, query, true)).sort((a, b) => rank(a) - rank(b));
    let groups = [];
    if (this.state.tab === 'groups' && Store.loaded.groups) groups = this.matchGroups(raw).slice(0, 5);
    const SHOWN = 8, shown = students.slice(0, SHOWN);
    const items = [...shown.map(t => ({ kind: 's', tz: t.tz })), ...groups.map(g => ({ kind: 'g', id: g.groupId }))];
    let i = 0;
    const row = (inner, kind) => `<div id="sg-${i}" class="sg-item" role="option" aria-selected="false" data-act="sgPick" data-i="${i++}" data-kind="${kind}">${inner}</div>`;
    const studentRows = shown.map(t => row(`<span class="sg-name">${this.highlightMatch(t.name, raw)}</span>
      <span class="sg-badge">${E(Config.classLabel(t.classKey))}</span><span class="sg-tz" dir="ltr">${E(t.tz)}</span>`, 's')).join('');
    const groupRows = groups.map(g => row(`<span class="sg-name">${this.highlightMatch(`${g.subject} • ${g.teacher || 'ללא מורה'}`, raw)}</span>
      <span class="sg-tz" dir="ltr">[${E(g.groupId)}]</span>`, 'g')).join('');
    pop.innerHTML = `<div class="sg-head">חניכים${students.length ? ` (${students.length})` : ''}</div>${studentRows || '<div class="sg-empty">לא נמצאו חניכים תואמים</div>'}
      ${students.length > SHOWN ? `<div class="sg-empty">ועוד ${students.length - SHOWN} – המשיכו להקליד לצמצום</div>` : ''}
      ${groups.length ? `<div class="sg-head">קבוצות ומורים תואמים</div>${groupRows}` : ''}`;
    pop.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    this._sg = { items, active: -1 };
  },

  moveSuggestion(delta) {
    const n = this._sg.items.length;
    if (!n) return;
    const a = this._sg.active;
    this._sg.active = a < 0 ? (delta > 0 ? 0 : n - 1) : (a + delta + n) % n;
    document.querySelectorAll('#searchSuggestPopup .sg-item').forEach((el, i) => {
      const on = i === this._sg.active;
      el.classList.toggle('active', on);
      el.setAttribute('aria-selected', String(on));
      if (on) { el.scrollIntoView({ block: 'nearest' }); $('globalSearch').setAttribute('aria-activedescendant', el.id); }
    });
  },

  pickSuggestion(i) {
    const item = this._sg.items[i];
    if (!item) return;
    this.hideSuggestions();
    if (item.kind === 's') this.selectStudent(item.tz); else this.selectGroup(item.id);
  },

  /** בסדין בחירה מסננת לחניך; בשאר המסכים נפתח כרטיס 360°. */
  selectStudent(tz) {
    const t = Store.trainees.get(tz);
    if (!t) return;
    clearTimeout(this._searchTimer);
    this.state.selectedSearchTz = tz;
    this.state.filters.q = '';
    setVal('globalSearch', t.name);
    FILTERED_TABS.forEach(tab => this.dirty.add(tab));
    this.renderSearchChrome();
    if (this.state.tab === 'sadin' && this.state.sadin.mode === 'full') {
      this.renderTab('sadin');
      return;
    }
    this.openProfile(tz);
  },

  screenKey(tab = this.state.tab, mode = this.state.sadin.mode) {
    return tab === 'sadin' ? (mode === 'full' ? 'sheet' : 'weakness') : tab;
  },

  rememberScreenFilters() {
    const current = this.screenKey();
    if (!this._screenFilters) this._screenFilters = {};
    if (['overview', 'groups', 'bagrut', 'sheet', 'weakness'].includes(current)) {
      this._screenFilters[current] = {
        filters: { ...this.state.filters }, selectedSearchTz: this.state.selectedSearchTz,
        subject: this.state.sadin.subject, teacher: this.state.sadin.teacher, strip: this.state.sadin.strip
      };
    }
  },

  switchScreenFilters(key) {
    if (this.screenKey() === key) return;
    this.rememberScreenFilters();
    const saved = this._screenFilters[key];
    this.state.filters = saved ? { ...saved.filters } : { grade: key === 'bagrut' ? 'יב' : 'all', cls: 'all', track: 'all', q: '' };
    this.state.selectedSearchTz = saved ? saved.selectedSearchTz : null;
    if (key === 'sheet' || key === 'weakness') {
      Object.assign(this.state.sadin, { subject: saved ? saved.subject : 'all', teacher: saved ? saved.teacher : 'all', strip: saved ? saved.strip : 'all' });
    }
    this.state.bagrutScope = this.scopeOfGrade(this.state.filters.grade);
    this.state.bagrutScopeSet = true;
    this.alertOut = [];
    FILTERED_TABS.forEach(tab => this.dirty.add(tab));
  },

  selectGroup(groupId) {
    Object.assign(this.state.groups, { subject: 'all', teacher: 'all', subjectKey: 'all', strip: 'all', groupId, missingSelected: false });
    this.state.groupsViewMode = 'explorer';
    this.state.selectedSearchTz = null;
    this.state.filters.q = '';
    setVal('globalSearch', '');
    FILTERED_TABS.forEach(tab => this.dirty.add(tab));
    this.renderSearchChrome();
    this.syncGroupLayout();
    this.groupsRerender();
  },

  clearSearch() {
    clearTimeout(this._searchTimer);
    const st = this.state, had = st.selectedSearchTz || st.filters.q;
    st.selectedSearchTz = null;
    st.filters.q = '';
    setVal('globalSearch', '');
    this.hideSuggestions();
    this.renderSearchChrome();
    if (had) { FILTERED_TABS.forEach(tab => this.dirty.add(tab)); this.renderTab(st.tab); }
    const input = $('globalSearch');
    if (input) input.focus();
  },

  /** כפתור ה-× בתיבת החיפוש (מוצג כשיש טקסט או חניך נעול) */
  renderSearchChrome() {
    const input = $('globalSearch'), st = this.state;
    const clear = $('searchClear');
    if (clear) clear.classList.toggle('hidden', !(input && input.value) && !st.selectedSearchTz);
  },

  onFilterChange() {
    /* סינון חדש מחליף את רשימת הניווט שנשמרה מהטבלה ברשימת החניכים שבסינון הנוכחי */
    if (this.state.navOrigin) this.state.navOrigin.orderedTzList = null;
    this.syncFilters();
    FILTERED_TABS.forEach(t => this.dirty.add(t));
    this.alertOut = [];
    this.renderTab(this.state.tab);
  },

  /** שינוי שכבה בסינון העליון (#fGrade): בורר השכבות בלשונית הבגרות עובר לאותה שכבה */
  changeGradeFilter(grade) {
    const st = this.state;
    st.filters.grade = grade;
    st.filters.cls = 'all';
    st.bagrutScope = this.scopeOfGrade(grade);
    st.bagrutScopeSet = true;
    this.onFilterChange();
  },

  /** "נקה": שכבה עליונה ובורר השכבות חוזרים יחד ל"הכל" / "כל השכבות" */
  resetFilters(keepGrade12 = false) {
    clearTimeout(this._searchTimer);
    this.state.selectedSearchTz = null;
    this.state.filters = { grade: keepGrade12 ? 'יב' : 'all', cls: 'all', track: 'all', q: '' };
    if (this.state.tab === 'sadin') Object.assign(this.state.sadin, { subject: 'all', teacher: 'all', strip: 'all' });
    this.state.bagrutScope = keepGrade12 ? '12' : 'all';
    this.state.bagrutScopeSet = true;
    this.hideSuggestions();
    this.onFilterChange();
  },

  /* ------------------------------------------------------------------
     רמזור עדכניות + העלאה מבוזרת
     ------------------------------------------------------------------ */
  renderChrome() {
    const ex = Config.exceptionCount();
    setText('statusLine', `${Store.trainees.size} חניכים במצבת · ${Store.groups.size} קבוצות${ex ? ` · ⚡ ${ex} במסלול חריג` : ''}`);
    this._rosterByTz = new Map(Config.getRosterAll().map(r => [r.tz, r]));
    const count = Object.keys(Config.getRosterOverrides()).length;
    const ghostCount = Config.activeGhostClasses().length;
    const unmatchedCount = Store.hasData() ? GroupAnalyzer.unmatchedIds().length : 0;
    const banner = $('overridesBanner');
    if (banner) {
      const show = count > 0 || ghostCount > 0 || unmatchedCount > 0;
      banner.classList.toggle('hidden', !show);
      const parts = [];
      if (count) parts.push(`${count} דריסות שיוך`);
      if (ghostCount) parts.push(`${ghostCount} כיתות רפאים`);
      if (unmatchedCount) parts.push(`${unmatchedCount} חניכי רפאים לבדיקה`);
      banner.textContent = show ? `ארגון כיתות אם: ${parts.join(' · ')}` : '';
    }
    ['bagrut', 'groups', 'sadin', 'roster'].forEach(p => this.renderFreshnessBar(p));
    RulesView.renderDataStatus.call(this);
    if (this.state.tab === 'settings') RulesView.renderQualityCard.call(this, DATASETS);
  },

  /** כלים טכניים בלשונית ההגדרות: מיפוי עמודות וניקוי נתונים לכל קובץ משנה (כולל הסרת סדין לפי שכבה) */
  renderDataTools() { return RulesView.renderDataTools.call(this, DATASETS); },
  renderQualityCard() { return RulesView.renderQualityCard.call(this, DATASETS); },

  overrideBadge(tz) {
    const r = this._rosterByTz && this._rosterByTz.get(tz), o = r && r.override;
    if (!o || !(o.grade || o.homeroom || o.track)) return '';
    const current = `${this.effLabel(r)} · שכבה ${Util.gl(r.grade)} · מסלול ${Config.trackFor(r.tz, r.track, r.homeroom)}`;
    const original = r.added ? 'לא במצבת' : `${this.rawLabel(r)} · שכבה ${Util.gl(r.rawGrade)} · מסלול ${r.rawTrack}`;
    return ` <span class="badge badge-exc whitespace-nowrap" title="${E(`שיוך דורס ידנית: ${current} (בקובץ המצבת המקורי: ${original})`)}">🔀 דריסה</span>`;
  },

  freshBarHtml(key) {
    const info = Config.getFreshnessInfo(key);
    if (key === 'masterRoster') {
      const empty = info.status === 'empty';
      return `<div class="fresh-bar ${empty ? 'fresh-slate' : 'fresh-emerald'}"><span class="font-medium">${empty ? 'טרם נטענה מצבת' : `נטענה: ${E(info.dateTime)} (${E(info.fileName)}) – נשמרת עד לטעינת מצבת חדשה`}</span></div>`;
    }
    /* פס הסטטוס מציג מידע בלבד – כפתור הטעינה היחיד נמצא בכותרת הפאנל */
    /* בציונים שוטפים מוצג גם תאריך האירוע האחרון בקובץ: קובץ ישן שהועלה היום אינו "עדכני" באמת */
    const eventHint = key === 'sadinData' && Store.latestEventDate ? ` · אירוע אחרון בקובץ: ${E(Store.latestEventDate.split('-').reverse().join('/'))}` : '';
    if (info.status === 'fresh') {
      return `<div class="fresh-bar fresh-emerald"><span class="font-medium">🟢 מעודכן: ${E(info.dateTime)} (${E(info.fileName)})${eventHint}</span></div>`;
    }
    if (info.status === 'aging') {
      return `<div class="fresh-bar fresh-amber"><span class="font-medium">🟠 שים לב: הנתונים מלפני ${info.ageDays} ימים – מומלץ לטעון קובץ עדכני${eventHint}</span></div>`;
    }
    if (info.status === 'stale') {
      return `<div class="fresh-bar fresh-red"><span class="font-medium">🔴 הנתונים מלפני ${info.ageDays} ימים (${E(info.date)}) – מומלץ לטעון קובץ עדכני${eventHint}</span></div>`;
    }
    return `<div class="fresh-bar fresh-slate"><span class="font-medium">⚪ טרם נטען קובץ</span></div>`;
  },

  /** כיסוי לפי שכבה (חניכים ייחודיים בקובץ לכל שכבה); ריק כשלא נטען קובץ. ניקוי הנתונים נמצא בהגדרות */
  coverageHtml(key) {
    if (!Config.getDataset(key)) return '';
    let badges = '';
    if (key === 'groupsData' || key === 'sadinData') {
      const roster = Config.rosterMap(), byGrade = new Map();
      Config.getRows(key).forEach(r => {
        if (r.isTeacher || !r.tz) return;
        const g = r.gradeKey || (roster.get(r.tz) || {}).grade;
        if (!g) return;
        if (!byGrade.has(g)) byGrade.set(g, new Set());
        byGrade.get(g).add(r.tz);
      });
      badges = [...byGrade.entries()].sort((a, b) => Util.ord(a[0]) - Util.ord(b[0]))
        .map(([g, set]) => `<span class="badge fresh-slate border" title="חניכים ייחודיים בקובץ">${E(Util.gl(g))}: ${set.size} חניכים</span>`).join('');
    }
    return badges;
  },

  renderFreshnessBar(panelType) {
    const key = PANEL_KEY[panelType];
    if (!key) return;
    document.querySelectorAll(`[data-fresh-bar="${key}"]`).forEach(el => { el.innerHTML = this.freshBarHtml(key); });
    document.querySelectorAll(`[data-coverage="${key}"]`).forEach(el => { el.innerHTML = this.coverageHtml(key); });
    if (key === 'masterRoster') return;

    const info = Config.getFreshnessInfo(key);
    const overlay = $(`stale-${key}`);
    if (overlay) {
      const show = info.status === 'stale' && !Config.isStaleDismissed(key);
      overlay.classList.toggle('hidden', !show);
      overlay.innerHTML = show ? `
        <div class="font-semibold mb-1">הנתונים מלפני ${info.ageDays} ימים (${E(info.date)})</div>
        <p class="text-sm text-slate-500 mb-3">הנתונים ישנים מ-${Config.STALE_DAYS} ימים. מומלץ לטעון קובץ עדכני לפני קבלת החלטות.</p>
        <div class="flex flex-wrap justify-center gap-2">
          <button type="button" class="btn btn-primary" data-upload="${key}">טען קובץ עדכני עכשיו</button>
          <button type="button" class="btn btn-ghost" data-act="dismissStale" data-key="${key}">המשך לצפייה בנתונים הישנים</button>
        </div>` : '';
    }
    const badges = $(`unknown-${key}`);
    if (badges) {
      const rc = info.status === 'empty' || !Store.hasData() ? { unknown: [], missing: [] } : Config.reconcile(key);
      const any = rc.unknown.length || rc.missing.length;
      badges.className = any ? 'flex flex-wrap gap-2' : 'hidden';
      badges.innerHTML =
        (rc.unknown.length ? `<button type="button" class="badge gate-warn" data-act="showUnknown" data-key="${key}">לא נמצאו במצבת (${rc.unknown.length})</button>` : '') +
        (rc.missing.length && key !== 'sadinData' ? `<button type="button" class="badge tier-4" data-act="showMissing" data-key="${key}">חסרים בקובץ (${rc.missing.length})</button>` : '');
    }
  },

  /** פותח בחירת קובץ עבור פאנל/מפתח; יוצר שדה קובץ נסתר אם חסר */
  pickFile(key) {
    let inp = $(`file-${key}`);
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.id = `file-${key}`; inp.className = 'hidden'; inp.dataset.fileInput = key;
      inp.multiple = key !== 'masterRoster';
      inp.accept = key === 'masterRoster' ? '.xlsx,.xls,.csv' : '.xlsx,.xls,.csv,.txt';
      document.body.appendChild(inp);
    }
    inp.click();
  },

  /** מסמך → parseExcelFile → חלון מיפוי (אם נדרש, או תמיד עם opts.confirmMapping) → שמירה ב-Config → רינדור מחדש */
  handleFile(key, file, opts = {}) { return this.handleFiles(key, file ? [file] : [], opts); },

  /**
   * ייבוא כמה קבצים ברצף (בחירה מרובה). קובצי קבוצות/סדין/בגרות ממוזגים בצורה מצטברת (Config.upsertDataset),
   * כך שקובץ של שכבה אחת אינו מוחק את שאר השכבות; הרינדור מחדש מתבצע פעם אחת בסוף.
   */
  async handleFiles(key, files, opts = {}) {
    const list = [...(files || [])].filter(Boolean);
    if (!list.length || this.busy) return;
    if (!this.requireEdit()) return;
    this.busy = true;
    try {
      if (key === 'masterRoster') {
        if (await this.importRoster(list[0], opts)) this.lastFiles[key] = list[0];
      } else if (DATASETS[key]) {
        let imported = 0;
        for (const file of list) {
          try {
            if (await this.importDataset(key, file, opts)) { imported++; this.lastFiles[key] = file; }
          } catch (err) {
            console.error(err);
            this.toast(`${file.name}: ${err.message || 'שגיאה בקריאת הקובץ'}`, 'error');
          }
        }
        if (imported) this.afterDataChange();
        if (list.length > 1) this.toast(`יובאו ${imported} מתוך ${list.length} קבצים`, imported === list.length ? 'ok' : 'warn');
      }
    } catch (err) {
      console.error(err);
      this.toast(err.message || 'שגיאה בקריאת הקובץ', 'error');
    } finally { this.busy = false; }
  },

  /** מיפוי עמודות ידני מחדש: על הקובץ האחרון שנטען בהפעלה זו, ואם אין כזה – אחרי בחירת קובץ */
  remapColumns(key) {
    const last = this.lastFiles[key];
    if (last) { this.handleFile(key, last, { confirmMapping: true }); return; }
    const inp = document.createElement('input');
    inp.type = 'file'; inp.className = 'hidden'; inp.multiple = key !== 'masterRoster';
    inp.accept = key === 'masterRoster' ? '.xlsx,.xls,.csv' : '.xlsx,.xls,.csv,.txt';
    inp.addEventListener('change', () => {
      const files = [...(inp.files || [])];
      inp.remove();
      if (files.length) this.handleFiles(key, files, { confirmMapping: true });
    });
    document.body.appendChild(inp);
    inp.click();
  },

  confirmRosterImport(diff, fileName) {
    this.openModal(`
      <h3 class="text-lg font-semibold mb-3">אישור עדכון מצבת: ${E(fileName)}</h3>
      <table class="mb-3"><thead><tr><th>שכבה</th><th>כיום</th><th>בקובץ החדש</th></tr></thead>
        <tbody>${diff.grades.map(g => `<tr><td>${E(Util.gl(g.grade))}</td><td>${g.current}</td><td>${g.incoming}</td></tr>`).join('')}</tbody></table>
      <p class="text-sm mb-3">בהחלפה מלאה: ${diff.added} חניכים יתווספו, ${diff.removed} יוסרו, ${diff.changed} יעברו כיתה או שכבה.</p>
      ${diff.missingGrades.length ? `<p class="fresh-red border rounded-lg p-3 font-bold mb-3" role="alert">אזהרה: שכבות ${diff.missingGrades.map(g => E(Util.gl(g))).join(', ')} חסרות לחלוטין בקובץ החדש. החלפה מלאה תמחק את חניכיהן מהמצבת.</p>` : ''}
      <p class="text-sm mb-3">השינוי יישמר מקומית ויסונכרן לענן אם הוגדר. דריסות שיוך קיימות ימשיכו לחול.</p>
      <div class="flex flex-wrap gap-2">
        ${diff.missingGrades.length ? '<button type="button" class="btn btn-primary" data-act="rosterImportChoice" data-choice="merge">מזג רק את השכבות שבקובץ (שמור שכבות אחרות)</button>' : ''}
        <button type="button" class="btn ${diff.missingGrades.length ? 'btn-danger' : 'btn-primary'}" data-act="rosterImportChoice" data-choice="replace">${diff.missingGrades.length ? 'החלף את כל המצבת' : 'אשר החלפת מצבת'}</button>
        <button type="button" class="btn btn-ghost" data-act="closeModal">ביטול</button>
      </div>`);
    document.querySelector('#modal-root [data-act="closeModal"]')?.focus();
    return new Promise(resolve => { this._rosterImportResolve = resolve; });
  },

  async reportImportQuarantine(key, file, result, options) {
    if (!window.ImportQuarantine) {
      this.toast('דוח הסגר הקליטה אינו זמין.', 'warn');
      return;
    }
    try {
      const batch = await window.ImportQuarantine.recordImport(key, file, result, options);
      this.dirty.add('settings');
      const summary = window.ImportQuarantine.summarize(batch.records);
      const details = summary.reasons.map(([reason, count]) => `${reason}: ${count}`).join(' · ');
      this.toast(summary.total ? `דוח קליטה: ${summary.total} פריטים לבדיקה · ${details}` : 'דוח קליטה: לא זוהו פריטים להסגר', summary.total ? 'warn' : 'info');
      if (batch.warning) this.toast(batch.warning, 'warn');
    } catch (error) {
      console.error('import quarantine', error);
      this.toast(`דוח הסגר הקליטה לא הושלם: ${error.message}`, 'error');
    }
  },

  async importRoster(file, opts = {}) {
    if (!this.requireEdit()) return false;
    let res;
    try { res = await parseExcelFile(file, 'roster', opts); }
    catch (error) {
      if (window.ImportQuarantine) window.ImportQuarantine.recordFailure('masterRoster', file, error);
      this.dirty.add('settings');
      throw error;
    }
    if (!res) { this.toast('הייבוא בוטל', 'info'); return false; }
    const previous = Config.getRosterEntry();
    const diff = Config.rosterDiff(res.rows);
    if (!diff.incoming.length) {
      await this.reportImportQuarantine('masterRoster', file, res, { append: true });
      this.toast('לא נמצאו חניכים תקינים בקובץ. המצבת לא הוחלפה.', 'error');
      return false;
    }
    let rows = diff.incoming, merged = false;
    if (previous) {
      const choice = await this.confirmRosterImport(diff, file.name);
      if (!choice) { this.toast('הייבוא בוטל', 'info'); return false; }
      if (Config.getRosterEntry() !== previous) {
        this.toast('המצבת השתנתה בזמן האישור. יש לטעון שוב את הקובץ ולבדוק את ההבדלים העדכניים.', 'warn');
        return false;
      }
      if (choice === 'merge') { rows = Config.mergeRosterGrades(rows); merged = true; }
    }
    const saved = Config.setRoster(rows, file.name, res.ignoredIds);
    if (!saved.ok) { this.toast(saved.error, 'error'); return false; }
    await Config.scrubDatasets(true);
    /* מעבר מנתוני דמו למצבת אמיתית: מנקים את נתוני הדמו כדי שלא יוצגו כ"לא במצבת" */
    if (previous && previous.fileName === 'נתוני דמו') {
      await Config.clearAllData();
      if (!this.requireEdit()) return false;
      Config.data.traineeExceptions = {};
      Config.save();
      this.toast('נתוני הדמו הוסרו. טענו את קובצי הקבוצות, הסדין והבגרות מהפאנלים.', 'info');
    }
    this.rosterReport = { warnings: res.warnings, skipped: res.skipped, duplicates: res.duplicates, sheets: res.sheets, ignored: saved.ignored };
    this.toast(`נטענה מצבת: ${saved.count} חניכים מ-${res.sheets.length} גיליונות${saved.ignored ? ` (${saved.ignored} חניכי ז'-ט' לא נקלטו)` : ''}`, 'ok');
    const rec = saved.reconciled || {};
    if (rec.mergedManual || rec.cleanedOverrides || rec.mergedGhostClasses || rec.convertedManual) {
      const summary = [
        rec.mergedManual ? `${rec.mergedManual} חניכי רפאים התמזגו למצבת` : '',
        rec.convertedManual ? `${rec.convertedManual} חניכי רפאים נשמרו בדריסת כיתה` : '',
        rec.mergedGhostClasses ? `${rec.mergedGhostClasses} כיתות רפאים התמזגו` : '',
        rec.cleanedOverrides ? `${rec.cleanedOverrides} דריסות תואמות נוקו` : ''
      ].filter(Boolean).join(' · ');
      this.toast(`התמזגות שכבת האמת: ${summary}`, 'info');
    }
    const overrides = Object.keys(Config.getRosterOverrides()).length;
    if (overrides) this.toast(`המצבת עודכנה. שים לב: ${overrides} דריסות שיוך ידניות ממשיכות לחול על הקובץ החדש.`, 'warn');
    res.warnings.forEach(w => this.toast(w, 'warn'));
    await this.reportImportQuarantine('masterRoster', file, res, {
      replaceAll: !merged, grades: [...new Set(diff.incoming.map(r => r.grade).filter(Boolean))]
    });
    this.afterDataChange();
    return true;
  },

  async importDataset(key, file, opts = {}) {
    if (!this.requireEdit()) return false;
    const ds = DATASETS[key];
    if (!Store.hasData()) this.toast('טרם נטענה מצבת – ת.ז שאינן במצבת יוחרגו מכל המדדים.', 'warn');
    let res;
    try { res = await parseExcelFile(file, ds.type, opts); }
    catch (error) {
      if (window.ImportQuarantine) window.ImportQuarantine.recordFailure(key, file, error);
      this.dirty.add('settings');
      throw error;
    }
    if (!res) { this.toast('הייבוא בוטל', 'info'); return false; }
    if (!res.rows.length) {
      await this.reportImportQuarantine(key, file, res, { append: true });
      this.toast(`${file.name}: לא נקלטו שורות תקינות מהקובץ. הנתונים הקיימים לא הוחלפו.`, 'warn');
      return false;
    }
    const saved = await Config.upsertDataset(key, Parser.slimRows(res.type, res.rows), { fileName: file.name });
    if (!saved.ok) { this.toast(saved.error, 'error'); return false; }
    const scope = saved.grades.length ? ` · שכבות: ${saved.grades.map(g => Util.gl(g)).join(', ')} (שאר השכבות נשמרו)` : '';
    this.toast(`נטענו ${res.rows.length} שורות מ"${file.name}"${res.skipped ? ` (${res.skipped} דולגו)` : ''}${res.ignored ? ` · ${res.ignored} שורות של חניכי ז'-ט' לא נקלטו` : ''}${scope}`, 'ok');
    if (res.unmatchedIds.length) this.toast(`${res.unmatchedIds.length} ת.ז בקובץ אינן במצבת והוחרגו מהחישובים`, 'warn');
    res.warnings.forEach(w => this.toast(w, 'warn'));
    await this.reportImportQuarantine(key, file, res, { grades: saved.grades, replaceAll: key !== 'bagrutData' && !saved.grades.length });
    return true;
  },

  /* ------------------------------------------------------------------
     עזרי טבלה
     ------------------------------------------------------------------ */
  noRoster(clearIds, mainId) {
    clearIds.forEach(id => setHtml(id, ''));
    setHtml(mainId, `
      <div class="p-10 text-center">
        <h3 class="text-lg font-semibold mb-1">טרם נטענה מצבת חניכים</h3>
        <p class="text-slate-500 text-sm mb-4">המצבת העליונה קובעת מי החניכים הפעילים, באיזו שכבה ובאיזו כיתת אם. אפשר לטעון אותה במסך "הגדרות ומצבת חניכים".</p>
        <div class="flex gap-2 justify-center">
          <button type="button" class="btn btn-primary" data-act="goSettings">מעבר להגדרות ומצבת</button>
        </div>
      </div>`);
  },

  /* ==================================================================
     חדר בקרה פדגוגי – תמונת מצב (לשונית ברירת המחדל)
     ================================================================== */
  /** חריגות שיבוץ לכל התצוגות; חוסר כולל גם היעדר מגמה, וכפילויות שגרתיות כפופות למתג הגלובלי. */
  placementAnomaliesModel(...args) { return GroupsView.placementAnomaliesModel.apply(this, args); },

  /** מעקב הוא איחוד סיכון בבגרות ו-2+ מקצועות שליליים/חסרים בסדין, רק ממקורות שנטענו. */
  attentionModel(...args) { return OverviewView.attentionModel.call(this, ...args); },

  /** פירוט אחיד של חניכים במעקב; החפיפה מוצגת רק כשיש חניכים בשתי הקבוצות */
  attentionBreakdownText(...args) { return OverviewView.attentionBreakdownText.call(this, ...args); },

  /** ממוצע שווה-משקל לחניכים עם ציון; תקינים הם בעלי ציון וללא מקצוע בסיכון. */
  sadinSummary(...args) { return SadinView.sadinSummary.apply(this, args); },

  /** התאמת מקצוע וסדין בכללי המחזור של כל חניך, ללא שימוש בתחזית הבגרות. */
  subjectReadinessModel(...args) { return BagrutView.subjectReadinessModel.apply(this, args); },

  overviewReadinessModel(...args) { return OverviewView.overviewReadinessModel.call(this, ...args); },

  readinessBreakdown(...args) { return BagrutView.readinessBreakdown.apply(this, args); },
  readinessCompact(...args) { return BagrutView.readinessCompact.apply(this, args); },
  readinessAverage(...args) { return BagrutView.readinessAverage.apply(this, args); },

  overviewModel(...args) { return OverviewView.overviewModel.call(this, ...args); },

  /**
   * אוכלוסיית הייחוס לצפי הבגרות בחדר הבקרה. בסינון "הכל": שכבת י"ב (ללא י"ב – י"א, ואם גם היא ריקה – כל החניכים).
   * שכבה שנבחרה במפורש קובעת. כשכל האוכלוסייה מתחת לי"ב מוצגת תקינות צבירה לשכבה ולא זכאות מלאה.
   */
  bagrutBenchmark(...args) { return OverviewView.bagrutBenchmark.call(this, ...args); },

  /** מקצועות חוסמים: מהסדין כשנטען (אוכלוסיית הייחוס בלבד), אחרת מהבגרות. בתקינות צבירה: רק כשלים בפועל ושאלונים שמועדם הגיע */
  overviewBlockers(...args) { return OverviewView.overviewBlockers.call(this, ...args, BAGRUT_CORE); },

  /**
   * תלמידים בחריגת שיבוץ או בחסם בגרות, מהחמור לקל. י"ב: חסם יחיד לזכאות כרגיל.
   * י' / י"א: רק כשל בפועל, שאלון חסר שמועדו הגיע או סיכון בציונים שוטפים – לא בגלל שאלוני י"ב עתידיים.
   */
  overviewIssues(...args) { return OverviewView.overviewIssues.call(this, ...args); },

  renderOverview() { return this.renderOverviewPanel(); },
  renderOverviewPanel(...args) { return OverviewView.renderOverviewPanel.call(this, ...args, DATASETS); },

  /** פסי ההתקדמות בחדר הבקרה מתחילים מאפס וגולשים למקומם (המעבר מוגדר ב-CSS על .ov-fill) */
  animateOverviewBars(...args) { return OverviewView.animateOverviewBars.call(this, ...args); },

  /* ==================================================================
     פאנל 1 – צפי זכאות לבגרות
     ================================================================== */
  dashRows(...args) { return BagrutView.dashRows.apply(this, args); },
  tierBased(...args) { return BagrutView.tierBased.apply(this, args); },
  BAGRUT_SCOPE_OF: { 'יב': '12', 'יא': '11', 'י': '10', all: 'all' },
  scopeOfGrade(...args) { return BagrutView.scopeOfGrade.apply(this, args); },
  gradeOfScope(...args) { return BagrutView.gradeOfScope.apply(this, args); },
  bagrutScopeCounts(...args) { return BagrutView.bagrutScopeCounts.apply(this, args); },
  applyBagrutScope(scope) { return BagrutView.applyBagrutScope.call(this, scope, FILTERED_TABS); },
  syncBagrutScope(...args) { return BagrutView.syncBagrutScope.apply(this, args); },
  bagrutScopeInfo(...args) { return BagrutView.bagrutScopeInfo.apply(this, args); },
  renderBagrutScope(...args) { return BagrutView.renderBagrutScope.apply(this, args); },
  attentionTzs(...args) { return BagrutView.attentionTzs.apply(this, args); },
  filterByChip(...args) { return BagrutView.filterByChip.apply(this, args); },
  chipMatch(...args) { return BagrutView.chipMatch.apply(this, args); },
  manualReviewLines(...args) { return BagrutView.manualReviewLines.apply(this, args); },
  manualReviewBadge(...args) { return BagrutView.manualReviewBadge.apply(this, args); },
  subjectDisplayCell(...args) { return ProfileView.subjectDisplayCell.apply(this, args); },
  majorDisplayCell(...args) { return BagrutView.majorDisplayCell.apply(this, args); },
  reverseBadges(...args) { return BagrutView.reverseBadges.apply(this, args); },
  renderBagrutPanel(...args) {
    const result = BagrutView.renderBagrutPanel.apply(this, args);
    const reset = $('bagrutRiskReset');
    if (reset) reset.hidden = this.state.bagrut.targets || this.state.bagrut.chip !== 'notok';
    return result;
  },
  renderBagrutKpis(...args) { return BagrutView.renderBagrutKpis.apply(this, args); },
  subjectDrillModel(...args) { return BagrutView.subjectDrillModel.apply(this, args); },
  readinessMatch(...args) { return BagrutView.readinessMatch.apply(this, args); },
  subjectReadinessKpis(...args) { return BagrutView.subjectReadinessKpis.apply(this, args); },
  bagrutSubjectMatrix(...args) { return BagrutView.bagrutSubjectMatrix.apply(this, args); },
  renderCohortInfo(...args) { return BagrutView.renderCohortInfo.apply(this, args); },
  bagrutList(...args) { return BagrutView.bagrutList.apply(this, args); },
  homeroomRows(...args) { return BagrutView.homeroomRows.apply(this, args); },
  advisoryHtml(...args) { return BagrutView.advisoryHtml.apply(this, args); },
  paceBadge(...args) { return BagrutView.paceBadge.apply(this, args); },
  diagBadges(...args) { return BagrutView.diagBadges.apply(this, args); },
  bagrutTable(list, signals) { return BagrutView.bagrutTable.call(this, list, BAGRUT_CORE, signals); },
  showMxPop(...args) { return BagrutView.showMxPop.apply(this, args); },
  hideMxPop(...args) { return BagrutView.hideMxPop.apply(this, args); },

  /* ---------- כללי זכאות ומשקלים (בתת-הלשונית "חוקי בגרות ושאלונים" בהגדרות) ---------- */
  applyRule(...args) { return RulesView.applyRule.apply(this, args); },
  renderCohortUi(...args) { return RulesView.renderCohortUi.apply(this, args); },
  cohortName(...args) { return RulesView.cohortName.apply(this, args); },
  renderRulesDrawer(...args) { return RulesView.renderRulesDrawer.apply(this, args); },
  ruleAdd(...args) { return RulesView.ruleAdd.apply(this, args); },
  patchComp(...args) { return RulesView.patchComp.apply(this, args); },

  openExceptionModal(...args) { return ProfileView.openExceptionModal.apply(this, args); },
  saveProfileException(...args) { return ProfileView.saveProfileException.apply(this, args); },
  clearProfileException(...args) { return ProfileView.clearProfileException.apply(this, args); },
  profTab(...args) { return ProfileView.profTab.apply(this, args); },

  /* ==================================================================
     פאנל 2 – בקרת קבוצות ושיבוצים
     ================================================================== */
  renderGroupsPanel(...args) { return GroupsView.renderGroupsPanel.apply(this, args); },
  visibleGroupCount(...args) { return GroupsView.visibleGroupCount.apply(this, args); },
  renderGroupsModeBar(...args) { return GroupsView.renderGroupsModeBar.apply(this, args); },
  renderAnomalyWorkspace(...args) { return GroupsView.renderAnomalyWorkspace.apply(this, args); },
  sortAnomalyRows(...args) { return GroupsView.sortAnomalyRows.apply(this, args); },
  syncGroupsHeadHeight(...args) { return GroupsView.syncGroupsHeadHeight.apply(this, args); },
  openTargetGroupInspector(...args) { return GroupsView.openTargetGroupInspector.apply(this, args); },
  renderStudentMapPopover(...args) { return GroupsView.renderStudentMapPopover.apply(this, args); },
  studentMapModel(...args) { return GroupsView.studentMapModel.apply(this, args); },
  groupsRerender(...args) { return GroupsView.groupsRerender.apply(this, args); },
  scrollActiveGroup(...args) { return GroupsView.scrollActiveGroup.apply(this, args); },
  renderGroupsExplorer(...args) { return GroupsView.renderGroupsExplorer.apply(this, args); },
  renderGroupsStrip(...args) { return GroupsView.renderGroupsStrip.apply(this, args); },
  compositionText(...args) { return GroupsView.compositionText.apply(this, args); },
  groupListItem(...args) { return GroupsView.groupListItem.apply(this, args); },
  renderGroupDetail(...args) { return GroupsView.renderGroupDetail.apply(this, args); },
  flatNote(...args) { return GroupsView.flatNote.apply(this, args); },

  /* ==================================================================
     פאנל 3 – מוניטור ציונים שוטפים
     ================================================================== */
  renderSadinPanel(...args) { return SadinView.renderSadinPanel.apply(this, args); },
  sadinScore(...args) { return SadinView.sadinScore.apply(this, args); },
  sadinTip(...args) { return SadinView.sadinTip.apply(this, args); },
  renderSadinSheet(...args) { return SadinView.renderSadinSheet.apply(this, args); },
  setSadinColWidth(...args) { return SadinView.setSadinColWidth.apply(this, args); },
  bindSadinColResize(...args) { return SadinView.bindSadinColResize.apply(this, args); },
  sadinSortRows(...args) { return SadinView.sadinSortRows.apply(this, args); },
  renderSadinFlat(...args) { return SadinView.renderSadinFlat.apply(this, args); },
  renderAlerts(...args) { return SadinView.renderAlerts.apply(this, args); },
  openSadinAlerts(...args) { return SadinView.openSadinAlerts.apply(this, args); },
  showSadinPop(...args) { return SadinView.showSadinPop.apply(this, args); },
  hideSadinPop(...args) { return SadinView.hideSadinPop.apply(this, args); },
  generateAlerts(...args) { return SadinView.generateAlerts.apply(this, args); },
  showMissed(...args) { return SadinView.showMissed.apply(this, args); },

  /* ==================================================================
     פאנל 4 – כרטיס חניך 360°
     ================================================================== */
  profileSubjectUnits(...args) { return ProfileView.profileSubjectUnits.apply(this, args); },
  unitsBadge(...args) { return ProfileView.unitsBadge.apply(this, args); },
  profileComponents(...args) { return ProfileView.profileComponents.apply(this, args); },
  profileSubjectStatus(...args) { return ProfileView.profileSubjectStatus.apply(this, args); },
  profileFocus(...args) { return ProfileView.profileFocus.apply(this, args); },
  profileList(...args) { return ProfileView.profileList.apply(this, args); },
  renderTrainee360Panel(...args) { return ProfileView.renderTrainee360Panel.apply(this, args); },
  profileModeBadge(...args) { return ProfileView.profileModeBadge.apply(this, args); },
  renderTrainee360Inner(...args) { return ProfileView.renderTrainee360Inner.apply(this, args); },
  profileCurrentModel(...args) { return ProfileView.profileCurrentModel.apply(this, args); },
  currentCell(...args) { return ProfileView.currentCell.apply(this, args); },
  renderProfileKpis(...args) { return ProfileView.renderProfileKpis.apply(this, args); },
  navScrollTarget(...args) { return ProfileView.navScrollTarget.apply(this, args); },
  captureNavOrigin(...args) { return ProfileView.captureNavOrigin.apply(this, args); },
  openProfile(...args) { return ProfileView.openProfile.apply(this, args); },
  setProfile(...args) { return ProfileView.setProfile.apply(this, args); },
  profileStep(...args) { return ProfileView.profileStep.apply(this, args); },
  renderProfileNav(...args) { return ProfileView.renderProfileNav.apply(this, args); },
  profBack(...args) { return ProfileView.profBack.apply(this, args); },
  returnToOrigin(...args) { return ProfileView.returnToOrigin.apply(this, args); },
  scrollToTop(...args) { return ProfileView.scrollToTop.apply(this, args); },
  saveProfileField(...args) { return ProfileView.saveProfileField.apply(this, args); },
  renderProfile(...args) { return this.renderTrainee360Panel(...args); },

  NAV_LABELS: { overview: 'חדר בקרה', bagrut: 'צפי זכאות לבגרות', groups: 'בקרת קבוצות', sadin: 'סדין ציונים שוטפים', settings: 'הגדרות ומצבת' },

  /* ==================================================================
     פאנל 5 – הגדרות ומצבת חניכים
     ================================================================== */
  /** תתי-לשוניות ההגדרות: מציג חלונית אחת ומעדכן את מוני התגיות (דריסות שיוך, שאלונים שטרם שויכו) */
  renderSettingsNav(...args) { return RulesView.renderSettingsNav.apply(this, args); },
  renderSettingsPanel(...args) { return RulesView.renderSettingsPanel.apply(this, args); },
  rawLabel(...args) { return RulesView.rawLabel.apply(this, args); },
  effLabel(...args) { return RulesView.effLabel.apply(this, args); },
  ovCandidates(...args) { return RulesView.ovCandidates.apply(this, args); },
  ovSearchResults(...args) { return RulesView.ovSearchResults.apply(this, args); },
  ovCloseResults(...args) { return RulesView.ovCloseResults.apply(this, args); },
  ovSetHomeroom(...args) { return RulesView.ovSetHomeroom.apply(this, args); },
  ovSyncGrade(...args) { return RulesView.ovSyncGrade.apply(this, args); },
  ovSyncDefaultTrack(...args) { return RulesView.ovSyncDefaultTrack.apply(this, args); },
  renderRosterOverrides(...args) { return RulesView.renderRosterOverrides.apply(this, args); },
  renderHomeroomWorkspace(...args) { return RulesView.renderHomeroomWorkspace.apply(this, args); },
  ovSelect(...args) { return RulesView.ovSelect.apply(this, args); },
  openClassRoster(...args) { return RulesView.openClassRoster.apply(this, args); },
  classRosterApply(...args) { return RulesView.classRosterApply.apply(this, args); },

  bindRulesEvents(...args) { return RulesView.bindRulesEvents.apply(this, args); },

  bindEvents() {
    on('headerCloudSync', 'click', () => this.syncCloudAccess({ push: true }));
    on('cloudAccessRetry', 'click', () => this.syncCloudAccess());
    on('cloudAccessContinue', 'click', () => { $('cloudAccessDialog').hidden = true; this.renderCloudAccess(); });
    on('cloudAccessSettings', 'click', () => {
      $('cloudAccessDialog').hidden = true;
      this.state.settingsView = 'system';
      this.dirty.add('settings');
      this.showTab('settings');
    });
    const editActions = new Set(['ovSave', 'ovRemove', 'ovClearAll', 'excModalSave', 'excModalClear',
      'ruleRemove', 'compRemove', 'qRemove', 'calibDelete', 'formSubmit', 'deleteRoster',
      'clearPanel', 'clearSadinGrade', 'quarantineClear', 'bagrutPin', 'weaknessRiskApply',
      'hrAddClass', 'hrDeleteGhostClass', 'hrAddStudent', 'hrBatchApply', 'hrAssignSelectedToClass',
      'hrHideSelected', 'hrHideStudent', 'hrRestoreStudent']);
    const editChanges = new Set(['backupImport', 'gradeCohort', 'compEnabled', 'compCodes', 'compWeight',
      'compGrade', 'compMagen', 'ruleToggle', 'clauseCodes', 'clauseKeywords', 'internalGrade',
      'clauseGrade', 'gateToggle', 'gateUnits', 'qName', 'qGrade', 'specialEd', 'classMove', 'classTrack',
      'weaknessRiskRules', 'hrClassNickname', 'hrClassReview']);
    const editIds = new Set(['excTrack', 'excNote', 'ruleCompEnabled', 'ruleCompPoints', 'ruleCompMin',
      'ruleCompMax', 'ruleCompCount', 'ruleCompExcluded', 'ruleParamPass', 'ruleParamBorderline',
      'ruleParamBonus', 'ruleParamMagen']);
    const originalControls = new WeakMap();
    const isEditControl = el => el && (editIds.has(el.id) || editChanges.has(el.dataset.chg));
    const rememberControl = e => {
      const el = e.target;
      if (isEditControl(el)) originalControls.set(el, { value: el.value, checked: el.checked });
    };
    document.addEventListener('focusin', rememberControl, true);
    document.addEventListener('pointerdown', rememberControl, true);
    document.addEventListener('change', e => {
      const el = e.target;
      if (!isEditControl(el)) return;
      if (this.requireEdit()) {
        originalControls.set(el, { value: el.value, checked: el.checked });
        return;
      }
      const original = originalControls.get(el);
      if (original) { el.value = original.value; el.checked = original.checked; }
      else if (el.id === 'excTrack' || el.id === 'excNote') {
        const ex = Config.getException(this.state.profileTz);
        el.value = el.id === 'excTrack' ? ex.trackOverride : ex.note;
      } else if (el.closest('#rulesDrawer')) this.renderRulesDrawer();
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    document.addEventListener('submit', e => {
      if (e.target.id === 'ovForm' && !this.requireEdit()) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    document.addEventListener('click', e => {
      if (e.target.closest && e.target.closest('#headerCloudSync')) return;
      const el = e.target.closest && e.target.closest('[data-act], [data-upload], [data-rule-add], #rulesReset, #btnClearData, #btnResetConfig');
      if (!el) return;
      if (!(el.dataset.upload || el.dataset.ruleAdd || editActions.has(el.dataset.act) ||
        ['rulesReset', 'btnClearData', 'btnResetConfig'].includes(el.id))) return;
      if (!this.requireEdit()) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    /* תפיסה בשלב ה-capture: האפליקציה שולטת בטאבים, בהעלאה ובמגירה ואינה תלויה בסקריפט מעטפת */
    document.addEventListener('click', e => {
      if (this.state.sadin.weakRiskDraft && !(e.target.closest && e.target.closest('.weak-risk-control'))) {
        SadinView.weaknessRiskClose.call(this);
      }
      if (this.state.bagrut.export30Open && !(e.target.closest && e.target.closest('.bagrut-export-control'))) {
        BagrutView.exportTargets30Close.call(this);
      }
      /* לחיצה מחוץ לחלונית "מפת שיבוצים" סוגרת אותה; לחיצה בתוך מודאל (השוואת קבוצות) או על כפתור הפתיחה אינה סוגרת */
      if (this.state.studentMapTz && !(e.target.closest && e.target.closest('.student-map-popover, #modal-root, #mappingModal, [data-act="studentMap"]'))) {
        GroupsView.closeStudentMap.call(this, false);
      }
      if (this.state.hrOpenClass && !(e.target.closest && e.target.closest('#hrClassPopover, #modal-root, #mappingModal, [data-act="hrOpenClass"], #hrBankCard'))) {
        RulesView.closeHomeroomClassPopover.call(this, false);
      }
      if (e.target.closest('[data-go-overrides]')) {
        e.stopPropagation();
        this.state.settingsView = 'overrides';
        this.state.ovMode = 'organize';
        this.dirty.add('settings');
        this.showTab('settings');
        this.renderSettingsNav();
        RulesView.renderHomeroomModeBar.call(this);
        RulesView.renderHomeroomWorkspace.call(this);
        const section = $('homeroomWorkspace') || $('ovTableSection');
        if (section && section.scrollIntoView) section.scrollIntoView({ block: 'start' });
        return;
      }
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        e.stopPropagation();
        const key = this.screenKey(tab.dataset.tab, tab.dataset.sadinMode);
        if (['overview', 'groups', 'bagrut', 'sheet', 'weakness'].includes(key)) this.switchScreenFilters(key);
        if (tab.dataset.sadinMode) return SadinView.sadinMode.call(this, { dataset: { mode: tab.dataset.sadinMode } }, true);
        if (tab.dataset.tab === 'bagrut') {
          Object.assign(this.state.bagrut, { drill: 'all', targets: false, chip: 'all', overviewEntry: false, whatifEntry: false });
          this.dirty.add('bagrut');
        }
        this.showTab(tab.dataset.tab);
        return;
      }
      const up = e.target.closest('[data-upload]');
      if (up) { e.stopPropagation(); e.preventDefault(); this.pickFile(up.dataset.upload); return; }
    }, true);
    document.addEventListener('change', e => {
      const inp = e.target.closest && e.target.closest('[data-file-input]');
      if (!inp) return;
      e.stopPropagation();
      /* העתקת הרשימה לפני איפוס השדה: איפוס ה-value מרוקן את ה-FileList */
      const files = [...(inp.files || [])];
      const key = inp.dataset.fileInput;
      inp.value = '';
      this.handleFiles(key, files);
    }, true);
    window.addEventListener('sd:file-selected', e => this.handleFiles(e.detail.key, e.detail.files || [e.detail.file]));
    window.addEventListener('sd:rules-changed', () => { Store.refresh(); SignalEngine.invalidate(); this.schedule(() => this.invalidateAll()); });
    window.addEventListener('resize', () => { this.syncGroupsHeadHeight(); this.fitTables(); });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => this.fitTables());
      ['globalFilterBar', 'brandBanner'].forEach(id => { const el = $(id); if (el) ro.observe(el); });
    }
    window.addEventListener('sd:exceptions-changed', () => { SignalEngine.invalidate(); this.schedule(() => this.invalidateAll()); });
    this.bindSadinColResize();

    /* סינון גלובלי */
    on('fGrade', 'change', e => this.changeGradeFilter(e.target.value));
    on('fHomeroom', 'change', e => { this.state.filters.cls = e.target.value; this.onFilterChange(); });
    on('fTrack', 'change', e => { this.state.filters.track = e.target.value; this.onFilterChange(); });
    on('globalSearch', 'input', e => {
      const st = this.state, hadLock = !!st.selectedSearchTz;
      clearTimeout(this._searchTimer);
      st.selectedSearchTz = null;
      st.filters.q = e.target.value;
      const live = this.LIVE_SEARCH_TABS.includes(st.tab);
      /* הקלדה מעדכנת רק את חלון ההשלמה; הטבלאות מתעדכנות חיות רק בבגרות ובסדין, או כשמשחררים נעילה של חניך */
      FILTERED_TABS.forEach(t => { if (t !== st.tab || live || hadLock) this.dirty.add(t); });
      this.renderSearchChrome();
      this.hideSuggestions();
      this._suggestTimer = setTimeout(() => this.showSuggestions(), 100);
      if (live) this._searchTimer = setTimeout(() => this.renderTab(st.tab), 180);
      else if (hadLock) this.renderTab(st.tab);
    });
    on('globalSearch', 'focus', () => this.showSuggestions());
    on('globalSearch', 'keydown', e => {
      let open = !$('searchSuggestPopup').classList.contains('hidden');
      if (e.key === 'Enter' && !open && this._suggestTimer != null) {
        this.showSuggestions();
        open = !$('searchSuggestPopup').classList.contains('hidden');
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (open) this.moveSuggestion(e.key === 'ArrowDown' ? 1 : -1); else this.showSuggestions();
      } else if (e.key === 'Enter' && open) {
        const idx = this._sg.active >= 0 ? this._sg.active : (this.LIVE_SEARCH_TABS.includes(this.state.tab) ? -1 : 0);
        if (this._sg.items[idx]) { e.preventDefault(); this.pickSuggestion(idx); }
      } else if (e.key === 'Escape' && (open || this._suggestTimer != null)) { e.stopPropagation(); this.hideSuggestions(); }
    });
    on('searchSuggestPopup', 'mousedown', e => e.preventDefault());
    document.addEventListener('click', e => { if (!e.target.closest('#searchWrap')) this.hideSuggestions(); });
    on('fClear', 'click', () => this.resetFilters(this.state.tab === 'bagrut'));
    on('bagrutSubjectDrillSelect', 'change', e => BagrutView.bagrutSubjectChange.call(this, e.target.value));
    on('sadinFilterSelect', 'change', e => {
      this.state.sadin.strip = e.target.value;
      this.dirty.add('sadin'); this.renderTab('sadin');
    });

    this.bindRulesEvents();

    /* קבוצות */
    on('groupSubjectSelect', 'change', e => GroupsView.groupSubjectChange.call(this, e.target.value));
    on('groupTeacherSelect', 'change', e => GroupsView.groupTeacherChange.call(this, e.target.value));
    /* ציונים שוטפים */
    on('sadinSubjectSelect', 'change', e => SadinView.sadinSubjectChange.call(this, e.target.value));
    on('sadinTeacherSelect', 'change', e => SadinView.sadinTeacherChange.call(this, e.target.value));

    /* כרטיס חניך */
    on('profSelect', 'change', e => this.setProfile(e.target.value));
    on('excTrack', 'change', e => this.saveProfileField({ trackOverride: e.target.value }));
    on('excNote', 'change', e => this.saveProfileField({ note: e.target.value.trim() }));

    /* Esc בכרטיס חניך חוזר למסך המקור כשאין חלון פתוח ולא מקלידים בשדה */
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (this.state.sadin.weakRiskDraft) {
        SadinView.weaknessRiskClose.call(this, true);
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (this.state.bagrut.export30Open) {
        BagrutView.exportTargets30Close.call(this, true);
        e.preventDefault(); e.stopPropagation();
        return;
      }
      const mapping = $('mappingModal');
      const modalOpen = !!($('modal-root') && $('modal-root').children.length) || !!(mapping && !mapping.classList.contains('hidden'));
      /* Esc סוגר קודם מודאל פתוח (למשל השוואת קבוצות מעל המפה), ורק אחריו את חלונית "מפת שיבוצים" או חלונית כיתת אם */
      if (this.state.studentMapTz && !modalOpen) {
        GroupsView.closeStudentMap.call(this, true);
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (this.state.hrOpenClass && !modalOpen) {
        RulesView.closeHomeroomClassPopover.call(this, true);
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (this.state.bagrut.drawerTz && !modalOpen) {
        BagrutView.bagrutDrawerClose.call(this, true);
        e.preventDefault(); e.stopPropagation();
        return;
      }
      const active = document.activeElement;
      const typing = !!active && (/^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName) || active.isContentEditable);
      this.closeModal(); this.hideMxPop(); this.hideSadinPop();
      if (this.state.tab === 'profile' && this.state.navOrigin && !modalOpen && !typing) this.profBack();
    }, true);
    window.addEventListener('popstate', () => { if (this.state.tab === 'profile' && this.state.navOrigin) this.returnToOrigin(); });
    /* חלון הפירוט של גיליון השליטה: ריחוף / מיקוד מקלדת זמניים, לחיצה מקבעת */
    const mxEl = e => e.target.closest && e.target.closest('[data-act="mxPop"]');
    document.addEventListener('mouseover', e => { const el = mxEl(e); if (el && !el.contains(e.relatedTarget) && !this._mxPinned) this.showMxPop(el, false); });
    document.addEventListener('mouseout', e => {
      const el = mxEl(e);
      if (el && !el.contains(e.relatedTarget) && !this._mxPinned && this._mxTrigger === el && !el.contains(document.activeElement)) {
        const focused = document.activeElement && document.activeElement.closest('[data-act="mxPop"]');
        if (focused) this.showMxPop(focused, false); else this.hideMxPop();
      }
    });
    document.addEventListener('focusin', e => { const el = mxEl(e); if (el && !this._mxPinned) this.showMxPop(el, false); });
    document.addEventListener('focusout', e => {
      const el = mxEl(e);
      if (el && !el.contains(e.relatedTarget) && !this._mxPinned && this._mxTrigger === el && !el.matches(':hover')) this.hideMxPop();
    });
    document.addEventListener('keydown', e => {
      const el = mxEl(e);
      if (el && e.target === el && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault(); this.acts.mxPop.call(this, el);
      }
    });
    document.addEventListener('click', e => { const pop = $('mxPop'); if (!mxEl(e) && (!pop || !pop.contains(e.target))) this.hideMxPop(); });
    document.addEventListener('scroll', e => { const pop = $('mxPop'); if (!pop || !pop.contains(e.target)) this.hideMxPop(); }, true);
    window.addEventListener('resize', () => this.hideMxPop());
    const sadinEl = e => e.target.closest && e.target.closest('[data-act="sadinPop"]');
    document.addEventListener('mouseover', e => { const el = sadinEl(e); if (el && !this._sadinPinned) this.showSadinPop(el, false); });
    document.addEventListener('mouseout', e => { const el = sadinEl(e); if (el && !el.contains(e.relatedTarget) && !this._sadinPinned) this.hideSadinPop(); });
    document.addEventListener('focusin', e => { const el = sadinEl(e); if (el && !this._sadinPinned) this.showSadinPop(el, false); });
    document.addEventListener('focusout', e => { if (sadinEl(e) && !this._sadinPinned) this.hideSadinPop(); });
    document.addEventListener('click', e => { if (!sadinEl(e) && !$('sadinPop').contains(e.target)) this.hideSadinPop(); });
    document.addEventListener('scroll', e => { if (!$('sadinPop').contains(e.target)) this.hideSadinPop(); }, true);
    document.addEventListener('click', e => {
      const add = e.target.closest('[data-rule-add]');
      if (add) return this.ruleAdd(add.dataset.ruleAdd);
      const sv = e.target.closest('[data-sview]');
      if (sv) {
        this.state.sadin.view = sv.dataset.sview;
        this.dirty.add('sadin');
        return this.renderTab('sadin');
      }
      const el = e.target.closest('[data-act]');
      const fn = el && this.acts[el.dataset.act];
      if (fn) fn.call(this, el, e);
    });
    document.addEventListener('change', e => {
      if (e.target.id === 'alertBy' || e.target.id === 'alertInitials') {
        if (e.target.id === 'alertBy') this.state.sadin.alertBy = e.target.value;
        else this.state.sadin.initials = e.target.checked;
        this.alertOut = [];
        this.renderAlerts();
      }
      const el = e.target.closest && e.target.closest('[data-chg]');
      const fn = el && this.chgs[el.dataset.chg];
      if (fn) fn.call(this, el, e);
    });
  },

  /** כינוי או הגדרת חנ"מ של כיתה משפיעים על תוויות, מסלולים וחישובי הזכאות */
  afterClassSettingChange(...args) { return RulesView.afterClassSettingChange.apply(this, args); },

  cloudService() { return CloudSync; },
  confirmAction(message) { return confirm(message); },
  promptAction(message) { return prompt(message); },
  renderSync(...args) { return RulesView.renderSync.apply(this, args); },
  renderCloudCard(...args) { return RulesView.renderCloudCard.apply(this, args); },
  renderCloudAuth(...args) { return RulesView.renderCloudAuth.apply(this, args); },
  cloudRefresh(...args) { return RulesView.cloudRefresh.apply(this, args); },

  CALIB_ORDER: ['עברית', 'היסטוריה', 'אזרחות', 'תנ"ך', 'ספרות', 'אנגלית', 'מתמטיקה'],

  calibModel(...args) { return RulesView.calibModel.apply(this, args); },
  unrecognizedCodes(...args) { return RulesView.unrecognizedCodes.apply(this, args); },
  renderCalibration(...args) { return RulesView.renderCalibration.apply(this, args); },
  openCalibModal(...args) { return RulesView.openCalibModal.apply(this, args); },
  calibDetach(...args) { return RulesView.calibDetach.apply(this, args); },
  calibSave(...args) { return RulesView.calibSave.apply(this, args); },
  afterRulesEdit(...args) { return RulesView.afterRulesEdit.apply(this, args); },

  acts: {
    rosterImportChoice(el) {
      const resolve = this._rosterImportResolve;
      this._rosterImportResolve = null;
      this.closeModal();
      if (resolve) resolve(el.dataset.choice);
    },
    cloudSave(...args) { return RulesView.cloudSave.apply(this, args); },
    cloudPull(...args) { return RulesView.cloudPull.apply(this, args); },
    cloudSync(...args) { return RulesView.cloudSync.apply(this, args); },
    cloudForcePush(...args) { return RulesView.cloudForcePush.apply(this, args); },
    cloudJoinLink(...args) { return RulesView.cloudJoinLink.apply(this, args); },
    cloudGoogleSignOut(...args) { return RulesView.cloudGoogleSignOut.apply(this, args); },
    backupExport(...args) { return RulesView.backupExport.apply(this, args); },
    cloudWipeLocal(...args) { return RulesView.cloudWipeLocal.apply(this, args); },
    calibAdd(...args) { return RulesView.calibAdd.apply(this, args); },
    calibAssign(...args) { return RulesView.calibAssign.apply(this, args); },
    calibEdit(...args) { return RulesView.calibEdit.apply(this, args); },
    calibDelete(...args) { return RulesView.calibDelete.apply(this, args); },

    modalBackdrop(el, e) { if (e.target === el) this.closeModal(); },
    mxPop(el) { return BagrutView.mxPop.call(this, el); },
    bagrutMode(el) { return BagrutView.bagrutMode.call(this, el); },
    bagrutWorkSort(el) { return BagrutView.workSort.call(this, el); },
    bagrutWorkSelect(el) { return BagrutView.workSelect.call(this, el); },
    bagrutWorkStep(el) { return BagrutView.workStep.call(this, el); },
    bagrutWorkGrade12() { return BagrutView.workGrade12.call(this); },
    closeModal() { this.closeModal(); },
    sadinAlerts() { this.openSadinAlerts(); },
    sadinMode(el) { return SadinView.sadinMode.call(this, el); },
    weaknessRiskToggle() { return SadinView.weaknessRiskToggle.call(this); },
    weaknessRiskAdjust(el) { return SadinView.weaknessRiskAdjust.call(this, el); },
    weaknessRiskReset() { return SadinView.weaknessRiskReset.call(this); },
    weaknessRiskApply() { return SadinView.weaknessRiskApply.call(this); },
    sadinSelectCell(el) { return SadinView.selectWeakness.call(this, el); },
    sadinCellEligibility(el) { return SadinView.openWeaknessEligibility.call(this, el); },
    sadinCellSheet(el) { return SadinView.openWeaknessSheet.call(this, el); },
    sadinCellAlerts(el) { return SadinView.openWeaknessAlerts.call(this, el); },
    generateAlerts() { this.generateAlerts(); },
    sadinPop(el) {
      if (this._sadinPinned === el) this.hideSadinPop();
      else this.showSadinPop(el, true);
    },
    goSettings() { this.showTab('settings'); },
    openDataTools() {
      this.state.settingsView = 'roster';
      this.dirty.add('settings');
      this.showTab('settings');
      const card = $('dataToolsCard');
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'start' });
    },
    openDataQuality() {
      this.state.settingsView = 'roster';
      this.dirty.add('settings');
      this.showTab('settings');
      const report = $('qualityDetails');
      if (report && report.scrollIntoView) report.scrollIntoView({ block: 'start' });
    },
    settingsView(...args) { return RulesView.settingsView.apply(this, args); },
    quarantineClear(...args) { return RulesView.quarantineClear.apply(this, args); },
    quarantineAudit(...args) { return RulesView.quarantineAudit.apply(this, args); },

    sgPick(el) { this.pickSuggestion(+el.dataset.i); },
    searchClear() { this.clearSearch(); },
    sgOpenGroup(el) { this.selectGroup(el.dataset.id); },
    /** ניווט מכרטיסי חדר הבקרה ללשונית מסוננת מראש */
    ovGo(el) {
      const { go, chip, strip, view, scope } = el.dataset;
      this.rememberScreenFilters();
      this.resetOverviewDrillFilters();
      if (go === 'bagrut') {
        Object.assign(this.state.bagrut, { chip: chip || 'all', drill: 'all', targets: false, overviewEntry: true, whatifEntry: false }); this.dirty.add('bagrut');
        if (chip === 'attention') {
          this.state.bagrutScope = this.scopeOfGrade(this.state.filters.grade);
          this.state.bagrutScopeSet = true;
        }
        /* "כל השכבות" מכרטיס כללי אינו מבטל שכבה שנבחרה במפורש בסינון העליון */
        if (chip !== 'attention' && scope && (scope !== 'all' || this.state.filters.grade === 'all')) { this.applyBagrutScope(scope); this.alertOut = []; }
      }
      if (go === 'sadin') { Object.assign(this.state.sadin, { strip: strip || 'all', mode: !strip || strip === 'all' ? 'early' : 'full', subject: 'all', teacher: 'all' }); this.alertOut = []; this.dirty.add('sadin'); }
      if (go === 'groups') {
        Object.assign(this.state.groups, { subject: 'all', teacher: 'all' });
        Object.assign(this.state, { groupsViewMode: view === 'explorer' ? 'explorer' : 'anomalies', anomalyCategoryFilter: 'all', anomalySubject: 'all' });
        this.dirty.add('groups');
      }
      this.showTab(go);
    },
    ovCompletion(el) {
      this.rememberScreenFilters();
      this.resetOverviewDrillFilters();
      if (this.state.filters.grade === 'all') this.applyBagrutScope(el.dataset.scope);
      Object.assign(this.state.bagrut, { chip: 'completion', drill: 'all', targets: false, readinessClass: '', readinessFilter: 'all', overviewEntry: true, whatifEntry: el.dataset.simulation === 'true', drillSim: { fullMode: true, ignoreInternals: false, plus5: false, useCurrent: false } });
      this.dirty.add('bagrut');
      this.showTab('bagrut');
      if (el.dataset.simulation === 'true') {
        const simulation = $('bagrutSimulation');
        if (simulation) simulation.open = true;
      }
    },
    ovHotspot(el) {
      this.rememberScreenFilters();
      this.resetOverviewDrillFilters();
      Object.assign(this.state.sadin, { mode: 'early', strip: 'all', subject: 'all', teacher: 'all', cell: { cls: el.dataset.class, subject: el.dataset.subject } });
      this.alertOut = [];
      this.dirty.add('sadin');
      this.showTab('sadin');
    },
    ovReadiness(el) {
      this.rememberScreenFilters();
      this.resetOverviewDrillFilters();
      if (this.state.filters.grade === 'all') this.applyBagrutScope(el.dataset.scope);
      Object.assign(this.state.bagrut, { drill: el.dataset.sel, chip: 'all', targets: false, onlyPending: true, readinessClass: '', readinessFilter: 'all', mxSort: 'current', mxDir: 1, overviewEntry: true, whatifEntry: false, drillSim: { fullMode: true, ignoreInternals: false, plus5: false, useCurrent: true } });
      this.dirty.add('bagrut');
      this.showTab('bagrut');
    },
    ovClass(el) {
      const f = this.state.filters, key = el.dataset.class;
      f.cls = f.cls === key ? 'all' : key;
      this.onFilterChange();
    },
    /** איפוס מהתג הפעיל בחדר הבקרה: מכיתה חזרה לכל השכבה, או משכבה לכל השכבות */
    ovScopeReset(el) {
      const f = this.state.filters;
      if (el.dataset.reset === 'grade') f.grade = 'all';
      f.cls = 'all';
      this.onFilterChange();
    },
    ovPick(...args) { return RulesView.ovPick.apply(this, args); },
    ovSave(...args) { return RulesView.ovSave.apply(this, args); },
    classRoster(...args) { return RulesView.classRoster.apply(this, args); },
    ovRemove(...args) { return RulesView.ovRemove.apply(this, args); },
    ovClearAll(...args) { return RulesView.ovClearAll.apply(this, args); },
    ovMode(...args) { return RulesView.ovMode.apply(this, args); },
    openHomeroomOrganize(...args) { return RulesView.openHomeroomOrganize.apply(this, args); },
    hrOpenClass(...args) { return RulesView.hrOpenClass.apply(this, args); },
    hrCloseClass(...args) { return RulesView.hrCloseClass.apply(this, args); },
    hrAddClass(...args) { return RulesView.hrAddClass.apply(this, args); },
    hrDeleteGhostClass(...args) { return RulesView.hrDeleteGhostClass.apply(this, args); },
    hrAddStudent(...args) { return RulesView.hrAddStudent.apply(this, args); },
    hrBatchApply(...args) { return RulesView.hrBatchApply.apply(this, args); },
    hrAssignSelectedToClass(...args) { return RulesView.hrAssignSelectedToClass.apply(this, args); },
    hrHideSelected(...args) { return RulesView.hrHideSelected.apply(this, args); },
    hrClearSelection(...args) { return RulesView.hrClearSelection.apply(this, args); },
    hrHideStudent(...args) { return RulesView.hrHideStudent.apply(this, args); },
    hrRestoreStudent(...args) { return RulesView.hrRestoreStudent.apply(this, args); },
    hrBankFilter(...args) { return RulesView.hrBankFilter.apply(this, args); },
    hrBankSort(...args) { return RulesView.hrBankSort.apply(this, args); },
    hrToggleBankAll(...args) { return RulesView.hrToggleBankAll.apply(this, args); },

    clearPanel(el) { return RulesView.clearPanel.call(this, el, DATASETS); },
    clearSadinGrade(...args) { return RulesView.clearSadinGrade.apply(this, args); },
    remap(...args) { return RulesView.remap.apply(this, args); },
    openProfile(el) { this.openProfile(el.dataset.tz, el); },
    profBack() { this.profBack(); },
    bagrutSort(el) { return BagrutView.bagrutSort.call(this, el); },
    bagrutPin(el) {
      BagrutView.bagrutPin.call(this, el);
      this.dirty.add('profile');
      if (this.state.tab === 'profile') this.renderTab('profile');
    },
    profileSubjectToggle(el, event) {
      if (event.target.closest('summary, button, a, input, select')) return;
      const details = el.querySelector('details');
      if (details) details.open = !details.open;
    },
    bagrutDrawerOpen(el) { return BagrutView.bagrutDrawerOpen.call(this, el); },
    bagrutDrawerClose() { return BagrutView.bagrutDrawerClose.call(this, true); },
    bagrutDrill(el) { return BagrutView.bagrutDrill.call(this, el); },
    readinessFilter(el) { return BagrutView.readinessFilter.call(this, el); },
    bagrutReadinessClass(el) { return BagrutView.bagrutReadinessClass.call(this, el); },
    bagrutDrillBack() { return BagrutView.bagrutDrillBack.call(this); },
    bagrutMxSort(el) { return BagrutView.bagrutMxSort.call(this, el); },
    bagrutChip(el) { return BagrutView.bagrutChip.call(this, el); },
    bagrutTargets() { return BagrutView.bagrutTargets.call(this); },
    bagrutTargetSort(el) { return BagrutView.bagrutTargetSort.call(this, el); },
    exportTargets30() { return BagrutView.exportTargets30Toggle.call(this); },
    exportTargets30SelectAll() { return BagrutView.exportTargets30SelectAll.call(this); },
    exportTargets30Clear() { return BagrutView.exportTargets30Clear.call(this); },
    exportTargets30Confirm() { return BagrutView.exportTargets30.call(this); },
    exportTargets30Close() { return BagrutView.exportTargets30Close.call(this, true); },
    bagrutScope(el) { return BagrutView.bagrutScope.call(this, el); },
    excModal(el) { this.openExceptionModal(el.dataset.tz); },
    excModalSave(el) { this.saveProfileException(el); },
    excModalClear(el) { this.clearProfileException(el); },
    profTab(el) { this.profTab(el.dataset.sub); },
    rulesTab(...args) { return RulesView.rulesTab.apply(this, args); },
    cohortEdit(...args) { return RulesView.cohortEdit.apply(this, args); },
    cohortCopy(...args) { return RulesView.cohortCopy.apply(this, args); },
    cohortAdd(...args) { return RulesView.cohortAdd.apply(this, args); },

    dismissStale(el) { Config.dismissStale(el.dataset.key); this.renderChrome(); },
    showUnknown(el) {
      const rc = Config.reconcile(el.dataset.key);
      this.openModal(`
        <div class="flex items-center justify-between gap-2 mb-2"><h3 class="text-lg font-semibold">לא נמצאו במצבת (${rc.unknown.length})</h3>
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-primary btn-sm" data-act="openHomeroomOrganize" data-bank-filter="ghosts">שייך בארגון כיתות אם</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="closeModal">סגירה</button>
          </div>
        </div>
        <p class="text-sm text-slate-500 mb-3">ת.ז אלה מופיעות ב"${E(DATASETS[el.dataset.key].title)}" אך אינן במצבת העליונה, ולכן הוחרגו מכל המדדים. ניתן לשייך אותן לכיתת אם או להסתירן בארגון כיתות אם.</p>
        <div class="flex flex-wrap gap-1 text-xs max-h-72 overflow-auto">${rc.unknown.slice(0, 500).map(tz => `<span class="badge fresh-slate border">${E(tz)}</span>`).join('')}</div>`);
    },
    showMissing(el) {
      const rc = Config.reconcile(el.dataset.key);
      const rows = this.sortTrainees(rc.missing.map(r => Store.trainees.get(r.tz)).filter(Boolean)).slice(0, 500).map(t =>
        `<tr class="cursor-pointer" data-act="openProfile" data-tz="${E(t.tz)}"><td class="tz-col">${E(t.tz)}</td><td class="font-medium">${E(t.name)}</td><td>${E(Config.classLabel(t.classKey))}</td></tr>`).join('');
      this.openModal(`
        <div class="flex items-center justify-between mb-2"><h3 class="text-lg font-semibold">חסרים בקובץ (${rc.missing.length})</h3><button type="button" class="btn btn-ghost" data-act="closeModal">סגירה</button></div>
        <p class="text-sm text-slate-500 mb-3">חניכים פעילים במצבת שאינם מופיעים ב"${E(DATASETS[el.dataset.key].title)}".</p>
        <div class="tbl-wrap" style="max-height:380px"><table class="grid"><thead><tr><th class="tz-col">ת.ז</th><th>שם</th><th>כיתה</th></tr></thead><tbody>${rows}</tbody></table></div>`, true);
    },
    ruleRemove(...args) { return RulesView.ruleRemove.apply(this, args); },
    compAdd(...args) { return RulesView.compAdd.apply(this, args); },
    compRemove(...args) { return RulesView.compRemove.apply(this, args); },
    qRemove(...args) { return RulesView.qRemove.apply(this, args); },

    groupsMode(el) { return GroupsView.groupsMode.call(this, el); },
    anCat(el) { return GroupsView.anCat.call(this, el); },
    grpAnomSort(el) { return GroupsView.grpAnomSort.call(this, el); },
    inspectGroups(el) { return GroupsView.inspectGroups.call(this, el); },
    sadinSort(el) { return SadinView.sadinSort.call(this, el); },
    toggleRoutine() { return GroupsView.toggleRoutine.call(this); },
    inspectOpenGroup(el) { return GroupsView.inspectOpenGroup.call(this, el); },
    studentMap(el) { return GroupsView.studentMap.call(this, el); },
    studentMapClose() { return GroupsView.closeStudentMap.call(this, true); },
    studentMapProfile(el) { GroupsView.closeStudentMap.call(this, false); this.openProfile(el.dataset.tz, el); },
    rosterSort(el) { return GroupsView.rosterSort.call(this, el); },
    gStrip(el) { return GroupsView.gStrip.call(this, el); },
    gPick(el) { return GroupsView.gPick.call(this, el); },
    gMissing() { return GroupsView.gMissing.call(this); },
    openBoardProfile(el) { return GroupsView.openBoardProfile.call(this, el, FILTERED_TABS); },
    showMissed() { this.showMissed(); },
    copyAlert(el) {
      const a = this.alertOut[+el.dataset.i];
      if (a) this.copyText(a.text).then(ok => this.toast(ok ? 'הועתק ללוח' : 'ההעתקה נכשלה', ok ? 'ok' : 'error'));
    },
    async waAlert(el) {
      const a = this.alertOut[+el.dataset.i];
      if (!a) return;
      const url = 'https://wa.me/?text=' + encodeURIComponent(a.text);
      if (url.length > WA_URL_MAX) return this.sendViaClipboard(a.text, () => window.open('https://wa.me/', '_blank', 'noopener'));
      window.open(url, '_blank', 'noopener');
    },
    async mailAlert(el) {
      const a = this.alertOut[+el.dataset.i];
      if (!a) return;
      const url = `mailto:?subject=${encodeURIComponent(a.title)}&body=${encodeURIComponent(a.text)}`;
      if (url.length > MAIL_URL_MAX) return this.sendViaClipboard(a.text, () => { window.location.href = `mailto:?subject=${encodeURIComponent(a.title)}`; });
      window.location.href = url;
    },
    deleteRoster(...args) { return RulesView.deleteRoster.apply(this, args); },

    formSubmit() {
      const ctx = this.formCtx;
      if (!ctx) return;
      const values = {};
      document.querySelectorAll('#modal-root [data-f]').forEach(el => { values[el.dataset.f] = el.value; });
      const res = ctx.onSubmit(values);
      if (res && res.ok === false) { setText('formErr', res.error || 'הערכים שהוזנו אינם תקינים'); return; }
      this.closeModal();
    }
  },

  chgs: {
    screenScope(el) {
      if (el.dataset.field === 'grade') this.changeGradeFilter(el.value);
      else if (el.dataset.field === 'cls') { this.state.filters.cls = el.value; this.onFilterChange(); }
    },
    bagrutWorkOption(el) {
      if (!['ignoreInternals', 'sim100'].includes(el.dataset.key)) throw new Error('אפשרות זכאות לא מוכרת');
      this.state.bagrut[el.dataset.key] = el.checked;
      this.dirty.add('bagrut'); this.renderTab('bagrut');
    },
    exportTargets30Subject(el) { return BagrutView.exportTargets30Subject.call(this, el); },
    weaknessRiskRules(el) { return SadinView.weaknessRiskChange.call(this, el); },
    submittedQuestionnaire(el) { return SadinView.submittedQuestionnaireChange.call(this, el); },
    async backupImport(el) {
      const f = el.files[0];
      el.value = '';
      if (!f || !confirm('ייבוא גיבוי או config.json יחליף נתונים והגדרות קיימים בתוכן הקובץ. ההחלפה תסונכרן גם לענן אם הוגדר ותשפיע על כל הצוות. מומלץ לייצא גיבוי קודם. להמשיך?')) return;
      await this.cloudRefresh(async () => {
        const kind = await CloudSync.importBackup(await f.text());
        this.toast(kind === 'legacy' ? 'קובץ config.json ישן נקלט: שוחזרו המצבת וההגדרות (קובצי בגרות, קבוצות וסדין אינם כלולים בו)' : 'הגיבוי נטען בהצלחה', kind === 'legacy' ? 'warn' : 'ok');
        return 'applied';
      });
    },
    sim(el) {
      const st = this.state.bagrut;
      if (st.targets) { el.checked = !!(st.drillSim || this.state.sim)[el.dataset.key]; return; }
      const base = this.state.filters.grade === 'יב'
        ? { fullMode: true, ignoreInternals: false, plus5: false, useCurrent: false }
        : this.state.sim;
      st.drillSim = { ...base, ...st.drillSim, [el.dataset.key]: el.checked };
      this.dirty.add('bagrut'); this.renderTab('bagrut');
    },
    bagrutOnlyPending(el) { return BagrutView.bagrutOnlyPending.call(this, el); },
    anSubject(el) { this.state.anomalySubject = el.value; this.dirty.add('groups'); this.renderTab('groups'); },
    gradeCohort(...args) { return RulesView.gradeCohort.apply(this, args); },
    compEnabled(...args) { return RulesView.compEnabled.apply(this, args); },
    compCodes(...args) { return RulesView.compCodes.apply(this, args); },
    compWeight(...args) { return RulesView.compWeight.apply(this, args); },
    compGrade(...args) { return RulesView.compGrade.apply(this, args); },
    compMagen(...args) { return RulesView.compMagen.apply(this, args); },
    ruleToggle(...args) { return RulesView.ruleToggle.apply(this, args); },
    clauseCodes(...args) { return RulesView.clauseCodes.apply(this, args); },
    clauseKeywords(...args) { return RulesView.clauseKeywords.apply(this, args); },
    internalGrade(...args) { return RulesView.internalGrade.apply(this, args); },
    clauseGrade(...args) { return RulesView.clauseGrade.apply(this, args); },
    gateToggle(...args) { return RulesView.gateToggle.apply(this, args); },
    gateUnits(...args) { return RulesView.gateUnits.apply(this, args); },
    qName(...args) { return RulesView.qName.apply(this, args); },
    qGrade(...args) { return RulesView.qGrade.apply(this, args); },
    specialEd(...args) { return RulesView.specialEd.apply(this, args); },
    hrClassNickname(...args) { return RulesView.hrClassNickname.apply(this, args); },
    hrClassReview(...args) { return RulesView.hrClassReview.apply(this, args); },
    classMove(...args) { return RulesView.classMove.apply(this, args); },
    classTrack(...args) { return RulesView.classTrack.apply(this, args); },

  }
};

window.App = App;

/* אתחול בטעינת המסמך (או מיד אם כבר נטען) */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => App.init());
else App.init();
