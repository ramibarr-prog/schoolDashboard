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
const setChecked = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
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
    sim: { ignoreInternals: false, plus5: false, useCurrent: false, fullMode: false },
    bagrut: { chip: 'all', sort: 'class', dir: 1, drill: 'all', mxSort: 'class', mxDir: 1, onlyPending: false, readinessClass: '', readinessFilter: 'all' },
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
    sadin: { subject: 'all', teacher: 'all', view: 'sheet', strip: 'all', alertBy: 'teacher', initials: false },
    profileTz: null,
    selectedSearchTz: null,
    settingsView: 'roster'
  },
  evals: new Map(),
  lastFiles: {},
  dirty: new Set(TABS),
  alertOut: [],
  formCtx: null,
  rosterReport: null,
  busy: false,
  _timer: null,

  /* ------------------------------------------------------------------
     אתחול
     ------------------------------------------------------------------ */
  /** מסך הפתיחה: מוצג לפחות 850ms ולכל היותר 1600ms מרגע הטעינה, גם אם האתחול (ענן / רשת) עוד לא הסתיים */
  SPLASH_MIN_MS: 850,
  SPLASH_MAX_MS: 1600,
  startSplash() {
    const t0 = window.__splashT0 || Date.now();
    this._splashT0 = t0;
    clearTimeout(this._splashFailsafe);
    this._splashFailsafe = setTimeout(() => this.hideSplash(), Math.max(0, this.SPLASH_MAX_MS - (Date.now() - t0)));
  },
  finishSplash() {
    clearTimeout(this._splashMin);
    this._splashMin = setTimeout(() => this.hideSplash(), Math.max(0, this.SPLASH_MIN_MS - (Date.now() - (this._splashT0 || Date.now()))));
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
    try { await Config.ready; } catch (e) { console.warn('config storage', e); }
    this.renderSync();
    window.addEventListener('sd:cloud-status', () => this.renderSync());
    window.addEventListener('sd:cloud-auto-error', e => {
      const message = `נשמר מקומית בלבד — ${(e.detail && e.detail.error) || 'הסנכרון לענן נכשל'}`, now = Date.now();
      if (this._autoErrorToast && this._autoErrorToast.message === message && now - this._autoErrorToast.at < 60000) return;
      this._autoErrorToast = { message, at: now };
      this.toast(message, 'warn');
    });
    window.addEventListener('sd:cloud-conflict', () => {
      this.toast('נשמרו שינויים ממחשב אחר (או מלשונית אחרת). כדי לא למחוק עבודה של אף אחד, השמירה האוטומטית נעצרה — בחרו כיצד להמשיך:', 'warn');
    });
    if (CloudSync.configured()) {
      try {
        const r = await CloudSync.pullCloudState();
        if (r === 'kept-local') this.toast('השינויים המקומיים נשמרו. יש לפתור את ההתנגשות בהגדרות הענן לפני סנכרון.', 'warn');
      } catch (e) { console.warn('cloud pull', e); this.toast(`סנכרון הענן נכשל: ${e.message}`, 'error'); }
    }
    Store.refresh();
    SignalEngine.invalidate();
    this.bindEvents();
    this.syncFilters();
    this.showTab(this.state.tab);
    if ((Config.rules().version || 0) < RULES_VERSION) {
      this.toast('קטלוג השאלונים והמגמות עודכן לקודי משוב של בית הספר. כדי לקבל אותו: ⚙️ הגדרות ומצבת ← חוקי בגרות ושאלונים ← שחזור ברירות מחדל.', 'info');
    }
    this.finishSplash();
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
    let e = this.evals.get(tz);
    if (!e) {
      /* מצב תעודה סופית חל על שכבת י"ב בלבד; י' ו-י"א נשפטות תמיד לפי צפי מותאם / תקינות צבירה */
      const t = Store.trainees.get(tz), sim = this.state.sim;
      e = BagrutEngine.evaluate(tz, t && t.gradeKey !== 'יב' ? { ...sim, fullMode: false } : sim);
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
  },

  showTab(name) {
    if (!TABS.includes(name)) return;
    /* יציאה מהכרטיס בדרך אחרת מהחזרה (למשל מהתפריט הצדדי) מבטלת את הקשר המקור */
    if (name !== 'profile' && this.state.navOrigin) { this.state.navOrigin = null; this._histPushed = false; this.dirty.add('profile'); }
    const changed = this.state.tab !== name;
    this.state.tab = name;
    document.body.classList.toggle('sadin-active', name === 'sadin');
    const toggle = (selector, on) => document.querySelectorAll(selector).forEach(el => el.classList.toggle('hidden', !on));
    toggle('[data-groups-only]', name === 'groups');
    toggle('[data-sadin-only]', name === 'sadin');
    toggle('[data-bagrut-only]', name === 'bagrut');
    toggle('[data-profile-only]', name === 'profile');
    toggle('[data-profile-exclude]', name !== 'profile');
    /* חדר הבקרה מסונן לפי שכבה וכיתת אם בלבד; מסלול וחיפוש מוסתרים בו (בלי לדרוס את ההסתרה שבכרטיס 360°) */
    document.querySelectorAll('[data-hide-overview]').forEach(el => el.classList.toggle('hidden', name === 'overview' || (name === 'profile' && el.hasAttribute('data-profile-exclude'))));
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
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    TABS.forEach(t => { const p = $(`panel-${t}`); if (p) p.hidden = t !== name; });
    this.renderChrome();
    this.renderTab(name);
    this.fitTables();
    if (name === 'overview' && changed) this.animateOverviewBars();
  },

  syncGroupLayout() {
    document.body.classList.toggle('group-explorer', this.state.tab === 'groups' && this.state.groupsViewMode === 'explorer' && Store.hasData() && Store.loaded.groups && !this.lockedTrainee());
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
    return f.track === 'all' || this.trackOf(t) === f.track;
  },

  /** חיפוש טקסט חי פעיל רק בלשוניות שבהן כל שורה היא חניך; בשאר הלשוניות הטקסט מזין רק את חלון ההשלמה */
  searchQuery() { return this.LIVE_SEARCH_TABS.includes(this.state.tab) ? this.state.filters.q : ''; },
  LIVE_SEARCH_TABS: ['bagrut', 'sadin'],

  lockedTrainee() { return this.state.selectedSearchTz ? Store.trainees.get(this.state.selectedSearchTz) || null : null; },

  /** התאמת חניך לטקסט: השם והשאילתה מנורמלים (גרשיים וגרשיים כפולים), בלי תלות בסדר שם פרטי/משפחה; ת.ז לפי ספרות */
  matchTrainee(t, query) {
    const q = Util.norm(query).toLocaleLowerCase();
    if (!q) return true;
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 3 && t.tz.includes(digits)) return true;
    const name = Util.norm(t.name).toLocaleLowerCase();
    return q.split(' ').every(token => name.includes(token));
  },

  filtered(includeSearch = true, ignoreClass = false) {
    const lock = includeSearch ? this.state.selectedSearchTz : null;
    const q = includeSearch && !lock ? this.searchQuery() : '';
    return this.sortTrainees(Store.traineeList().filter(t => {
      if (!this.passesFilters(t, ignoreClass)) return false;
      if (lock) return t.tz === lock;
      return !q || this.matchTrainee(t, q);
    }));
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
    const pop = $('searchSuggestPopup');
    if (pop) { pop.classList.add('hidden'); pop.innerHTML = ''; }
    const input = $('globalSearch');
    if (input) { input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    this._sg = { items: [], active: -1 };
  },

  showSuggestions() {
    const input = $('globalSearch'), pop = $('searchSuggestPopup');
    if (!input || !pop) return;
    const raw = input.value;
    if (this.state.selectedSearchTz || !Util.norm(raw) || !Store.hasData()) return this.hideSuggestions();
    const first = Util.norm(raw).toLocaleLowerCase().split(' ')[0];
    const rank = t => { const n = Util.norm(t.name).toLocaleLowerCase(); return n.startsWith(first) ? 0 : n.split(' ').some(w => w.startsWith(first)) ? 1 : 2; };
    const candidates = this.state.tab === 'profile' ? Store.traineeList() : this.filtered(false);
    const students = candidates.filter(t => this.matchTrainee(t, raw)).sort((a, b) => rank(a) - rank(b));
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

  /** נעילת הסינון לחניך אחד: טבלאות מסוננות אליו, בקבוצות מוצגות קבוצותיו בלבד, ובשאר הלשוניות נפתח כרטיס ה-360° שלו */
  selectStudent(tz) {
    const t = Store.trainees.get(tz);
    if (!t) return;
    clearTimeout(this._searchTimer);
    this.state.selectedSearchTz = tz;
    this.state.filters.q = '';
    setVal('globalSearch', t.name);
    FILTERED_TABS.forEach(tab => this.dirty.add(tab));
    this.renderSearchChrome();
    if (['groups', 'bagrut', 'sadin'].includes(this.state.tab)) this.renderTab(this.state.tab);
    else this.openProfile(tz);
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
  resetFilters() {
    clearTimeout(this._searchTimer);
    this.state.selectedSearchTz = null;
    this.state.filters = { grade: 'all', cls: 'all', track: 'all', q: '' };
    this.state.bagrutScope = 'all';
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
    const banner = $('overridesBanner');
    if (banner) { banner.classList.toggle('hidden', !count); banner.textContent = `🔀 ${count} דריסות שיוך פעילות`; }
    ['bagrut', 'groups', 'sadin', 'roster'].forEach(p => this.renderFreshnessBar(p));
  },

  /** כלים טכניים בלשונית ההגדרות: מיפוי עמודות וניקוי נתונים לכל קובץ משנה (כולל הסרת סדין לפי שכבה) */
  renderDataTools() {
    const sadinGrades = new Map(), roster = Config.rosterMap();
    Config.getRows('sadinData').forEach(r => {
      const grade = r.gradeKey || (roster.get(r.tz) || {}).grade;
      if (!Util.GRADE_KEYS.includes(grade)) return;
      if (!sadinGrades.has(grade)) sadinGrades.set(grade, new Set());
      if (r.tz) sadinGrades.get(grade).add(r.tz);
    });
    const card = key => {
      const loaded = !!Config.getDataset(key);
      const perGrade = key === 'sadinData'
        ? Util.GRADE_KEYS.filter(g => sadinGrades.has(g)).map(g =>
          `<button type="button" class="btn btn-ghost btn-sm w-full justify-between" data-act="clearSadinGrade" data-grade="${E(g)}" title="הסרת שורות סדין של שכבה ${E(Util.gl(g))}">הסרת שכבה ${E(Util.gl(g))} (${sadinGrades.get(g).size}) ×</button>`).join('')
        : '';
      return `<div class="rounded-lg border border-slate-300 bg-slate-50 p-3 space-y-2">
        <div class="text-sm font-bold">${E(DATASETS[key].title)}</div>
        <div data-fresh-bar="${key}" role="status"></div>
        <div class="flex flex-col gap-1.5">
          <button type="button" class="btn btn-primary btn-sm w-full justify-between" data-upload="${key}" title="טעינת קובץ ${E(DATASETS[key].title)}">📂 טעינת קובץ</button>
          <button type="button" class="btn btn-ghost btn-sm w-full justify-between" data-act="remap" data-key="${key}" title="מיפוי ידני מחדש של עמודות הקובץ">🔧 מיפוי עמודות</button>
          ${perGrade}
          <button type="button" class="btn btn-danger btn-sm w-full justify-between" data-act="clearPanel" data-key="${key}" ${loaded ? '' : 'disabled'}>🧹 נקה את כל הנתונים</button>
        </div></div>`;
    };
    setHtml('dataTools', Object.keys(DATASETS).map(card).join(''));
    Object.keys(DATASETS).forEach(key => {
      document.querySelectorAll(`#dataTools [data-fresh-bar="${key}"]`).forEach(el => { el.innerHTML = this.freshBarHtml(key); });
    });
  },

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

  async importRoster(file, opts = {}) {
    const res = await parseExcelFile(file, 'roster', opts);
    if (!res) { this.toast('הייבוא בוטל', 'info'); return false; }
    const previous = Config.getRosterEntry();
    const diff = Config.rosterDiff(res.rows);
    if (!diff.incoming.length) { this.toast('לא נמצאו חניכים תקינים בקובץ. המצבת לא הוחלפה.', 'error'); return false; }
    let rows = diff.incoming;
    if (previous) {
      const choice = await this.confirmRosterImport(diff, file.name);
      if (!choice) { this.toast('הייבוא בוטל', 'info'); return false; }
      if (Config.getRosterEntry() !== previous) {
        this.toast('המצבת השתנתה בזמן האישור. יש לטעון שוב את הקובץ ולבדוק את ההבדלים העדכניים.', 'warn');
        return false;
      }
      if (choice === 'merge') rows = Config.mergeRosterGrades(rows);
    }
    const saved = Config.setRoster(rows, file.name, res.ignoredIds);
    if (!saved.ok) { this.toast(saved.error, 'error'); return false; }
    await Config.scrubDatasets();
    /* מעבר מנתוני דמו למצבת אמיתית: מנקים את נתוני הדמו כדי שלא יוצגו כ"לא במצבת" */
    if (previous && previous.fileName === 'נתוני דמו') {
      await Config.clearAllData();
      Config.data.traineeExceptions = {};
      Config.save();
      this.toast('נתוני הדמו הוסרו. טענו את קובצי הקבוצות, הסדין והבגרות מהפאנלים.', 'info');
    }
    this.rosterReport = { warnings: res.warnings, skipped: res.skipped, duplicates: res.duplicates, sheets: res.sheets, ignored: saved.ignored };
    this.toast(`נטענה מצבת: ${saved.count} חניכים מ-${res.sheets.length} גיליונות${saved.ignored ? ` (${saved.ignored} חניכי ז'-ט' לא נקלטו)` : ''}`, 'ok');
    const overrides = Object.keys(Config.getRosterOverrides()).length;
    if (overrides) this.toast(`המצבת עודכנה. שים לב: ${overrides} דריסות שיוך ידניות ממשיכות לחול על הקובץ החדש.`, 'warn');
    res.warnings.forEach(w => this.toast(w, 'warn'));
    this.afterDataChange();
    return true;
  },

  async importDataset(key, file, opts = {}) {
    const ds = DATASETS[key];
    if (!Store.hasData()) this.toast('טרם נטענה מצבת – ת.ז שאינן במצבת יוחרגו מכל המדדים.', 'warn');
    const res = await parseExcelFile(file, ds.type, opts);
    if (!res) { this.toast('הייבוא בוטל', 'info'); return false; }
    if (!res.rows.length) { this.toast(`${file.name}: לא נקלטו שורות תקינות מהקובץ. הנתונים הקיימים לא הוחלפו.`, 'warn'); return false; }
    const saved = await Config.upsertDataset(key, Parser.slimRows(res.type, res.rows), { fileName: file.name });
    if (!saved.ok) { this.toast(saved.error, 'error'); return false; }
    const scope = saved.grades.length ? ` · שכבות: ${saved.grades.map(g => Util.gl(g)).join(', ')} (שאר השכבות נשמרו)` : '';
    this.toast(`נטענו ${res.rows.length} שורות מ"${file.name}"${res.skipped ? ` (${res.skipped} דולגו)` : ''}${res.ignored ? ` · ${res.ignored} שורות של חניכי ז'-ט' לא נקלטו` : ''}${scope}`, 'ok');
    if (res.unmatchedIds.length) this.toast(`${res.unmatchedIds.length} ת.ז בקובץ אינן במצבת והוחרגו מהחישובים`, 'warn');
    res.warnings.forEach(w => this.toast(w, 'warn'));
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
  placementAnomaliesModel(list) {
    const ready = Store.loaded.groups || Store.loaded.grades;
    const source = ready ? GroupAnalyzer.placementAnomalies(list) : { rows: [], outside: { unmatched: 0, unmatchedList: [] } };
    const hiddenRoutineCount = source.rows.filter(r => r.isRoutineDuplicate).length;
    const rows = this.state.showRoutineDuplicates ? source.rows : source.rows.filter(r => !r.isRoutineDuplicate);
    const byCategory = { missing: 0, duplicate: 0, suspect: 0 }, byTrainee = new Map();
    rows.forEach(r => {
      byCategory[r.category === 'missing_major' ? 'missing' : r.category]++;
      if (!byTrainee.has(r.tz)) byTrainee.set(r.tz, { tz: r.tz, items: [], severe: false, text: '' });
      const a = byTrainee.get(r.tz);
      a.items.push(r);
      if (r.kind !== 'nomajor') a.severe = true;
    });
    byTrainee.forEach(a => {
      a.text = a.items.map(r => `${GroupAnalyzer.ANOMALY_LABEL[r.kind] || r.kindLabel}: ${r.subject}`).join(' • ');
    });
    return { ready, rows, total: rows.length, studentsCount: byTrainee.size, byCategory, byTrainee, hiddenRoutineCount, outside: source.outside };
  },

  /** מעקב הוא איחוד סיכון בבגרות ו-2+ מקצועות שליליים/חסרים בסדין, רק ממקורות שנטענו. */
  attentionModel(...args) { return OverviewView.attentionModel.call(this, ...args); },

  /** פירוט אחיד של חניכים במעקב; החפיפה מוצגת רק כשיש חניכים בשתי הקבוצות */
  attentionBreakdownText(...args) { return OverviewView.attentionBreakdownText.call(this, ...args); },

  /** ממוצע שווה-משקל לחניכים עם ציון; תקינים הם בעלי ציון וללא מקצוע בסיכון. */
  sadinSummary(sheet) {
    const graded = sheet.filter(r => r.overall != null);
    return {
      avg: graded.length ? graded.reduce((sum, r) => sum + r.overall, 0) / graded.length : null,
      gradedCount: graded.length,
      cleanCount: graded.filter(r => !GroupAnalyzer.riskSubjects(r).length).length,
      totalCount: sheet.length
    };
  },

  /** התאמת מקצוע וסדין בכללי המחזור של כל חניך, ללא שימוש בתחזית הבגרות. */
  subjectReadinessModel(sel, trainees, onlyPending = false) {
    const [kind, id] = String(sel).split(':');
    const questionnaires = new Map(), all = [], groupsOn = !!Store.loaded.groups;
    let name = '', pass = Number(Config.rules().passGrade) || 55;
    const grades = [...new Set(trainees.map(t => t.gradeKey))];
    (grades.length ? grades : ['יב']).forEach(grade => Config.withRulesForGrade(grade, () => {
      const rules = Config.rules();
      const def = (kind === 'major' ? rules.majors : GroupAnalyzer.coreSubjects()).find(s => s.id === id && s.enabled !== false);
      const matrix = BagrutAdvisor.subjectMatrix(sel, trainees.filter(t => t.gradeKey === grade));
      if (!def || !matrix) return;
      name = matrix.name; pass = Number(rules.passGrade) || 55;
      matrix.questionnaires.forEach(q => { if (!questionnaires.has(q.key)) questionnaires.set(q.key, q); });
      const sheet = new Map((Store.loaded.grades ? GroupAnalyzer.sadinSheet(matrix.rows.map(r => r.t), {}) : []).map(r => [r.t.tz, r]));
      matrix.rows.forEach(r => {
        const comps = kind === 'major'
          ? (def.codeMode === 'any' ? [{ codes: def.codes, expectedGrade: def.expectedGrade }] : def.codes.map(code => ({ codes: [code], expectedGrade: def.expectedGrade })))
          : (def.variableUnits ? def.levels[r.level] : def.components) || [];
        const active = comps.filter(c => c.enabled !== false);
        const passed = c => {
          const cell = r.cells[c.codes.join(',')];
          return cell && (cell.state === 'pass' || (cell.state === 'num' && cell.num >= pass));
        };
        const dueNow = active.some(c => {
          const expected = c.expectedGrade || (rules.questionnaires[String(c.codes[0])] || {}).expectedGrade;
          return Util.normGrade(expected) === grade && !passed(c);
        });
        const finalPassed = r.finalScore != null ? r.finalScore >= pass : active.length > 0 && active.every(passed);
        const pending = !finalPassed || dueNow;
        const sr = sheet.get(r.t.tz);
        const subjects = sr ? [...sr.subjects.values()].filter(s => kind === 'major'
          ? Util.matchKeywords(s.name, def.keywords)
          : (GroupAnalyzer.coreOf(s.name) || {}).id === id || s.name === GroupAnalyzer.sadinSubject(def.name)) : [];
        // מגמות אינן מנורמלות בסדין; מאחדים עליאסים לפי אותן מילות מפתח של כללי הבגרות.
        const avg = subjects.length ? Store.weightedAverage(subjects.flatMap(s => s.events)).avg : null;
        // שאלוני 30% יושבים בכספת י"ב; מי שלומד את המקצוע השנה מזוהה לפי שיבוץ בפועל ולא לפי expectedGrade.
        const fileGroup = groupsOn ? Store.groupsOf(r.t.tz).find(g => g.inFile && !g.reinforcement && (kind === 'major'
          ? Util.matchKeywords(g.subject, def.keywords)
          : (GroupAnalyzer.coreOf(g.subject) || {}).id === id || Util.matchKeywords(g.subject, def.keywords))) : null;
        const unitGroup = (fileGroup && fileGroup.groupId) || r.groupId || '';
        const enrolled = !groupsOn || !!unitGroup || avg != null;
        all.push({ ...r, pass, pending, enrolled, unitGroup, currentAvg: avg, missed: subjects.reduce((n, s) => n + s.missed.size, 0) });
      });
    }));
    // יחידה מדווחת רק כשלחלק ממשי ממנה יש ציון שוטף (25% ולפחות 2, או כולם ביחידה של 1–2), כדי שציון בודד לא יהפוך את כל השאר ל"ללא ציון".
    const units = new Map();
    const tally = (key, r) => {
      const u = units.get(key) || { size: 0, graded: 0 };
      u.size++; if (r.currentAvg != null) u.graded++;
      units.set(key, u);
    };
    all.filter(r => r.enrolled).forEach(r => {
      r.unit = r.unitGroup ? `g:${r.unitGroup}` : groupsOn ? '' : `c:${r.t.classKey || ''}`;
      if (r.unitGroup) tally(r.unit, r);
      // נפילת חירום לכיתת אם (רק ללא קובץ קבוצות) נמדדת על כל חניכי הכיתה במקצוע.
      if (!groupsOn) tally(`c:${r.t.classKey || ''}`, r);
    });
    const isReported = u => !!u && u.graded >= Math.min(u.size, Math.max(2, Math.ceil(u.size * 0.25)));
    all.forEach(r => {
      const avg = r.currentAvg;
      r.readiness = !r.enrolled ? 'notEnrolled'
        : avg != null ? (avg < r.pass ? 'fail' : avg < 65 ? 'borderline' : 'ok')
        : isReported(units.get(r.unit)) ? 'noGrade' : 'unreported';
    });
    const rows = all.filter(r => (!onlyPending || r.pending) && !(onlyPending && groupsOn && !r.enrolled));
    const summarize = members => {
      const count = s => members.filter(r => r.readiness === s).length;
      const fail = count('fail'), borderline = count('borderline'), noGrade = count('noGrade'), ok = count('ok'), unreported = count('unreported'), notEnrolled = count('notEnrolled');
      const gradedRows = members.filter(r => r.currentAvg != null), total = members.length - notEnrolled, graded = gradedRows.length;
      const assessed = total - unreported, offTrack = fail + borderline + noGrade;
      return { total, assessed, graded, fail, borderline, noGrade, ok, unreported, notEnrolled, offTrack,
        offTrackPct: assessed ? Math.round(offTrack / assessed * 100) : 0,
        coveragePct: total ? Math.round(graded / total * 100) : 0,
        avg: graded ? gradedRows.reduce((n, r) => n + r.currentAvg, 0) / graded : null };
    };
    const byClass = new Map();
    rows.forEach(r => {
      const key = r.t.classKey || '';
      if (!byClass.has(key)) byClass.set(key, []);
      byClass.get(key).push(r);
    });
    const classes = [...byClass].map(([key, members]) => {
      const s = summarize(members);
      // כיתה נכנסת לדירוג רק כשהיא מדווחת ממשית, כדי שציון 0 בודד לא יקבע "כיתה חלשה".
      const reported = s.graded >= 2 || (s.graded > 0 && s.graded === s.total);
      return { key, ...s, offTrackCount: s.offTrack, failCount: s.fail, borderlineCount: s.borderline, noGradeCount: s.noGrade, unreportedOnly: !reported };
    }).filter(c => c.total > 0).sort((a, b) => a.unreportedOnly - b.unreportedOnly || b.offTrackPct - a.offTrackPct || (a.avg ?? -1) - (b.avg ?? -1) || b.offTrackCount - a.offTrackCount || natural(a.key, b.key));
    return { sel, name, pass, questionnaires: [...questionnaires.values()], rows, ...summarize(rows), classes, weakest: classes.find(c => !c.unreportedOnly) || null };
  },

  overviewReadinessModel(...args) { return OverviewView.overviewReadinessModel.call(this, ...args); },

  readinessBreakdown(m) {
    return `${m.fail} נכשלים · ${m.borderline} גבוליים · ${m.noGrade} ללא ציון${m.unreported ? ` · ${m.unreported} טרם דווח` : ''}`;
  },

  readinessCompact(r) {
    return `${r.fail} נכשלים · ${r.borderline} גבוליים${r.noGrade > 0 ? ` · ${r.noGrade} ללא ציון` : ''}`;
  },

  readinessAverage(avg) { return avg == null ? '—' : Util.fmt(avg, 1); },

  /** כל המדדים של חדר הבקרה על החניכים שבשכבה / כיתת האם שבסינון; ממוצע ומקצועות חוסמים מחושבים מגיליון הסדין */
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
  dashRows() { return this.filtered().map(t => ({ t, ev: this.getEval(t.tz) })); },

  /** י"ב, חריג ידני או ללא נתוני בגרות: נשפטים לפי צפי הזכאות המלא; י' / י"א: לפי תקינות צבירה לשכבה */
  tierBased(ev) { return ev.rank >= 12 || ev.manual || ev.tier === 0; },

  /** היקף השכבות בלשונית הבגרות. סינון שכבה גלובלי קובע לבדו; חניך שננעל בחיפוש מוצג תמיד. אם אין חניכים בהיקף ברירת המחדל – השכבה הגבוהה הראשונה שיש בה חניכים */
  /* מיפוי אחיד בין בורר השכבות בלשונית הבגרות לבין סינון השכבה העליון (#fGrade) */
  BAGRUT_SCOPE_OF: { 'יב': '12', 'יא': '11', 'י': '10', all: 'all' },
  scopeOfGrade(grade) { return this.BAGRUT_SCOPE_OF[grade] || 'all'; },
  gradeOfScope(scope) { return Object.keys(this.BAGRUT_SCOPE_OF).find(g => this.BAGRUT_SCOPE_OF[g] === scope) || 'all'; },

  /** ספירת החניכים לכל כפתור שכבה לפי יתר הסינונים, ללא חיתוך עצמי של סינון השכבה */
  bagrutScopeCounts() {
    const f = this.state.filters, grade = f.grade;
    let list;
    f.grade = 'all';
    try { list = this.filtered(); } finally { f.grade = grade; }
    const counts = { 12: 0, 11: 0, 10: 0, all: list.length };
    list.forEach(t => { const k = this.scopeOfGrade(t.gradeKey); if (k !== 'all') counts[k]++; });
    return counts;
  },

  /** קובע שכבה בבורר ובסינון העליון יחד; #fHomeroom מצטמצם לכיתות השכבה ושאר הלשוניות מסומנות לרינדור */
  applyBagrutScope(scope) {
    const st = this.state;
    st.filters.grade = this.gradeOfScope(scope);
    st.bagrutScope = this.scopeOfGrade(st.filters.grade);
    st.bagrutScopeSet = true;
    if (st.navOrigin) st.navOrigin.orderedTzList = null;
    this.syncFilters();
    st.bagrutScope = this.scopeOfGrade(st.filters.grade);
    FILTERED_TABS.forEach(t => this.dirty.add(t));
  },

  /** כניסה ראשונה ללשונית: ברירת המחדל (י"ב או השכבה הגבוהה הזמינה) נכתבת גם לסינון העליון; אחרת הבורר תמיד משקף את #fGrade */
  syncBagrutScope() {
    const st = this.state;
    if (st.filters.grade === 'all' && !st.bagrutScopeSet && !this.lockedTrainee() && Store.hasData()) {
      const counts = this.bagrutScopeCounts();
      if (counts.all) {
        let scope = st.bagrutScope;
        if (scope !== 'all' && !counts[scope]) scope = ['12', '11', '10'].find(k => counts[k]) || 'all';
        this.applyBagrutScope(scope);
        this.dirty.delete('bagrut');
        this.alertOut = [];
      }
    }
    st.bagrutScope = this.scopeOfGrade(st.filters.grade);
  },

  bagrutScopeInfo(rows) {
    const scope = this.scopeOfGrade(this.state.filters.grade);
    const show = !this.lockedTrainee();
    return { counts: this.bagrutScopeCounts(), scope, show, rows };
  },

  renderBagrutScope(info) {
    const box = $('bagrut-scope');
    if (!box) return;
    if (!Store.hasData() || !info.show) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const pill = (id, label) => `<button type="button" data-act="bagrutScope" data-scope="${id}" aria-pressed="${info.scope === id}">${label} (${info.counts[id]})</button>`;
    box.classList.remove('hidden');
    const cohort = gk => ` • ${E(Config.getCohortNameForGrade(gk))}`;
    box.innerHTML = `<div class="scope-bar" role="group" aria-label="היקף שכבות בצפי הזכאות">
      ${pill('12', `🎓 שכבת י"ב${cohort('יב')}`)}${pill('11', `📈 שכבת י"א${cohort('יא')}`)}${pill('10', `🌱 שכבת י'${cohort('י')}`)}${pill('all', '📋 כל השכבות')}</div>`;
  },

  /** חניכים הדורשים תשומת לב: סיכון בבגרות או 2+ מקצועות בסיכון בסדין (אותה הגדרה כמו כרטיס חדר הבקרה) */
  attentionTzs() {
    return this.attentionModel().tzSet;
  },

  filterByChip(rows, chip) {
    if (chip === 'attention') {
      const { tzSet } = this.attentionModel(rows.map(r => r.t), rows);
      return rows.filter(r => tzSet.has(r.t.tz));
    }
    return rows.filter(r => this.chipMatch(r, chip));
  },

  chipMatch(r, chip) {
    const ev = r.ev;
    if (chip === 'attention') return this.attentionTzs().has(r.t.tz);
    if (chip === 'exception') return ev.manual;
    if (chip === 'suspect') return !ev.manual && ev.isPotentialException;
    if (chip === 'manualReview') return !!(ev.manualReview && ev.manualReview.required);
    if (chip === 'near') return ev.singleBlocker;
    if (chip === 'notok') return ev.atRisk;
    if (chip === 'eligible') return this.tierBased(ev) && (ev.tier === 1 || ev.tier === 2);
    if (chip === 'savable') return ev.savable;
    if (/^tier[0-5]$/.test(chip)) return this.tierBased(ev) && ev.tier === +chip.slice(4);
    if (chip.startsWith('pace:')) return !this.tierBased(ev) && ev.paceStatus === chip.slice(5);
    return true;
  },

  manualReviewLines(ev) {
    return [...((ev.manualReview && ev.manualReview.reasons) || []), ...BagrutAdvisor.manualReviewLines(ev)];
  },

  /** תג בדיקת רכזת (פטורים / סמלי שאלון זרים) עם פירוט בריחוף */
  manualReviewBadge(ev, cls = 'badge tier-3') {
    const lines = this.manualReviewLines(ev);
    return lines.length ? `<span class="${cls} whitespace-nowrap" title="${E(lines.join(' | '))}">🔎 נדרשת בדיקה ידנית</span>` : '';
  },

  subjectDisplayCell(...args) { return ProfileView.subjectDisplayCell.apply(this, args); },

  majorDisplayCell(ev) {
    const exempt = ev.major.cands.find(c => c.exempt);
    if (exempt && !ev.major.chosen) return { ...ev.majorCell, name: exempt.name, text: 'פטור', sub: 'נדרשת החלטת רכזת', state: 'exempt', cls: 'text-amber-700 font-semibold',
      tip: `פטור במגמה (${exempt.name}) — נדרשת החלטת רכזת` };
    return ev.majorCell;
  },

  /** תגי "מחשבון הפוך" לציון ה-30% החסר: מידע / 🎯 ענבר / אדום */
  reverseBadges(ev, max = Infinity) {
    if (!ev.reverse || !ev.reverse.length || ev.tier === 0) return '';
    const cls = { info: 'bg-sky-100 text-sky-800', amber: 'tier-3', red: 'tier-4' };
    const shown = ev.reverse.slice(0, max), more = ev.reverse.length - shown.length;
    return `<div class="mt-1 flex flex-wrap gap-1">${shown.map(r =>
      `<span class="badge ${cls[r.level]} whitespace-normal" title="${E(`ציון חיצוני ${Math.round(r.externalScore)} · מקסימום אפשרי ${r.max}`)}">${E(r.subject)}: ${E(r.text)}</span>`).join('')}${more > 0 ? `<span class="badge fresh-slate border" title="${E(ev.reverseText)}">+${more}</span>` : ''}</div>`;
  },

  renderBagrutPanel() {
    this.renderFreshnessBar('bagrut');
    this.syncBagrutScope();
    const scope = this.bagrutScopeInfo(this.dashRows());
    this.renderBagrutScope(scope);
    const rows = scope.rows;
    const st = this.state.bagrut, sim = this.state.sim;
    const evalRows = rows.filter(r => this.tierBased(r.ev)), paceRows = rows.filter(r => !this.tierBased(r.ev));
    const stats = BagrutAdvisor.summarize(evalRows.map(r => r.ev));
    const list = this.bagrutList(rows);
    const tierCount = [0, 0, 0, 0, 0, 0];
    evalRows.forEach(r => { tierCount[r.ev.tier]++; });
    const hasGrade12 = rows.some(r => r.t.gradeKey === 'יב'), fullMode = hasGrade12 && !!sim.fullMode;
    const TT = BagrutEngine.TIER_TEXT[fullMode ? 'full' : 'adaptive'];

    const sw = (key, label) => `<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" class="w-4 h-4" data-chg="sim" data-key="${key}" ${sim[key] ? 'checked' : ''}>${label}</label>`;
    const modeBtn = (full, label, title, off = false) => `<button type="button" data-act="bagrutMode" data-mode="${full ? 'final' : 'adaptive'}" aria-pressed="${fullMode === full}" title="${E(title)}"${off ? ' disabled class="opacity-50 cursor-not-allowed"' : ''}>${label}</button>`;
    const finalBtn = hasGrade12 ? modeBtn(true, '🎓 מצב תעודה סופית (סוף י"ב)', 'בדיקה מחמירה לשכבת י"ב בלבד: כל השאלונים והיחידות הפנימיות נדרשים; שכבות י\' ו-י"א ממשיכות להישפט לפי תקינות צבירה')
      : modeBtn(true, '🎓 מצב תעודה סופית (סוף י"ב)', 'זמין לשכבת י"ב בלבד — שכבות י\' ו-י"א נשפטות לפי תקינות צבירה', true);
    setHtml('bagrut-whatif',
      `<span class="seg flex flex-col" role="group" aria-label="מצב הערכה">${modeBtn(false, '📅 צפי מותאם לשלב בשנה', 'נשפט לפי המבחנים שהשכבה כבר עברה; מה שטרם דווח לשכבה אינו חוסר')}${finalBtn}</span>` +
      sw('ignoreInternals', 'התעלם מחוסר יחידות פנימיות (חנ"ג, מעורבות, השכלה כללית ומדעים)') + sw('plus5', 'תוספת +5 לגבוליים 50-54') + sw('useCurrent', 'שלב ציונים שוטפים כתחזית (תצוגה מקדימה)'));

    this.renderCohortInfo(rows, fullMode);
    const drillOpts = BagrutAdvisor.drillOptions();
    if (st.drill !== 'all' && !drillOpts.some(o => o.value === st.drill)) {
      const subject = this.subjectReadinessModel(st.drill, rows.map(r => r.t));
      if (subject.name) drillOpts.push({ value: st.drill, label: subject.name });
      else st.drill = 'all';
    }
    const drill = st.drill !== 'all' && Store.hasData() ? this.subjectDrillModel(this.filterByChip(rows, st.chip)) : null;
    this.renderBagrutKpis(stats, tierCount, TT, paceRows, rows, drill);
    setHtml('bagrutSubjectDrillSelect',
      `<option value="all" ${st.drill === 'all' ? 'selected' : ''}>📊 מבט על – כל המקצועות</option>` +
      drillOpts.map(o => `<option value="${E(o.value)}" ${st.drill === o.value ? 'selected' : ''}>${E(o.label)}</option>`).join(''));
    if (!Store.hasData()) return this.noRoster([], 'bagrut-table');
    if (drill) return setHtml('bagrut-table', this.bagrutSubjectMatrix(drill));
    setHtml('bagrut-table', this.bagrutTable(list));
  },

  /** פס KPI מנהלים מעל הטבלה: אחוזי זכאות בקבוצה המסוננת ומונים לחיצים לסינון מהיר */
  renderBagrutKpis(stats, tierCount, TT, paceRows = [], rows = this.dashRows(), drill = null) {
    const box = $('bagrut-kpis');
    if (!box) return;
    if (!Store.hasData() || !Store.loaded.bagrut) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    if (drill) { box.classList.remove('hidden'); box.innerHTML = this.subjectReadinessKpis(drill); return; }
    const active = this.state.bagrut.chip;
    const pct = (value, label, title) => `<div class="flex items-baseline gap-2" title="${E(title)}"><span class="text-2xl font-extrabold leading-none text-slate-900">${value}%</span><span class="text-xs font-semibold text-slate-600">${label}</span></div>`;
    const quick = (id, cls, label, count, title) => `<button type="button" class="gstat ${cls}" data-act="bagrutChip" data-chip="${id}" aria-pressed="${active === id}" title="${E(title)}">
      <span class="text-xs font-bold text-slate-700 whitespace-nowrap">${label}</span><span class="text-sm font-extrabold px-2 py-0.5 rounded bg-slate-100">${count}</span></button>`;
    const basis = `מחושב על ${stats.counted} חניכים עם נתוני בגרות (ללא מסלול 12 שנות לימוד)`;
    const divider = '<span class="hidden sm:block h-8 w-px bg-slate-200" aria-hidden="true"></span>';
    const eligible = stats.total > 0 || !paceRows.length ? `
      <div class="flex flex-wrap items-center gap-x-6 gap-y-1">
        ${pct(stats.eligibilityInclSpecialEd, 'צפי זכאות · כולל חנ"מ', basis)}
        ${pct(stats.eligibilityExSpecialEd, 'צפי זכאות · ללא חנ"מ', basis)}
      </div>${divider}
      <div class="flex flex-wrap items-center gap-2" role="group" aria-label="סינון מהיר לפי צפי">
        ${quick('eligible', 'gstat-ok', 'זכאים', tierCount[1] + tierCount[2], `${TT[1]} + ${TT[2]}`)}
        ${quick('tier3', 'gstat-amber', 'קרובים לזכאות', tierCount[3], TT[3])}
        ${quick('tier4', 'gstat-bad', 'בסיכון', tierCount[4], TT[4])}
      </div>` : '';
    let pace = '';
    if (paceRows.length) {
      const ps = BagrutAdvisor.summarizePace(paceRows.map(r => r.ev));
      const grades = Util.GRADE_KEYS.filter(g => paceRows.some(r => r.t.gradeKey === g)).map(g => Util.gl(g)).join(', ');
      const paceBasis = `תקין לקצב או טרם החלו היבחנות, מתוך ${ps.counted} חניכים עם נתוני בגרות (שכבות ${grades}); שאלוני שכבות עליונות אינם נספרים כחוסר`;
      pace = `${eligible ? divider : ''}
      <div class="flex flex-wrap items-center gap-x-6 gap-y-1">
        ${pct(ps.pctInclSpecialEd, `תקינות צבירה (${grades}) · כולל חנ"מ`, paceBasis)}
        ${pct(ps.pctExSpecialEd, 'תקינות צבירה · ללא חנ"מ', paceBasis)}
      </div>${divider}
      <div class="flex flex-wrap items-center gap-2" role="group" aria-label="סינון מהיר לפי תקינות צבירה">
        ${quick('pace:on_track', 'gstat-ok', 'תקין לקצב', ps.onTrack, 'ללא כשלים ושאלון חסר שמועדו הגיע')}
        ${quick('pace:not_started', 'gstat-violet', 'טרם החלו', ps.notStarted, 'טרם החלו היבחנות')}
        ${quick('pace:pace_warning', 'gstat-amber', 'חסם יחיד', ps.warning, 'חסם צבירה יחיד לשכבה')}
        ${quick('pace:pace_lag', 'gstat-bad', 'בפיגור', ps.lag, 'בפיגור צבירה לשכבה')}
      </div>`;
    }
    box.classList.remove('hidden');
    const attention = active === 'attention' ? this.attentionModel(rows.map(r => r.t), rows) : null;
    box.innerHTML = `<div class="card px-4 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">${eligible}${pace}
      ${attention ? `<div class="w-full rounded bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900" role="status">במעקב: ${attention.tzSet.size} · ${this.attentionBreakdownText(attention)} <button type="button" class="btn btn-ghost btn-sm" data-act="bagrutChip" data-chip="all">✕ הצג הכל</button></div>` : ''}</div>`;
  },

  /** מודל אחד למקצוע בודד, משותף לפס המוכנות שב-#bagrut-kpis ולמטריצת השאלונים */
  subjectDrillModel(rows) {
    const st = this.state.bagrut, trainees = rows.map(r => r.t);
    const currentOn = !!(this.state.sim.useCurrent && Store.loaded.grades);
    const readiness = currentOn || st.onlyPending ? this.subjectReadinessModel(st.drill, trainees, st.onlyPending) : null;
    if (currentOn && st.readinessClass && !readiness.classes.some(c => c.key === st.readinessClass)) st.readinessClass = '';
    return { currentOn, readiness, m: readiness || BagrutAdvisor.subjectMatrix(st.drill, trainees) };
  },

  readinessMatch(r, filter) {
    if (filter === 'offTrack') return r.readiness === 'fail' || r.readiness === 'borderline' || r.readiness === 'noGrade';
    return filter === 'all' || r.readiness === filter;
  },

  /** פס מוכנות למקצוע הנוכחי: חזרה, ממוצע שוטף, סינון מהיר, מתגים והשוואת כיתות – מחוץ לגלילת הטבלה */
  subjectReadinessKpis(d) {
    const st = this.state.bagrut, r = d.readiness, m = d.m;
    const back = '<button type="button" class="btn btn-ghost btn-sm" data-act="bagrutDrillBack">← כל המקצועות</button>';
    const toggle = (attrs, on, label) => `<label class="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap"><input type="checkbox" class="w-4 h-4" ${attrs} ${on ? 'checked' : ''}>${label}</label>`;
    const toggles = `<div class="flex flex-wrap items-center gap-3">
      ${toggle('data-chg="sim" data-key="useCurrent"', this.state.sim.useCurrent, 'שלב ציונים שוטפים')}
      ${toggle('data-chg="bagrutOnlyPending"', st.onlyPending, 'ניגשים בלבד')}
      ${!d.currentOn && Store.loaded.grades ? '<span class="text-xs text-slate-500">הפעל "שלב ציונים שוטפים" להצגת מוכנות לבגרות</span>' : ''}</div>`;
    const chipReset = st.chip !== 'all' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="bagrutChip" data-chip="all">✕ ביטול סינון צפי</button>' : '';
    const divider = '<span class="hidden sm:block h-8 w-px bg-slate-200" aria-hidden="true"></span>';
    let metrics = '', classes = '';
    if (d.currentOn && m && m.name) {
      const flt = (id, cls, label, n) => `<button type="button" class="gstat ${cls}" data-act="readinessFilter" data-filter="${id}" data-count="${n}" aria-pressed="${st.readinessFilter === id}">
        <span class="text-xs font-bold text-slate-700 whitespace-nowrap">${label}</span><span class="text-sm font-extrabold px-2 py-0.5 rounded bg-slate-100">${n}</span></button>`;
      metrics = `${divider}<div class="flex items-baseline gap-2" data-readiness-summary data-avg="${r.avg == null ? '' : r.avg}" data-off-track="${r.offTrack}" data-fail="${r.fail}" data-borderline="${r.borderline}" data-no-grade="${r.noGrade}" data-total="${r.total}" title="${E(this.readinessBreakdown(r))}">
          <span class="text-2xl font-extrabold leading-none text-slate-900">${this.readinessAverage(r.avg)}</span><span class="text-xs font-semibold text-slate-600">ממוצע שוטף · ${r.offTrackPct}% לא בכיוון מתוך ${r.assessed}${r.unreported ? ` (+ ${r.unreported} טרם דווח)` : ''}</span></div>${divider}
        <div class="flex flex-wrap items-center gap-2" role="group" aria-label="סינון מהיר לפי מוכנות">
          ${flt('offTrack', 'gstat-bad', 'לא בכיוון', r.offTrack)}
          ${flt('fail', 'gstat-bad', `נכשלים (&lt;${r.pass})`, r.fail)}
          ${flt('borderline', 'gstat-amber', `גבוליים (${r.pass}–64)`, r.borderline)}
          ${r.noGrade > 0 ? flt('noGrade', 'gstat-violet', 'ללא ציון', r.noGrade) : ''}</div>`;
      if (r.classes.length > 1) classes = `<div class="w-full flex flex-wrap gap-2" aria-label="השוואת מוכנות לפי כיתות">${r.classes.map(c => `<button type="button" class="rounded-lg border px-2.5 py-1.5 text-right text-xs ${st.readinessClass === c.key ? 'bg-amber-100 border-amber-500' : c.unreportedOnly ? 'bg-slate-100 text-slate-400' : 'bg-slate-50'}" data-act="bagrutReadinessClass" data-class="${E(c.key)}" data-off-track="${c.offTrackCount}" data-total="${c.total}" data-unreported-only="${c.unreportedOnly}" aria-pressed="${st.readinessClass === c.key}">
        <span class="block font-bold">${E(Config.classLabel(c.key))} · ${c.unreportedOnly ? (c.graded ? 'דיווח חלקי' : 'טרם דווח') : `${c.offTrackPct}% לא בכיוון (${c.offTrackCount}/${c.assessed})`}</span>
        <span class="block">${this.readinessBreakdown(c)} · ממוצע ${this.readinessAverage(c.avg)}</span></button>`).join('')}</div>`;
    }
    return `<div class="card px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2" data-subject-kpis>
      ${back}<span class="font-bold text-slate-800">${E((m && m.name) || 'המקצוע אינו פעיל בכללים')}</span>${chipReset}${metrics}${divider}${toggles}${classes}</div>`;
  },

  /** מטריצת שאלונים למקצוע בודד: ציון לכל שאלון, 🧮 נצבר (משוקלל עד כה) וציון סופי */
  bagrutSubjectMatrix(d) {
    const st = this.state.bagrut;
    const { currentOn, m } = d;
    if (!m || !m.name) return '<div class="text-center text-slate-400 py-8">המקצוע אינו פעיל בכללים</div>';
    const { mxSort: sort, mxDir: dir } = st;
    const qKey = q => `q:${q.key}`;
    const cellOf = (r, q) => r.cells[q.key];
    const val = r => {
      if (sort === 'name') return r.t.name;
      if (sort === 'class') return Config.classLabel(r.t.classKey);
      if (sort === 'units') return r.level ? Number(r.level) : 0;
      if (sort === 'acc') return r.accumulated;
      if (sort === 'final') return r.finalScore == null ? -1 : r.finalScore;
      if (sort === 'current') return r.currentAvg == null ? -1 : r.currentAvg;
      const q = m.questionnaires.find(x => qKey(x) === sort), c = q && cellOf(r, q);
      return c && c.state === 'num' ? c.num : -1;
    };
    // במיון לפי שוטף: ציונים מספריים תמיד ראשונים (בכיוון המבוקש), אחריהם "ללא ציון" ולבסוף "טרם דווח".
    const currentRank = r => r.currentAvg != null ? 0 : r.readiness === 'noGrade' ? 1 : r.readiness === 'unreported' ? 2 : 3;
    const list = m.rows.filter(r => !currentOn || ((!st.readinessClass || r.t.classKey === st.readinessClass) && this.readinessMatch(r, st.readinessFilter))).sort((a, b) => {
      if (sort === 'current' && currentRank(a) !== currentRank(b)) return currentRank(a) - currentRank(b);
      const x = val(a), y = val(b);
      return ((typeof x === 'number' ? x - y : natural(x, y)) || natural(a.t.name, b.t.name)) * dir;
    });
    const th = (key, label, title = '') => `<th><button type="button" class="font-semibold" data-act="bagrutMxSort" data-key="${E(key)}" ${title ? `title="${E(title)}"` : ''}>${label}${sort === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    const qCells = r => m.questionnaires.map(q => {
      const c = cellOf(r, q);
      if (!c) return '<td class="text-slate-300">–</td>';
      if (c.state === 'num') return `<td class="${c.num >= r.pass ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-bold'}">${c.num}</td>`;
      if (c.state === 'pass') return '<td class="text-emerald-700 font-semibold">עבר</td>';
      if (c.state === 'fail') return '<td class="text-rose-600 font-bold">נכשל</td>';
      if (c.state === 'missed') return '<td class="text-rose-600 font-bold">חסר</td>';
      if (c.state === 'future') return `<td class="future-cell" title="${E(`עתידי ל${Util.gl(Util.GRADE_KEYS.find(g => Util.ord(g) === c.target))}`)}">–</td>`;
      return '<td class="text-slate-300">–</td>';
    }).join('');
    const accTd = r => {
      const left = r.remainingW;
      const tip = r.accumulated >= r.pass && !left ? `נצבר: ${r.accumulated} נק' מתוך 100` :
        r.accumulated + left < r.pass - 0.5 ? `נצבר עד כה: ${r.accumulated} נק' מתוך 100 (גם בציון 100 בשאלוני ההמשך לא יושג ציון עובר ${r.pass})` :
        r.need > 0 ? `נצבר עד כה: ${r.accumulated} נק' מתוך 100 (חסרות עוד ${r.need} נק' משאלוני ההמשך כדי להבטיח ציון סופי עובר ${r.pass})` :
        `נצבר עד כה: ${r.accumulated} נק' מתוך 100 (ציון עובר ${r.pass} כבר מובטח)`;
      return `<td class="whitespace-nowrap text-slate-700" title="${E(tip)}">🧮 ${r.accumulated}</td>`;
    };
    const finalTd = r => r.finalScore != null
      ? `<td class="${r.finalScore >= r.pass ? 'text-emerald-700' : 'text-rose-600'} font-bold">${r.finalScore}</td>`
      : `<td class="text-slate-300" title="${E(r.partialAvg != null ? `בתהליך – ממוצע חלקי נוכחי: ${r.partialAvg} (על ${r.doneW}% מהמשקל)` : 'טרם הושלם אף שאלון')}">–</td>`;
    const currentTd = r => `<td data-readiness="${r.readiness}" class="whitespace-nowrap ${r.readiness === 'fail' ? 'text-rose-600 font-bold' : r.readiness === 'borderline' ? 'text-orange-600 font-bold' : 'text-emerald-700'}">
      <span${r.readiness === 'noGrade' ? ' class="badge bg-amber-100 text-amber-900"' : r.readiness === 'unreported' ? ' class="badge bg-slate-100 text-slate-500" title="בקבוצה/בכיתה טרם דווחו ציונים שוטפים במקצוע"' : r.readiness === 'notEnrolled' ? ' class="text-slate-400" title="לא משובץ לקבוצת לימוד במקצוע השנה"' : ''}>${r.readiness === 'noGrade' ? 'ללא ציון' : r.readiness === 'unreported' ? 'טרם דווח' : r.readiness === 'notEnrolled' ? '—' : this.readinessAverage(r.currentAvg)}</span>${r.missed ? ` <span class="block text-xs text-rose-600">${r.missed} אירועים שהוחמצו</span>` : ''}</td>`;
    const body = list.map(r => `<tr>
      <td><button type="button" class="font-bold text-indigo-700 hover:text-indigo-900 text-right hover:underline whitespace-nowrap cursor-pointer" data-act="openProfile" data-tz="${E(r.t.tz)}" title="ת.ז ${E(r.t.tz)}">${E(r.t.name)}</button></td>
      <td><span class="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-800">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</span></td>
      <td class="whitespace-nowrap text-slate-700">${r.level ? `${E(r.level)} יח'` : ''}${r.teacher ? ` <span class="text-slate-500 text-xs">· ${E(r.teacher)}</span>` : ''}</td>
      ${qCells(r)}${accTd(r)}${finalTd(r)}${currentOn ? currentTd(r) : ''}</tr>`).join('');
    const cols = 5 + m.questionnaires.length + (currentOn ? 1 : 0);
    return `<div class="px-3 py-2 mb-2 rounded-lg bg-slate-100 text-sm">
        <span class="font-bold text-slate-800">${E(m.name)} · ${list.length} חניכים · ${m.questionnaires.length} שאלונים</span></div>
      <table class="grid mx w-full text-center"><thead><tr>${th('name', 'שם החניך')}${th('class', 'כיתה')}${th('units', 'יח"ל / קבוצה')}${m.questionnaires.map(q => th(qKey(q), `${E(q.code)} · ${E(q.weightText)}%`, q.names.join(' | '))).join('')}${th('acc', '🧮 נצבר')}${th('final', 'סופי')}${currentOn ? th('current', 'שוטף (סדין)') : ''}</tr></thead>
      <tbody>${body || `<tr><td colspan="${cols}" class="text-center text-slate-400 py-8">אין חניכים להצגה במקצוע זה</td></tr>`}</tbody></table>`;
  },

  /** שורת שקיפות: אילו רכיבים כבר נבחנו בשכבה (>= 15% מהחניכים עם ציון) ואילו עדיין "בתהליך" */
  renderCohortInfo(rows, fullMode = !!this.state.sim.fullMode && rows.some(r => r.t.gradeKey === 'יב')) {
    const box = $('bagrut-cohort');
    if (!box) return;
    if (fullMode || !Store.loaded.bagrut) { box.innerHTML = ''; return; }
    const grades = Util.GRADE_KEYS.filter(g => rows.some(r => r.t.gradeKey === g));
    const lines = grades.map(g => {
      const all = BagrutEngine.activeCohortQuestionnaires(g);
      const name = x => `${E(x.subject)}${x.label.endsWith('%') ? ` ${E(x.label)}` : ''}`;
      const taken = all.filter(x => x.takenByCohort).map(x => `${name(x)} (${x.pct}%)`);
      const pending = all.filter(x => x.pendingCohort && !x.variable).map(name);
      return `<div><b>${E(Util.gl(g))}:</b> נבחנו בשכבה – ${taken.length ? taken.join(' · ') : 'עדיין לא'}${pending.length ? `<br><span class="text-slate-400">בתהליך השנה / טרם דווח לשכבה (&lt;${BagrutEngine.COHORT_MIN_PCT}%): ${pending.join(' · ')}</span>` : ''}</div>`;
    });
    box.innerHTML = `<details><summary>🕒 מה כבר נבחן בשכבה? (צפי מותאם: מקצוע ליבה נחשב "נבחן" כש-${BagrutEngine.COHORT_MIN_PCT}% מהשכבה לפחות קיבלו בו ציון; מגמה – ${BagrutEngine.COHORT_MAJOR_PCT}% מלומדיה)</summary><div class="mt-2 space-y-1 leading-relaxed">${lines.join('')}</div></details>`;
  },

  bagrutList(rows) {
    const { chip, sort, dir } = this.state.bagrut;
    const val = r => ({ name: r.t.name, class: r.t.classKey, grade: Util.ord(r.t.gradeKey), track: this.trackOf(r.t), tier: this.tierBased(r.ev) ? r.ev.tier : BagrutEngine.PACE_TIER[r.ev.paceStatus], tz: r.t.tz, diag: r.ev.diagnostic })[sort];
    return this.filterByChip(rows, chip).sort((a, b) => {
      const x = val(a), y = val(b);
      return ((typeof x === 'number' ? x - y : natural(x, y)) || natural(a.t.name, b.t.name)) * dir;
    });
  },

  homeroomRows(rows, cols, render) {
    const rooms = new Map();
    rows.forEach(row => {
      const key = row.t.classKey || '';
      if (!rooms.has(key)) rooms.set(key, []);
      rooms.get(key).push(row);
    });
    return [...rooms.entries()].map(([key, members]) =>
      `<tr class="room-divider"><td colspan="${cols}">כיתה <bdi dir="rtl">${E(Config.classLabel(key))}</bdi> (${members.length})</td></tr>${members.map(render).join('')}`
    ).join('');
  },

  /** הערות מייעצות בין-מחזוריות (אינן משנות סטטוס): תגית עדינה לכל מקצוע שעומד בדרישות לפי מחזור אחר */
  advisoryHtml(ev) {
    const hints = ev.advisoryHints || [];
    return hints.map(h => `<span class="adv-hint" title="${E(`הציונים בפועל עומדים בדרישות ${h.subject} לפי ${h.cohortName}. הסטטוס לא שונה אוטומטית – ההכרעה בידי המרכזת (חריג ידני)`)}">💡 ${E(h.text)}</span>`).join('');
  },

  /** תג תקינות צבירה לשכבות י' / י"א (במקום "לא זכאי"): ירוק – תקין, חרדל – חסם יחיד, טרקוטה – פיגור, אפור – טרם החלו */
  paceBadge(ev) {
    const pi = ev.paceInfo;
    const detail = [
      `${ev.paceText} · ${pi.passedDueCount} מתוך ${pi.dueCount} שאלונים שמועדם הגיע עברו`,
      ...pi.focus.map(x => x.text),
      pi.futureCount ? `${pi.futureCount} שאלונים עתידיים לשכבות גבוהות אינם נספרים כחוסר` : ''
    ].filter(Boolean).join(' · ');
    return `<span class="badge pace-badge pace-${ev.paceStatus} whitespace-nowrap" title="${E(detail)}">${E(ev.paceText)}</span>`;
  },

  /** תגיות אבחון תמציתיות (עד 3) במקום מחרוזת האבחון המלאה; המלאה זמינה ב-title */
  diagBadges(ev) {
    if (ev.manual) return `<span class="badge badge-exc" title="${E(ev.diagnostic)}">⚡ ${E(ev.tierText)}</span>`;
    if (ev.tier === 0) return `<span class="text-xs text-slate-500">${E(ev.diagnostic)}</span>`;
    if (!ev.blockers.length) return `<span class="text-xs text-slate-600" title="${E(ev.diagnostic)}">${E(ev.diagnostic)}</span>`;
    const MAX = 3;
    const sorted = [...ev.blockers].sort((a, b) => (b.hard ? 1 : 0) - (a.hard ? 1 : 0));
    const badge = b => `<span class="badge ${b.hard ? 'tier-4' : 'tier-3'}">${b.miss ? 'חסר ' : ''}${E(b.text)}</span>`;
    const more = sorted.length - MAX;
    return `<div class="flex flex-wrap gap-1" title="${E(ev.diagnostic)}">${sorted.slice(0, MAX).map(badge).join('')}${more > 0 ? `<span class="badge fresh-slate border">+${more}</span>` : ''}</div>`;
  },

  /** גיליון שליטה ויזואלי: שורה לכל חניך, עמודה לכל מקצוע, צבע לכל תא ופירוט בלחיצה / ריחוף */
  bagrutTable(list) {
    const { sort, dir } = this.state.bagrut;
    const sim = this.state.sim;
    const rules = Config.rules();
    const th = (key, label, cls = '') => `<th class="${cls}"><button type="button" class="font-semibold" data-act="bagrutSort" data-key="${key}">${label}${sort === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    const plain = (label, cls = '') => `<th class="${cls}">${label}</th>`;
    const coreCols = BAGRUT_CORE.filter(([id]) => rules.coreSubjects.some(s => s.id === id && s.enabled !== false));
    const tip = text => `data-act="mxPop" data-tip="${E(text)}"`;

    const subjectTd = (c, label) => {
      if (!c) return '<td class="text-slate-300 text-xs">—</td>';
      const major = label === 'מגמה 5 יח"ל' && c.name;
      const value = major ? `${c.text}${c.text === 'לומד' ? ' ' : ' • '}${c.name}` :
        c.state === 'comp' ? `${c.text} ${c.sub.startsWith('פיצוי') ? 'פיצוי' : 'קיזוז'}` : c.text;
      const numeric = Number(c.text);
      const failed = ['fail', 'lost', 'missing', 'noshow', 'none'].includes(c.state) || (c.text.trim() !== '' && Number.isFinite(numeric) && numeric < rules.passGrade);
      const style = c.state === 'future' ? 'future-cell' : c.state === 'comp' || c.state === 'exempt' ? 'text-amber-700 font-semibold' : failed ? 'score-alert' :
        c.state === 'noenroll' || c.text === 'לומד' || c.text === '—' || c.text === 'בתהליך' ? 'text-slate-400' : 'text-slate-800 font-normal';
      return `<td class="mx-cell whitespace-nowrap" ${tip(c.tip)} tabindex="0" role="button" aria-label="${E(`${label}: ${value}${c.sub ? ' ' + c.sub : ''}`)}"><span class="${style}">${E(value)}</span></td>`;
    };
    const internalsTd = ev => {
      const cells = ev.internalCells;
      if (!cells.length) return '<td class="text-slate-300 text-xs">—</td>';
      const allDone = cells.every(c => c.state === 'ok' || c.state === 'na');
      const missing = cells.some(c => c.state === 'miss');
      const text = allDone ? '✓ תקין' : ev.internals.some(i => i.explicitFail) ? 'לא עבר' : missing ? 'חסר' : 'בתהליך';
      const cls = allDone ? 'text-emerald-800' : missing ? 'text-rose-800 font-bold' : 'text-slate-600';
      const detail = ['מקצועות פנימיים', ...cells.map(c => c.tip)].join(' | ');
      return `<td class="whitespace-nowrap"><span class="${cls}" ${tip(detail)} tabindex="0" role="button" aria-label="${E(detail)}">${text}</span></td>`;
    };
    const focusTd = ev => {
      const MAX = 1, items = ev.focus;
      let body;
      if (ev.tier === 0) body = `<span class="text-xs text-slate-600">${E(ev.diagnostic)}</span>`;
      else if (!items.length) body = '<span class="text-xs text-emerald-800">✓ תקין</span>';
      else {
        const b = x => `<span class="badge ${x.hard ? 'tier-4' : x.target ? 'bg-sky-100 text-sky-800' : 'tier-3'}">${E(x.text)}</span>`;
        const more = items.length - MAX;
        body = items.slice(0, MAX).map(b).join(' ') + (more > 0 ? ` <span class="badge fresh-slate border" title="${E(items.slice(MAX).map(x => x.text).join(' · '))}">+${more}</span>` : '');
      }
      return `<td class="mx-focus" title="${E(items.map(x => x.text).join(' · '))}">${body}${this.advisoryHtml(ev)}</td>`;
    };
    const pill = ev => {
      let text = ev.tierText;
      const held = ev.manualReview.required, real = ev.blockers.filter(b => !b.info).length;
      if (ev.adaptive && ev.tier === 3 && !ev.manual && real > 0) text += ` (חסם ${real})`;
      const status = held ? `<span class="badge tier-3 whitespace-nowrap" title="${E(`חישוב אוטומטי: ${text} | ${this.manualReviewLines(ev).join(' | ')}`)}">נדרשת החלטת רכזת</span>` :
        !this.tierBased(ev) ? this.paceBadge(ev) : ev.tier === 1 ? `<span class="text-emerald-700 font-medium whitespace-nowrap" title="${E(ev.diagnostic)}">✓ ${E(text)}</span>` :
        ev.tier === 0 || ev.tier === 5 ? `<span class="text-slate-400 whitespace-nowrap" title="${E(ev.diagnostic)}">${E(text)}</span>` :
        `<span class="badge pill-t${ev.tier} whitespace-nowrap" title="${E(ev.diagnostic)}">${E(text)}</span>`;
      /* תגית "נדרשת החלטת רכזת" כבר מפרטת את סיבות הבדיקה: מתחתיה מוצג "חשד לחריג" רק בגין סיבות נוספות, וללא תג בדיקה ידנית כפול */
      const suspect = held ? ev.suspectExtra : ev.suspect;
      const mr = held ? '' : this.manualReviewBadge(ev);
      return `<div>${status}</div><div>${this.unitsBadge(ev)}</div>
        ${ev.manual ? '<div><span class="badge badge-exc">⚡ חריג</span></div>' : suspect.length ? `<div><span class="badge tier-3" title="${E(suspect.join(' · '))}">חשד לחריג</span></div>` : ''}${mr ? `<div>${mr}</div>` : ''}`;
    };

    const cols = 6 + coreCols.length;
    const body = this.homeroomRows(list.slice(0, 1500), cols, ({ t, ev }) => {
      const track = this.trackOf(t);
      return `
      <tr>
        <td><button type="button" class="font-bold text-indigo-700 hover:text-indigo-900 text-right hover:underline whitespace-nowrap cursor-pointer" data-act="openProfile" data-tz="${E(t.tz)}" title="ת.ז ${E(t.tz)}">${E(t.name)}</button></td>
        <td><span class="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-800">${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)}${track && track !== 'רגילה' ? ` <span class="badge fresh-slate border">${E(track)}</span>` : ''}</span></td>
        <td>${pill(ev)}</td>
        ${coreCols.map(([id, label]) => subjectTd(this.subjectDisplayCell(ev, id), label)).join('')}
        ${subjectTd(this.majorDisplayCell(ev), 'מגמה 5 יח"ל')}
        ${internalsTd(ev)}
        ${focusTd(ev)}
      </tr>`;
    });
    const coreHead = ([id, l]) => `<th><button type="button" class="font-semibold hover:underline" data-act="bagrutDrill" data-sel="core:${id}" title="מטריצת שאלונים – ${E(l)}">${l}</button></th>`;
    return `<table class="grid mx w-full text-center"><thead><tr>${th('name', 'חניך')}${th('class', 'כיתה')}${th('tier', 'סטטוס זכאות / צבירה')}${coreCols.map(coreHead).join('')}${plain('מגמה 5 יח"ל')}${plain('פנימיים')}${plain('מיקוד פדגוגי (מה נדרש)', 'mx-focus')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${cols}" class="text-center text-slate-400 py-8">אין שורות להצגה</td></tr>`}</tbody></table>`;
  },

  /** חלון מידע צף (ריחוף / לחיצה / מקלדת) לפירוט תא בגיליון השליטה */
  showMxPop(el, pin) {
    const pop = $('mxPop');
    if (!pop || !el || !el.dataset.tip) return;
    const [head, ...lines] = el.dataset.tip.split(' | ');
    pop.innerHTML = `<div class="h">${E(head)}</div>${lines.map(l => `<div>${E(l)}</div>`).join('')}`;
    pop.classList.remove('hidden');
    const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
    this._mxPinned = pin ? el : null;
  },

  hideMxPop() {
    const pop = $('mxPop');
    if (pop) pop.classList.add('hidden');
    this._mxPinned = null;
  },

  /* ---------- כללי זכאות ומשקלים (בתת-הלשונית "חוקי בגרות ושאלונים" בהגדרות) ---------- */
  applyRule(res) {
    if (res && res.ok === false) { this.toast(res.error || 'השינוי נדחה', 'error'); this.renderRulesDrawer(); }
  },

  /** שיוך שכבות למחזורי לימוד + בורר המחזור הנערך עם כפתורי העתקה והוספה */
  renderCohortUi() {
    const cohorts = Object.values(Config.getCohortProfiles()), map = Config.getGradeCohortMap();
    const active = Config.getActiveCohortId();
    const GRADES = [['12', 'יב'], ['11', 'יא'], ['10', 'י']];
    setHtml('cohortAssign', `<div class="cohort-card">
      <div class="flex flex-wrap items-baseline gap-x-3"><span class="font-bold text-[#355747]">שיוך שכבות למחזורי לימוד</span>
        <span class="text-xs text-slate-500">כל חניך נבדק לפי כללי הבגרות של המחזור המשויך לשכבתו</span></div>
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 mt-2">${GRADES.map(([n, key]) => `
        <label class="flex items-center gap-2 text-sm font-semibold text-[#355747]">שכבת ${E(Util.gl(key))}:
          <select class="inp" data-chg="gradeCohort" data-grade="${n}" aria-label="${E(`מחזור לשכבת ${Util.gl(key)}`)}">${cohorts.map(c => `<option value="${E(c.id)}" ${map[n] === c.id ? 'selected' : ''}>${E(c.name)}</option>`).join('')}</select></label>`).join('')}
      </div></div>`);
    const gradesOf = id => GRADES.filter(([n]) => map[n] === id).map(([, key]) => `שכבת ${Util.gl(key)}`).join(', ');
    setHtml('cohortBar', `<div class="flex flex-wrap items-center justify-between gap-2">
      <div><div class="text-xs font-semibold text-[#75977D] mb-1">בחירת מחזור לעריכת חוקי בגרות ושאלונים</div>
        <div class="flex flex-wrap gap-1.5" role="tablist" aria-label="מחזורים">${cohorts.map(c => {
          const g = gradesOf(c.id);
          return `<button type="button" role="tab" class="chip cohort-tab" data-act="cohortEdit" data-id="${E(c.id)}" aria-selected="${c.id === active}" aria-pressed="${c.id === active}">${E(c.name)}${g ? ` <span class="text-[11px] opacity-80">[${E(g)}]</span>` : ''}</button>`;
        }).join('')}</div></div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-ghost btn-sm" data-act="cohortCopy">📋 העתק חוקים ממחזור אחר...</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="cohortAdd">➕ הוסף מחזור חדש</button>
      </div></div>`);
  },

  cohortName(id) { const c = Config.getCohortProfiles()[id]; return c ? c.name : ''; },

  renderRulesDrawer() {
    this.renderCohortUi();
    const r = Config.rules();
    const warnings = Config.rulesWarnings(r);
    setHtml('rulesWarnings', warnings.map(w => `<div>${E(w)}</div>`).join(''));
    setChecked('ruleCompEnabled', r.allowCompensationRule !== false);
    setChecked('ruleCompPoints', Config.pointsCompensation().enabled);
    setVal('ruleCompMin', r.compensationMin);
    setVal('ruleCompMax', r.compensationMax);
    setVal('ruleCompCount', r.maxCompensations);
    setVal('ruleCompExcluded', (r.compensationExcludedSubjects || []).join(', '));
    setVal('ruleParamPass', r.passGrade);
    setVal('ruleParamBorderline', r.borderlineMin);
    setVal('ruleParamBonus', r.borderlineBonus);
    setVal('ruleParamMagen', Config.magenWeight());

    const gates = r.gates || {};
    setHtml('rulesGates', ['core', 'major', 'internal'].map(g => `
      <label class="flex items-center gap-2"><input type="checkbox" class="w-4 h-4" data-chg="gateToggle" data-gate="${g}" ${gates[g] && gates[g].enabled === false ? '' : 'checked'}>${E(g === 'internal' ? 'מקצועות פנימיים' : (gates[g] && gates[g].label) || g)}</label>`).join('') +
      `<label class="flex items-center gap-2 text-xs">יח"ל מינימום במגמה<input type="number" min="1" max="5" class="inp w-16" data-chg="gateUnits" value="${(gates.major && gates.major.requiredUnits) || 5}"></label>`);

    const attrs = (kind, id, level, i) => `data-kind="${kind}" data-id="${E(id)}" data-level="${E(level)}" data-i="${i}"`;
    const GRADE_OPTS = ['י', 'יא', 'יב'];
    const compRow = (s, level, c, i) => {
      const q = r.questionnaires[c.codes[0]];
      const grade = c.expectedGrade || (q ? q.expectedGrade : 'יב');
      const comps = (s.variableUnits ? (s.levels || {})[level] : s.components) || [c];
      const magen = BagrutFacts.isInternalComp(c, comps) ? ''
        : `<label class="flex items-center gap-1 whitespace-nowrap">מגן<input type="number" min="0" max="100" class="inp w-14" placeholder="${r.magenWeight ?? 30}" value="${c.magenWeight ?? ''}" title="משקל ציון הגשה/מגן לשאלון (ריק = ברירת מחדל של המחזור)" data-chg="compMagen" ${attrs('core', s.id, level, i)}>%</label>`;
      return `<div class="q-row ${c.enabled === false ? 'opacity-50' : ''}">
        <input type="checkbox" class="w-4 h-4" aria-label="פעיל" data-chg="compEnabled" ${attrs('core', s.id, level, i)} ${c.enabled === false ? '' : 'checked'}>
        <input type="text" class="inp q-codes" dir="ltr" aria-label="סמלי שאלון" value="${E(c.codes.join(', '))}" data-chg="compCodes" ${attrs('core', s.id, level, i)}>
        <label class="flex items-center gap-1 whitespace-nowrap">משקל<input type="number" min="0" max="100" class="inp q-weight" value="${c.weight}" data-chg="compWeight" ${attrs('core', s.id, level, i)}>%</label>
        ${magen}
        <select class="inp q-grade" aria-label="נדרש עד שכבה" title="נדרש עד שכבה" data-chg="compGrade" ${attrs('core', s.id, level, i)}>${GRADE_OPTS.map(g => `<option value="${g}" ${grade === g ? 'selected' : ''}>${Util.gl(g)}</option>`).join('')}</select>
        <input type="text" class="inp q-name" aria-label="שם השאלון" placeholder="שם השאלון" title="שם השאלון בקטלוג" value="${E(q ? q.name : '')}" data-chg="qName" data-code="${E(c.codes[0])}">
        <button type="button" class="btn btn-danger btn-sm" aria-label="הסרת שאלון" data-act="compRemove" ${attrs('core', s.id, level, i)}>✕</button></div>`;
    };
    const compBlock = (s, level, label, comps) => {
      const sum = comps.filter(c => c.enabled !== false).reduce((a, c) => a + (Number(c.weight) || 0), 0);
      return `<div class="mt-1">${label ? `<div class="text-xs font-medium text-slate-600">${E(label)}</div>` : ''}
        ${comps.map((c, i) => compRow(s, level, c, i)).join('')}
        <div class="flex items-center gap-2 text-xs mt-1"><button type="button" class="btn btn-ghost btn-sm" data-act="compAdd" ${attrs('core', s.id, level, '')}>+ שאלון</button>
          <span class="${comps.length && Math.round(sum) !== 100 ? 'text-amber-700 font-medium' : 'text-slate-400'}">סה"כ ${Math.round(sum)}%</span></div></div>`;
    };
    /* שאלונים בקטלוג שאין להם שימוש בשום מקצוע, יחידה או מגמה: ניתנים להסרה */
    const used = new Set([
      ...r.coreSubjects.flatMap(s => (s.variableUnits ? Object.values(s.levels || {}) : [s.components || []]).flat().flatMap(c => c.codes || [])),
      ...r.internals.flatMap(i => i.codes || []), ...r.majors.flatMap(m => m.codes || [])
    ].map(String));
    const orphans = Object.keys(r.questionnaires || {}).filter(code => !used.has(code));
    const orphanHtml = orphans.length ? `<div class="border border-dashed border-slate-300 rounded-lg p-2 bg-white text-xs">
      <div class="font-medium text-slate-600 mb-1">שאלונים בקטלוג ללא שימוש</div>
      ${orphans.map(code => `<div class="flex items-center gap-2 py-0.5"><span class="tz-col">${E(code)}</span><span class="text-slate-500 truncate">${E(r.questionnaires[code].name || '')}</span>
        <button type="button" class="btn btn-danger btn-sm mr-auto" aria-label="הסרת שאלון ${E(code)} מהקטלוג" data-act="qRemove" data-code="${E(code)}">הסרה</button></div>`).join('')}</div>` : '';
    setHtml('rulesCore', r.coreSubjects.map(s => `
      <div class="border border-slate-200 rounded-lg p-2 bg-white ${s.enabled === false ? 'opacity-60' : ''}">
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-2 font-medium"><input type="checkbox" class="w-4 h-4" data-chg="ruleToggle" data-kind="core" data-id="${E(s.id)}" ${s.enabled === false ? '' : 'checked'}>${E(s.name)}</label>
          <span class="text-xs text-slate-400">${s.variableUnits ? 'יח"ל משתנה' : `${s.units} יח"ל`}</span>
          <button type="button" class="btn btn-danger btn-sm mr-auto" data-act="ruleRemove" data-kind="core" data-id="${E(s.id)}">הסרה</button>
        </div>
        ${s.variableUnits ? Object.keys(s.levels || {}).sort().map(l => compBlock(s, l, `${l} יח"ל`, s.levels[l])).join('') : compBlock(s, '', '', s.components || [])}
      </div>`).join('') + orphanHtml);

    setHtml('rulesMajor', r.majors.map(m => `
      <div class="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg p-2 bg-white text-sm ${m.enabled === false ? 'opacity-60' : ''}">
        <label class="flex items-center gap-2 font-medium min-w-[180px]"><input type="checkbox" class="w-4 h-4" data-chg="ruleToggle" data-kind="major" data-id="${E(m.id)}" ${m.enabled === false ? '' : 'checked'}>${E(m.name)}</label>
        <label class="flex items-center gap-1 text-xs">סמלים<input type="text" class="inp w-40" value="${E(m.codes.join(', '))}" data-chg="clauseCodes" data-kind="major" data-id="${E(m.id)}"></label>
        <label class="flex items-center gap-1 text-xs">נדרש עד שכבה
          <select class="inp" data-chg="clauseGrade" data-kind="major" data-id="${E(m.id)}">${GRADE_OPTS.map(g => `<option value="${g}" ${m.expectedGrade === g ? 'selected' : ''}>${Util.gl(g)}</option>`).join('')}</select></label>
        <label class="flex items-center gap-1 text-xs">מילות מפתח<input type="text" class="inp w-44" value="${E((m.keywords || []).join(', '))}" data-chg="clauseKeywords" data-kind="major" data-id="${E(m.id)}"></label>
        <button type="button" class="btn btn-danger btn-sm mr-auto" data-act="ruleRemove" data-kind="major" data-id="${E(m.id)}">הסרה</button></div>`).join(''));

    setHtml('rulesInternal', r.internals.map(it => `
      <div class="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg p-2 bg-white text-sm ${it.enabled === false ? 'opacity-60' : ''}">
        <label class="flex items-center gap-2 font-medium min-w-[160px]"><input type="checkbox" class="w-4 h-4" data-chg="ruleToggle" data-kind="internal" data-id="${E(it.id)}" ${it.enabled === false ? '' : 'checked'}>${E(it.name)}</label>
        <label class="flex items-center gap-1 text-xs">סמלים<input type="text" class="inp w-32" value="${E(it.codes.join(', '))}" data-chg="clauseCodes" data-kind="internal" data-id="${E(it.id)}"></label>
        <label class="flex items-center gap-1 text-xs">נדרש עד שכבה
          <select class="inp" data-chg="internalGrade" data-id="${E(it.id)}">${['י', 'יא', 'יב'].map(g => `<option value="${g}" ${it.expectedGrade === g ? 'selected' : ''}>${Util.gl(g)}</option>`).join('')}</select></label>
        <button type="button" class="btn btn-danger btn-sm mr-auto" data-act="ruleRemove" data-kind="internal" data-id="${E(it.id)}">הסרה</button></div>`).join(''));

    const plan = [];
    r.coreSubjects.filter(s => s.enabled !== false).forEach(s => {
      const lists = s.variableUnits ? Object.entries(s.levels || {}) : [['', s.components || []]];
      lists.forEach(([level, comps]) => comps.forEach((c, i) => {
        if (c.enabled !== false) plan.push({ c, label: s.name + (level ? ` ${level} יח"ל` : '') + ` · ${c.weight}%`, handler: 'compGrade', attrs: attrs('core', s.id, level, i) });
      }));
    });
    ['major', 'internal'].forEach(kind => {
      const list = kind === 'major' ? r.majors : r.internals;
      list.filter(c => c.enabled !== false).forEach(c => plan.push({
        c, label: `${c.name} · ${kind === 'major' ? 'מגמה' : 'פנימי'}`, handler: 'clauseGrade', attrs: `data-kind="${kind}" data-id="${E(c.id)}"`
      }));
    });
    setHtml('rulesPlan', GRADE_OPTS.map(g => {
      const rows = plan.filter(row => BagrutFacts.compOrd(row.c) === Util.ord(g));
      return `<section class="border border-slate-200 rounded-lg p-3 bg-white">
        <h3 class="font-semibold mb-2">שכבת ${Util.gl(g)}</h3>
        ${rows.length ? rows.map(row => `<div class="flex flex-wrap items-center gap-2 py-1 text-sm">
          <span>${E(row.label)}</span><span class="tz-col text-xs text-slate-500" dir="ltr">${E((row.c.codes || []).join(', '))}</span>
          <select class="inp mr-auto" aria-label="${E(`נדרש עד שכבה: ${row.label}`)}" data-chg="${row.handler}" ${row.attrs}>${GRADE_OPTS.map(opt => `<option value="${opt}" ${opt === g ? 'selected' : ''}>${Util.gl(opt)}</option>`).join('')}</select>
        </div>`).join('') : '<p class="text-xs text-slate-400">אין רכיבים לשכבה זו</p>'}</section>`;
    }).join(''));

    const RULE_TABS = [['core', 'שער 1 – מקצועות ליבה'], ['major', 'שער 2 – מגמות'], ['internal', 'מקצועות פנימיים'], ['params', 'חוק קיזוז ופרמטרים'], ['plan', 'תוכנית היבחנות']];
    const tab = RULE_TABS.some(x => x[0] === this.state.rulesTab) ? this.state.rulesTab : 'core';
    setHtml('rulesTabs', RULE_TABS.map(([id, label]) => `<button type="button" role="tab" class="chip" data-act="rulesTab" data-sub="${id}" aria-selected="${tab === id}" aria-pressed="${tab === id}">${label}</button>`).join(''));
    document.querySelectorAll('[data-rules-pane]').forEach(p => { p.hidden = p.dataset.rulesPane !== tab; });
  },

  ruleAdd(kind) {
    const split = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
    const gradeOpts = ['י', 'יא', 'יב'].map(g => ({ value: g, label: Util.gl(g) }));
    if (kind === 'core') {
      this.formModal('הוספת מקצוע ליבה', [
        { key: 'name', label: 'שם המקצוע' }, { key: 'units', label: 'יח"ל', type: 'number', value: 2 },
        { key: 'keywords', label: 'מילות מפתח לזיהוי קבוצה (מופרדות בפסיקים)' },
        { key: 'code', label: 'סמל שאלון ראשון (אופציונלי)' }, { key: 'weight', label: 'משקל השאלון (%)', type: 'number', value: 100 },
        { key: 'grade', label: 'נדרש עד שכבה', type: 'select', value: 'יב', options: gradeOpts }
      ], v => Config.addClause('core', {
        name: v.name.trim(), units: Number(v.units) || 2, keywords: split(v.keywords).length ? split(v.keywords) : [v.name.trim()],
        components: v.code.trim() ? [{ codes: split(v.code), weight: Number(v.weight), expectedGrade: v.grade, enabled: true }] : []
      }));
    } else if (kind === 'major') {
      this.formModal('הוספת מגמה', [
        { key: 'name', label: 'שם המגמה' }, { key: 'keywords', label: 'מילות מפתח לזיהוי קבוצה (מופרדות בפסיקים)' },
        { key: 'codes', label: 'סמלי שאלון (מופרדים בפסיקים)' },
        { key: 'grade', label: 'נדרש עד שכבה', type: 'select', value: 'יב', options: gradeOpts }
      ], v => Config.addClause('major', { name: v.name.trim(), keywords: split(v.keywords).length ? split(v.keywords) : [v.name.trim()], codes: split(v.codes), expectedGrade: v.grade }));
    } else {
      this.formModal('הוספת יחידה פנימית', [
        { key: 'name', label: 'שם היחידה' }, { key: 'codes', label: 'סמלי שאלון (מופרדים בפסיקים)' },
        { key: 'grade', label: 'נדרש עד שכבה', type: 'select', value: 'יב', options: gradeOpts }
      ], v => Config.addClause('internal', { name: v.name.trim(), codes: split(v.codes), expectedGrade: v.grade }));
    }
  },

  /** עדכון רכיב שאלון (קודים / משקל / פעיל) מתוך שורת העורך */
  patchComp(el, patch) {
    const { kind, id, level } = el.dataset, i = +el.dataset.i;
    const s = Config.rules().coreSubjects.find(x => x.id === id);
    const c = s && (s.variableUnits ? s.levels[level] : s.components)[i];
    if (c) this.applyRule(Config.upsertComponent(kind, id, level, i, { ...c, ...patch }));
  },

  /* ---------- חריגים ---------- */
  openExceptionModal(...args) { return ProfileView.openExceptionModal.apply(this, args); },
  saveProfileException(...args) { return ProfileView.saveProfileException.apply(this, args); },
  clearProfileException(...args) { return ProfileView.clearProfileException.apply(this, args); },
  profTab(...args) { return ProfileView.profTab.apply(this, args); },

  /* ==================================================================
     פאנל 2 – בקרת קבוצות ושיבוצים
     ================================================================== */
  renderGroupsPanel() {
    this.syncGroupLayout();
    this.renderFreshnessBar('groups');
    const st = this.state.groups, explorer = this.state.groupsViewMode === 'explorer';
    const show = (id, on) => { const el = $(id); if (el) el.classList.toggle('hidden', !on); };
    const hideAll = () => ['groups-explorer', 'groups-table', 'groups-kpis', 'groups-strip', 'gctl-explorer', 'groups-mode', 'groups-head'].forEach(id => show(id, false));
    const message = text => {
      this._explorerView = []; this._boardMissing = [];
      hideAll(); show('groups-table', true); show('groups-mode', true); show('groups-head', true);
      setHtml('groups-table', `<div class="p-8 text-center text-slate-500">${text}</div>`);
    };
    if (!Store.hasData()) {
      this._explorerView = []; this._boardMissing = [];
      this.noRoster(['groups-kpis', 'groups-master', 'groups-detail', 'groups-mode'], 'groups-table');
      hideAll(); show('groups-table', true); show('groups-student-map', false);
      return;
    }
    /* חניך נעול (נבחר בחיפוש): במקום שני המצבים מוצגת מפת השיבוצים שלו */
    const lockT = this.lockedTrainee();
    show('groups-student-map', !!lockT && (Store.loaded.groups || Store.loaded.grades));
    if (lockT && (Store.loaded.groups || Store.loaded.grades)) {
      hideAll();
      $('groups-kpis').classList.remove('grid');
      this._explorerView = []; this._boardMissing = [];
      return this.renderStudentGroupsMap(lockT.tz);
    }
    const list = this.filtered();
    const am = this.placementAnomaliesModel(list);
    this.renderGroupsModeBar(am.total, this.visibleGroupCount());
    if (explorer && !Store.loaded.groups) return message('הסייר מציג את הרשימות השמיות כפי שנרשמו במשוב, ולכן נדרש קובץ קבוצות לימוד. אפשר לטעון אותו בכפתור שבראש הפאנל.');
    if (!explorer && !am.ready) return message('נדרש קובץ קבוצות ושיבוצים לניתוח השיבוצים. אפשר לטעון אותו בכפתור שבראש הפאנל.');

    show('groups-head', true); show('groups-mode', true);
    show('groups-explorer', explorer); show('gctl-explorer', explorer);
    show('groups-table', !explorer);
    show('groups-kpis', !explorer);
    $('groups-kpis').classList.toggle('grid', !explorer);
    if (!explorer) show('groups-strip', false);
    if (explorer) return this.renderGroupsExplorer();
    this.renderAnomalyWorkspace(am);
    this.syncGroupsHeadHeight();
  },

  /** מספר הקבוצות בסייר לפי הסינון הגלובלי (קבוצות מקובץ הקבוצות שיש בהן חניך מהסינון) */
  visibleGroupCount() {
    const f = this.state.filters;
    const scoped = f.grade !== 'all' || f.cls !== 'all' || f.track !== 'all';
    const people = new Set(this.filtered(false).map(t => t.tz));
    let n = 0;
    Store.groups.forEach(g => { if (g.inFile && (!scoped || [...g.members].some(tz => people.has(tz)))) n++; });
    return n;
  },

  /** סרגל בקרה דחוס אחד: מחליף המצבים מימין; מסנן המקצוע ומונה החריגות משמאל (במצב מוקד החריגים) */
  renderGroupsModeBar(anomalies, groups) {
    const box = $('groups-mode');
    if (!box) return;
    const mode = this.state.groupsViewMode;
    const btn = (id, label, n) => `<button type="button" data-act="groupsMode" data-mode="${id}" aria-pressed="${mode === id}">${label}<span class="mode-badge">${n}</span></button>`;
    box.innerHTML = `<div class="gm-row"><div class="scope-bar lg" role="group" aria-label="מצב תצוגת קבוצות">${btn('anomalies', 'מוקד חריגי שיבוץ לטיפול', anomalies)}${btn('explorer', 'סייר קבוצות ובדיקת תפוסה', groups)}</div><div id="groups-mode-extra" class="gm-extra"></div></div>`;
  },

  /** מוקד חריגי שיבוץ: חמשת כרטיסי הקטגוריה הלחיצים, סינון מקצוע וטבלת חריגים עם כפתור בדיקת קבוצת יעד */
  renderAnomalyWorkspace(am) {
    const state = this.state, cat = state.anomalyCategoryFilter, rows = am.rows;
    const count = c => rows.filter(r => r.category === c).length;
    const students = am.studentsCount;
    const suspectKinds = ['outlier', 'grade', 'sadin'].map(k => rows.filter(r => r.kind === k).length);
    const subjects = [...new Set(rows.map(r => r.subject))].sort(natural);
    if (state.anomalySubject !== 'all' && !subjects.includes(state.anomalySubject)) state.anomalySubject = 'all';
    const subject = state.anomalySubject;

    const card = (id, cls, label, n, sub, title = '') => `<button type="button" class="an-card ${cls}" data-act="anCat" data-cat="${id}" aria-pressed="${cat === id}" title="${E(title || sub)}">
      <span class="top"><span class="t">${label}</span><span class="n">${n}</span></span><span class="s">${sub}</span></button>`;
    setHtml('groups-kpis',
      card('all', 'an-forest', 'כל החריגות לטיפול', am.total, `${students} חניכים`) +
      card('missing', 'an-sage', 'היעדר מקצוע ליבה', count('missing'), 'חסר במקצוע שבו לפחות 30% מהכיתה משובצים') +
      card('missing_major', 'an-terra', 'ללא שיבוץ מגמה', count('missing_major'), 'חניכים ללא קבוצת מגמה') +
      card('duplicate', 'an-mustard', 'כפילות קבוצה במקצוע', am.byCategory.duplicate, 'רשומים ב-2 קבוצות ויותר') +
      card('suspect', 'an-peach', 'חשד לשיבוץ שגוי', am.byCategory.suspect, `בודד ${suspectKinds[0]} · שכבה ${suspectKinds[1]} · סדין ${suspectKinds[2]}`,
        `בודד מכיתתו ${suspectKinds[0]} · חריג שכבה ${suspectKinds[1]} · פער מול סדין ${suspectKinds[2]}`));

    const filteredRows = rows.filter(r => (cat === 'all' || r.category === cat) && (subject === 'all' || r.subject === subject));
    const { anomSort: sortCol, anomDir: sortDir } = state.groups;
    const shown = this.sortAnomalyRows(filteredRows, sortCol, sortDir);
    setHtml('groups-mode-extra', `<label class="flex items-center gap-2 text-xs font-semibold text-[#355747]">סינון לפי מקצוע
        <select class="inp" data-chg="anSubject" aria-label="סינון לפי מקצוע"><option value="all">כל המקצועות</option>${subjects.map(s => `<option value="${E(s)}" ${s === subject ? 'selected' : ''}>${E(s)} (${rows.filter(r => r.subject === s).length})</option>`).join('')}</select></label>
      <button type="button" class="routine-toggle" data-act="toggleRoutine" aria-pressed="${state.showRoutineDuplicates}" title="כפילות רישום במקצועות שגרתיים היא בדרך כלל תקינה">הצג גם חינוך / מגדר / מפגש בוקר (${am.hiddenRoutineCount})</button>
      <span class="badge bg-[#E8B95F] text-[#355747] border-[#E8B95F] whitespace-nowrap">${shown.length}${shown.length !== rows.length ? ` מתוך ${rows.length}` : ''} חריגות</span>`);

    const groupTxt = g => `<div><span dir="ltr" class="font-semibold">[${E(g.groupId)}]</span> ${E(g.teacher || 'ללא מורה')}</div>`;
    const body = shown.slice(0, 1500).map(r => {
      const major = r.category === 'missing_major';
      const current = r.groups.length ? r.groups.map(g => groupTxt(g)).join('')
        : `<span class="font-semibold an-k-missing">${major ? 'ללא מגמה רשומה' : 'ללא שיבוץ'}</span>${r.category === 'missing' && r.classTotal ? `<div class="text-xs text-slate-500" data-class-coverage>(בכיתה: ${r.classEnrolled} מתוך ${r.classTotal})</div>` : ''}`;
      const sadin = r.sadinGroups.map(g => `<div class="text-xs text-slate-600">בסדין: <span dir="ltr">[${E(g.groupId)}]</span>${g.teacher ? ` ${E(g.teacher)}` : ''}</div>`).join('');
      return `<tr>
        <td class="text-right"><button type="button" class="font-semibold text-[#355747] hover:underline text-right" data-act="openProfile" data-tz="${E(r.tz)}" title="ת.ז ${E(r.tz)}">${E(r.t.name)}</button></td>
        <td class="text-right whitespace-nowrap">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.tz)}</td>
        <td class="text-right whitespace-nowrap">${E(r.subject)}</td>
        <td class="text-right"><span class="an-k an-k-${r.category}">${E(r.kindLabel)}</span>${r.isRoutineDuplicate ? ' <span class="routine-tag">מקצוע מערכתי</span>' : ''}</td>
        <td class="text-right">${current}${sadin}</td>
        <td class="text-right whitespace-nowrap"><button type="button" class="btn btn-ghost btn-sm" data-act="inspectGroups" data-tz="${E(r.tz)}" data-subject="${E(major ? GroupAnalyzer.MAJOR_KEY : r.subject)}">${major ? '🔍 השוואת מגמות בשכבה' : '🔍 השוואת קבוצות במקצוע'}</button>
          <button type="button" class="text-xs text-[#75977D] underline mr-2" data-act="studentMap" data-tz="${E(r.tz)}">מפת חניך</button></td></tr>`;
    }).join('');
    const out = am.outside;
    const th = (col, label) => {
      const active = sortCol === col;
      return `<th class="text-right cursor-pointer select-none" aria-sort="${active ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="font-semibold cursor-pointer select-none" data-act="grpAnomSort" data-col="${col}" title="מיון לפי ${E(label)}">${E(label)}<span class="${active ? '' : 'opacity-40'}" aria-hidden="true"> ${active ? (sortDir > 0 ? '▲' : '▼') : '⇅'}</span></button></th>`;
    };
    setHtml('groups-table', `<table class="grid w-full" aria-label="טבלת חריגי שיבוץ לטיפול"><thead><tr>
        ${th('name', 'שם החניך')}${th('cls', 'כיתת אם')}${th('subject', 'מקצוע')}${th('kind', 'סוג החריגה')}
        ${th('current', 'מצב נוכחי (קבוצות רשומות / סדין)')}<th class="text-right">בדיקת קבוצת יעד</th></tr></thead>
        <tbody>${body || '<tr><td colspan="6" class="text-center text-[#355747] py-8">לא נמצאו חריגות שיבוץ בסינון הנוכחי</td></tr>'}</tbody></table>
      ${out.unmatchedList && out.unmatchedList.length ? `<details class="px-4 py-2 border-t border-[#E6ECE6] text-sm"><summary class="cursor-pointer font-semibold text-[#355747]">ת.ז בקובצי המשנה שאינן במצבת (${out.unmatchedList.length})</summary>
        <ul class="mt-1 text-xs leading-5">${out.unmatchedList.map(u => `<li><span class="tz-col">${E(u.tz)}</span> ${E(u.name || '—')} <span class="text-slate-500">· ${E(u.sources.join(' • '))}</span></li>`).join('')}</ul></details>` : ''}`);
  },

  /** מיון עותק של שורות חריגי השיבוץ לפי עמודה; ללא עמודה נשמר סדר placementAnomalies */
  sortAnomalyRows(rows, col, dir = 1) {
    if (!col) return rows;
    const name = (a, b) => String(a.t.name || '').localeCompare(String(b.t.name || ''), 'he');
    const cls = (a, b) => Util.ord(a.t.gradeKey) - Util.ord(b.t.gradeKey) || natural(a.t.classKey, b.t.classKey);
    const subject = (a, b) => natural(a.subject, b.subject);
    const kind = (a, b) => natural(a.kindLabel, b.kindLabel);
    const currentKey = r => {
      const ids = [...r.groups.map(g => g.groupId)].sort(natural).map(id => `[${id}]`).join('+');
      const sadin = [...r.sadinGroups.map(g => g.groupId)].sort(natural).map(id => `[${id}]`).join('+');
      return `${ids || 'ללא שיבוץ'}${sadin ? ` / ${sadin}` : ''}`;
    };
    const current = (a, b) => natural(currentKey(a), currentKey(b));
    const chains = {
      name: [name, subject, kind], cls: [cls, name, subject], subject: [subject, kind, cls, name],
      kind: [kind, subject, cls, name], current: [current, subject, cls, name]
    };
    const chain = chains[col];
    if (!chain) return rows;
    return [...rows].sort((a, b) => {
      for (const cmp of chain) { const v = cmp(a, b); if (v) return v * dir; }
      return 0;
    });
  },

  /** גובה הכותרת הדביקה (סרגל + כרטיסים) נמדד ומועבר ל-CSS כדי שכותרות העמודות ידבקו מתחתיה */
  syncGroupsHeadHeight() {
    const head = $('groups-head'), table = $('groups-table');
    if (head && table) table.style.setProperty('--groups-head-h', `${head.offsetHeight}px`);
  },

  /** בדיקת קבוצת יעד ותפוסה: כל קבוצות המקצוע לחניך – תפוסה, התאמה לכיתת האם, הרכב ורשימה שמית */
  openTargetGroupInspector(tz, subjectName) {
    const m = GroupAnalyzer.targetGroupInspector(tz, subjectName);
    if (!m) return;
    const t = m.t, room = Config.classLabel(t.classKey);
    const groupTxt = g => `<span dir="ltr">[${E(g.groupId)}]</span> ${E(g.teacher || 'ללא מורה')}`;
    const banner = (m.current.length ? `כרגע רשום ב: ${m.current.map(groupTxt).join(', ')}` : m.isMajor ? 'כרגע: ללא מגמה רשומה' : 'כרגע: ללא שיבוץ') +
      (m.sadin.length ? ` · ציונים בסדין ב: ${m.sadin.map(groupTxt).join(', ')}` : '');
    const card = g => {
      const comp = g.composition.map(c => `<bdi dir="rtl">${E(Config.classLabel(c.classKey))}</bdi> (${c.n})`).join(', ');
      const roster = g.members.map(x => `<li class="${x.sameRoom ? 'ti-same' : ''} ${x.self ? 'font-bold' : ''}">${E(x.t.name)} <span class="text-slate-500"><bdi dir="rtl">${E(Config.classLabel(x.t.classKey))}</bdi></span>${x.self ? ' (החניך)' : ''}${x.diag.length ? ` <span class="an-k an-k-suspect">${E(x.diag[0].text)}</span>` : ''}</li>`).join('');
      return `<article class="ti-card ${g.enrolled ? 'is-current' : ''}">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0"><div class="font-bold text-[#355747]">${E(g.subject)} • ${E(g.teacher || 'ללא מורה')} <span dir="ltr">[${E(g.groupId)}]</span></div>
            ${g.targetClasses ? `<div class="text-xs text-slate-500">כיתות יעד: <bdi dir="rtl">${E(g.targetClasses)}</bdi></div>` : ''}
            ${g.enrolled ? '<span class="ti-tag">הקבוצה הרשומה כיום</span>' : g.inSadin ? '<span class="ti-tag sadin">מקבל בה ציונים בסדין</span>' : ''}</div>
          <div class="text-sm font-semibold text-[#355747] whitespace-nowrap">תפוסה: ${g.total} חניכים רשומים</div>
        </div>
        <div class="mt-2">${g.homeroomN > 0 ? `<span class="ti-match">★ ${g.homeroomN} חניכים מכיתתו (<bdi dir="rtl">${E(room)}</bdi>) בקבוצה זו</span>` : `<span class="text-xs text-slate-500">אין חניכים מכיתתו (<bdi dir="rtl">${E(room)}</bdi>) בקבוצה זו</span>`}</div>
        <div class="text-xs text-slate-600 mt-1">הרכב: ${comp || '—'}</div>
        <div class="flex flex-wrap items-start justify-between gap-2 mt-2">
          <details class="ti-roster grow"><summary>הצג רשימת חניכים בקבוצה</summary><ul class="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-xs leading-5">${roster || '<li class="text-slate-500">אין חניכים</li>'}</ul></details>
          <button type="button" class="btn btn-ghost btn-sm" data-act="inspectOpenGroup" data-id="${E(g.groupId)}">פתח בסייר הקבוצות</button>
        </div></article>`;
    };
    const others = m.otherGrades.length ? `<details class="mt-3"><summary class="cursor-pointer font-semibold text-[#355747]">${m.isMajor ? 'קבוצות מגמה' : 'קבוצות במקצוע'} בשכבות אחרות (${m.otherGrades.length})</summary><div class="space-y-2 mt-2">${m.otherGrades.map(card).join('')}</div></details>` : '';
    this.openModal(`
      <div class="flex items-start justify-between gap-3">
        <h3 class="text-lg font-bold text-[#355747]">בדיקת קבוצות יעד במקצוע: ${E(m.subject)} • עבור ${E(t.name)} (<bdi dir="rtl">${E(room)}</bdi>)</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-act="closeModal" aria-label="סגירה">סגירה</button>
      </div>
      <div class="ti-banner mt-3">${banner}</div>
      <h4 class="font-semibold text-[#355747] mt-4 mb-2">${m.isMajor ? 'קבוצות מגמה' : 'קבוצות'} בשכבת ${E(Util.gl(t.gradeKey))} (${m.sameGrade.length}) · ממוין לפי התאמה לכיתת האם</h4>
      <div class="space-y-2">${m.sameGrade.map(card).join('') || `<div class="text-sm text-slate-500">${m.isMajor ? 'לא נמצאו קבוצות מגמה בשכבת החניך' : 'לא נמצאו קבוצות במקצוע זה בשכבת החניך'}</div>`}</div>
      ${others}`, true);
  },

  /** מפת שיבוצים לחניך: שורה לכל מקצוע (ליבה, מגמה ושאר המקצועות שבהם רשום או מקבל ציונים) מול הסדין, עם חיווי בקרה */
  renderStudentGroupsMap(tz) {
    const m = GroupAnalyzer.studentPlacementMap(tz);
    if (!m) return setHtml('groups-student-map', '');
    const t = m.t, c = m.counts;
    const dash = '<span class="text-slate-300">—</span>';
    const kpi = (label, value, sub, cls = '') => `<div class="prof-kpi"><div class="k">${label}</div><div class="v ${cls}">${value}</div><div class="s">${sub}</div></div>`;
    const groupBtn = g => `<button type="button" class="font-semibold text-[#355747] hover:underline text-right" data-act="sgOpenGroup" data-id="${E(g.groupId)}" title="פתיחת הקבוצה בסייר הקבוצות">${E(g.subject)} <span dir="ltr">[${E(g.groupId)}]</span>${g.reinforcement ? ' <span class="text-xs text-slate-500">תגבור</span>' : ''}</button>`;
    const body = m.rows.map(r => {
      const tag = r.kind === 'core' ? 'ליבה' : r.kind === 'major' ? 'מגמה' : '';
      const enrolled = r.enrolled.length ? r.enrolled.map(g => `<div>${groupBtn(g)}</div>`).join('') : '<span class="txt-bad font-semibold">ללא שיבוץ</span>';
      const teachers = r.enrolled.length ? r.enrolled.map(g => `<div>${E(g.teacher || 'ללא מורה')}</div>`).join('') : dash;
      const sadin = r.sadin.length ? r.sadin.map(s => `<div class="${s.mismatch ? 'txt-bad font-semibold' : ''}">${s.groupId ? `<button type="button" class="hover:underline" data-act="sgOpenGroup" data-id="${E(s.groupId)}"><span dir="ltr">[${E(s.groupId)}]</span> ${E(s.teacher || 'ללא מורה')}</button>` : E(s.teacher || 'ללא קבוצה')}${s.avg != null ? ` <span class="text-slate-500 font-normal">· ממוצע ${Util.fmt(s.avg, 0)}</span>` : ''}</div>`).join('') : dash;
      const status = r.issues.length ? r.issues.map(i => `<div class="text-xs font-semibold ${i.level === 'severe' ? 'txt-bad' : 'txt-warn'}">${E(i.text)}</div>`).join('')
        : r.enrolled.length ? '<span class="txt-ok font-semibold">✓ תקין</span>' : dash;
      return `<tr><td class="font-bold text-[#355747] whitespace-nowrap">${E(r.label)}${tag ? ` <span class="text-[11px] font-normal text-slate-500">${tag}</span>` : ''}</td>
        <td>${enrolled}</td><td class="whitespace-nowrap">${teachers}</td><td>${sadin}</td><td>${status}</td>
        <td class="whitespace-nowrap"><button type="button" class="btn btn-ghost btn-sm" data-act="inspectGroups" data-tz="${E(t.tz)}" data-subject="${E(r.label)}">🔍 השוואת קבוצות במקצוע</button></td></tr>`;
    }).join('');
    setHtml('groups-student-map', `
      <div class="card px-5 py-4">
        <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div class="min-w-0">
            <div class="text-xs font-semibold text-[#75977D]">מפת שיבוצים לחניך</div>
            <div class="text-2xl font-extrabold text-[#355747]">${E(t.name)}</div>
            <div class="text-sm text-slate-500 mt-0.5">ת.ז ${E(t.tz)} · כיתת אם ${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)} · מסלול ${E(this.trackOf(t))}</div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            ${kpi('קבוצות משובצות', c.groups, 'בקובץ הקבוצות')}
            ${kpi('מקצועות ליבה ללא שיבוץ', c.missingCore, c.missingCore ? 'דורש שיבוץ' : 'כל מקצועות הליבה משובצים', c.missingCore ? 'txt-bad' : 'txt-ok')}
            ${kpi('חריגות שיבוץ', c.anomalies, c.anomalies ? 'לבדיקה בטבלה' : 'אין חריגות', c.anomalies ? 'txt-bad' : 'txt-ok')}
          </div>
          <div class="mr-auto flex flex-wrap gap-2">
            <button type="button" class="btn btn-ghost" data-act="openProfile" data-tz="${E(t.tz)}">👤 מעבר לכרטיס 360°</button>
            <button type="button" class="nav-back" data-act="mapBack">← חזרה למוקד חריגי שיבוץ</button>
          </div>
        </div>
      </div>
      <div class="tbl-wrap sticky-scroll"><table class="grid w-full" aria-label="מפת שיבוצים לחניך">
        <thead><tr><th>מקצוע</th><th>קבוצה רשומה (שיבוץ)</th><th>מורה</th><th>קבוצה בסדין ציונים</th><th>חיווי בקרה</th><th>בדיקת קבוצת יעד</th></tr></thead>
        <tbody>${body || '<tr><td colspan="6" class="text-center text-slate-500 py-8">לא נמצאו שיבוצים או ציונים לחניך זה</td></tr>'}</tbody></table></div>`);
  },

  groupsRerender() {
    const scrollTop = $('groups-master') ? $('groups-master').scrollTop : 0;
    this.dirty.add('groups');
    this.renderTab('groups');
    if ($('groups-master')) $('groups-master').scrollTop = scrollTop;
    this.scrollActiveGroup();
  },

  scrollActiveGroup() {
    const list = $('groups-master'), active = list && list.querySelector('[aria-pressed="true"]');
    if (!active || list.scrollHeight <= list.clientHeight + 1) return;
    const bounds = list.getBoundingClientRect(), item = active.getBoundingClientRect();
    if (item.top < bounds.top || item.bottom > bounds.bottom) list.scrollTop += item.top - bounds.top - (list.clientHeight - item.height) / 2;
  },

  renderGroupsExplorer() {
    const st = this.state.groups, f = this.state.filters;
    const groups = GroupAnalyzer.explorerModel().groups;
    const lockT = this.lockedTrainee();
    const population = lockT ? [lockT] : this.filtered(false), populationIds = new Set(population.map(t => t.tz));
    const scoped = !!lockT || f.grade !== 'all' || f.cls !== 'all' || f.track !== 'all';
    const visible = groups.filter(g => !scoped || g.members.some(m => populationIds.has(m.t.tz)));
    const cats = new Map();
    groups.forEach(g => { const c = cats.get(g.cat.key) || { ...g.cat, n: 0 }; c.n++; cats.set(c.key, c); });
    const opt = (v, label, current) => `<option value="${E(v)}" ${v === current ? 'selected' : ''}>${E(label)}</option>`;
    const labels = { core: 'מקצועות ליבה', major: 'מגמות', internal: 'פנימי ואחר', other: 'פנימי ואחר' };
    const catList = [...cats.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'he'));
    if (st.subjectKey !== 'all' && !cats.has(st.subjectKey)) { st.subjectKey = 'all'; st.strip = 'all'; }
    setHtml('groupSubjectSelect', opt('all', 'כל המקצועות', st.subjectKey) +
      ['מקצועות ליבה', 'מגמות', 'פנימי ואחר'].map(label => {
        const items = catList.filter(c => labels[c.kind] === label);
        return items.length ? `<optgroup label="${E(label)}">${items.map(c => opt(c.key, `${c.label} (${c.n})`, st.subjectKey)).join('')}</optgroup>` : '';
      }).join(''));
    const teachers = new Map();
    groups.forEach(g => { if (g.teacher) teachers.set(g.teacher, (teachers.get(g.teacher) || 0) + 1); });
    if (st.teacher !== 'all' && !teachers.has(st.teacher)) st.teacher = 'all';
    setHtml('groupTeacherSelect', opt('all', 'כל המורים', st.teacher) +
      [...teachers.keys()].sort((a, b) => a.localeCompare(b, 'he')).map(t => opt(t, `${t} (${teachers.get(t)})`, st.teacher)).join(''));

    const cat = cats.get(st.subjectKey);
    this._boardCategory = cat ? cat.label : '';
    const health = cat ? GroupAnalyzer.subjectHealth(cat, groups, population, f.grade !== 'all' || f.cls !== 'all') : null;
    this.renderGroupsStrip(cat, health);
    const hit = t => !!lockT && t.tz === lockT.tz;
    let scope = visible.filter(g => (st.subjectKey === 'all' || g.cat.key === st.subjectKey) && (st.teacher === 'all' || g.teacher === st.teacher));
    const dupGroups = new Set(health ? health.dup.flatMap(d => d.groups.map(g => g.groupId)) : []);
    const strayIds = new Set(health ? health.stray.map(s => `${s.g.groupId}\u0000${s.t.tz}`) : []);
    if (st.strip === 'missing') scope = [];
    if (st.strip === 'dup') scope = scope.filter(g => dupGroups.has(g.groupId));
    if (st.strip === 'stray') scope = scope.filter(g => g.members.some(m => strayIds.has(`${g.groupId}\u0000${m.t.tz}`)));
    scope.sort((a, b) => a.cat.order - b.cat.order || a.subject.localeCompare(b.subject, 'he') || (a.teacher || 'תת').localeCompare(b.teacher || 'תת', 'he') || natural(a.groupId, b.groupId));
    this._explorerView = scope;
    const missing = health && (st.strip === 'all' || st.strip === 'missing') ? health.missing.filter(t => !lockT || hit(t)) : [];
    this._boardMissing = missing;
    if (st.strip === 'missing') st.missingSelected = true;
    if (st.missingSelected && !missing.length && st.strip !== 'missing') st.missingSelected = false;
    if (!scope.some(g => g.groupId === st.groupId)) st.groupId = scope.length ? scope[0].groupId : '';
    if (!scope.length && missing.length) st.missingSelected = true;
    const missingItem = missing.length ? `<button type="button" data-act="gMissing" aria-pressed="${st.missingSelected}"
      class="w-full text-right rounded-xl border border-r-4 py-2 px-3 transition ${st.missingSelected ? 'bg-slate-900 text-white border-slate-900 border-r-rose-400 shadow-lg' : 'bg-white border-slate-300 border-r-rose-600 hover:border-indigo-500 hover:shadow-md text-slate-900'}">
      <span class="font-bold">לא משובצים ל${E(cat.label)}</span><span class="block text-xs mt-1">${missing.length} חניכים</span></button>` : '';
    setHtml('groups-master', missingItem + scope.map(g => this.groupListItem(g, !st.missingSelected && g.groupId === st.groupId)).join('') ||
      '<div class="card p-6 text-center text-slate-700 text-sm">אין קבוצות או חניכים להצגה בסינון הנוכחי</div>');
    if (st.missingSelected) this.renderGroupDetail(null, missing, hit, cat);
    else this.renderGroupDetail(scope.find(g => g.groupId === st.groupId), [], hit, cat);
    this.scrollActiveGroup();
  },

  renderGroupsStrip(cat, h) {
    const box = $('groups-strip'), st = this.state.groups;
    if (!cat || !h) { box.classList.add('hidden'); box.innerHTML = ''; st.strip = 'all'; return; }
    box.classList.remove('hidden');
    const pill = (key, cls, label, value) => `<button type="button" class="gstat ${cls}" data-act="gStrip" data-k="${key}" aria-pressed="${st.strip === key}" title="${E(label)}">
      <span class="text-xs font-bold text-slate-700 truncate">${E(label)}</span><span class="text-sm font-extrabold px-2 py-0.5 rounded bg-slate-100 whitespace-nowrap">${value}</span></button>`;
    box.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-2">${[
      pill('all', 'gstat-ok', '🟢 הכל / משובצים תקין', `${h.ok} מתוך ${h.total}`),
      pill('missing', 'gstat-bad', `לא משובצים כלל ל${cat.label}`, h.missing.length),
      pill('dup', 'gstat-violet', `🔀 רשומים ל-2 קבוצות ב${cat.label}`, h.dup.length),
      pill('stray', 'gstat-amber', `חריגי שכבה/כיתה ב${cat.label}`, h.stray.length)
    ].join('')}</div>`;
  },

  /** הרכב כיתות הקבוצה בקצרה: "יב1: 15, יב2: 12" (עד max כיתות, והשאר כמספר) */
  compositionText(g, max = 4) {
    const parts = g.classes.slice(0, max).map(c => `<bdi dir="rtl">${E(Config.classLabel(c.classKey))}</bdi>: ${c.n}`);
    return parts.join(', ') + (g.classes.length > max ? ` · +${g.classes.length - max}` : '');
  },

  groupListItem(g, selected) {
    const sub = [E(g.subject), g.targetClasses ? `<bdi dir="rtl">${E(g.targetClasses)}</bdi>` : ''].filter(Boolean).join(' • ');
    const badges = selected ? 'bg-white/15 text-white border-white/30' : 'bg-slate-100 text-slate-900 border-slate-300';
    const muted = selected ? 'text-indigo-100' : 'text-slate-700';
    return `<button type="button" data-act="gPick" data-id="${E(g.groupId)}" aria-pressed="${selected}"
      class="w-full text-right rounded-xl border py-2 px-3 transition ${selected ? 'bg-slate-900 text-white border-slate-900 border-r-4 border-r-indigo-400 shadow-lg' : 'bg-white border-slate-300 hover:border-indigo-500 hover:shadow-md text-slate-900'}">
      <span class="flex items-center justify-between gap-2">
        <span class="min-w-0"><span class="text-sm leading-4 font-bold block truncate">${E(g.teacher || 'ללא מורה')}</span><span class="text-xs leading-4 block truncate ${muted}">${sub}</span></span>
        <span class="flex flex-wrap justify-end gap-1 shrink-0"><span class="badge font-mono ${badges}">[${E(g.groupId)}]</span><span class="badge ${badges}">תפוסה: ${g.total} חניכים</span></span>
      </span>
      <span class="block text-[11px] leading-4 mt-1 truncate ${muted}">${g.classes.length ? `הרכב: ${this.compositionText(g)}` : 'אין חניכים רשומים'}${g.anomalyCount ? ` · ${g.anomalyCount} חריגים` : ''}</span></button>`;
  },

  renderGroupDetail(g, missing, hit, cat) {
    const st = this.state.groups;
    if (!g && !st.missingSelected) return setHtml('groups-detail', '<div class="card p-10 text-center text-slate-700">בחרו קבוצה מהרשימה כדי לראות את הרשימה השמית שלה</div>');
    const members = g ? g.members : missing.map(t => ({ t, diag: [], severity: 9 }));
    const byName = st.rosterSort === 'name';
    const anomalies = byName ? [] : members.filter(m => m.diag.length).sort((a, b) => a.severity - b.severity);
    const rooms = new Map();
    (byName ? [] : members.filter(m => !m.diag.length)).forEach(m => {
      if (!rooms.has(m.t.classKey)) rooms.set(m.t.classKey, []);
      rooms.get(m.t.classKey).push(m);
    });
    const row = m => {
      const t = m.t, count = Store.currentOf(t.tz).reduce((n, e) => n + e.events.length, 0);
      const tint = hit(t) ? 'bg-yellow-100' : m.diag.length ? 'an-row' : '';
      const notes = m.diag.map(d => this.flatNote(d.kind === 'outlier' ? 'warn' : 'severe', d.text, d.title)).join('');
      return `<tr class="${tint}"><td class="tz-col">${E(t.tz)}</td><td><button type="button" class="font-semibold text-indigo-800 hover:underline text-right" data-act="openBoardProfile" data-tz="${E(t.tz)}" title="${E(`סדין: ${count} אירועים`)}">${E(t.name)}</button></td>
        <td><bdi dir="rtl">${E(Config.classLabel(t.classKey))}</bdi>${this.overrideBadge(t.tz)}</td><td>${notes || (g ? '<span class="text-emerald-800">✓ תקין</span>' : 'ללא שיבוץ')}</td></tr>`;
    };
    const divider = (text, cls = '') => `<tr class="room-divider ${cls}"><td colspan="4">${text}</td></tr>`;
    const body = byName ? [...members].sort((a, b) => a.t.name.localeCompare(b.t.name, 'he')).map(row).join('') :
      (anomalies.length ? divider(`חריגי שיבוץ בקבוצה זו (${anomalies.length})`, 'anomaly-divider') + anomalies.map(row).join('') : '') +
      [...rooms.entries()].map(([key, items]) => divider(`כיתה <bdi dir="rtl">${E(Config.classLabel(key))}</bdi> (${items.length})`) + items.map(row).join('')).join('');
    const title = g ? `${E(g.subject)} • ${E(g.teacher || 'ללא מורה')} <span class="font-mono">[${E(g.groupId)}]</span>` : `לא משובצים ל${E(cat ? cat.label : '')}`;
    const declared = g && g.declared != null && g.declared !== g.total ? `<span class="badge tier-3">מוצהר ${g.declared}</span>` : '';
    const sortBtn = (id, label) => `<button type="button" class="chip" data-act="rosterSort" data-sort="${id}" aria-pressed="${(st.rosterSort || 'room') === id}">${label}</button>`;
    setHtml('groups-detail', `<article class="card overflow-hidden lg:h-full lg:flex lg:flex-col lg:min-h-0">
      <header class="bg-gradient-to-l from-slate-900 to-slate-800 text-white px-4 py-2.5 rounded-t-xl flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div><h3 class="text-lg font-bold">${title}</h3>${g && g.targetClasses ? `<div class="text-xs text-indigo-100 mt-1">כיתות יעד: <bdi dir="rtl">${E(g.targetClasses)}</bdi></div>` : ''}</div>
        <div class="flex flex-wrap items-center gap-2"><span class="badge bg-indigo-500 text-white border-indigo-300">תפוסה: ${members.length} חניכים</span>${declared}        ${g && g.reinforcement ? '<span class="badge bg-white/15 text-white border-white/30">תגבור</span>' : ''}</div>
      </header>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 bg-[#FAF7EF] border-b border-[#E6ECE6] text-xs shrink-0">
        ${g && g.classes.length ? `<span class="text-slate-700">הרכב כיתות: ${this.compositionText(g, 12)}</span>` : ''}
        <span class="mr-auto flex items-center gap-1"><span class="text-slate-600">מיון:</span>${sortBtn('room', 'לפי כיתה')}${sortBtn('name', 'לפי שם')}</span>
      </div>
      <div class="sticky-scroll lg:flex-1 lg:min-h-0 overscroll-contain"><table class="grid w-full"><thead><tr><th>ת.ז</th><th>שם חניך</th><th>כיתת אם</th><th>חיווי בקרה</th></tr></thead>
      <tbody>${body || '<tr><td colspan="4" class="text-center text-slate-700 py-6">אין חניכים להצגה</td></tr>'}</tbody></table></div></article>`);
  },

  /** ממצא שטוח: טקסט בלבד בלי רקע, מסגרת או ריפוד; חמור בבורדו, בינוני בענבר. כל ממצא בשורה משלו */
  flatNote(level, text, title = '') {
    return `<span class="block text-xs font-medium ${level === 'severe' ? 'text-rose-900' : 'text-amber-800'}"${title ? ` title="${E(title)}"` : ''}>${E(text)}</span>`;
  },

  /* ==================================================================
     פאנל 3 – מוניטור ציונים שוטפים
     ================================================================== */
  renderSadinPanel() {
    this.renderFreshnessBar('sadin');
    const st = this.state.sadin;
    let summaryBox = $('sadin-summary');
    if (!summaryBox) {
      summaryBox = document.createElement('div');
      summaryBox.id = 'sadin-summary';
      summaryBox.className = 'card px-4 py-2.5 mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm';
      summaryBox.setAttribute('role', 'status');
      $('sadin-table').insertAdjacentElement('beforebegin', summaryBox);
    }
    summaryBox.innerHTML = '';
    summaryBox.classList.add('hidden');
    $('sadin-table').className = st.view === 'sheet' ? 'card overflow-hidden min-w-0' : 'tbl-wrap sticky-scroll';
    document.querySelectorAll('[data-sview]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sview === st.view)));
    const entries = Store.traineeList().flatMap(t => Store.currentOf(t.tz));
    const rawUnknown = Store.raw.grades.filter(r => !Store.trainees.has(r.tz));
    const subjects = [...new Set(entries.map(e => e.subject).concat(rawUnknown.map(r => r.subject)).filter(Boolean).map(s => GroupAnalyzer.sadinSubject(s)))].sort(natural);
    const teachers = [...new Set(entries.map(e => (Store.groups.get(e.groupId) || {}).teacher || e.teacher).concat(rawUnknown.map(r => r.teacher)).filter(Boolean))].sort(natural);
    if (st.subject !== 'all' && !subjects.includes(st.subject)) st.subject = 'all';
    if (st.teacher !== 'all' && !teachers.includes(st.teacher)) st.teacher = 'all';
    const option = (v, label, selected) => `<option value="${E(v)}" ${v === selected ? 'selected' : ''}>${E(label)}</option>`;
    setHtml('sadinSubjectSelect', option('all', 'כל המקצועות', st.subject) + subjects.map(s => option(s, s, st.subject)).join(''));
    setHtml('sadinTeacherSelect', option('all', 'כל המורים', st.teacher) + teachers.map(t => option(t, t, st.teacher)).join(''));
    if (!Store.hasData()) {
      setHtml('sadinFilterSelect', option('all', 'כל החניכים (0)', 'all'));
      return this.noRoster([], 'sadin-table');
    }
    if (!Store.loaded.grades) {
      st.strip = 'all';
      setHtml('sadinFilterSelect', option('all', 'כל החניכים (0)', 'all'));
      setHtml('sadin-table', '<div class="p-8 text-center text-slate-500">לא נטען קובץ ציונים שוטפים. אפשר לטעון אותו בכפתור שבראש הפאנל.</div>');
      return;
    }
    const roster = this.filtered();
    const all = GroupAnalyzer.sadinSheet(roster, st);
    if (st.view === 'sheet' && (st.subject !== 'all' || st.teacher !== 'all')) {
      const included = new Set(all.map(r => r.t.tz));
      GroupAnalyzer.sadinSheet(roster.filter(t => !included.has(t.tz))).forEach(r => {
        all.push({ ...r, subjects: new Map(), failing: 0, missed: 0 });
      });
    }
    const filters = [
      ['all', 'כל החניכים', all.length],
      ['fail', 'עם נכשל שוטף', all.filter(r => r.failing > 0).length],
      ['multiple', '2+ מקצועות בסיכון (שלילי/חסר)', all.filter(r => GroupAnalyzer.riskSubjects(r).length >= 2).length],
      ['missed', 'אירועים שהוחמצו', all.filter(r => r.missed > 0).length]
    ];
    setHtml('sadinFilterSelect', filters.map(([key, label, count]) => option(key, `${label} (${count})`, st.strip)).join(''));
    const selectedFilter = filters.find(([key]) => key === st.strip);
    const rows = all.filter(r => st.strip === 'all' || (st.strip === 'fail' && r.failing > 0) || (st.strip === 'multiple' && GroupAnalyzer.riskSubjects(r).length >= 2) || (st.strip === 'missed' && r.missed > 0));
    const summary = this.sadinSummary(rows);
    $('sadinFilterSelect').title = `${selectedFilter ? `${selectedFilter[1]} (${selectedFilter[2]}) · ` : ''}ממוצע כללי בסינון: ${Util.fmt(summary.avg, 1)}`;
    summaryBox.classList.remove('hidden');
    summaryBox.innerHTML = `<span><strong>ממוצע כללי בסינון:</strong> ${Util.fmt(summary.avg, 1)}</span>
      <span><strong>100% ציונים עוברים:</strong> ${summary.cleanCount} מתוך ${summary.gradedCount} עם ציונים</span>
      <span>מוצגים ${summary.totalCount} מתוך ${roster.length} חניכים בחיתוך</span>`;
    if (st.view === 'flat') this.renderSadinFlat(rows);
    else this.renderSadinSheet(rows, st.subject !== 'all' || st.teacher !== 'all');
  },

  /** ציון כטקסט שטוח בשורה אחת, בלי רקע או מסגרת: אדום כהה לנכשל/חסר/מסומן, אפור-כהה לעובר */
  sadinScore(value, missed = false) {
    const text = value == null ? (missed ? 'חסר' : '—') : Util.fmt(value, 0);
    const alert = missed || (value != null && value < (Number(Config.rules().passGrade) || 55));
    return `<span class="sadin-score ${alert ? 'is-bad' : value == null ? 'is-empty' : ''}">${text}</span>`;
  },

  sadinTip(subject) {
    const exact = v => v == null ? '—' : String(v);
    const lines = [`${subject.name} · ממוצע מקצוע ${exact(subject.avg)} · ${subject.events.length} אירועים`];
    subject.entries.forEach(e => {
      lines.push(`${e.displaySubject || e.subject} • ${e.teacher || 'ללא מורה'}${e.groupId ? ` [${e.groupId}]` : ''} · ממוצע ${exact(e.avg)}`);
      e.events.forEach(ev => lines.push(`${ev.eventName || 'אירוע'}${ev.date ? ` · ${ev.date}` : ''}: ${ev.score != null ? exact(ev.score) : (ev.scoreRaw || 'חסר')} (משקל ${ev.weight})`));
    });
    subject.missed.forEach(m => {
      if (!subject.events.some(e => e.key === m.key)) lines.push(`${m.eventName || 'אירוע'}${m.date ? ` · ${m.date}` : ''}: חסר (משקל ${m.weight})`);
    });
    return lines.join('\n');
  },

  renderSadinSheet(rows, eventsMode) {
    const coreOrder = GroupAnalyzer.coreSubjects().map(s => s.name);
    const rank = s => { const i = coreOrder.indexOf(s); return i < 0 ? coreOrder.length : i; };
    /* עמודות קבועות: כל מקצועות הסדין של השכבה (ללא תלות בחיפוש, בכיתה או בסינון השורות) */
    const all = GroupAnalyzer.sadinSheet(this.filtered(false, true), this.state.sadin);
    const names = [...new Set(all.flatMap(r => [...r.subjects.keys()]))]
      .sort((a, b) => rank(a) - rank(b) || natural(a, b));
    const columns = [];
    names.forEach(name => {
      if (eventsMode) {
        const events = new Map();
        all.forEach(r => {
          const s = r.subjects.get(name);
          if (!s) return;
          s.events.forEach(e => events.set(e.key, e));
          s.missed.forEach(e => { if (!events.has(e.key)) events.set(e.key, e); });
        });
        [...events.values()].sort((a, b) => (a.date || '').localeCompare(b.date || '') || natural(a.eventName, b.eventName) || natural(a.groupId, b.groupId)).forEach(e => {
          const header = `${names.length > 1 ? `${name} · ` : ''}${e.eventName || 'אירוע'}${e.date ? ` · ${e.date}` : ''} (משקל ${e.weight})${e.teacher ? ` · ${e.teacher}` : ''}${e.groupId ? ` [${e.groupId}]` : ''}`;
          columns.push({ kind: 'event', name, event: e, header });
        });
      }
      columns.push({ kind: 'subject', name, header: eventsMode ? (names.length > 1 ? `ממוצע ${name}` : 'ממוצע מקצוע') : name });
    });
    const rowsSorted = this.sadinSortRows(rows, columns);
    const colKey = c => (c.kind === 'event' ? `evt:${c.name}|${c.event.key}` : `subj:${c.name}`);
    /* רוחב עמודה: ערך שהמשתמש גרר (נשמר ב-state.sadinColWidths) או ברירת המחדל */
    const DEFAULT_W = { name: 155, homeroom: 105, avg: 82, negatives: 118 };
    const widthOf = key => this.state.sadinColWidths[key] || DEFAULT_W[key] || 82;
    const wStyle = key => `width:${widthOf(key)}px;min-width:${widthOf(key)}px;max-width:${widthOf(key)}px`;
    const body = rowsSorted.map(r => {
      const cells = columns.map(col => {
        const s = r.subjects.get(col.name);
        const sty = wStyle(colKey(col));
        if (!s) return `<td class="sx-s text-slate-300" style="${sty}">—</td>`;
        if (col.kind === 'event') {
          const ev = s.events.find(x => x.key === col.event.key), missed = s.missed.has(col.event.key);
          const val = ev && ev.score != null ? ev.score : null;
          const text = ev && ev.score == null && ev.scoreRaw ? String(ev.scoreRaw) : '';
          const eventTip = `${col.name} · ${col.event.eventName || 'אירוע'}${col.event.date ? ` · ${col.event.date}` : ''} · משקל ${col.event.weight} · ${val != null ? String(val) : text || (missed ? 'חסר' : '—')}`;
          return `<td class="sx-s" style="${sty}" title="${E(eventTip)}">${val != null || missed ? this.sadinScore(val, missed) : text ? E(text) : '<span class="text-slate-300">—</span>'}</td>`;
        }
        return `<td class="sx-s" style="${sty}"><button type="button" class="w-full text-center" data-act="sadinPop" data-tip="${E(this.sadinTip(s))}" aria-label="${E(`${col.name}: ממוצע ${Util.fmt(s.avg, 1)}. הצגת פירוט`)}">${this.sadinScore(s.avg, s.missed.size > 0)}</button></td>`;
      }).join('');
      /* נכשלים וחסרים בתגים נפרדים, כדי שלא יתבלבלו זה בזה */
      const negBadges = r.failing || r.missed
        ? `<span class="neg-cell">${r.failing ? `<span class="neg-badge neg-fail">${r.failing} נכשל</span>` : ''}${r.missed ? `<span class="neg-badge neg-miss">${r.missed} חסר</span>` : ''}</span>`
        : '<span class="neg-ok">✓ תקין</span>';
      return `<tr><td class="sx-name" style="${wStyle('name')}"><button type="button" class="font-bold text-indigo-700 hover:text-indigo-900 hover:underline cursor-pointer" data-act="openProfile" data-tz="${E(r.t.tz)}" title="${E(r.t.name)} · ת.ז ${E(r.t.tz)}">${E(r.t.name)}</button></td>
        <td class="sx-room" style="${wStyle('homeroom')}">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</td>
        <td class="sx-avg font-bold" style="${wStyle('avg')}" title="${E(`ממוצע שווה-משקל של ממוצעי המקצועות: ${r.overall == null ? '—' : String(r.overall)}`)}">${this.sadinScore(r.overall, false)}</td>
        <td class="sx-neg" style="${wStyle('negatives')}" title="${E(`${r.failing} נכשלים · ${r.missed} חסרים`)}">${negBadges}</td>${cells}</tr>`;
    }).join('');
    const sort = this.state.sadinSort, sortKey = sort.key === 'class_name' ? 'homeroom' : sort.key;
    const th = (key, label, cls = '', title = '') => {
      const active = sortKey === key;
      return `<th class="${cls}" style="${wStyle(key)}" data-ck="${E(key)}" aria-sort="${active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}"><button type="button" class="sx-sort${active ? ' is-active' : ''}" data-act="sadinSort" data-key="${E(key)}" title="${E(title || `מיון לפי ${label}`)}"><span class="sx-label">${E(label)}</span><span class="sx-ind" aria-hidden="true">${active ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}</span></button><span class="col-resizer" aria-hidden="true" title="גרור לשינוי רוחב עמודה (לחיצה כפולה להתאמה אוטומטית)"></span></th>`;
    };
    const keys = ['name', 'homeroom', 'avg', 'negatives', ...columns.map(colKey)];
    const width = keys.reduce((sum, k) => sum + widthOf(k), 0);
    setHtml('sadin-table', `<div class="sticky-scroll overscroll-contain"><table class="grid sadin-sheet" style="width:${width}px"><colgroup>${keys.map(k => `<col style="width:${widthOf(k)}px">`).join('')}</colgroup>
      <thead><tr>${th('name', 'חניך', 'sx-name')}${th('homeroom', 'כיתה', 'sx-room')}${th('avg', 'ממוצע כללי', 'sx-avg')}${th('negatives', 'נכשלים / חסרים', 'sx-neg', 'מיון לפי מספר הנכשלים והחסרים')}${columns.map(c => th(colKey(c), c.header, 'sx-s', c.header)).join('')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${columns.length + 4}" class="text-center text-slate-700 py-8">אין חניכים בסינון הנוכחי</td></tr>`}</tbody></table></div>`);
  },

  /** מציב רוחב לעמודה בסדין (56–360px) ב-col וב-th/td שלה, ושומר ב-state.sadinColWidths */
  setSadinColWidth(table, idx, key, width) {
    const w = Math.max(56, Math.min(360, Math.round(width)));
    const cols = table.querySelectorAll('colgroup col');
    if (cols[idx]) cols[idx].style.width = `${w}px`;
    table.querySelectorAll(`tr > :nth-child(${idx + 1})`).forEach(c => { if (c.colSpan <= 1) { c.style.width = c.style.minWidth = c.style.maxWidth = `${w}px`; } });
    table.style.width = `${[...cols].reduce((sum, c) => sum + parseFloat(c.style.width), 0)}px`;
    this.state.sadinColWidths[key] = w;
    return w;
  },

  /** גרירה (RTL: שמאלה מרחיבה) והתאמה אוטומטית בלחיצה כפולה על ידית העמודה; אף אחד מהם אינו מפעיל מיון */
  bindSadinColResize() {
    const handle = e => (e.target.closest ? e.target.closest('#sadin-table .col-resizer') : null);
    document.addEventListener('mousedown', e => {
      const h = handle(e);
      if (!h || e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      const th = h.closest('th'), table = th.closest('table'), key = th.dataset.ck, idx = th.cellIndex;
      const startX = e.clientX, startW = th.getBoundingClientRect().width;
      document.body.classList.add('col-resizing');
      const move = ev => this.setSadinColWidth(table, idx, key, startW + (startX - ev.clientX));
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('col-resizing'); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    }, true);
    document.addEventListener('click', e => { if (handle(e)) { e.stopPropagation(); e.preventDefault(); } }, true);
    document.addEventListener('dblclick', e => {
      const h = handle(e);
      if (!h) return;
      e.stopPropagation(); e.preventDefault();
      const th = h.closest('th'), label = th.querySelector('.sx-label'), ind = th.querySelector('.sx-ind');
      this.setSadinColWidth(th.closest('table'), th.cellIndex, th.dataset.ck, (label ? label.scrollWidth : th.scrollWidth) + (ind ? ind.offsetWidth : 0) + 24);
    }, true);
  },

  /** מיון הסדין: שם / כיתה+שם (ברירת מחדל) / ממוצע / שליליים / מקצוע או אירוע. חניכים ללא ערך (לא לומדים את המקצוע, ללא ממוצע) תמיד בתחתית */
  sadinSortRows(rows, columns) {
    const { key, dir } = this.state.sadinSort, sign = dir === 'desc' ? -1 : 1;
    const nameCmp = (a, b) => a.t.name.localeCompare(b.t.name, 'he');
    const roomCmp = (a, b) => Util.ord(a.t.gradeKey) - Util.ord(b.t.gradeKey) || natural(a.t.classKey, b.t.classKey);
    const col = columns.find(c => (c.kind === 'event' ? `evt:${c.name}|${c.event.key}` : `subj:${c.name}`) === key);
    /* ערך מספרי; חסר ציון = -1 (עולה ראשון בסדר עולה); null = אינו לומד את המקצוע */
    const valueOf = r => {
      if (key === 'avg') return r.overall;
      if (!col) return null;
      const s = r.subjects.get(col.name);
      if (!s || !(s.entries.length || s.events.length || s.missed.size)) return null;
      if (col.kind === 'event') {
        const ev = s.events.find(x => x.key === col.event.key);
        if (ev && ev.score != null) return ev.score;
        return ev || s.missed.has(col.event.key) ? -1 : null;
      }
      return s.avg == null ? -1 : s.avg;
    };
    return [...rows].sort((a, b) => {
      if (key === 'name') return sign * nameCmp(a, b);
      if (key === 'class_name' || key === 'homeroom') return sign * (roomCmp(a, b) || nameCmp(a, b));
      if (key === 'negatives') return sign * ((a.failing + a.missed) - (b.failing + b.missed) || a.failing - b.failing) || roomCmp(a, b) || nameCmp(a, b);
      const va = valueOf(a), vb = valueOf(b);
      if (va == null && vb == null) return roomCmp(a, b) || nameCmp(a, b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return sign * (va - vb) || roomCmp(a, b) || nameCmp(a, b);
    });
  },

  renderSadinFlat(rows) {
    /* חניך וכיתה מוצגים פעם אחת לכל חניך (rowspan על כל מקצועותיו); השורה האחרונה של כל חניך נושאת קו תחתון חזק לסימון הקבוצה */
    const body = rows.filter(r => r.subjects.size).map(r => [...r.subjects.values()].map((s, i, all) => {
        const teacher = [...new Set(s.entries.map(e => e.teacher).filter(Boolean))].join(', ');
        const n = Store.weightedAverage(s.events).n;
        const last = i === all.length - 1;
        const end = last ? ' student-end' : '';
        const who = i === 0
          ? `<td rowspan="${all.length}" class="fx-name student-end"><button type="button" class="font-semibold text-indigo-700 hover:text-indigo-900 hover:underline cursor-pointer" data-act="openProfile" data-tz="${E(r.t.tz)}" title="ת.ז ${E(r.t.tz)}">${E(r.t.name)}</button></td><td rowspan="${all.length}" class="fx-room student-end">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</td>`
          : '';
        return `<tr>${who}
          <td class="fx-subj${end}">${E(s.name)}</td><td class="fx-teacher${end}" title="${E(teacher)}">${E(teacher || '—')}</td><td class="fx-n${end}">${n}</td><td class="fx-avg${end}"><button type="button" data-act="sadinPop" data-tip="${E(this.sadinTip(s))}" aria-label="${E(`${s.name}: הצגת פירוט הציונים`)}">${this.sadinScore(s.avg, s.missed.size > 0)}</button></td></tr>`;
    }).join('')).join('');
    setHtml('sadin-table', `<table class="grid sadin-flat" style="width:745px"><colgroup><col style="width:165px"><col style="width:115px"><col style="width:135px"><col style="width:140px"><col style="width:80px"><col style="width:110px"></colgroup>
      <thead><tr><th>חניך</th><th>כיתה</th><th>מקצוע</th><th>מורה</th><th>אירועים</th><th>ממוצע משוקלל</th></tr></thead><tbody>${body || '<tr><td colspan="6" class="text-center py-8">אין נתונים בסינון הנוכחי</td></tr>'}</tbody></table>`);
  },

  renderAlerts() {
    setHtml('alertOut', this.alertOut.map((a, i) => `
      <div class="card p-3">
        <div class="flex items-center justify-between mb-2"><b>${E(a.title)}</b><span class="text-xs text-slate-400">${a.count} פריטים</span></div>
        <textarea class="inp w-full text-xs" rows="6" readonly aria-label="${E(a.title)}">${E(a.text)}</textarea>
        <div class="flex gap-2 mt-2">
          <button type="button" class="btn btn-ghost btn-sm" data-act="copyAlert" data-i="${i}">העתקה</button>
          <button type="button" class="btn btn-primary btn-sm" data-act="waAlert" data-i="${i}">וואטסאפ</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="mailAlert" data-i="${i}">מייל</button>
        </div></div>`).join(''));
  },

  openSadinAlerts() {
    const st = this.state.sadin;
    this.openModal(`<div class="flex items-center justify-between gap-2 mb-3"><h3 class="text-lg font-semibold">🔔 התראות ציונים שוטפים</h3><button type="button" class="btn btn-ghost btn-sm" data-act="closeModal">סגירה</button></div>
      <div class="flex flex-wrap items-center gap-3 mb-3">
        <select id="alertBy" class="inp" aria-label="קיבוץ התראות לפי"><option value="class" ${st.alertBy === 'class' ? 'selected' : ''}>לפי כיתה</option><option value="teacher" ${st.alertBy === 'teacher' ? 'selected' : ''}>לפי מורה</option></select>
        <label class="flex items-center gap-1 text-sm"><input type="checkbox" id="alertInitials" ${st.initials ? 'checked' : ''}>ראשי תיבות בלבד</label>
        <button type="button" class="btn btn-primary btn-sm" data-act="generateAlerts">הפק רשימת התראות</button>
      </div><div id="alertOut" class="grid md:grid-cols-2 gap-3" aria-live="polite"></div>`, true);
    this.renderAlerts();
  },

  showSadinPop(el, pin) {
    const pop = $('sadinPop');
    if (!el.dataset.tip) return;
    pop.textContent = el.dataset.tip;
    pop.style.pointerEvents = pin ? 'auto' : 'none';
    pop.tabIndex = pin ? 0 : -1;
    pop.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
    let top = r.bottom + 6;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
    pop.style.top = `${top}px`;
    this._sadinPinned = pin ? el : null;
  },
  hideSadinPop() { $('sadinPop').classList.add('hidden'); this._sadinPinned = null; },

  async generateAlerts() {
    const by = this.state.sadin.alertBy === 'class' ? 'homeroom' : this.state.sadin.alertBy;
    const res = GroupAnalyzer.generateAlertsText({
      by, roster: this.filtered(), initials: this.state.sadin.initials, getEval: tz => this.getEval(tz)
    });
    this.alertOut = res.sections;
    this.renderAlerts();
    if (!res.sections.length) return this.toast('לא נמצאו פריטים להתראה בסינון הנוכחי', 'ok');
    const copied = await this.copyText(res.text);
    this.toast(copied ? `הופקו ${res.sections.length} רשימות (${res.total} פריטים) והועתקו ללוח` : 'הרשימות הופקו, אך ההעתקה ללוח נכשלה – אפשר להעתיק מכל כרטיס', copied ? 'ok' : 'warn');
  },

  showMissed() {
    const res = GroupAnalyzer.analyzeCurrentGrades(this.filtered(), { subject: this.state.sadin.subject });
    const KIND = { 'no-row': 'אין שורה', empty: 'ללא ציון', zero: 'ציון 0' };
    const rows = res.missed.slice(0, 1000).map(m => {
      const t = Store.trainees.get(m.tz);
      return `<tr class="cursor-pointer" data-act="openProfile" data-tz="${E(m.tz)}"><td class="font-medium whitespace-nowrap">${E(t.name)}</td><td>${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)}</td>
        <td>${E(m.subject)}</td><td>${E(m.teacher)}</td><td>${E(m.eventName)} (${m.weight})</td><td>${E(m.date || '—')}</td><td><span class="badge tier-3">${KIND[m.kind]}</span></td></tr>`;
    }).join('');
    this.openModal(`
      <div class="flex items-center justify-between mb-2"><h3 class="text-lg font-semibold">אירועי הערכה שהוחמצו (${res.missed.length})</h3><button type="button" class="btn btn-ghost" data-act="closeModal">סגירה</button></div>
      <p class="text-xs text-slate-400 mb-3">חניכים עם ציון חסר או 0 באירוע שרוב חברי הקבוצה שלהם קיבלו בו ציון.</p>
      <div class="tbl-wrap" style="max-height:480px"><table class="grid"><thead><tr><th>חניך</th><th>כיתה</th><th>מקצוע</th><th>מורה</th><th>אירוע (משקל)</th><th>תאריך</th><th>ממצא</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="text-center text-emerald-600 py-6">לא זוהו אירועים שהוחמצו 🎉</td></tr>'}</tbody></table></div>`, true);
  },

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

  NAV_LABELS: { overview: 'חדר בקרה', bagrut: 'צפי זכאות לבגרות', groups: 'בקרת קבוצות', sadin: 'סדין ציונים', settings: 'הגדרות ומצבת' },

  /* ==================================================================
     פאנל 5 – הגדרות ומצבת חניכים
     ================================================================== */
  /** תתי-לשוניות ההגדרות: מציג חלונית אחת ומעדכן את מוני התגיות (דריסות שיוך, שאלונים שטרם שויכו) */
  renderSettingsNav() {
    const view = ['roster', 'overrides', 'rules', 'system'].includes(this.state.settingsView) ? this.state.settingsView : 'roster';
    this.state.settingsView = view;
    document.querySelectorAll('[data-settings-pane]').forEach(p => { p.hidden = p.dataset.settingsPane !== view; });
    document.querySelectorAll('#settingsTabs [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    const badge = (id, n, title) => { const el = $(id); if (el) { el.classList.toggle('hidden', !n); el.textContent = n; el.title = title; } };
    const overrides = Object.keys(Config.getRosterOverrides()).length;
    badge('setBadgeOverrides', overrides, `${overrides} דריסות שיוך פעילות`);
    const unmapped = this.unrecognizedCodes().length;
    badge('setBadgeRules', unmapped, `${unmapped} שאלונים שטרם שויכו`);
  },

  renderSettingsPanel() {
    this.renderFreshnessBar('roster');
    const roster = Config.getRoster();
    let html;
    if (!roster.length) {
      html = '<div class="text-slate-500">טרם נטענה מצבת. אפשר לטעון קובץ אקסל.</div>';
    } else {
      const byClass = new Map();
      roster.forEach(r => byClass.set(r.homeroom, (byClass.get(r.homeroom) || 0) + 1));
      const classes = [...byClass.keys()].sort((a, b) => Util.ord(Util.parseClass('', a).gradeKey) - Util.ord(Util.parseClass('', b).gradeKey) || natural(a, b));
      const rep = this.rosterReport;
      html = `<div class="font-medium mb-1">${roster.length} חניכים פעילים · ${classes.length} כיתות אם</div>
        <div class="flex flex-wrap gap-1 mb-2">${classes.map(c => `<button type="button" class="class-pill" data-act="classRoster" data-class="${E(c)}" title="הצגת חניכי הכיתה ושיוך מהיר" aria-haspopup="dialog">${E(Config.classLabel(c))}: ${byClass.get(c)}</button>`).join('')}</div>
        ${rep ? `<div class="text-xs text-slate-500">נקלטו ${rep.sheets.length} גיליונות${rep.skipped ? ` · ${rep.skipped} שורות דולגו` : ''}${rep.duplicates ? ` · ${rep.duplicates} כפילויות אוחדו` : ''}${rep.ignored ? ` · ${rep.ignored} חניכי ז'-ט' לא נקלטו` : ''}</div>
          ${rep.warnings.map(w => `<div class="text-xs text-amber-700 mt-1">${E(w)}</div>`).join('')}` : ''}
        <div class="flex gap-2 mt-3"><button type="button" class="btn btn-danger btn-sm" data-act="deleteRoster">מחיקת המצבת</button></div>`;
    }
    setHtml('rosterSummary', html);

    const rawRows = Config.getRosterEntry() ? Config.getRosterEntry().data : [];
    const counts = new Map();
    rawRows.forEach(r => counts.set(r.homeroom, (counts.get(r.homeroom) || 0) + 1));
    const classes = [...counts.keys()].sort((a, b) => Util.ord(Util.parseClass('', a).gradeKey) - Util.ord(Util.parseClass('', b).gradeKey) || natural(a, b));
    const classRow = c => `
      <label class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 p-2 text-sm cursor-pointer">
        <span><strong>${E(Config.classLabel(c))}</strong> <span class="text-xs text-slate-600">(${counts.get(c)} חניכים)</span></span>
        <span class="flex items-center gap-1 text-xs font-bold whitespace-nowrap">
          <input type="checkbox" class="w-4 h-4" data-chg="specialEd" data-class="${E(c)}" ${Config.isSpecialEdClass(c) ? 'checked' : ''}>כיתת חנ"מ</span>
      </label>`;
    setHtml('nicknames', classes.length
      ? classes.map(classRow).join('')
      : '<div class="text-sm text-slate-400 md:col-span-3">הכיתות יוצגו לאחר טעינת המצבת.</div>');
    setText('configSummary', `${Object.keys(Config.data.traineeExceptions).length} רשומות חריג/מסלול שמורות · ${Object.keys(Config.getRosterOverrides()).length} דריסות שיוך`);
    this.renderRosterOverrides();
    this.renderDataTools();
    this.renderCloudCard();
    this.renderCalibration();
    this.renderRulesDrawer();
    this.renderSettingsNav();
  },

  /* ---------- דריסת שיוך שכבה וכיתת אם ---------- */
  rawLabel(r) { return r.added ? '— (לא במצבת)' : `${r.rawHomeroom}${r.rawClassName ? ` • ${r.rawClassName}` : ''}`; },
  effLabel(r) { return `${r.homeroom}${r.className ? ` • ${r.className}` : ''}`; },

  /** כל החניכים שאפשר לדרוס: המצבת (כולל מוסתרים) + ת.ז מקובצי המשוב שאינן במצבת */
  ovCandidates() {
    const out = Config.getRosterAll().map(r => ({ tz: r.tz, name: `${r.firstName} ${r.lastName}`.trim() || r.tz, rec: r }));
    const known = new Set(out.map(c => c.tz));
    GroupAnalyzer.unmatchedIds().forEach(u => { if (!known.has(u.tz)) out.push({ tz: u.tz, name: u.name || u.tz, rec: null }); });
    return out;
  },

  ovSearchResults() {
    const input = $('overrideTraineeSearch'), results = $('ovResults');
    const q = this.ovTz ? '' : Util.norm(input.value).toLocaleLowerCase();
    const matches = (this._ovCands || []).filter(c => Util.norm(c.name).toLocaleLowerCase().includes(q) || c.tz.toLocaleLowerCase().includes(q));
    results.innerHTML = matches.map(c => `<button type="button" class="block w-full text-right px-3 py-2 border-b border-slate-100 hover:bg-indigo-50 focus:bg-indigo-50" data-act="ovPick" data-tz="${E(c.tz)}">
      <span class="font-bold">${E(c.name)}</span> <span class="font-mono text-xs">${E(c.tz)}</span>
      <span class="block text-xs text-slate-700">כיתה נוכחית במצבת: ${E(c.rec ? this.effLabel(c.rec) : 'לא במצבת')}${c.rec && c.rec.hidden ? ' · מוסתר' : ''}</span></button>`).join('') ||
      '<div class="p-3 text-sm text-slate-700">לא נמצא חניך מתאים</div>';
    results.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  },

  ovCloseResults() {
    $('ovResults').classList.add('hidden');
    $('overrideTraineeSearch').setAttribute('aria-expanded', 'false');
  },

  ovSetHomeroom(value) {
    const select = $('ovHomeroom'), other = $('ovOtherHomeroom');
    const known = [...select.options].some(o => o.value === value && value !== 'other');
    select.value = known ? value : 'other';
    other.value = known ? '' : value;
    other.classList.toggle('hidden', select.value !== 'other');
  },

  ovSyncGrade(value) {
    const grade = Util.parseClass('', value).gradeKey;
    if (Util.GRADE_KEYS.includes(grade)) setVal('ovGrade', grade);
  },

  ovSyncDefaultTrack(home) {
    const c = (this._ovCands || []).find(x => x.tz === this.ovTz);
    const o = Config.getRosterOverrides()[this.ovTz];
    if (!c || !c.rec || this.ovTrackEdited || (o && o.track)) return;
    const base = c.rec.rawTrack || c.rec.track;
    setVal('ovTrack', Config.defaultTrack(base, home || c.rec.rawHomeroom || c.rec.homeroom));
  },

  renderRosterOverrides() {
    if (!$('ovTable')) return;
    this._ovCands = this.ovCandidates();
    const entry = Config.getRosterEntry();
    const classes = [...new Set((entry ? entry.data : []).map(r => r.homeroom))].sort(natural);
    setHtml('ovHomeroom', '<option value="">ללא שינוי</option>' + Util.GRADE_KEYS.map(g => {
      const rooms = classes.filter(c => Util.parseClass('', c).gradeKey === g);
      return rooms.length ? `<optgroup label="שכבה ${E(Util.gl(g))}">${rooms.map(c => `<option value="${E(c)}">${E(Config.classLabel(c))}</option>`).join('')}</optgroup>` : '';
    }).join('') + '<option value="other">אחר (הקלד כיתה חדשה)...</option>');
    const track = $('ovTrack');
    if (track && track.options.length < 2) track.innerHTML += Config.TRACKS.map(t => `<option value="${E(t)}">${E(t)}</option>`).join('');

    const byTz = new Map(Config.getRosterAll().map(r => [r.tz, r]));
    const ovs = Object.values(Config.getRosterOverrides()).sort((a, b) => b.updatedAt - a.updatedAt);
    setText('ovCount', `(${ovs.length})`);
    setText('ovClearAll', `🧹 בטל את כל הדריסות (${ovs.length})`);
    $('ovClearAll').disabled = !ovs.length;
    const rows = ovs.map(o => {
      const r = byTz.get(o.tz);
      const name = r ? `${r.firstName} ${r.lastName}`.trim() : (o.name || o.tz);
      const eff = o.homeroom && r ? this.effLabel(r) : (o.homeroom || 'ללא שינוי');
      const status = [o.hidden ? '🚫 עזב / לא פעיל' : '', o.track ? `מסלול: ${o.track}` : '', o.note].filter(Boolean).map(E).join(' · ') || '—';
      return `<tr class="${o.hidden ? 'opacity-60' : ''}"><td class="tz-col text-right">${E(o.tz)}</td><td class="text-right font-medium">${E(name)}</td>
        <td class="text-right whitespace-nowrap">${E(r ? this.rawLabel(r) : '— (לא במצבת)')}</td><td class="text-right whitespace-nowrap">${E(eff)}</td>
        <td class="text-right">${status}</td>
        <td class="text-right"><button type="button" class="btn btn-ghost btn-sm" data-act="ovRemove" data-tz="${E(o.tz)}">בטל דריסה</button></td></tr>`;
    }).join('');
    setHtml('ovTable', `<table class="grid w-full"><thead><tr><th class="tz-col text-right">ת.ז</th><th class="text-right">שם חניך</th><th class="text-right">שיוך מקורי בקובץ</th><th class="text-right">שיוך דורס פעיל</th><th class="text-right">סטטוס / מסלול</th><th class="text-right">פעולה</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="text-center text-slate-400 py-6">אין דריסות פעילות</td></tr>'}</tbody></table>`);
    this.ovSelect(this.ovTz);
  },

  /** בחירת חניך בטופס: מציג את השיוך המקורי ומטעין דריסה קיימת */
  ovSelect(tz) {
    const search = $('overrideTraineeSearch');
    if (!search) return;
    const c = (this._ovCands || []).find(x => x.tz === tz);
    this.ovTz = c ? tz : '';
    const info = $('ovInfo'), nameWrap = $('ovNameWrap');
    ['rounded-lg', 'border', 'border-indigo-300', 'bg-indigo-50', 'text-indigo-900', 'px-3', 'py-2', 'font-semibold'].forEach(cls => info.classList.toggle(cls, !!c));
    if (nameWrap) nameWrap.classList.add('hidden');
    if (!c) {
      info.textContent = 'בחרו חניך כדי לראות את השיוך המקורי בקובץ.';
      ['ovGrade', 'ovHomeroom', 'ovOtherHomeroom', 'ovTrack', 'ovNote', 'ovName'].forEach(id => setVal(id, ''));
      $('ovOtherHomeroom').classList.add('hidden');
      setChecked('ovHidden', false);
      return;
    }
    const o = Config.getRosterOverrides()[tz];
    this.ovTrackEdited = false;
    search.value = `${c.name} • ${c.tz}`;
    if (c && c.rec && !c.rec.added) {
      info.textContent = `נבחר: ${c.name} (מקור בקובץ: ${this.rawLabel(c.rec)})${o && o.hidden ? ' · מוסתר כרגע' : ''}`;
    } else {
      info.textContent = `נבחר: ${c.name} (מקור בקובץ: לא במצבת) – יש להזין שכבה וכיתת אם כדי להוסיף אותו.`;
      if (nameWrap) nameWrap.classList.remove('hidden');
      setVal('ovName', (o && o.name) || (c && c.name) || '');
    }
    setVal('ovGrade', c.rec ? c.rec.grade : '');
    this.ovSetHomeroom(c.rec ? c.rec.homeroom : '');
    setVal('ovTrack', c.rec ? ((o && o.track) || Config.defaultTrack(c.rec.rawTrack || c.rec.track, c.rec.homeroom)) : '');
    setChecked('ovHidden', o && o.hidden);
    setVal('ovNote', (o && o.note) || '');
  },

  /** חלון שיוך מהיר: חניכי כיתת אם אחת, עם שינוי כיתה / מסלול מיידי */
  openClassRoster(classKey) {
    const members = Config.getRoster().filter(r => r.homeroom === classKey)
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'he'));
    const prev = document.querySelector('#modal-root [data-act="modalBackdrop"]');
    const scroll = prev ? prev.scrollTop : 0;
    if (!members.length) return this.closeModal();
    const classes = [...new Set(Config.getRoster().map(r => r.homeroom))].sort(natural);
    const homeOptions = current => Util.GRADE_KEYS.map(g => {
      const rooms = classes.filter(c => Util.parseClass('', c).gradeKey === g);
      return rooms.length ? `<optgroup label="שכבה ${E(Util.gl(g))}">${rooms.map(c => `<option value="${E(c)}" ${c === current ? 'selected' : ''}>${E(Config.classLabel(c))}</option>`).join('')}</optgroup>` : '';
    }).join('') + '<option value="other">אחר (הקלד כיתה חדשה)...</option>';
    const rows = members.map(r => {
      const name = `${r.firstName} ${r.lastName}`.trim() || r.tz;
      const track = Config.trackFor(r.tz, r.track, r.homeroom);
      return `<tr><td class="tz-col">${E(r.tz)}</td><td class="font-medium">${E(name)}${this.overrideBadge(r.tz)}</td>
        <td><select class="flat-sel" data-chg="classTrack" data-tz="${E(r.tz)}" data-class="${E(classKey)}" aria-label="${E(`מסלול של ${name}`)}">${Config.TRACKS.map(t => `<option value="${E(t)}" ${t === track ? 'selected' : ''}>${E(t)}</option>`).join('')}</select></td>
        <td><select class="flat-sel" data-chg="classMove" data-tz="${E(r.tz)}" data-class="${E(classKey)}" aria-label="${E(`כיתת אם של ${name}`)}">${homeOptions(r.homeroom)}</select></td></tr>`;
    }).join('');
    this.openModal(`
      <div class="flex items-center justify-between gap-2 mb-1"><h3 class="text-lg font-semibold">כיתה <bdi dir="rtl">${E(Config.classLabel(classKey))}</bdi> · ${members.length} חניכים</h3>
        <button type="button" class="btn btn-sm bg-slate-100 text-slate-800 hover:bg-indigo-100" data-act="closeModal">סגירה</button></div>
      <p class="text-xs text-slate-500 mb-3">שינוי כיתה או מסלול נשמר מיד כדריסה (קובץ המצבת אינו משתנה)       וניתן לביטול בטבלת הדריסות.</p>
      <div class="max-h-[60vh] overflow-auto rounded-lg"><table class="grid flat-tbl w-full"><thead><tr><th class="tz-col">ת.ז</th><th>שם חניך</th><th>מסלול</th><th>כיתת אם</th></tr></thead><tbody>${rows}</tbody></table></div>`, true);
    const dialog = document.querySelector('#modal-root [role="dialog"]');
    if (dialog) dialog.classList.add('flat-modal');
    const backdrop = document.querySelector('#modal-root [data-act="modalBackdrop"]');
    if (backdrop) backdrop.scrollTop = scroll;
  },

  /** שמירת שינוי שיוך מהחלון המהיר ורענון הרשימה (חניך שעבר כיתה נעלם מהרשימה) */
  classRosterApply(tz, classKey, patch, message) {
    const res = Config.setRosterOverride(tz, patch);
    if (res.ok === false) this.toast(res.error || 'שמירת השינוי נכשלה', 'error');
    else { this.toast(message, 'ok'); this.afterDataChange(); }
    this.openClassRoster(classKey);
  },

  /* ==================================================================
     אירועים
     ================================================================== */
  bindEvents() {
    /* תפיסה בשלב ה-capture: האפליקציה שולטת בטאבים, בהעלאה ובמגירה ואינה תלויה בסקריפט מעטפת */
    document.addEventListener('click', e => {
      if (e.target.closest('[data-go-overrides]')) {
        e.stopPropagation();
        this.state.settingsView = 'overrides';
        this.showTab('settings');
        this.renderSettingsNav();
        const section = $('ovTableSection');
        if (section) { section.scrollIntoView({ block: 'start' }); section.focus({ preventScroll: true }); }
        return;
      }
      const tab = e.target.closest('[data-tab]');
      if (tab) { e.stopPropagation(); this.showTab(tab.dataset.tab); return; }
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
    window.addEventListener('sd:rules-changed', () => this.schedule(() => this.invalidateAll()));
    window.addEventListener('resize', () => { this.syncGroupsHeadHeight(); this.fitTables(); });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => this.fitTables());
      ['globalFilterBar', 'brandBanner'].forEach(id => { const el = $(id); if (el) ro.observe(el); });
    }
    window.addEventListener('sd:exceptions-changed', () => this.schedule(() => this.invalidateAll()));
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
      this.showSuggestions();
      if (live) this._searchTimer = setTimeout(() => this.renderTab(st.tab), 180);
      else if (hadLock) this.renderTab(st.tab);
    });
    on('globalSearch', 'focus', () => this.showSuggestions());
    on('globalSearch', 'keydown', e => {
      const open = !$('searchSuggestPopup').classList.contains('hidden');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (open) this.moveSuggestion(e.key === 'ArrowDown' ? 1 : -1); else this.showSuggestions();
      } else if (e.key === 'Enter' && open) {
        const idx = this._sg.active >= 0 ? this._sg.active : (this.LIVE_SEARCH_TABS.includes(this.state.tab) ? -1 : 0);
        if (this._sg.items[idx]) { e.preventDefault(); this.pickSuggestion(idx); }
      } else if (e.key === 'Escape' && open) { e.stopPropagation(); this.hideSuggestions(); }
    });
    on('searchSuggestPopup', 'mousedown', e => e.preventDefault());
    document.addEventListener('click', e => { if (!e.target.closest('#searchWrap')) this.hideSuggestions(); });
    on('fClear', 'click', () => this.resetFilters());
    on('bagrutSubjectDrillSelect', 'change', e => {
      this.state.bagrut.drill = e.target.value;
      this.state.bagrut.readinessClass = '';
      this.state.bagrut.readinessFilter = 'all';
      this.dirty.add('bagrut'); this.renderTab('bagrut');
    });
    on('sadinFilterSelect', 'change', e => {
      this.state.sadin.strip = e.target.value;
      this.dirty.add('sadin'); this.renderTab('sadin');
    });

    /* מגירת הכללים: שדות קבועים */
    const num = (id, fn) => on(id, 'change', e => (e.target.value === '' ? this.renderRulesDrawer() : this.applyRule(fn(Number(e.target.value)))));
    on('ruleCompEnabled', 'change', e => this.applyRule(Config.setCompensation({ enabled: e.target.checked })));
    on('ruleCompPoints', 'change', e => this.applyRule(Config.setCompensation({ pointsEnabled: e.target.checked })));
    num('ruleCompMin', v => Config.setCompensation({ min: v }));
    num('ruleCompMax', v => Config.setCompensation({ max: v }));
    num('ruleCompCount', v => Config.setCompensation({ maxCount: v }));
    on('ruleCompExcluded', 'change', e => this.applyRule(Config.setCompensation({ excludedSubjects: e.target.value.split(',') })));
    num('ruleParamPass', v => Config.setRuleParam('passGrade', v));
    num('ruleParamBorderline', v => Config.setRuleParam('borderlineMin', v));
    num('ruleParamBonus', v => Config.setRuleParam('borderlineBonus', v));
    num('ruleParamMagen', v => {
      const res = Config.setRuleParam('magenWeight', v);
      Store.refresh();
      SignalEngine.invalidate();
      return res;
    });
    on('rulesReset', 'click', () => {
      if (!confirm(`לשחזר את כללי הזכאות והמשקלים של ${this.cohortName(Config.getActiveCohortId())} לברירת המחדל?`)) return;
      const res = Config.resetRules();
      Store.refresh();
      SignalEngine.invalidate();
      this.applyRule(res);
    });

    /* קבוצות */
    /* מקצוע ומורה מתואמים: בחירת מקצוע מאפסת מורה שאינו מלמד אותו; בחירת מורה מציגה את כל קבוצותיו בכל המקצועות */
    on('groupSubjectSelect', 'change', e => {
      const st = this.state.groups, key = e.target.value;
      st.subjectKey = key;
      st.strip = 'all';
      st.missingSelected = false;
      if (key !== 'all' && st.teacher !== 'all' && !GroupAnalyzer.explorerModel().groups.some(g => g.teacher === st.teacher && g.cat.key === key)) st.teacher = 'all';
      this.groupsRerender();
    });
    on('groupTeacherSelect', 'change', e => {
      const st = this.state.groups;
      st.teacher = e.target.value;
      if (st.teacher !== 'all') { st.subjectKey = 'all'; st.strip = 'all'; st.missingSelected = false; }
      this.groupsRerender();
    });
    /* ציונים שוטפים */
    const compatible = (subject, teacher) => Store.traineeList().some(t => Store.currentOf(t.tz).some(e =>
      GroupAnalyzer.sadinSubject(e.subject) === subject && ((Store.groups.get(e.groupId) || {}).teacher || e.teacher) === teacher));
    on('sadinSubjectSelect', 'change', e => {
      const st = this.state.sadin;
      st.subject = e.target.value;
      if (st.subject !== 'all' && st.teacher !== 'all' && !compatible(st.subject, st.teacher)) st.teacher = 'all';
      this.dirty.add('sadin'); this.renderTab('sadin');
    });
    on('sadinTeacherSelect', 'change', e => {
      const st = this.state.sadin;
      st.teacher = e.target.value;
      if (st.teacher !== 'all' && st.subject !== 'all' && !compatible(st.subject, st.teacher)) st.subject = 'all';
      this.dirty.add('sadin'); this.renderTab('sadin');
    });

    /* כרטיס חניך */
    on('profSelect', 'change', e => this.setProfile(e.target.value));
    on('excTrack', 'change', e => this.saveProfileField({ trackOverride: e.target.value }));
    on('excNote', 'change', e => this.saveProfileField({ note: e.target.value.trim() }));

    /* הגדרות */
    on('overrideTraineeSearch', 'focus', () => this.ovSearchResults());
    on('overrideTraineeSearch', 'input', () => { this.ovSelect(''); this.ovSearchResults(); });
    on('overrideTraineeSearch', 'keydown', e => {
      if (e.key === 'ArrowDown') {
        const first = $('ovResults').querySelector('button');
        if (first) { e.preventDefault(); first.focus(); }
      } else if (e.key === 'Enter' && !$('ovResults').classList.contains('hidden')) {
        const first = $('ovResults').querySelector('button');
        e.preventDefault();
        if (first) first.click();
      } else if (e.key === 'Escape') this.ovCloseResults();
    });
    on('ovSearchWrap', 'focusout', e => {
      if (!e.currentTarget.contains(e.relatedTarget)) this.ovCloseResults();
    });
    on('ovResults', 'keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        $('overrideTraineeSearch').focus();
        this.ovCloseResults();
      }
    });
    on('ovHomeroom', 'change', e => {
      $('ovOtherHomeroom').classList.toggle('hidden', e.target.value !== 'other');
      if (e.target.value === '') setVal('ovGrade', '');
      else if (e.target.value === 'other') this.ovSyncGrade($('ovOtherHomeroom').value);
      else this.ovSyncGrade(e.target.value);
      this.ovSyncDefaultTrack(e.target.value === 'other' ? $('ovOtherHomeroom').value : e.target.value);
    });
    on('ovOtherHomeroom', 'input', e => { this.ovSyncGrade(e.target.value); this.ovSyncDefaultTrack(e.target.value); });
    on('ovTrack', 'change', () => { this.ovTrackEdited = true; });
    on('ovForm', 'submit', e => { e.preventDefault(); this.acts.ovSave.call(this); });
    on('btnClearData', 'click', async () => {
      if (!confirm('למחוק את קובצי הבגרות, הקבוצות והציונים השוטפים? המצבת וההגדרות יישמרו.')) return;
      try {
        await Config.clearAllData();
        this.afterDataChange();
        this.toast('קובצי המשנה נוקו', 'ok');
      } catch (err) {
        this.afterDataChange();
        this.toast(`מחיקת הנתונים נכשלה: ${err.message}`, 'error');
      }
    });
    on('btnResetConfig', 'click', () => {
      if (!confirm('האיפוס ימחק את כל כללי הזכאות, החריגים, הכינויים, פרופילי המיפוי ודריסות שיוך (rosterOverrides). המצבת תישאר. המחיקות יסונכרנו גם לענן אם הוגדר וישפיעו על כל הצוות. להמשיך?')) return;
      Config.reset({ silent: true });
      this.afterDataChange();
      this.toast('ההגדרות אופסו', 'ok');
    });

    /* Esc בכרטיס חניך (כשאין חלון פתוח ולא מקלידים בשדה) חוזר למסך המקור; נבדק בשלב ה-capture לפני שחלונות נסגרים */
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const mapping = $('mappingModal');
      const modalOpen = !!($('modal-root') && $('modal-root').children.length) || !!(mapping && !mapping.classList.contains('hidden'));
      const active = document.activeElement;
      const typing = !!active && (/^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName) || active.isContentEditable);
      this.closeModal(); this.hideMxPop(); this.hideSadinPop();
      if (this.state.tab === 'profile' && this.state.navOrigin && !modalOpen && !typing) this.profBack();
    }, true);
    window.addEventListener('popstate', () => { if (this.state.tab === 'profile' && this.state.navOrigin) this.returnToOrigin(); });
    /* חלון הפירוט של גיליון השליטה: ריחוף / מיקוד מקלדת זמניים, לחיצה מקבעת */
    const mxEl = e => e.target.closest && e.target.closest('[data-act="mxPop"]');
    document.addEventListener('mouseover', e => { const el = mxEl(e); if (el && !this._mxPinned) this.showMxPop(el, false); });
    document.addEventListener('mouseout', e => { if (mxEl(e) && !this._mxPinned) this.hideMxPop(); });
    document.addEventListener('focusin', e => { const el = mxEl(e); if (el && !this._mxPinned) this.showMxPop(el, false); });
    document.addEventListener('focusout', e => { if (mxEl(e) && !this._mxPinned) this.hideMxPop(); });
    document.addEventListener('click', e => { if (!mxEl(e)) this.hideMxPop(); });
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
  afterClassSettingChange() {
    this.syncFilters();
    this.evals.clear();
    ['overview', 'bagrut', 'groups', 'sadin', 'profile', 'settings'].forEach(t => this.dirty.add(t));
    this.renderChrome();
    this.renderTab(this.state.tab);
  },

  /* ==================================================================
     סנכרון ענן
     ================================================================== */
  renderSync() {
    const el = $('syncStatus');
    if (!el) return;
    const s = CloudSync.status, url = CloudSync.url();
    const conflict = $('cloudConflict');
    if (conflict) conflict.hidden = s.kind !== 'conflict';
    let t;
    if (!url) t = '💾 נתונים מקומיים (ללא סנכרון ענן)';
    else if (s.text) t = s.text;
    else if (CloudSync.hasUnpublished()) t = '☁️ מסנכרן...';
    else t = (s.updatedAt || CloudSync.meta().syncedAt) ? '☁️ מסונכרן' : '☁️ טרם סונכרן';
    el.textContent = t;
    el.title = s.kind === 'error' ? s.error || t : '';
    setText('ovSyncPill', t);
  },

  renderCloudCard() {
    const body = $('cloudBody');
    if (!body) return;
    body.innerHTML = `
      <p class="text-xs text-slate-500">הסנכרון דורש כתובת, אסימון API וקוד בית-ספר להצפנה. יש להשתמש באותם פרטים בכל מחשבי הצוות. גרסאות שרת מונעות דריסה אוטומטית של שינויים מתנגשים.</p>
      <p class="text-xs text-amber-700">אסימון וקישור הצטרפות מעניקים גישה לנתוני בית הספר. שתפו רק בערוץ פרטי עם אנשי צוות מורשים. הפרטים נשמרים בדפדפן זה.</p>
      <div class="grid md:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1">כתובת Web App של Google Apps Script
          <input id="cloudUrl" class="inp" dir="ltr" placeholder="https://script.google.com/macros/s/…/exec" value="${E(CloudSync.url())}"></label>
        <label class="flex flex-col gap-1">אסימון API (כמו API_TOKEN בשרת)
          <input id="cloudToken" type="password" class="inp" dir="ltr" autocomplete="off" value="${E(CloudSync.apiToken())}"></label>
        <label class="flex flex-col gap-1">קוד בית-ספר (חובה להצפנה בענן)
          <input id="cloudPass" type="password" class="inp" autocomplete="off" value="${E(CloudSync.passcode())}"></label>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary btn-sm" data-act="cloudSave">שמירת הגדרות</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="cloudPull">⬇️ משיכה מהענן</button>
        <button type="button" class="btn btn-primary btn-sm" data-act="cloudSync">☁️ סנכרן לענן כעת</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="cloudJoinLink">העתקת קישור הצטרפות לצוות</button>
      </div>`;
  },

  /** מחילה תמונת מצב חדשה על כל התצוגות */
  async cloudRefresh(fn) {
    try {
      const r = await fn();
      this.rosterReport = null;
      if (r === 'applied') this.afterDataChange();
      this.renderSync();
      this.renderCloudCard();
      return r;
    } catch (e) { this.renderSync(); this.toast(e.message || 'הפעולה נכשלה', 'error'); return null; }
  },

  /* ==================================================================
     כיול סמלי שאלונים
     ================================================================== */
  CALIB_ORDER: ['עברית', 'היסטוריה', 'אזרחות', 'תנ"ך', 'ספרות', 'אנגלית', 'מתמטיקה'],

  calibModel() {
    const r = Config.rules(), cat = r.questionnaires || {}, rows = [];
    const ordOf = name => { const i = this.CALIB_ORDER.findIndex(n => Util.norm(name).includes(Util.norm(n))); return i < 0 ? 50 : i; };
    const nameOf = code => (cat[code] && cat[code].name) || '';
    const subjects = [...r.coreSubjects].sort((a, b) => ordOf(a.name) - ordOf(b.name));
    subjects.forEach(s => {
      const lists = s.variableUnits ? Object.entries(s.levels || {}).sort((a, b) => a[0] - b[0]).map(([l, comps]) => [l, comps]) : [['', s.components || []]];
      lists.forEach(([level, comps]) => {
        const group = `${s.name}${s.variableUnits ? ` ${level} יח'` : ` (${s.units || 2} יח')`}`;
        comps.forEach((c, ci) => {
          const internal = BagrutEngine.isInternalComp(c, comps);
          (c.codes || []).forEach((code, k) => rows.push({
            code: String(code), name: nameOf(code) || c.label || '', group, order: ordOf(s.name),
            kind: internal ? `הערכה פנימית ${Number(c.weight) || 0}%` : 'בחינה חיצונית', weight: Number(c.weight) || 0,
            sub: k > 0 ? String(c.codes[0]) : '', off: c.enabled === false || s.enabled === false,
            loc: { t: 'core', id: s.id, level, ci }, targetKey: `core:${s.id}:${level}`, internal
          }));
        });
      });
    });
    r.majors.forEach(m => m.codes.forEach(code => rows.push({
      code: String(code), name: nameOf(code) || m.name, group: 'מגמות 5 יח\'', order: 60, kind: 'בחינה חיצונית',
      weight: m.weights && m.weights[code] != null ? Number(m.weights[code]) : null, sub: '', off: m.enabled === false,
      loc: { t: 'major', id: m.id }, targetKey: `major:${m.id}`
    })));
    r.internals.forEach(i => i.codes.forEach(code => rows.push({
      code: String(code), name: nameOf(code) || i.name, group: 'יחידות פנימיות', order: 70, kind: 'הערכה פנימית', weight: null, sub: '', off: i.enabled === false,
      loc: { t: 'internal', id: i.id }, targetKey: `internal:${i.id}`
    })));
    ((r.exceptionDetection && r.exceptionDetection.immigrantCodes) || []).forEach(code => rows.push({
      code: String(code), name: nameOf(code) || 'שאלון עולים / מותאם', group: 'שאלוני עולים / מותאם', order: 80, kind: 'בחינה חיצונית', weight: null,
      sub: 'שאלון רגיל', off: false, loc: { t: 'immigrant' }, targetKey: 'immigrant'
    }));
    return rows;
  },

  /** קודי שאלון בקובץ הבגרויות שאינם משויכים לשום מקצוע / מגמה / יחידה / שאלון עולים */
  unrecognizedCodes(rows = this.calibModel()) {
    const known = new Set(rows.map(r => r.code));
    const found = new Map();
    Config.getRows('bagrutData').forEach(r => {
      const code = String(r.code ?? '').trim();
      if (!code || code === 'פנימי' || known.has(code)) return;
      const f = found.get(code) || { code, count: 0, subject: '' };
      f.count++; if (!f.subject && r.subject) f.subject = String(r.subject);
      found.set(code, f);
    });
    return [...found.values()].sort((a, b) => b.count - a.count);
  },

  renderCalibration() {
    const host = $('qCalib');
    if (!host) return;
    const rows = this.calibModel();
    this._calibRows = rows;
    const unk = this.unrecognizedCodes(rows);
    this._calibUnk = unk;
    const banner = unk.length ? `<div class="rounded-lg border border-amber-400 bg-amber-50 p-3" role="alert">
      <div class="font-semibold text-amber-900">זוהו ${unk.length} שאלונים בקובץ הבגרויות שטרם שויכו למקצוע</div>
      <div class="flex flex-wrap gap-2 mt-2">${unk.map((u, i) => `<span class="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-1 text-xs">
        <span class="font-mono font-bold">${E(u.code)}</span><span class="text-slate-500">${E(u.subject)} · ${u.count} רשומות</span>
        <button type="button" class="btn btn-primary btn-sm" data-act="calibAssign" data-i="${i}">+ שייך כעת</button></span>`).join('')}</div></div>` : '';
    setHtml('qUnmapped', banner);
    let last = null;
    const body = rows.map((r, i) => {
      const head = r.group !== last ? `<tr class="bg-slate-100"><td colspan="7" class="font-bold text-slate-700 py-1">${E(r.group)}</td></tr>` : '';
      last = r.group;
      return `${head}<tr class="${r.off ? 'opacity-50' : ''}">
        <td class="font-mono font-bold">${E(r.code)}</td><td>${E(r.name || '—')}</td><td>${E(r.group)}</td><td>${E(r.kind)}</td>
        <td>${r.weight == null ? '—' : `${r.weight}%`}</td><td>${r.sub ? `<span class="badge fresh-slate border">תחליף ל-${E(r.sub)}</span>` : '—'}</td>
        <td class="whitespace-nowrap"><button type="button" class="btn btn-ghost btn-sm" data-act="calibEdit" data-i="${i}" title="עריכה">✏️</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="calibDelete" data-i="${i}" title="מחיקה">🗑️</button></td></tr>`;
    }).join('');
    host.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2"><p class="text-xs text-slate-500">שינוי נשמר מיד, מחשב מחדש את זכאות הבגרות ומסומן לפרסום לצוות.</p>
        <button type="button" class="btn btn-primary btn-sm" data-act="calibAdd">+ הוספת סמל שאלון</button></div>
      <div class="tbl-wrap" style="max-height:480px"><table class="w-full text-sm">
        <thead><tr><th>סמל שאלון</th><th>שם שאלון</th><th>מקצוע ורמה</th><th>רכיב</th><th>משקל (%)</th><th>תחליף לשאלון (עולים/מותאם)</th><th>פעולות</th></tr></thead>
        <tbody>${body}</tbody></table></div>`;
  },

  /** טופס הוספה / עריכה. row = שורה קיימת לעריכה, preset = ערכים התחלתיים להוספה */
  openCalibModal(row, preset = {}) {
    const r = Config.rules();
    const targets = [];
    [...r.coreSubjects].forEach(s => {
      if (s.variableUnits) Object.keys(s.levels || {}).sort().forEach(l => targets.push({ v: `core:${s.id}:${l}`, l: `${s.name} ${l} יח'` }));
      else targets.push({ v: `core:${s.id}:`, l: `${s.name} (${s.units || 2} יח')` });
    });
    r.majors.forEach(m => targets.push({ v: `major:${m.id}`, l: `מגמה: ${m.name}` }));
    r.internals.forEach(i => targets.push({ v: `internal:${i.id}`, l: `יחידה פנימית: ${i.name}` }));
    targets.push({ v: 'immigrant', l: 'שאלון עולים / מותאם' });
    const subs = this.calibModel().filter(x => x.loc.t === 'core' && !x.sub);
    const cur = row ? { code: row.code, name: row.name, target: row.targetKey, weight: row.weight, internal: row.internal ? '1' : '', sub: row.sub ? `${row.loc.id}|${row.loc.level}|${row.loc.ci}` : '' }
      : { code: preset.code || '', name: preset.name || '', target: targets[0].v, weight: 100, internal: '', sub: '' };
    const sel = (key, opts, val) => `<select class="inp" data-f="${key}">${opts.map(o => `<option value="${E(o.v)}" ${o.v === val ? 'selected' : ''}>${E(o.l)}</option>`).join('')}</select>`;
    this.formCtx = { onSubmit: values => this.calibSave(values, row) };
    this.openModal(`
      <h3 class="text-lg font-semibold mb-3">${row ? `עריכת שאלון ${E(row.code)}` : 'הוספת סמל שאלון'}</h3>
      <div class="grid gap-3 text-sm">
        <label class="flex flex-col gap-1">סמל שאלון<input class="inp font-mono" data-f="code" value="${E(cur.code)}" ${row ? 'readonly' : ''}></label>
        <label class="flex flex-col gap-1">שם שאלון<input class="inp" data-f="name" value="${E(cur.name)}"></label>
        <label class="flex flex-col gap-1">מקצוע ורמה${sel('target', targets, cur.target)}</label>
        <label class="flex flex-col gap-1">תחליף לשאלון (עולים / מותאם) – אם נבחר, גובר על המקצוע שלמעלה${sel('sub', [{ v: '', l: '— שאלון עצמאי (לא תחליף) —' }, ...subs.map(s => ({ v: `${s.loc.id}|${s.loc.level}|${s.loc.ci}`, l: `${s.code} · ${s.group}` }))], cur.sub)}</label>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">משקל (%)<input class="inp" type="number" min="0" max="100" data-f="weight" value="${cur.weight ?? ''}"></label>
          <label class="flex flex-col gap-1">רכיב${sel('internal', [{ v: '', l: 'בחינה חיצונית' }, { v: '1', l: 'הערכה פנימית (בית-ספרי)' }], cur.internal)}</label>
        </div>
        <p class="text-xs text-slate-500">משקל ורכיב חלים על שאלונים בליבה; מגמות, יחידות פנימיות ושאלוני עולים נקבעים לפי הקבוצה.</p>
      </div>
      <div id="formErr" class="text-sm text-red-600 mt-2" role="alert"></div>
      <div class="flex gap-2 mt-4"><button type="button" class="btn btn-primary" data-act="formSubmit">שמירה</button><button type="button" class="btn btn-ghost" data-act="closeModal">ביטול</button></div>`);
  },

  calibDetach(r, code) {
    const strip = list => { for (let i = list.length - 1; i >= 0; i--) { list[i].codes = (list[i].codes || []).filter(c => String(c) !== code); if (!list[i].codes.length) list.splice(i, 1); } };
    r.coreSubjects.forEach(s => { if (s.variableUnits) Object.values(s.levels || {}).forEach(strip); else strip(s.components || (s.components = [])); });
    r.majors.forEach(m => { m.codes = m.codes.filter(c => String(c) !== code); if (m.weights) delete m.weights[code]; });
    r.internals.forEach(i => { i.codes = i.codes.filter(c => String(c) !== code); });
    if (r.exceptionDetection && r.exceptionDetection.immigrantCodes) r.exceptionDetection.immigrantCodes = r.exceptionDetection.immigrantCodes.filter(c => String(c) !== code);
  },

  calibSave(v, row) {
    const code = String(v.code || '').trim(), name = String(v.name || '').trim();
    if (!code) return { ok: false, error: 'יש להזין סמל שאלון' };
    if (!/^[\w\u0590-\u05FF-]+$/.test(code)) return { ok: false, error: 'סמל שאלון יכול להכיל אותיות, ספרות ומקף בלבד' };
    const weight = Number(v.weight);
    const isCore = v.target.startsWith('core:') || v.sub;
    if (isCore && !(weight >= 0 && weight <= 100)) return { ok: false, error: 'משקל חייב להיות בין 0 ל-100' };
    if (!row && this.calibModel().some(x => x.code === code)) return { ok: false, error: `הסמל ${code} כבר קיים בטבלה – ערכו אותו במקום להוסיף` };
    const res = Config.updateRules(r => {
      const sameSpot = row && row.targetKey === v.target && !!row.sub === !!v.sub;
      const findList = (id, level) => {
        const s = r.coreSubjects.find(x => x.id === id);
        if (!s) throw new Error('מקצוע לא נמצא');
        return s.variableUnits ? (s.levels[level] || (s.levels[level] = [])) : (s.components || (s.components = []));
      };
      if (sameSpot && row.loc.t === 'core') {
        const comp = findList(row.loc.id, row.loc.level)[row.loc.ci];
        if (comp) { comp.weight = weight; comp.internal = !!v.internal; }
      } else {
        if (row) this.calibDetach(r, row.code);
        if (v.sub) {
          const [id, level, ci] = v.sub.split('|');
          const comp = findList(id, level)[Number(ci)];
          if (!comp) throw new Error('השאלון הראשי לא נמצא');
          comp.codes.push(code);
        } else if (v.target.startsWith('core:')) {
          const [, id, level] = v.target.split(':');
          const comp = { enabled: true, codes: [code], weight };
          if (v.internal) comp.internal = true;
          findList(id, level).push(comp);
        } else if (v.target.startsWith('major:')) {
          const m = r.majors.find(x => x.id === v.target.slice(6));
          m.codes.push(code);
        } else if (v.target.startsWith('internal:')) {
          r.internals.find(x => x.id === v.target.slice(9)).codes.push(code);
        } else {
          r.exceptionDetection = r.exceptionDetection || {};
          r.exceptionDetection.immigrantCodes = [...(r.exceptionDetection.immigrantCodes || []), code];
        }
      }
      r.questionnaires = r.questionnaires || {};
      const old = r.questionnaires[code] || {};
      r.questionnaires[code] = { ...old, name: name || old.name || '', expectedGrade: old.expectedGrade || 'יב' };
    });
    if (res.ok === false) return res;
    this.afterRulesEdit(res);
    return { ok: true };
  },

  afterRulesEdit(res) {
    this.toast(res.warnings && res.warnings.length ? `נשמר. ${res.warnings[0]}` : 'השאלון נשמר והזכאות חושבה מחדש', res.warnings && res.warnings.length ? 'warn' : 'ok');
    this.dirty.add('settings');
    this.schedule(() => { this.renderCalibration(); });
  },

  acts: {
    rosterImportChoice(el) {
      const resolve = this._rosterImportResolve;
      this._rosterImportResolve = null;
      this.closeModal();
      if (resolve) resolve(el.dataset.choice);
    },
    async cloudSave() {
      try {
        CloudSync.saveSettings({ url: $('cloudUrl').value, apiToken: $('cloudToken').value, passcode: $('cloudPass').value });
        this.renderSync();
        this.toast('הגדרות הענן נשמרו', 'ok');
        if (CloudSync.configured()) await this.cloudRefresh(() => CloudSync.pullCloudState());
      } catch (e) { this.toast(`שמירת הגדרות הענן נכשלה: ${e.message}`, 'error'); }
    },
    async cloudPull() {
      if (!CloudSync.url()) return this.toast('לא הוגדרה כתובת סנכרון ענן', 'warn');
      if (CloudSync.hasUnpublished() && !confirm('יש שינויים שלא סונכרנו. משיכה מהענן תדרוס אותם. להמשיך?')) return;
      const r = await this.cloudRefresh(() => CloudSync.pullCloudState({ force: true }));
      if (r === 'kept-local') this.toast('בוצעו שינויים בזמן המשיכה; הם נשמרו. יש לפתור את ההתנגשות לפני סנכרון.', 'warn');
      else if (r) this.toast(r === 'applied' ? 'הנתונים נטענו מהענן' : 'אין עדיין נתונים בענן', r === 'applied' ? 'ok' : 'info');
    },
    async cloudSync() {
      try {
        CloudSync.saveSettings({ url: $('cloudUrl').value, apiToken: $('cloudToken').value, passcode: $('cloudPass').value });
        if (!CloudSync.url()) return this.toast('יש להגדיר כתובת סנכרון ענן בהגדרות', 'warn');
        const r = await this.cloudRefresh(() => CloudSync.pullCloudState());
        if (!r || r === 'kept-local') return;
        const pushed = await CloudSync.pushCloudState();
        if (pushed === 'kept-local') return;
        this.toast('הנתונים סונכרנו לענן', 'ok');
      } catch (e) { this.toast(`הסנכרון נכשל: ${e.message}`, 'error'); }
      this.renderSync();
    },
    async cloudForcePush() {
      if (!confirm('דחיפה כפויה תחליף את נתוני הענן בנתונים המקומיים ותשפיע על כל הצוות. מומלץ לייצא גיבוי מקומי קודם. להמשיך?')) return;
      const r = await this.cloudRefresh(() => CloudSync.pushCloudState({ force: true }));
      if (r && r !== 'kept-local') this.toast('הנתונים המקומיים נשלחו לענן', 'ok');
    },
    async cloudJoinLink() {
      try {
        CloudSync.saveSettings({ url: $('cloudUrl').value, apiToken: $('cloudToken').value, passcode: $('cloudPass').value });
        await navigator.clipboard.writeText(CloudSync.teamJoinLink());
        this.toast('קישור ההצטרפות הועתק. יש לשתף רק בערוץ פרטי עם הצוות.', 'ok');
      } catch (e) { this.toast(`העתקת הקישור נכשלה: ${e.message}`, 'error'); }
    },
    async backupExport() {
      try { await CloudSync.exportBackup(); }
      catch (e) { this.toast(`ייצוא הגיבוי נכשל: ${e.message}`, 'error'); }
    },
    async cloudWipeLocal() {
      if (!confirm('פעולה זו מנתקת את המחשב הזה בלבד ומוחקת ממנו את הנתונים ואת קוד הגישה, כדי שמשתמשים אחרים במחשב המשותף לא יוכלו לראות פרטי תלמידים.\n\nהנתונים של בית הספר בענן לא יימחקו ויישארו שמורים.\n\nשינויים שעדיין לא נשמרו בענן יאבדו, והדף ייטען מחדש. להמשיך?')) return;
      try { await CloudSync.wipeLocalSession(); }
      catch (e) { this.toast(`מחיקת הנתונים המקומיים נכשלה: ${e.message}. הסנכרון נשאר חסום; יש לנסות למחוק שוב.`, 'error'); }
    },
    calibAdd() { this.openCalibModal(null); },
    calibAssign(el) { const u = this._calibUnk[Number(el.dataset.i)]; if (u) this.openCalibModal(null, { code: u.code, name: u.subject }); },
    calibEdit(el) { const r = this._calibRows[Number(el.dataset.i)]; if (r) this.openCalibModal(r); },
    calibDelete(el) {
      const row = this._calibRows[Number(el.dataset.i)];
      if (!row || !confirm(`למחוק את הסמל ${row.code} מ-${row.group}?`)) return;
      const res = Config.updateRules(r => {
        this.calibDetach(r, row.code);
        if (r.questionnaires) delete r.questionnaires[row.code];
      });
      if (res.ok === false) return this.toast(res.error, 'error');
      this.afterRulesEdit(res);
    },
    modalBackdrop(el, e) { if (e.target === el) this.closeModal(); },
    mxPop(el) {
      if (this._mxPinned === el) return this.hideMxPop();
      this.showMxPop(el, true);
    },
    bagrutMode(el) {
      if (el.disabled) return;
      this.state.sim.fullMode = el.dataset.mode === 'final';
      this.evals.clear();
      ['overview', 'bagrut', 'profile', 'sadin'].forEach(t => this.dirty.add(t));
      this.renderTab(this.state.tab);
    },
    closeModal() { this.closeModal(); },
    sadinAlerts() { this.openSadinAlerts(); },
    generateAlerts() { this.generateAlerts(); },
    sadinPop(el) {
      if (this._sadinPinned === el) this.hideSadinPop();
      else this.showSadinPop(el, true);
    },
    goSettings() { this.showTab('settings'); },
    settingsView(el) { this.state.settingsView = el.dataset.view; this.renderSettingsNav(); },
    sgPick(el) { this.pickSuggestion(+el.dataset.i); },
    searchClear() { this.clearSearch(); },
    sgOpenGroup(el) { this.selectGroup(el.dataset.id); },
    /** ניווט מכרטיסי חדר הבקרה ללשונית מסוננת מראש */
    ovGo(el) {
      const { go, chip, strip, view, scope } = el.dataset;
      this.resetOverviewDrillFilters();
      if (go === 'bagrut') {
        this.state.bagrut.chip = chip || 'all'; this.state.bagrut.drill = 'all'; this.dirty.add('bagrut');
        if (chip === 'attention') {
          this.state.bagrutScope = this.scopeOfGrade(this.state.filters.grade);
          this.state.bagrutScopeSet = true;
        }
        /* "כל השכבות" מכרטיס כללי אינו מבטל שכבה שנבחרה במפורש בסינון העליון */
        if (chip !== 'attention' && scope && (scope !== 'all' || this.state.filters.grade === 'all')) { this.applyBagrutScope(scope); this.alertOut = []; }
      }
      if (go === 'sadin') { Object.assign(this.state.sadin, { strip: strip || 'all', subject: 'all', teacher: 'all' }); this.dirty.add('sadin'); }
      if (go === 'groups') {
        Object.assign(this.state.groups, { subject: 'all', teacher: 'all' });
        Object.assign(this.state, { groupsViewMode: view === 'explorer' ? 'explorer' : 'anomalies', anomalyCategoryFilter: 'all', anomalySubject: 'all' });
        this.dirty.add('groups');
      }
      this.showTab(go);
    },
    ovReadiness(el) {
      this.resetOverviewDrillFilters();
      if (this.state.filters.grade === 'all') this.applyBagrutScope(el.dataset.scope);
      Object.assign(this.state.bagrut, { drill: el.dataset.sel, chip: 'all', onlyPending: true, readinessClass: '', readinessFilter: 'all', mxSort: 'current', mxDir: 1 });
      this.state.sim.useCurrent = true;
      this.evals.clear();
      FILTERED_TABS.forEach(tab => this.dirty.add(tab));
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
    ovPick(el) { this.ovSelect(el.dataset.tz); this.ovCloseResults(); },
    ovSave() {
      const tz = this.ovTz;
      if (!tz) return this.toast('יש לבחור חניך מהרשימה', 'warn');
      const home = $('ovHomeroom').value === 'other' ? $('ovOtherHomeroom').value.trim() : $('ovHomeroom').value;
      if ($('ovHomeroom').value === 'other' && !home) return this.toast('יש להזין כיתת אם חדשה', 'warn');
      const res = Config.setRosterOverride(tz, {
        grade: $('ovGrade').value, homeroom: home, track: $('ovTrack').value,
        hidden: $('ovHidden').checked, note: $('ovNote').value, name: $('ovName').value
      });
      if (res.ok === false) return this.toast(res.error || 'שמירת הדריסה נכשלה', 'error');
      ['overrideTraineeSearch', 'ovGrade', 'ovHomeroom', 'ovOtherHomeroom', 'ovTrack', 'ovNote', 'ovName'].forEach(id => setVal(id, ''));
      $('ovOtherHomeroom').classList.add('hidden');
      setChecked('ovHidden', false);
      this.ovTz = '';
      this.toast(res.removed ? 'הדריסה זהה לשיוך שבקובץ ולכן לא נשמרה' : 'הדריסה נשמרה והופעלה בכל הפאנלים', res.removed ? 'info' : 'ok');
      this.afterDataChange();
    },
    classRoster(el) { this.openClassRoster(el.dataset.class); },
    ovRemove(el) {
      const res = Config.removeRosterOverride(el.dataset.tz);
      if (res.ok === false) return this.toast(res.error || 'ביטול הדריסה נכשל', 'error');
      this.toast('הדריסה בוטלה – חזר השיוך שבקובץ', 'ok');
      this.afterDataChange();
    },
    ovClearAll() {
      const count = Object.keys(Config.getRosterOverrides()).length;
      if (!count || !confirm(`לבטל את כל ${count} דריסות השיוך הפעילות?`)) return;
      const res = Config.clearRosterOverrides();
      if (res.ok === false) return this.toast(res.error || 'ביטול הדריסות נכשל', 'error');
      this.toast('כל הדריסות בוטלו – חזרו השיוכים שבקובץ', 'ok');
      this.afterDataChange();
    },
    async clearPanel(el) {
      const key = el.dataset.key, ds = DATASETS[key];
      if (!ds || !confirm(`למחוק את כל נתוני "${ds.title}" (כל השכבות)? המצבת וההגדרות יישמרו.`)) return;
      try { await Config.clearDataset(key); }
      catch (err) { return this.toast(`מחיקת הנתונים נכשלה: ${err.message}`, 'error'); }
      this.afterDataChange();
      this.toast(`נתוני "${ds.title}" נוקו`, 'ok');
    },
    async clearSadinGrade(el) {
      const grade = el.dataset.grade;
      if (!confirm(`למחוק את שורות הסדין של שכבה ${Util.gl(grade)}? שורות ללא שכבה מזוהה יישארו.`)) return;
      try {
        const res = await Config.clearSadinGrade(grade);
        if (!res.ok) return this.toast(res.error, 'error');
        this.afterDataChange();
        this.toast(`נתוני סדין של שכבה ${Util.gl(grade)} הוסרו`, 'ok');
      } catch (err) { this.toast(`מחיקת הנתונים נכשלה: ${err.message}`, 'error'); }
    },
    remap(el) { this.remapColumns(el.dataset.key); },
    openProfile(el) { this.openProfile(el.dataset.tz, el); },
    profBack() { this.profBack(); },
    bagrutSort(el) {
      const st = this.state.bagrut, k = el.dataset.key;
      if (st.sort === k) st.dir *= -1; else { st.sort = k; st.dir = 1; }
      this.dirty.add('bagrut');
      this.renderTab('bagrut');
    },
    bagrutDrill(el) { Object.assign(this.state.bagrut, { drill: el.dataset.sel, readinessClass: '', readinessFilter: 'all' }); this.dirty.add('bagrut'); this.renderTab('bagrut'); },
    readinessFilter(el) {
      const st = this.state.bagrut;
      st.readinessFilter = st.readinessFilter === el.dataset.filter ? 'all' : el.dataset.filter;
      this.dirty.add('bagrut'); this.renderTab('bagrut');
    },
    bagrutReadinessClass(el) {
      const st = this.state.bagrut;
      st.readinessClass = st.readinessClass === el.dataset.class ? '' : el.dataset.class;
      this.dirty.add('bagrut'); this.renderTab('bagrut');
    },
    bagrutDrillBack() { Object.assign(this.state.bagrut, { drill: 'all', readinessClass: '', readinessFilter: 'all' }); this.dirty.add('bagrut'); this.renderTab('bagrut'); },
    bagrutMxSort(el) {
      const st = this.state.bagrut, k = el.dataset.key;
      if (st.mxSort === k) st.mxDir *= -1; else { st.mxSort = k; st.mxDir = 1; }
      this.dirty.add('bagrut');
      this.renderTab('bagrut');
    },
    bagrutChip(el) {
      const st = this.state.bagrut, chip = el.dataset.chip;
      st.chip = st.chip === chip ? 'all' : chip;
      this.dirty.add('bagrut');
      this.renderTab('bagrut');
    },
    bagrutScope(el) {
      this.state.bagrut.chip = 'all';
      this.applyBagrutScope(el.dataset.scope);
      this.alertOut = [];
      this.renderTab(this.state.tab);
    },
    excModal(el) { this.openExceptionModal(el.dataset.tz); },
    excModalSave(el) { this.saveProfileException(el); },
    excModalClear(el) { this.clearProfileException(el); },
    profTab(el) { this.profTab(el.dataset.sub); },
    rulesTab(el) { this.state.rulesTab = el.dataset.sub; this.renderRulesDrawer(); },
    cohortEdit(el) {
      Config.setActiveCohort(el.dataset.id);
      ['settings'].forEach(t => this.dirty.add(t));
      this.renderTab('settings');
    },
    cohortCopy() {
      const to = Config.getActiveCohortId();
      const others = Object.values(Config.getCohortProfiles()).filter(c => c.id !== to);
      if (!others.length) return this.toast('אין מחזור אחר להעתיק ממנו', 'warn');
      this.formModal(`העתקת חוקים אל ${this.cohortName(to)}`, [
        { key: 'from', label: 'העתק חוקים ממחזור', type: 'select', value: others[0].id, options: others.map(c => ({ value: c.id, label: c.name })) }
      ], v => {
        if (!confirm(`כל חוקי הבגרות והשאלונים של ${this.cohortName(to)} יוחלפו בעותק של ${this.cohortName(v.from)}. להמשיך?`)) return { ok: false, error: 'ההעתקה בוטלה' };
        const res = Config.copyCohortRules(v.from, to);
        if (res.ok !== false) { Store.refresh(); SignalEngine.invalidate(); this.toast(`החוקים הועתקו מ-${this.cohortName(v.from)}`, 'ok'); }
        return res;
      }, 'העתקה');
    },
    cohortAdd() {
      const from = Config.getActiveCohortId();
      this.formModal('הוספת מחזור חדש', [
        { key: 'name', label: 'שם המחזור', placeholder: 'מחזור ח\' (תש"צ)' }
      ], v => {
        const res = Config.addCohort(v.name, from);
        if (res.ok) {
          Config.setActiveCohort(res.id);
          this.toast(`נוסף ${v.name.trim()} כעותק של ${this.cohortName(from)}. אפשר לשייך אליו שכבה בראש המסך.`, 'ok');
        }
        return res;
      }, 'הוספה');
    },
    dismissStale(el) { Config.dismissStale(el.dataset.key); this.renderChrome(); },
    showUnknown(el) {
      const rc = Config.reconcile(el.dataset.key);
      this.openModal(`
        <div class="flex items-center justify-between mb-2"><h3 class="text-lg font-semibold">לא נמצאו במצבת (${rc.unknown.length})</h3><button type="button" class="btn btn-ghost" data-act="closeModal">סגירה</button></div>
        <p class="text-sm text-slate-500 mb-3">ת.ז אלה מופיעות ב"${E(DATASETS[el.dataset.key].title)}" אך אינן במצבת העליונה, ולכן הוחרגו מכל המדדים.</p>
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
    ruleRemove(el) {
      const list = Config.rules()[{ core: 'coreSubjects', major: 'majors', internal: 'internals' }[el.dataset.kind]] || [];
      const c = list.find(x => x.id === el.dataset.id);
      if (c && confirm(`להסיר את "${c.name}" מכללי הזכאות?`)) this.applyRule(Config.removeClause(el.dataset.kind, el.dataset.id));
    },
    compAdd(el) {
      const { kind, id, level } = el.dataset;
      this.formModal('הוספת שאלון', [
        { key: 'codes', label: 'סמלי שאלון (חלופיים, מופרדים בפסיקים)' },
        { key: 'weight', label: 'משקל (%)', type: 'number', value: 0 },
        { key: 'label', label: 'תיאור (אופציונלי)' }
      ], v => Config.upsertComponent(kind, id, level, null, { codes: v.codes.split(',').map(x => x.trim()).filter(Boolean), weight: Number(v.weight), label: v.label.trim() }));
    },
    compRemove(el) { this.applyRule(Config.removeComponent(el.dataset.kind, el.dataset.id, el.dataset.level, +el.dataset.i)); },
    qRemove(el) { this.applyRule(Config.removeQuestionnaire(el.dataset.code)); },
    groupsMode(el) {
      this.state.groupsViewMode = el.dataset.mode === 'explorer' ? 'explorer' : 'anomalies';
      this.dirty.add('groups');
      this.renderTab('groups');
    },
    anCat(el) {
      this.state.anomalyCategoryFilter = el.dataset.cat;
      this.dirty.add('groups');
      this.renderTab('groups');
      const active = document.querySelector(`#groups-kpis [data-cat="${el.dataset.cat}"]`);
      if (active) active.focus();
    },
    grpAnomSort(el) {
      const st = this.state.groups, col = el.dataset.col;
      if (st.anomSort === col) st.anomDir = -st.anomDir; else { st.anomSort = col; st.anomDir = 1; }
      this.dirty.add('groups');
      this.renderTab('groups');
    },
    inspectGroups(el) { this.openTargetGroupInspector(el.dataset.tz, el.dataset.subject); },
    sadinSort(el) {
      const cur = this.state.sadinSort, key = el.dataset.key;
      const sameKey = (cur.key === 'class_name' ? 'homeroom' : cur.key) === key;
      this.state.sadinSort = { key, dir: sameKey && cur.dir === 'asc' ? 'desc' : 'asc' };
      this.dirty.add('sadin');
      const box = document.querySelector('#sadin-table .sticky-scroll'), top = box ? box.scrollTop : 0, left = box ? box.scrollLeft : 0;
      this.renderTab('sadin');
      const next = document.querySelector('#sadin-table .sticky-scroll');
      if (next) { next.scrollTop = top; next.scrollLeft = left; }
      const btn = [...document.querySelectorAll('#sadin-table [data-act="sadinSort"]')].find(b => b.dataset.key === key);
      if (btn) btn.focus();
    },
    toggleRoutine() {
      this.state.showRoutineDuplicates = !this.state.showRoutineDuplicates;
      this.dirty.add('groups');
      this.renderTab('groups');
      const btn = document.querySelector('#groups-mode-extra [data-act="toggleRoutine"]');
      if (btn) btn.focus();
    },
    inspectOpenGroup(el) { this.closeModal(); this.selectGroup(el.dataset.id); },
    studentMap(el) { this.selectStudent(el.dataset.tz); },
    mapBack() { this.state.groupsViewMode = 'anomalies'; this.clearSearch(); },
    rosterSort(el) { this.state.groups.rosterSort = el.dataset.sort; this.groupsRerender(); },
    gStrip(el) {
      const st = this.state.groups;
      st.strip = el.dataset.k;
      st.missingSelected = st.strip === 'missing';
      this.groupsRerender();
      const active = document.querySelector(`#groups-strip [data-k="${st.strip}"]`);
      if (active) active.focus();
    },
    gPick(el) {
      this.state.groups.groupId = el.dataset.id;
      this.state.groups.missingSelected = false;
      this.groupsRerender();
      const active = [...document.querySelectorAll('#groups-master [data-act="gPick"]')].find(button => button.dataset.id === this.state.groups.groupId);
      if (active) active.focus();
    },
    gMissing() {
      this.state.groups.missingSelected = true;
      this.groupsRerender();
      const active = document.querySelector('#groups-master [data-act="gMissing"]');
      if (active) active.focus();
    },
    openBoardProfile(el) {
      const t = Store.trainees.get(el.dataset.tz);
      if (!t) return;
      const f = this.state.filters;
      if (f.grade !== 'all' && f.grade !== t.gradeKey) f.grade = 'all';
      if (f.cls !== 'all' && f.cls !== t.classKey) f.cls = 'all';
      if (f.track !== 'all' && f.track !== this.trackOf(t)) f.track = 'all';
      if (!this.filtered().some(person => person.tz === t.tz)) f.q = '';
      this.syncFilters();
      FILTERED_TABS.forEach(tab => this.dirty.add(tab));
      this.openProfile(t.tz, el);
    },
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
    deleteRoster() {
      if (!confirm('למחוק את מצבת החניכים? כל הפאנלים יתרוקנו עד לטעינת מצבת חדשה.')) return;
      Config.clearRoster();
      Config.setRosterCleared(true);
      this.rosterReport = null;
      this.afterDataChange();
    },
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
    sim(el) { this.state.sim[el.dataset.key] = el.checked; this.evals.clear(); ['overview', 'bagrut', 'profile', 'sadin'].forEach(t => this.dirty.add(t)); this.renderTab(this.state.tab); },
    bagrutOnlyPending(el) { this.state.bagrut.onlyPending = el.checked; this.dirty.add('bagrut'); this.renderTab('bagrut'); },
    anSubject(el) { this.state.anomalySubject = el.value; this.dirty.add('groups'); this.renderTab('groups'); },
    gradeCohort(el) {
      const res = Config.setGradeCohort(el.dataset.grade, el.value);
      if (res.ok === false) this.toast(res.error, 'error');
      else this.toast(`שכבת ${Util.gl(Util.GRADE_KEYS.find(k => String(Util.ord(k)) === el.dataset.grade))} נבדקת כעת לפי ${this.cohortName(el.value)}`, 'ok');
      this.renderRulesDrawer();
    },
    compEnabled(el) { this.patchComp(el, { enabled: el.checked }); },
    compCodes(el) { this.patchComp(el, { codes: el.value.split(',').map(x => x.trim()).filter(Boolean) }); },
    compWeight(el) { this.patchComp(el, { weight: Number(el.value) }); },
    compGrade(el) { this.patchComp(el, { expectedGrade: el.value }); this.renderRulesDrawer(); },
    /* ריק = מחיקת הדריסה וירושת ברירת המחדל של המחזור; ציונים נגזרים מחושבים מחדש מיד */
    compMagen(el) {
      const v = el.value.trim(), n = Number(v);
      if (v !== '' && !(isFinite(n) && n >= 0 && n <= 100)) { this.toast('משקל המגן חייב להיות בין 0 ל-100', 'error'); this.renderRulesDrawer(); return; }
      this.patchComp(el, { magenWeight: v === '' ? null : n });
      Store.refresh();
      SignalEngine.invalidate();
      this.renderRulesDrawer();
    },
    ruleToggle(el) { this.applyRule(Config.toggleClause(el.dataset.kind, el.dataset.id)); },
    clauseCodes(el) { this.applyRule(Config.setClauseCodes(el.dataset.kind, el.dataset.id, el.value)); },
    clauseKeywords(el) { this.applyRule(Config.patchClause(el.dataset.kind, el.dataset.id, { keywords: el.value.split(',').map(x => x.trim()).filter(Boolean) })); },
    internalGrade(el) { this.applyRule(Config.patchClause('internal', el.dataset.id, { expectedGrade: el.value })); },
    clauseGrade(el) { this.applyRule(Config.patchClause(el.dataset.kind, el.dataset.id, { expectedGrade: el.value })); this.renderRulesDrawer(); },
    gateToggle(el) { this.applyRule(Config.setGateEnabled(el.dataset.gate, el.checked)); },
    gateUnits(el) { this.applyRule(Config.updateRules(r => { r.gates.major.requiredUnits = Math.max(1, Math.min(5, Number(el.value) || 5)); })); },
    qName(el) { this.applyRule(Config.setQuestionnaire(el.dataset.code, { name: el.value.trim() })); },
    qGrade(el) {
      let res;
      el.dataset.code.split(',').filter(Boolean).forEach(code => { res = Config.setQuestionnaire(code, { expectedGrade: el.value }); });
      this.applyRule(res);
    },
    specialEd(el) {
      const res = Config.setSpecialEdClass(el.dataset.class, el.checked);
      if (res.ok === false) { this.afterClassSettingChange(); return this.toast(res.error || 'שמירת ההגדרה נכשלה', 'error'); }
      this.afterClassSettingChange();
      this.toast(el.checked ? `כיתה ${el.dataset.class}: חניכיה במסלול חנ"מ` : `כיתה ${el.dataset.class}: הוסרה ממסלול חנ"מ`, 'ok');
    },
    classMove(el) {
      let home = el.value;
      if (home === 'other') home = (prompt('הקלידו כיתת אם חדשה (למשל יא3)') || '').trim();
      if (!home) return this.openClassRoster(el.dataset.class);
      const patch = { grade: Util.parseClass('', home).gradeKey, homeroom: home };
      this.classRosterApply(el.dataset.tz, el.dataset.class, patch, `החניך הועבר לכיתה ${home}`);
    },
    classTrack(el) {
      this.classRosterApply(el.dataset.tz, el.dataset.class, { track: el.value }, `המסלול עודכן: ${el.value}`);
    }
  }
};

/* אתחול בטעינת המסמך (או מיד אם כבר נטען) */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => App.init());
else App.init();
