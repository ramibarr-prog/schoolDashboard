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
    bagrut: { chip: 'all', sort: 'class', dir: 1, drill: 'all', mxSort: 'class', mxDir: 1 },
    groups: { view: 'explorer', subject: 'all', teacher: 'all', kind: 'all', subjectKey: 'all', strip: 'all', groupId: '', missingSelected: false },
    sadin: { subject: 'all', teacher: 'all', view: 'sheet', strip: 'all', alertBy: 'teacher', initials: false },
    profileTz: null
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
  async init() {
    try { await Config.ready; } catch (e) { console.warn('config storage', e); }
    this.renderSync();
    window.addEventListener('sd:cloud-status', () => this.renderSync());
    let seeded = false;
    if (CloudSync.url()) {
      try {
        const r = await CloudSync.pullCloudState();
        if (r === 'kept-local') this.toast('נשמרו שינויים מקומיים הממתינים לסנכרון; הם יישלחו לענן אוטומטית.', 'info');
      } catch (e) { console.warn('cloud pull', e); this.toast(`סנכרון הענן נכשל: ${e.message}`, 'error'); }
    }
    try { if (!CloudSync.url() && typeof initMockDataIfEmpty === 'function') seeded = await initMockDataIfEmpty(); }
    catch (e) { console.error(e); this.toast(`טעינת נתוני הדמו נכשלה: ${e.message}`, 'error'); }
    Store.refresh();
    this.bindEvents();
    this.syncFilters();
    this.showTab(this.state.tab);
    if (seeded) this.toast('המצבת הייתה ריקה – נטענו נתוני דמו. אפשר להחליף אותם בהגדרות ומצבת חניכים.', 'info');
    if ((Config.rules().version || 0) < RULES_VERSION) {
      this.toast('קטלוג השאלונים והמגמות עודכן לקודי משוב של בית הספר. כדי לקבל אותו: ⚙️ כללי זכאות ← שחזור ברירות מחדל.', 'info');
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
    let root = $('modal-root');
    if (!root) { root = document.createElement('div'); root.id = 'modal-root'; document.body.appendChild(root); }
    root.innerHTML = `
      <div class="fixed inset-0 bg-slate-900/60 z-50 flex items-start justify-center overflow-auto p-4" data-act="modalBackdrop">
        <div class="card w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} mt-8 p-5" role="dialog" aria-modal="true">${html}</div>
      </div>`;
    this.icons();
  },
  closeModal() { setHtml('modal-root', ''); this.formCtx = null; },

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
    if (!e) { e = BagrutEngine.evaluate(tz, this.state.sim); this.evals.set(tz, e); }
    return e;
  },

  invalidateAll() {
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
  },

  showTab(name) {
    if (!TABS.includes(name)) return;
    const changed = this.state.tab !== name;
    this.state.tab = name;
    document.body.classList.toggle('sadin-active', name === 'sadin');
    const toggle = (selector, on) => document.querySelectorAll(selector).forEach(el => el.classList.toggle('hidden', !on));
    toggle('[data-groups-only]', name === 'groups');
    toggle('[data-sadin-only]', name === 'sadin');
    toggle('[data-bagrut-only]', name === 'bagrut');
    toggle('[data-profile-only]', name === 'profile');
    [['groupActions', 'groups'], ['sadinActions', 'sadin'], ['bagrutActions', 'bagrut'], ['profileSwitcher', 'profile']].forEach(([id, tab]) => {
      const el = $(id);
      if (el) el.classList.toggle('flex', name === tab);
    });
    this.syncGroupLayout();
    if (changed && $('mainContent')) $('mainContent').scrollTop = 0;
    document.body.classList.remove('nav-open');
    if ($('navScrim')) $('navScrim').classList.add('hidden');
    const search = $('globalSearch');
    if (search) search.placeholder = name === 'groups' ? 'חיפוש חניך לפי שם, ת.ז או קוד קבוצה' : 'חיפוש חניך לפי שם או ת.ז';
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    TABS.forEach(t => { const p = $(`panel-${t}`); if (p) p.hidden = t !== name; });
    this.renderChrome();
    this.renderTab(name);
  },

  syncGroupLayout() {
    document.body.classList.toggle('group-explorer', this.state.tab === 'groups' && this.state.groups.view === 'explorer' && Store.hasData() && Store.loaded.groups);
  },

  /* ------------------------------------------------------------------
     סינון גלובלי
     ------------------------------------------------------------------ */
  trackOf(t) { return Config.trackFor(t.tz, t.track, t.classKey); },

  sortTrainees(list) {
    return list.sort((a, b) => Util.ord(a.gradeKey) - Util.ord(b.gradeKey) || natural(a.classKey, b.classKey) || a.name.localeCompare(b.name, 'he'));
  },

  filtered(includeSearch = true, ignoreClass = false) {
    const f = this.state.filters;
    const q = includeSearch ? Util.norm(f.q) : '', digits = q.replace(/\D/g, '');
    return this.sortTrainees(Store.traineeList().filter(t => {
      if (f.grade !== 'all' && t.gradeKey !== f.grade) return false;
      if (!ignoreClass && f.cls !== 'all' && t.classKey !== f.cls) return false;
      if (f.track !== 'all' && this.trackOf(t) !== f.track) return false;
      if (q && !(t.name.includes(q) || (digits.length >= 3 && t.tz.includes(digits)))) return false;
      return true;
    }));
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
    setVal('globalSearch', f.q);
  },

  onFilterChange() {
    this.syncFilters();
    FILTERED_TABS.forEach(t => this.dirty.add(t));
    this.alertOut = [];
    this.renderTab(this.state.tab);
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
        await this.importRoster(list[0], opts);
        this.lastFiles[key] = list[0];
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

  async importRoster(file, opts = {}) {
    const res = await parseExcelFile(file, 'roster', opts);
    if (!res) { this.toast('הייבוא בוטל', 'info'); return; }
    const previous = Config.getRosterEntry();
    const saved = Config.setRoster(res.rows, file.name, res.ignoredIds);
    if (!saved.ok) { this.toast(saved.error, 'error'); return; }
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
        <p class="text-slate-500 text-sm mb-4">המצבת העליונה קובעת מי החניכים הפעילים, באיזו שכבה ובאיזו כיתת אם. אפשר לטעון אותה במסך "הגדרות ומצבת חניכים", או לנסות נתוני דמו.</p>
        <div class="flex gap-2 justify-center">
          <button type="button" class="btn btn-primary" data-act="loadMock">טעינת נתוני דמו</button>
          <button type="button" class="btn btn-ghost" data-act="goSettings">מעבר להגדרות ומצבת</button>
        </div>
      </div>`);
  },

  /* ==================================================================
     חדר בקרה פדגוגי – תמונת מצב (לשונית ברירת המחדל)
     ================================================================== */
  /** כל המדדים של חדר הבקרה על החניכים שבסינון הגלובלי; ממוצע ומקצועות חוסמים מחושבים מגיליון הסדין */
  overviewModel() {
    const list = this.filtered();
    const rows = list.map(t => ({ t, ev: this.getEval(t.tz) }));
    const stats = BagrutEngine.summarize(rows.map(r => r.ev));
    const sheet = Store.loaded.grades ? GroupAnalyzer.sadinSheet(list, {}) : [];
    const analysis = Store.loaded.groups ? GroupAnalyzer.analyzeGroupAnomalies(list, 'all') : null;
    const bagrutRisk = rows.filter(r => r.ev.tier === 4);
    const multi = sheet.filter(r => GroupAnalyzer.riskSubjects(r).length >= 2);
    const graded = sheet.filter(r => r.overall != null);
    return {
      list, rows, stats, sheet, analysis, bagrutRisk, multi, graded,
      anomalies: analysis ? GroupAnalyzer.anomaliesByTrainee(analysis) : new Map(),
      attention: new Set([...bagrutRisk.map(r => r.t.tz), ...multi.map(r => r.t.tz)]),
      avg: graded.length ? graded.reduce((sum, r) => sum + r.overall, 0) / graded.length : null,
      clean: graded.filter(r => !GroupAnalyzer.riskSubjects(r).length).length
    };
  },

  /** מקצועות חוסמים: מהסדין כשנטען, אחרת ממקצועות הליבה הנכשלים/החסרים בצפי הבגרות */
  overviewBlockers(m) {
    if (m.sheet.length) return { source: 'sadin', items: GroupAnalyzer.blockingSubjects(m.sheet, 5) };
    const failing = ['fail', 'lost', 'missing', 'noshow'];
    const items = BAGRUT_CORE.map(([id, name]) => {
      const cells = m.rows.map(r => r.ev.cells[id]).filter(c => c && c.state !== 'noenroll');
      const bad = cells.filter(c => failing.includes(c.state)).length;
      return { name, enrolled: cells.length, bad, pct: cells.length ? Math.round((bad / cells.length) * 100) : 0 };
    }).filter(x => x.bad > 0).sort((a, b) => b.bad - a.bad || b.pct - a.pct).slice(0, 5);
    return { source: 'bagrut', items };
  },

  /** תלמידים בחריגת שיבוץ או במרחק מקצוע אחד מזכאות, מהחמור לקל */
  overviewIssues(m) {
    const issues = new Map();
    m.anomalies.forEach(a => {
      const t = Store.trainees.get(a.tz);
      if (t) issues.set(a.tz, { t, rank: a.severe ? 0 : 1, parts: [{ text: a.text, severe: a.severe }] });
    });
    m.rows.filter(r => r.ev.singleBlocker).forEach(r => {
      const first = r.ev.focus[0];
      const e = issues.get(r.t.tz) || { t: r.t, rank: 2, parts: [] };
      e.parts.push({ text: `חסם יחיד לזכאות: ${first ? first.text : r.ev.diagnostic}`, severe: false });
      issues.set(r.t.tz, e);
    });
    return [...issues.values()].sort((a, b) => a.rank - b.rank || b.parts.length - a.parts.length || natural(a.t.name, b.t.name));
  },

  renderOverviewPanel() {
    if (!Store.hasData()) return this.noRoster([], 'overview-body');
    const m = this.overviewModel(), f = this.state.filters, st = m.stats;
    const bagrutOn = Store.loaded.bagrut && st.counted > 0, sadinOn = m.sheet.length > 0;
    const missing = Object.keys(DATASETS).filter(key => !Config.getDataset(key));

    const card = (data, label, value, sub, extra = '', icon = '') => `<button type="button" class="ov-card" data-act="ovGo" ${data}>
      <span class="ov-head"><span class="ov-label">${label}</span>${icon}</span>${extra || `<span class="ov-value">${value}</span>`}<span class="ov-sub">${sub}</span></button>`;
    const badge = (cls, paths) => `<span class="ov-icon ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24">${paths}</svg></span>`;
    const ICONS = {
      attn: badge('i-attn', '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
      trophy: badge('i-ok', '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
      grad: badge('i-ok', '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>'),
      alert: badge('i-bad', '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>')
    };
    const donut = pct => {
      const c = 2 * Math.PI * 30;
      return `<svg viewBox="0 0 80 80" class="w-20 h-20 shrink-0" role="img" aria-label="${E(`צפי זכאות ${pct}%`)}">
        <circle cx="40" cy="40" r="30" fill="none" stroke="#ECEFE9" stroke-width="10"/>
        <circle cx="40" cy="40" r="30" fill="none" stroke="#75977D" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * pct / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/></svg>`;
    };

    const notLoaded = 'טרם נטען קובץ';
    const attentionGo = Store.loaded.bagrut && (!m.multi.length || m.bagrutRisk.length >= m.multi.length) ? 'data-go="bagrut" data-chip="notok"' : 'data-go="sadin" data-strip="multiple"';
    const card1 = card(attentionGo, 'חניכים במעקב / דורש תשומת לב', m.attention.size,
      bagrutOn || sadinOn ? `${m.bagrutRisk.length} בסיכון בבגרות · ${m.multi.length} עם 2+ ציונים שליליים או חסרים · מתוך ${m.list.length}` : notLoaded, '', ICONS.attn);
    const card2 = card('data-go="sadin" data-strip="all"', 'ממוצע הישגים שוטפים', m.avg == null ? '—' : Util.fmt(m.avg, 1),
      sadinOn ? `${m.clean} חניכים עם 100% ציונים עוברים (מתוך ${m.graded.length} עם ציונים)` : notLoaded, '', ICONS.trophy);
    const card3 = card('data-go="bagrut" data-chip="all"', 'צפי זכאות לבגרות', '', bagrutOn
      ? `ללא חנ"מ: ${st.eligibilityExSpecialEd}% • כולל חנ"מ: ${st.eligibilityInclSpecialEd}%<br>${st.singleBlocker} חניכים במרחק מקצוע אחד מזכאות` : notLoaded,
      `<span class="flex items-center justify-between gap-3"><span class="ov-value">${bagrutOn ? `${st.eligibilityInclSpecialEd}%` : '—'}</span>${bagrutOn ? donut(st.eligibilityInclSpecialEd) : ''}</span>`, ICONS.grad);
    const c = m.analysis ? m.analysis.counts : null;
    const card4 = card('data-go="groups" data-view="anomalies"', 'חריגות שיבוץ בקבוצות', '',
      m.analysis ? `${m.anomalies.size} חניכים · חוסר ${c.none} • כפילות ${c.dup} • ללא מגמה ${c.nomajor}` : notLoaded,
      `<span class="ov-value warm">${m.analysis ? m.analysis.items.length : '—'}</span>`, ICONS.alert);

    /* אחוז זכאות לפי כיתות (או ממוצע שוטף כשקובץ הבגרות טרם נטען); הסינון לפי כיתה אינו מצמצם את הגרף כדי שאפשר יהיה לעבור בין כיתות */
    const pool = f.cls === 'all' ? m.list : this.filtered(true, true);
    const poolRows = f.cls === 'all' ? m.rows : pool.map(t => ({ t, ev: this.getEval(t.tz) }));
    const poolGraded = f.cls === 'all' ? m.graded : (sadinOn ? GroupAnalyzer.sadinSheet(pool, {}).filter(r => r.overall != null) : []);
    const byClass = new Map();
    poolRows.forEach(r => { const k = r.t.classKey || ''; if (!byClass.has(k)) byClass.set(k, []); byClass.get(k).push(r); });
    const sheetByClass = new Map();
    poolGraded.forEach(r => { const k = r.t.classKey || ''; if (!sheetByClass.has(k)) sheetByClass.set(k, []); sheetByClass.get(k).push(r.overall); });
    const classBars = [...byClass.entries()].sort((a, b) => Util.ord(a[1][0].t.gradeKey) - Util.ord(b[1][0].t.gradeKey) || natural(a[0], b[0])).map(([key, members]) => {
      if (bagrutOn) {
        const s = BagrutEngine.summarize(members.map(r => r.ev));
        return { key, value: s.counted ? s.eligibilityInclSpecialEd : null, text: s.counted ? `${s.eligibilityInclSpecialEd}%` : '—' };
      }
      const scores = sheetByClass.get(key) || [];
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      return { key, value: avg, text: avg == null ? '—' : Util.fmt(avg, 0) };
    });
    const bar = (label, value, cls = '') => `<span class="min-w-0 truncate text-sm font-semibold text-[#355747]">${label}</span><span class="ov-track"><span class="ov-fill ${cls}" style="width:${Math.max(0, Math.min(100, value || 0))}%"></span></span>`;
    const classHtml = classBars.length && (bagrutOn || sadinOn)
      ? classBars.map(b => `<button type="button" class="ov-bar" data-act="ovClass" data-class="${E(b.key)}" aria-pressed="${f.cls === b.key}" title="סינון לפי כיתה">${bar(`${E(Config.classLabel(b.key))} (${b.text})`, b.value)}</button>`).join('')
      : `<div class="text-sm text-slate-500 py-3">${notLoaded} – אחוז הזכאות או הממוצע לפי כיתות יוצגו לאחר הטעינה.</div>`;

    const blockers = this.overviewBlockers(m);
    const maxBad = Math.max(1, ...blockers.items.map(x => x.bad));
    const blockerHtml = blockers.items.length
      ? blockers.items.map((x, i) => `<div class="ov-bar" title="${E(`${x.bad} מתוך ${x.enrolled} חניכים`)}"><span class="min-w-0 truncate text-sm font-semibold text-[#355747]">${E(x.name)} <span class="${i === 0 ? 'txt-bad' : 'txt-warn'} font-bold">(${x.bad} - ${x.pct}%)</span></span><span class="ov-track"><span class="ov-fill mustard" style="width:${Math.round((x.bad / maxBad) * 100)}%"></span></span></div>`).join('')
      : `<div class="text-sm text-slate-500 py-3">${bagrutOn || sadinOn ? 'לא נמצאו מקצועות עם ציונים נכשלים או חסרים בסינון הנוכחי.' : notLoaded}</div>`;

    const issues = this.overviewIssues(m), SHOWN = 8;
    const issueRows = issues.slice(0, SHOWN).map(i => `<tr class="ov-row" data-act="openProfile" data-tz="${E(i.t.tz)}">
      <td><button type="button" class="text-right font-semibold text-[#355747] hover:underline" data-act="openProfile" data-tz="${E(i.t.tz)}">${E(i.t.name)}</button><div class="text-xs text-slate-500">${E(Config.classLabel(i.t.classKey))}</div></td>
      <td>${i.parts.map(p => `<div class="text-xs font-medium ${p.severe ? 'txt-bad' : 'txt-warn'}">${E(p.text)}</div>`).join('')}</td></tr>`).join('');
    const issueHtml = issues.length
      ? `<table class="ov-table"><thead><tr><th>תלמידים (שם + כיתה)</th><th>תיאור החריגה / חסם</th></tr></thead><tbody>${issueRows}</tbody></table>
        ${issues.length > SHOWN ? `<div class="pt-2 text-xs text-slate-500">מוצגים ${SHOWN} מתוך ${issues.length} · <button type="button" class="underline text-[#75977D]" data-act="ovGo" data-go="groups" data-view="anomalies">כל חריגי השיבוץ</button></div>` : ''}`
      : `<div class="text-sm text-slate-500 py-3">${m.analysis || bagrutOn ? 'אין חניכים בחריגת שיבוץ או במרחק מקצוע אחד מזכאות בסינון הנוכחי.' : notLoaded}</div>`;

    const scope = [f.grade !== 'all' ? `שכבה ${Util.gl(f.grade)}` : '', f.cls !== 'all' ? Config.classLabel(f.cls) : '', f.track !== 'all' ? `מסלול ${f.track}` : ''].filter(Boolean).join(' · ');
    setHtml('overview-body', `
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div class="text-xs font-semibold text-[#75977D]">מוניטור פדגוגי ‹ חדר בקרה</div>
          <h2 class="ov-title text-2xl font-extrabold text-[#355747] mt-0.5">חדר בקרה פדגוגי – תמונת מצב</h2>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-slate-500">${E(scope || 'כל בית הספר')} · ${m.list.length} חניכים</span>
          <span id="ovSyncPill" class="ov-pill" role="status">${E(($('syncStatus') || {}).textContent || '')}</span>
        </div>
      </div>
      ${missing.length ? `<div class="card px-4 py-2 flex flex-wrap items-center gap-2 text-sm"><span class="text-slate-500">טרם נטענו קבצים:</span>${missing.map(key => `<button type="button" class="btn btn-primary btn-sm" data-upload="${key}">📂 ${E(DATASETS[key].title)}</button>`).join('')}</div>` : ''}
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">${card1}${card2}${card3}${card4}</div>
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div class="card p-5 lg:col-span-7 space-y-5">
          <div><h3 class="font-bold text-[#355747] mb-2">${bagrutOn ? 'אחוז זכאות שכבתי לפי כיתות' : 'ממוצע הישגים שוטפים לפי כיתות'}</h3><div class="space-y-1">${classHtml}</div></div>
          <div class="border-t border-[#E6ECE6] pt-4"><h3 class="font-bold text-[#355747] mb-2">התפלגות החוסמים ביותר <span class="text-xs font-normal text-slate-500">${blockers.source === 'sadin' ? 'מקצועות עם ציון נכשל או חסר' : 'מקצועות ליבה בבגרות'}</span></h3><div class="space-y-1">${blockerHtml}</div></div>
        </div>
        <div class="card p-5 lg:col-span-5"><h3 class="font-bold text-[#355747] mb-2">חניכים בחריגה וצווארי בקבוק</h3>${issueHtml}</div>
      </div>`);
  },

  /* ==================================================================
     פאנל 1 – צפי זכאות לבגרות
     ================================================================== */
  dashRows() { return this.filtered().map(t => ({ t, ev: this.getEval(t.tz) })); },

  chipMatch(r, chip) {
    if (chip === 'exception') return r.ev.manual;
    if (chip === 'suspect') return !r.ev.manual && r.ev.isPotentialException;
    if (chip === 'near') return r.ev.singleBlocker;
    if (chip === 'notok') return r.ev.tier === 4;
    if (chip === 'eligible') return r.ev.tier === 1 || r.ev.tier === 2;
    if (chip === 'savable') return r.ev.savable;
    if (/^tier[0-5]$/.test(chip)) return r.ev.tier === +chip.slice(4);
    return true;
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
    const rows = this.dashRows();
    const st = this.state.bagrut, sim = this.state.sim;
    const stats = BagrutEngine.summarize(rows.map(r => r.ev));
    const list = this.bagrutList(rows);
    const tierCount = [0, 0, 0, 0, 0, 0];
    rows.forEach(r => { tierCount[r.ev.tier]++; });
    const TT = BagrutEngine.TIER_TEXT[sim.fullMode ? 'full' : 'adaptive'];
    const option = (id, label) => `<option value="${id}" ${st.chip === id ? 'selected' : ''}>${E(label)}</option>`;
    setHtml('bagrutStatusSelect',
      option('all', `כל הסטטוסים (${rows.length})`) +
      option('eligible', `✅ זכאים (${tierCount[1] + tierCount[2]})`) +
      [1, 2, 3, 4, 5, 0].map(i => option(`tier${i}`, `${['⚪', '🟢', '🟡', '🟠', '🔴', '⚪'][i]} ${i === 0 ? 'ללא נתוני בגרות' : TT[i]} (${tierCount[i]})`)).join('') +
      option('savable', `🎯 הצלה ב-30% (${stats.savable})`) +
      option('near', `חסם בודד (${stats.singleBlocker})`) +
      option('exception', `⚡ חריג ידני (${stats.exceptions})`) +
      option('suspect', `חשד לחריג (${stats.potentialExceptions})`));

    const sw = (key, label) => `<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" class="w-4 h-4" data-chg="sim" data-key="${key}" ${sim[key] ? 'checked' : ''}>${label}</label>`;
    const modeBtn = (full, label, title) => `<button type="button" data-act="bagrutMode" data-mode="${full ? 'final' : 'adaptive'}" aria-pressed="${!!sim.fullMode === full}" title="${E(title)}">${label}</button>`;
    setHtml('bagrut-whatif',
      `<span class="seg flex flex-col" role="group" aria-label="מצב הערכה">${modeBtn(false, '📅 צפי מותאם לשלב בשנה', 'נשפט לפי המבחנים שהשכבה כבר עברה; מה שטרם דווח לשכבה אינו חוסר')}${modeBtn(true, '🎓 מצב תעודה סופית (סוף י"ב)', 'בדיקה מחמירה: כל השאלונים והיחידות הפנימיות נדרשים')}</span>` +
      sw('ignoreInternals', 'התעלם מחוסר יחידות פנימיות (חנ"ג, מעורבות, השכלה כללית ומדעים)') + sw('plus5', 'תוספת +5 לגבוליים 50-54') + sw('useCurrent', 'שלב ציונים שוטפים כתחזית (תצוגה מקדימה)'));

    this.renderCohortInfo(rows);
    this.renderBagrutKpis(stats, tierCount, TT);
    const drillOpts = BagrutEngine.drillOptions();
    if (st.drill !== 'all' && !drillOpts.some(o => o.value === st.drill)) st.drill = 'all';
    setHtml('bagrutSubjectDrillSelect',
      `<option value="all" ${st.drill === 'all' ? 'selected' : ''}>📊 מבט על – כל המקצועות</option>` +
      drillOpts.map(o => `<option value="${E(o.value)}" ${st.drill === o.value ? 'selected' : ''}>${E(o.label)}</option>`).join(''));
    if (!Store.hasData()) return this.noRoster([], 'bagrut-table');
    if (st.drill !== 'all') return setHtml('bagrut-table', this.bagrutSubjectMatrix(rows.filter(r => this.chipMatch(r, st.chip))));
    setHtml('bagrut-table', this.bagrutTable(list));
  },

  /** פס KPI מנהלים מעל הטבלה: אחוזי זכאות בקבוצה המסוננת ומונים לחיצים לסינון מהיר */
  renderBagrutKpis(stats, tierCount, TT) {
    const box = $('bagrut-kpis');
    if (!box) return;
    if (!Store.hasData() || !Store.loaded.bagrut) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const active = this.state.bagrut.chip;
    const pct = (value, label, title) => `<div class="flex items-baseline gap-2" title="${E(title)}"><span class="text-2xl font-extrabold leading-none text-slate-900">${value}%</span><span class="text-xs font-semibold text-slate-600">${label}</span></div>`;
    const quick = (id, cls, label, count, title) => `<button type="button" class="gstat ${cls}" data-act="bagrutChip" data-chip="${id}" aria-pressed="${active === id}" title="${E(title)}">
      <span class="text-xs font-bold text-slate-700 whitespace-nowrap">${label}</span><span class="text-sm font-extrabold px-2 py-0.5 rounded bg-slate-100">${count}</span></button>`;
    const basis = `מחושב על ${stats.counted} חניכים עם נתוני בגרות (ללא מסלול 12 שנות לימוד)`;
    box.classList.remove('hidden');
    box.innerHTML = `<div class="card px-4 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-1">
        ${pct(stats.eligibilityInclSpecialEd, 'צפי זכאות · כולל חנ"מ', basis)}
        ${pct(stats.eligibilityExSpecialEd, 'צפי זכאות · ללא חנ"מ', basis)}
      </div>
      <span class="hidden sm:block h-8 w-px bg-slate-200" aria-hidden="true"></span>
      <div class="flex flex-wrap items-center gap-2" role="group" aria-label="סינון מהיר לפי צפי">
        ${quick('eligible', 'gstat-ok', 'זכאים', tierCount[1] + tierCount[2], `${TT[1]} + ${TT[2]}`)}
        ${quick('tier3', 'gstat-amber', 'קרובים לזכאות', tierCount[3], TT[3])}
        ${quick('tier4', 'gstat-bad', 'בסיכון', tierCount[4], TT[4])}
      </div></div>`;
  },

  /** מטריצת שאלונים למקצוע בודד: ציון לכל שאלון, 🧮 נצבר (משוקלל עד כה) וציון סופי */
  bagrutSubjectMatrix(rows) {
    const st = this.state.bagrut;
    const m = BagrutEngine.subjectMatrix(st.drill, rows.map(r => r.t));
    if (!m) return '<div class="text-center text-slate-400 py-8">המקצוע אינו פעיל בכללים</div>';
    const { mxSort: sort, mxDir: dir } = st;
    const qKey = q => `q:${q.key}`;
    const cellOf = (r, q) => r.cells[q.key];
    const val = r => {
      if (sort === 'name') return r.t.name;
      if (sort === 'class') return Config.classLabel(r.t.classKey);
      if (sort === 'units') return r.level ? Number(r.level) : 0;
      if (sort === 'acc') return r.accumulated;
      if (sort === 'final') return r.finalScore == null ? -1 : r.finalScore;
      const q = m.questionnaires.find(x => qKey(x) === sort), c = q && cellOf(r, q);
      return c && c.state === 'num' ? c.num : -1;
    };
    const list = m.rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      return ((typeof x === 'number' ? x - y : natural(x, y)) || natural(a.t.name, b.t.name)) * dir;
    });
    const th = (key, label, title = '') => `<th><button type="button" class="font-semibold" data-act="bagrutMxSort" data-key="${E(key)}" ${title ? `title="${E(title)}"` : ''}>${label}${sort === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    const qCells = r => m.questionnaires.map(q => {
      const c = cellOf(r, q);
      if (!c) return '<td class="text-slate-300">–</td>';
      if (c.state === 'num') return `<td class="${c.num >= m.pass ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-bold'}">${c.num}</td>`;
      if (c.state === 'pass') return '<td class="text-emerald-700 font-semibold">עבר</td>';
      if (c.state === 'fail') return '<td class="text-rose-600 font-bold">נכשל</td>';
      if (c.state === 'missed') return '<td class="text-rose-600 font-bold">חסר</td>';
      return '<td class="text-slate-300">–</td>';
    }).join('');
    const accTd = r => {
      const left = r.remainingW;
      const tip = r.accumulated >= m.pass && !left ? `נצבר: ${r.accumulated} נק' מתוך 100` :
        r.accumulated + left < m.pass - 0.5 ? `נצבר עד כה: ${r.accumulated} נק' מתוך 100 (גם בציון 100 בשאלוני ההמשך לא יושג ציון עובר ${m.pass})` :
        r.need > 0 ? `נצבר עד כה: ${r.accumulated} נק' מתוך 100 (חסרות עוד ${r.need} נק' משאלוני ההמשך כדי להבטיח ציון סופי עובר ${m.pass})` :
        `נצבר עד כה: ${r.accumulated} נק' מתוך 100 (ציון עובר ${m.pass} כבר מובטח)`;
      return `<td class="whitespace-nowrap text-slate-700" title="${E(tip)}">🧮 ${r.accumulated}</td>`;
    };
    const finalTd = r => r.finalScore != null
      ? `<td class="${r.finalScore >= m.pass ? 'text-emerald-700' : 'text-rose-600'} font-bold">${r.finalScore}</td>`
      : `<td class="text-slate-300" title="${E(r.partialAvg != null ? `בתהליך – ממוצע חלקי נוכחי: ${r.partialAvg} (על ${r.doneW}% מהמשקל)` : 'טרם הושלם אף שאלון')}">–</td>`;
    const body = list.map(r => `<tr>
      <td><button type="button" class="font-bold text-indigo-700 hover:text-indigo-900 text-right hover:underline whitespace-nowrap cursor-pointer" data-act="openProfile" data-tz="${E(r.t.tz)}" title="${E(`ת.ז ${r.t.tz}`)}">${E(r.t.name)}</button></td>
      <td><span class="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-800">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</span></td>
      <td class="whitespace-nowrap text-slate-700">${r.level ? `${E(r.level)} יח'` : ''}${r.teacher ? ` <span class="text-slate-500 text-xs">· ${E(r.teacher)}</span>` : ''}</td>
      ${qCells(r)}${accTd(r)}${finalTd(r)}</tr>`).join('');
    const cols = 5 + m.questionnaires.length;
    return `<div class="flex items-center justify-between gap-2 flex-wrap px-3 py-2 mb-2 rounded-lg bg-slate-100 text-sm">
        <span class="font-bold text-slate-800">${E(m.name)} · ${list.length} חניכים · ${m.questionnaires.length} שאלונים</span>
        <button type="button" class="btn btn-ghost btn-sm" data-act="bagrutDrillBack">← חזרה למבט על (כל המקצועות)</button></div>
      <table class="grid mx w-full text-center"><thead><tr>${th('name', 'שם החניך')}${th('class', 'כיתה')}${th('units', 'יח"ל / קבוצה')}${m.questionnaires.map(q => th(qKey(q), `${E(q.code)} · ${E(q.weightText)}%`, q.names.join(' | '))).join('')}${th('acc', '🧮 נצבר')}${th('final', 'סופי')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${cols}" class="text-center text-slate-400 py-8">אין חניכים להצגה במקצוע זה</td></tr>`}</tbody></table>`;
  },

  /** שורת שקיפות: אילו רכיבים כבר נבחנו בשכבה (>= 15% מהחניכים עם ציון) ואילו עדיין "בתהליך" */
  renderCohortInfo(rows) {
    const box = $('bagrut-cohort');
    if (!box) return;
    if (this.state.sim.fullMode || !Store.loaded.bagrut) { box.innerHTML = ''; return; }
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
    const val = r => ({ name: r.t.name, class: r.t.classKey, grade: Util.ord(r.t.gradeKey), track: this.trackOf(r.t), tier: r.ev.tier, tz: r.t.tz, diag: r.ev.diagnostic })[sort];
    return rows.filter(r => this.chipMatch(r, chip)).sort((a, b) => {
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
      const failed = ['fail', 'lost', 'missing', 'noshow'].includes(c.state) || (c.text.trim() !== '' && Number.isFinite(numeric) && numeric < rules.passGrade);
      const style = c.state === 'comp' ? 'text-amber-700 font-semibold' : failed ? 'score-alert' :
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
      const detail = ['יחידות פנימיות (שער 3)', ...cells.map(c => c.tip)].join(' | ');
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
      return `<td class="mx-focus" title="${E(items.map(x => x.text).join(' · '))}">${body}</td>`;
    };
    const pill = ev => {
      let text = ev.tierText;
      if (ev.adaptive && ev.tier === 3 && !ev.manual) text += ` (חסם ${ev.blockers.filter(b => !b.info).length})`;
      const status = ev.tier === 1 ? `<span class="text-emerald-700 font-medium whitespace-nowrap" title="${E(ev.diagnostic)}">✓ ${E(text)}</span>` :
        ev.tier === 0 || ev.tier === 5 ? `<span class="text-slate-400 whitespace-nowrap" title="${E(ev.diagnostic)}">${E(text)}</span>` :
        `<span class="badge pill-t${ev.tier} whitespace-nowrap" title="${E(ev.diagnostic)}">${E(text)}</span>`;
      return `<div>${status}</div>
        ${ev.manual ? '<div><span class="badge badge-exc">⚡ חריג</span></div>' : ev.isPotentialException ? `<div><span class="badge tier-3" title="${E(ev.potentialExceptionReason)}">חשד לחריג</span></div>` : ''}`;
    };

    const cols = 6 + coreCols.length;
    const body = this.homeroomRows(list.slice(0, 1500), cols, ({ t, ev }) => {
      const track = this.trackOf(t);
      return `
      <tr>
        <td><button type="button" class="font-bold text-indigo-700 hover:text-indigo-900 text-right hover:underline whitespace-nowrap cursor-pointer" data-act="openProfile" data-tz="${E(t.tz)}" title="${E(`ת.ז ${t.tz}`)}">${E(t.name)}</button></td>
        <td><span class="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-800">${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)}${track && track !== 'רגילה' ? ` <span class="badge fresh-slate border">${E(track)}</span>` : ''}</span></td>
        <td>${pill(ev)}</td>
        ${coreCols.map(([id, label]) => subjectTd(ev.cells[id], label)).join('')}
        ${subjectTd(ev.majorCell && Object.assign({}, ev.majorCell, { units: '' }), 'מגמה 5 יח"ל')}
        ${internalsTd(ev)}
        ${focusTd(ev)}
      </tr>`;
    });
    const coreHead = ([id, l]) => `<th><button type="button" class="font-semibold hover:underline" data-act="bagrutDrill" data-sel="core:${id}" title="מטריצת שאלונים – ${E(l)}">${l}</button></th>`;
    return `<table class="grid mx w-full text-center"><thead><tr>${th('name', 'חניך')}${th('class', 'כיתה')}${th('tier', 'צפי זכאות')}${coreCols.map(coreHead).join('')}${plain('מגמה 5 יח"ל')}${plain('פנימיים')}${plain('מיקוד פדגוגי (מה נדרש)', 'mx-focus')}</tr></thead>
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

  /* ---------- מגירת כללי זכאות ומשקלים ---------- */
  toggleDrawer(force) {
    const drawer = $('rulesDrawer');
    if (!drawer) return;
    const open = typeof force === 'boolean' ? force : drawer.classList.contains('hidden');
    drawer.classList.toggle('hidden', !open);
    const btn = $('btnRulesToggle');
    if (btn) btn.setAttribute('aria-expanded', String(open));
    if (open) this.renderRulesDrawer();
  },

  applyRule(res) {
    if (res && res.ok === false) { this.toast(res.error || 'השינוי נדחה', 'error'); this.renderRulesDrawer(); }
  },

  renderRulesDrawer() {
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
      <label class="flex items-center gap-2"><input type="checkbox" class="w-4 h-4" data-chg="gateToggle" data-gate="${g}" ${gates[g] && gates[g].enabled === false ? '' : 'checked'}>${E((gates[g] && gates[g].label) || g)}</label>`).join('') +
      `<label class="flex items-center gap-2 text-xs">יח"ל מינימום במגמה<input type="number" min="1" max="5" class="inp w-16" data-chg="gateUnits" value="${(gates.major && gates.major.requiredUnits) || 5}"></label>`);

    const attrs = (kind, id, level, i) => `data-kind="${kind}" data-id="${E(id)}" data-level="${E(level)}" data-i="${i}"`;
    const GRADE_OPTS = ['י', 'יא', 'יב'];
    const compRow = (s, level, c, i) => {
      const q = r.questionnaires[c.codes[0]];
      const grade = q ? q.expectedGrade : 'יב';
      return `<div class="flex flex-wrap items-center gap-1.5 text-xs py-0.5 ${c.enabled === false ? 'opacity-50' : ''}">
        <input type="checkbox" class="w-4 h-4" aria-label="פעיל" data-chg="compEnabled" ${attrs('core', s.id, level, i)} ${c.enabled === false ? '' : 'checked'}>
        <input type="text" class="inp w-28" aria-label="סמלי שאלון" value="${E(c.codes.join(', '))}" data-chg="compCodes" ${attrs('core', s.id, level, i)}>
        <label class="flex items-center gap-1">משקל<input type="number" min="0" max="100" class="inp w-14" value="${c.weight}" data-chg="compWeight" ${attrs('core', s.id, level, i)}>%</label>
        <select class="inp" aria-label="שכבה צפויה" title="שכבה צפויה לשאלון" data-chg="qGrade" data-code="${E(c.codes.join(','))}">${GRADE_OPTS.map(g => `<option value="${g}" ${grade === g ? 'selected' : ''}>${Util.gl(g)}</option>`).join('')}</select>
        <input type="text" class="inp w-36" aria-label="שם השאלון" placeholder="שם השאלון" title="שם השאלון בקטלוג" value="${E(q ? q.name : '')}" data-chg="qName" data-code="${E(c.codes[0])}">
        <button type="button" class="btn btn-danger btn-sm mr-auto" aria-label="הסרת שאלון" data-act="compRemove" ${attrs('core', s.id, level, i)}>✕</button></div>`;
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
        <label class="flex items-center gap-1 text-xs">מילות מפתח<input type="text" class="inp w-44" value="${E((m.keywords || []).join(', '))}" data-chg="clauseKeywords" data-kind="major" data-id="${E(m.id)}"></label>
        <button type="button" class="btn btn-danger btn-sm mr-auto" data-act="ruleRemove" data-kind="major" data-id="${E(m.id)}">הסרה</button></div>`).join(''));

    setHtml('rulesInternal', r.internals.map(it => `
      <div class="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg p-2 bg-white text-sm ${it.enabled === false ? 'opacity-60' : ''}">
        <label class="flex items-center gap-2 font-medium min-w-[160px]"><input type="checkbox" class="w-4 h-4" data-chg="ruleToggle" data-kind="internal" data-id="${E(it.id)}" ${it.enabled === false ? '' : 'checked'}>${E(it.name)}</label>
        <label class="flex items-center gap-1 text-xs">סמלים<input type="text" class="inp w-32" value="${E(it.codes.join(', '))}" data-chg="clauseCodes" data-kind="internal" data-id="${E(it.id)}"></label>
        <label class="flex items-center gap-1 text-xs">נדרש עד שכבה
          <select class="inp" data-chg="internalGrade" data-id="${E(it.id)}">${['י', 'יא', 'יב'].map(g => `<option value="${g}" ${it.expectedGrade === g ? 'selected' : ''}>${Util.gl(g)}</option>`).join('')}</select></label>
        <button type="button" class="btn btn-danger btn-sm mr-auto" data-act="ruleRemove" data-kind="internal" data-id="${E(it.id)}">הסרה</button></div>`).join(''));

    const RULE_TABS = [['core', 'שער 1 – מקצועות ליבה'], ['major', 'שער 2 – מגמות'], ['internal', 'שער 3 – יחידות פנימיות'], ['params', 'חוק קיזוז ופרמטרים']];
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
        { key: 'code', label: 'סמל שאלון ראשון (אופציונלי)' }, { key: 'weight', label: 'משקל השאלון (%)', type: 'number', value: 100 }
      ], v => Config.addClause('core', {
        name: v.name.trim(), units: Number(v.units) || 2, keywords: split(v.keywords).length ? split(v.keywords) : [v.name.trim()],
        components: v.code.trim() ? [{ codes: split(v.code), weight: Number(v.weight), enabled: true }] : []
      }));
    } else if (kind === 'major') {
      this.formModal('הוספת מגמה', [
        { key: 'name', label: 'שם המגמה' }, { key: 'keywords', label: 'מילות מפתח לזיהוי קבוצה (מופרדות בפסיקים)' },
        { key: 'codes', label: 'סמלי שאלון (מופרדים בפסיקים)' }
      ], v => Config.addClause('major', { name: v.name.trim(), keywords: split(v.keywords).length ? split(v.keywords) : [v.name.trim()], codes: split(v.codes) }));
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
  openExceptionModal(tz) {
    const t = Store.trainees.get(tz);
    if (!t) return;
    const ex = Config.getException(tz), ev = this.getEval(tz);
    this.openModal(`
      <h3 class="text-lg font-semibold mb-1">⚡ מצב חריג – ${E(t.name)}</h3>
      <p class="text-xs text-slate-500 mb-3">ת.ז ${t.tz} · ${E(Config.classLabel(t.classKey))}</p>
      ${ev.isPotentialException ? `<div class="text-sm bg-violet-50 text-violet-800 rounded-lg p-2 mb-3">חשד לחריג: ${E(ev.potentialExceptionReason)}</div>` : ''}
      <label class="flex items-center gap-2 text-sm mb-3"><input type="checkbox" id="xmIs" class="w-4 h-4" ${ex.isException ? 'checked' : ''}>מוחרג מחישוב אוטומטי</label>
      <label class="flex flex-col gap-1 text-sm mb-3">סטטוס מוכרע
        <select id="xmStatus" class="inp">${Config.OVERRIDE_STATUSES.map(s => `<option value="${s.value}" ${(ex.overrideStatus || 'atrisk') === s.value ? 'selected' : ''}>${E(s.label)}</option>`).join('')}</select></label>
      <label class="flex flex-col gap-1 text-sm">סיבת החריג
        <input id="xmReason" class="inp" maxlength="200" value="${E(ex.reason)}" placeholder="למשל: עולה חדש – הקלות שפה / המרת שאלון מבי&quot;ס קודם"></label>
      <div class="flex gap-2 mt-4">
        <button type="button" class="btn btn-primary" data-act="excModalSave" data-tz="${t.tz}">שמירה</button>
        <button type="button" class="btn btn-ghost" data-act="excModalClear" data-tz="${t.tz}">הסרת חריג</button>
        <button type="button" class="btn btn-ghost mr-auto" data-act="closeModal">סגירה</button>
      </div>`);
  },

  /* ==================================================================
     פאנל 2 – בקרת קבוצות ושיבוצים
     ================================================================== */
  renderGroupsPanel() {
    this.syncGroupLayout();
    this.renderFreshnessBar('groups');
    const st = this.state.groups, explorer = st.view === 'explorer';
    document.querySelectorAll('[data-gview]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.gview === st.view)));
    const show = (id, on) => { const el = $(id); if (el) el.classList.toggle('hidden', !on); };
    const message = text => {
      this._explorerView = []; this._boardMissing = [];
      show('groups-explorer', false); show('groups-table', true); show('gctl-explorer', false); show('gctl-anomalies', false); show('groups-kpis', false); show('groups-strip', false);
      setHtml('groups-table', `<div class="p-8 text-center text-slate-500">${text}</div>`);
    };
    if (!Store.hasData()) {
      this._explorerView = []; this._boardMissing = [];
      this.noRoster(['groups-kpis', 'groups-master', 'groups-detail'], 'groups-table');
      show('groups-table', true); show('groups-explorer', false); show('gctl-explorer', false); show('gctl-anomalies', false); show('groups-kpis', false); show('groups-strip', false);
      return;
    }
    if (explorer && !Store.loaded.groups) return message('הסייר מציג את הרשימות השמיות כפי שנרשמו במשוב, ולכן נדרש קובץ קבוצות לימוד. אפשר לטעון אותו בכפתור שבראש הפאנל.');
    if (!explorer && !Store.loaded.groups && !Store.loaded.grades) return message('נדרש קובץ קבוצות ושיבוצים לניתוח השיבוצים. אפשר לטעון אותו בכפתור שבראש הפאנל.');

    show('groups-explorer', explorer); show('gctl-explorer', explorer);
    show('groups-table', !explorer); show('gctl-anomalies', !explorer);
    show('groups-kpis', !explorer);
    $('groups-kpis').classList.toggle('grid', !explorer);
    if (!explorer) show('groups-strip', false);
    if (explorer) return this.renderGroupsExplorer();

    const list = this.filtered();
    const opt = (v, l, cur) => `<option value="${E(v)}" ${v === cur ? 'selected' : ''}>${E(l)}</option>`;
    const analysis = GroupAnalyzer.analyzeGroupAnomalies(list, st.subject);
    const c = analysis.counts;
    const stat = (k, cls, label, n) => `<button type="button" class="gstat ${cls}" data-act="anKind" data-kind="${k}" aria-pressed="${st.kind === k}" title="${E(label)}">
      <span class="text-xs font-bold text-slate-700 truncate">${label}</span><span class="text-sm font-extrabold px-2 py-0.5 rounded bg-slate-100 whitespace-nowrap">${n}</span></button>`;
    setHtml('groups-kpis',
      stat('all', 'gstat-ok', 'הכל', analysis.traineeCount) + stat('none', 'gstat-bad', 'חוסר', c.none) + stat('dup', 'gstat-violet', 'כפילות', c.dup) +
      stat('nomajor', 'gstat-bad', 'ללא מגמה', c.nomajor) + stat('unmatched', 'gstat-amber', 'לא במצבת', c.unmatched));
    setHtml('groupsSubject', opt('all', 'כל מקצועות החובה + מגמה', st.subject) +
      GroupAnalyzer.coreSubjects().map(s => opt(s.id, s.name, st.subject)).join('') + opt('major', 'מגמה 5 יח"ל בלבד', st.subject));
    setHtml('groups-table', this.anomaliesTable(analysis, list));
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
    const population = this.filtered(false), populationIds = new Set(population.map(t => t.tz));
    const scoped = f.grade !== 'all' || f.cls !== 'all' || f.track !== 'all';
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
    const q = Util.norm(f.q).toLocaleLowerCase(), code = q.replace(/^\[|\]$/g, '');
    const hit = t => !!q && (Util.norm(t.name).toLocaleLowerCase().includes(q) || t.tz.includes(q));
    let scope = visible.filter(g => (st.subjectKey === 'all' || g.cat.key === st.subjectKey) && (st.teacher === 'all' || g.teacher === st.teacher));
    if (q) scope = scope.filter(g => (code && g.groupId.toLocaleLowerCase().includes(code)) || g.members.some(m => hit(m.t)));
    const dupGroups = new Set(health ? health.dup.flatMap(d => d.groups.map(g => g.groupId)) : []);
    const strayIds = new Set(health ? health.stray.map(s => `${s.g.groupId}\u0000${s.t.tz}`) : []);
    if (st.strip === 'missing') scope = [];
    if (st.strip === 'dup') scope = scope.filter(g => dupGroups.has(g.groupId));
    if (st.strip === 'stray') scope = scope.filter(g => g.members.some(m => strayIds.has(`${g.groupId}\u0000${m.t.tz}`)));
    scope.sort((a, b) => a.cat.order - b.cat.order || a.subject.localeCompare(b.subject, 'he') || (a.teacher || 'תת').localeCompare(b.teacher || 'תת', 'he') || natural(a.groupId, b.groupId));
    this._explorerView = scope;
    const missing = health && (st.strip === 'all' || st.strip === 'missing') ? health.missing.filter(t => !q || hit(t)) : [];
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

  groupListItem(g, selected) {
    const sub = [E(g.subject), g.targetClasses ? `<bdi dir="rtl">${E(g.targetClasses)}</bdi>` : ''].filter(Boolean).join(' • ');
    const badges = selected ? 'bg-white/15 text-white border-white/30' : 'bg-slate-100 text-slate-900 border-slate-300';
    return `<button type="button" data-act="gPick" data-id="${E(g.groupId)}" aria-pressed="${selected}"
      class="w-full text-right rounded-xl border py-2 px-3 transition ${selected ? 'bg-slate-900 text-white border-slate-900 border-r-4 border-r-indigo-400 shadow-lg' : 'bg-white border-slate-300 hover:border-indigo-500 hover:shadow-md text-slate-900'}">
      <span class="flex items-center justify-between gap-2">
        <span class="min-w-0"><span class="text-sm leading-4 font-bold block truncate">${E(g.teacher || 'ללא מורה')}</span><span class="text-xs leading-4 block truncate ${selected ? 'text-indigo-100' : 'text-slate-700'}">${sub}</span></span>
        <span class="flex flex-wrap justify-end gap-1 shrink-0"><span class="badge font-mono ${badges}">[${E(g.groupId)}]</span><span class="badge ${badges}">${g.total} חניכים</span></span>
      </span></button>`;
  },

  renderGroupDetail(g, missing, hit, cat) {
    const st = this.state.groups;
    if (!g && !st.missingSelected) return setHtml('groups-detail', '<div class="card p-10 text-center text-slate-700">בחרו קבוצה מהרשימה כדי לראות את הרשימה השמית שלה</div>');
    const members = g ? g.members : missing.map(t => ({ t, diag: [], severity: 9 }));
    const anomalies = members.filter(m => m.diag.length).sort((a, b) => a.severity - b.severity);
    const rooms = new Map();
    members.filter(m => !m.diag.length).forEach(m => {
      if (!rooms.has(m.t.classKey)) rooms.set(m.t.classKey, []);
      rooms.get(m.t.classKey).push(m);
    });
    const row = m => {
      const t = m.t, count = Store.currentOf(t.tz).reduce((n, e) => n + e.events.length, 0);
      const tint = hit(t) ? 'bg-yellow-100' : '';
      const notes = m.diag.map(d => this.flatNote(d.kind === 'outlier' ? 'warn' : 'severe', d.text, d.title)).join('');
      return `<tr class="${tint}"><td class="tz-col">${E(t.tz)}</td><td><button type="button" class="font-semibold text-indigo-800 hover:underline text-right" data-act="openBoardProfile" data-tz="${E(t.tz)}" title="${E(`סדין: ${count} אירועים`)}">${E(t.name)}</button></td>
        <td><bdi dir="rtl">${E(Config.classLabel(t.classKey))}</bdi>${this.overrideBadge(t.tz)}</td><td>${notes || (g ? '<span class="text-emerald-800">✓ תקין</span>' : 'ללא שיבוץ')}</td></tr>`;
    };
    const divider = (text, cls = '') => `<tr class="room-divider ${cls}"><td colspan="4">${text}</td></tr>`;
    const body = (anomalies.length ? divider(`חריגי שיבוץ בקבוצה זו (${anomalies.length})`, 'anomaly-divider') + anomalies.map(row).join('') : '') +
      [...rooms.entries()].map(([key, items]) => divider(`כיתה <bdi dir="rtl">${E(Config.classLabel(key))}</bdi> (${items.length})`) + items.map(row).join('')).join('');
    const title = g ? `${E(g.subject)} • ${E(g.teacher || 'ללא מורה')} <span class="font-mono">[${E(g.groupId)}]</span>` : `לא משובצים ל${E(cat ? cat.label : '')}`;
    const declared = g && g.declared != null && g.declared !== g.total ? `<span class="badge tier-3">מוצהר ${g.declared}</span>` : '';
    setHtml('groups-detail', `<article class="card overflow-hidden lg:h-full lg:flex lg:flex-col lg:min-h-0">
      <header class="bg-gradient-to-l from-slate-900 to-slate-800 text-white px-4 py-2.5 rounded-t-xl flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div><h3 class="text-lg font-bold">${title}</h3>${g && g.targetClasses ? `<div class="text-xs text-indigo-100 mt-1">כיתות יעד: <bdi dir="rtl">${E(g.targetClasses)}</bdi></div>` : ''}</div>
        <div class="flex flex-wrap items-center gap-2"><span class="badge bg-indigo-500 text-white border-indigo-300">${members.length} חניכים</span>${declared}        ${g && g.reinforcement ? '<span class="badge bg-white/15 text-white border-white/30">תגבור</span>' : ''}</div>
      </header>
      <div class="sticky-scroll lg:flex-1 lg:min-h-0 overscroll-contain"><table class="grid w-full"><thead><tr><th>ת.ז</th><th>שם חניך</th><th>כיתת אם</th><th>חיווי בקרה</th></tr></thead>
      <tbody>${body || '<tr><td colspan="4" class="text-center text-slate-700 py-6">אין חניכים להצגה</td></tr>'}</tbody></table></div></article>`);
  },

  /** ממצא שטוח: טקסט בלבד בלי רקע, מסגרת או ריפוד; חמור בבורדו, בינוני בענבר. כל ממצא בשורה משלו */
  flatNote(level, text, title = '') {
    return `<span class="block text-xs font-medium ${level === 'severe' ? 'text-rose-900' : 'text-amber-800'}"${title ? ` title="${E(title)}"` : ''}>${E(text)}</span>`;
  },

  anomaliesTable(analysis, list) {
    const st = this.state.groups;
    const byTz = new Map(list.map(t => [t.tz, t]));
    const KIND = { none: ['חוסר', 'severe'], dup: ['כפילות', 'severe'], nomajor: ['ללא', 'warn'] };
    const card = (table, count) => `<header class="bg-gradient-to-l from-slate-900 to-slate-800 text-white px-4 py-2.5 rounded-t-xl flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-lg font-bold">${st.kind === 'unmatched' ? 'רשומות שאינן במצבת' : 'חריגי שיבוץ'}</h3>
      <span class="badge bg-indigo-500 text-white border-indigo-300">${count} ${st.kind === 'unmatched' ? 'רשומות' : 'חניכים'}</span>
      </header><div class="sticky-scroll overscroll-contain">${table}</div>`;

    if (st.kind === 'unmatched') {
      return card(`<table class="grid w-full"><thead><tr><th class="tz-col text-right">ת.ז</th><th class="text-right">שם בקובץ</th><th class="text-right">מופיעה ב</th></tr></thead><tbody>${
              analysis.unmatched.map(u => `<tr><td class="tz-col text-right">${E(u.tz)}</td><td class="text-right font-semibold text-slate-800">${E(u.name || '—')}</td><td class="text-right text-slate-700">${E(u.sources.join(' • '))}</td></tr>`).join('') ||
        '<tr><td colspan="3" class="text-center text-emerald-800 py-8">כל הת.ז בקובצי המשנה נמצאות במצבת 🎉</td></tr>'}</tbody></table>`, analysis.unmatched.length);
    }
    /* שורה אחת לחניך: כל הממצאים שלו כתגיות בתא אחד */
    const byTrainee = new Map();
    analysis.items.filter(a => st.kind === 'all' || a.kind === st.kind).forEach(a => {
      if (!byTrainee.has(a.tz)) byTrainee.set(a.tz, []);
      byTrainee.get(a.tz).push(a);
    });
    const rowsHtml = [...byTrainee.entries()].filter(([tz]) => byTz.has(tz)).slice(0, 1500).map(([tz, found]) => {
      const t = byTz.get(tz);
      const badges = found.map(a => {
        const detail = a.groups.length ? ` (${a.groups.map(g => `[${g.groupId}] ${g.teacher || 'ללא מורה'}`).join(', ')})` : '';
        return this.flatNote(KIND[a.kind][1], `${KIND[a.kind][0]}: ${a.subject}`, a.subject + detail);
      }).join('');
      return `<tr class="cursor-pointer" data-act="openProfile" data-tz="${tz}"><td class="tz-col min-w-[95px] whitespace-nowrap text-right">${tz}</td><td class="text-right"><button type="button" class="font-semibold text-indigo-800 hover:underline text-right" data-act="openProfile" data-tz="${E(tz)}">${E(t.name)}</button></td>
        <td class="text-right">${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)}</td><td class="text-right">${badges}</td></tr>`;
    }).join('');
    return card(`<table class="grid w-full"><colgroup><col style="width:12%"><col style="width:20%"><col style="width:12%"><col style="width:56%"></colgroup>
      <thead><tr><th class="tz-col min-w-[95px] whitespace-nowrap text-right">ת.ז</th><th class="text-right">שם</th><th class="text-right">כיתה</th><th class="text-right">ממצאי שיבוץ</th></tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="4" class="text-center text-emerald-800 py-8">לא נמצאו חריגות 🎉</td></tr>'}</tbody></table>`, byTrainee.size);
  },

  /* ==================================================================
     פאנל 3 – מוניטור ציונים שוטפים
     ================================================================== */
  renderSadinPanel() {
    this.renderFreshnessBar('sadin');
    const st = this.state.sadin;
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
    const all = GroupAnalyzer.sadinSheet(this.filtered(), st);
    const graded = all.filter(r => r.overall != null);
    const mean = graded.length ? graded.reduce((sum, r) => sum + r.overall, 0) / graded.length : null;
    const filters = [
      ['all', 'כל החניכים', all.length],
      ['fail', 'עם נכשל שוטף', all.filter(r => r.failing > 0).length],
      ['multiple', 'ריבוי שליליים', all.filter(r => r.failing >= 2).length],
      ['missed', 'אירועים שהוחמצו', all.filter(r => r.missed > 0).length]
    ];
    setHtml('sadinFilterSelect', filters.map(([key, label, count]) => option(key, `${label} (${count})`, st.strip)).join(''));
    const selectedFilter = filters.find(([key]) => key === st.strip);
    $('sadinFilterSelect').title = `${selectedFilter ? `${selectedFilter[1]} (${selectedFilter[2]}) · ` : ''}ממוצע כללי בסינון: ${Util.fmt(mean, 1)}`;
    const rows = all.filter(r => st.strip === 'all' || (st.strip === 'fail' && r.failing > 0) || (st.strip === 'multiple' && r.failing >= 2) || (st.strip === 'missed' && r.missed > 0));
    if (st.view === 'flat') this.renderSadinFlat(rows);
    else this.renderSadinSheet(rows, st.subject !== 'all' || st.teacher !== 'all');
  },

  /** ציון כטקסט שטוח בשורה אחת, בלי רקע או מסגרת: אדום כהה לנכשל/חסר/מסומן, אפור-כהה לעובר */
  sadinScore(value, missed = false) {
    const text = value == null ? (missed ? 'חסר' : '—') : Util.fmt(value, 0);
    const alert = missed || (value != null && value < SADIN_PASS);
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
    /* עמודת מקצוע מוצגת רק אם לפחות חניך אחד בסינון רשום בה, בעל ציון או אירוע שהוחמץ; מקצועות ליבה קודם, אחריהם בחירה */
    const relevant = s => s.entries.length || s.events.length || s.missed.size;
    const names = [...new Set(rows.flatMap(r => [...r.subjects.values()].filter(relevant).map(s => s.name)))]
      .sort((a, b) => rank(a) - rank(b) || natural(a, b));
    const columns = [];
    names.forEach(name => {
      if (eventsMode) {
        const events = new Map();
        rows.forEach(r => {
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
    const body = this.homeroomRows(rows, columns.length + 4, r => {
      const cells = columns.map(col => {
        const s = r.subjects.get(col.name);
        if (!s) return '<td class="text-slate-300">—</td>';
        if (col.kind === 'event') {
          const ev = s.events.find(x => x.key === col.event.key), missed = s.missed.has(col.event.key);
          const val = ev && ev.score != null ? ev.score : null;
          const text = ev && ev.score == null && ev.scoreRaw ? String(ev.scoreRaw) : '';
          const eventTip = `${col.name} · ${col.event.eventName || 'אירוע'}${col.event.date ? ` · ${col.event.date}` : ''} · משקל ${col.event.weight} · ${val != null ? String(val) : text || (missed ? 'חסר' : '—')}`;
          return `<td title="${E(eventTip)}">${val != null || missed ? this.sadinScore(val, missed) : text ? E(text) : '<span class="text-slate-300">—</span>'}</td>`;
        }
        return `<td><button type="button" class="w-full text-center" data-act="sadinPop" data-tip="${E(this.sadinTip(s))}" aria-label="${E(`${col.name}: ממוצע ${Util.fmt(s.avg, 1)}. הצגת פירוט`)}">${this.sadinScore(s.avg, s.missed.size > 0)}</button></td>`;
      }).join('');
      return `<tr><td><button type="button" class="font-bold text-indigo-700 hover:text-indigo-900 hover:underline whitespace-nowrap cursor-pointer" data-act="openProfile" data-tz="${E(r.t.tz)}" title="${E(`ת.ז ${r.t.tz}`)}">${E(r.t.name)}</button></td>
        <td><span class="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-800">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</span></td>        <td class="font-bold bg-[#FAF7EF]" title="${E(`ממוצע שווה-משקל של ממוצעי המקצועות: ${r.overall == null ? '—' : String(r.overall)}`)}">${this.sadinScore(r.overall, false)}</td>
                <td class="whitespace-nowrap border-l-2 border-[#E6ECE6]">${[r.failing ? `<span class="sadin-bad">${r.failing}</span>` : !r.missed ? '<span class="sadin-ok">✓ תקין</span>' : '', r.missed ? `<span class="sadin-bad text-xs">${r.missed} חסר</span>` : ''].filter(Boolean).join('<span class="text-slate-300"> • </span>')}</td>${cells}</tr>`;
    });
            setHtml('sadin-table', `<div class="sticky-scroll overscroll-contain"><table class="grid sadin-sheet w-full"><thead><tr><th>חניך</th><th>כיתה</th><th>ממוצע כללי</th><th class="border-l-2 border-[#75977D]">שליליים</th>${columns.map(c => `<th>${E(c.header)}</th>`).join('')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${columns.length + 4}" class="text-center text-slate-700 py-8">אין חניכים בסינון הנוכחי</td></tr>`}</tbody></table></div>`);
  },

  renderSadinFlat(rows) {
    /* שם וכיתה מוצגים רק בשורה הראשונה של כל חניך; השורה האחרונה שלו נושאת את קו ההפרדה */
    const body = this.homeroomRows(rows.filter(r => r.subjects.size), 7, r => [...r.subjects.values()].map((s, i, all) => {
        const teacher = [...new Set(s.entries.map(e => e.teacher).filter(Boolean))].join(', ');
        const groups = [...new Set(s.entries.map(e => e.groupId).filter(Boolean))].join(', ');
        const n = Store.weightedAverage(s.events).n;
        const last = i === all.length - 1;
        const who = i === 0
          ? `<td><button type="button" class="font-bold text-indigo-700 hover:text-indigo-900 hover:underline whitespace-nowrap cursor-pointer" data-act="openProfile" data-tz="${E(r.t.tz)}" title="${E(`ת.ז ${r.t.tz}`)}">${E(r.t.name)}</button></td><td><span class="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-800">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</span></td>`
          : '<td aria-hidden="true"></td><td aria-hidden="true"></td>';
        return `<tr class="${last ? 'student-end border-b border-[#E6ECE6]' : ''}">${who}
          <td>${E(s.name)}</td><td>${E(teacher || '—')}</td><td>${E(groups || '—')}</td><td>${n}</td><td><button type="button" data-act="sadinPop" data-tip="${E(this.sadinTip(s))}" aria-label="${E(`${s.name}: הצגת פירוט הציונים`)}">${this.sadinScore(s.avg, s.missed.size > 0)}</button></td></tr>`;
    }).join(''));
    setHtml('sadin-table', `<table class="grid sadin-flat w-full"><thead><tr><th>חניך</th><th>כיתה</th><th>מקצוע</th><th>מורה</th><th>קבוצה</th><th>אירועים</th><th>ממוצע משוקלל</th></tr></thead><tbody>${body || '<tr><td colspan="7" class="text-center py-8">אין נתונים בסינון הנוכחי</td></tr>'}</tbody></table>`);
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
      return `<tr class="cursor-pointer" data-act="openProfile" data-tz="${m.tz}"><td class="font-medium whitespace-nowrap">${E(t.name)}</td><td>${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)}</td>
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
  profileSubjectUnits(tz, s, def) {
    if (!def || !Number(s.units)) return null;
    const groups = Store.groupsOf(tz);
    const matching = groups.filter(g => !g.reinforcement && Util.matchKeywords(g.subject, def.keywords));
    const recorded = s.comps.filter(c => c.state === 'num' || c.state === 'pass');
    if (!matching.length && !recorded.length && Store.currentGrade(tz, def.keywords) == null) return null;
    if (s.variableUnits && !matching.some(g => String(g.units) === String(s.units))) {
      const otherCodes = new Set(Object.entries(def.levels || {}).filter(([level]) => level !== String(s.units)).flatMap(([, comps]) => comps.flatMap(c => c.codes)));
      if (!recorded.some(c => !otherCodes.has(c.code))) return null;
    }
    return Number(s.units);
  },

  profileUnits(tz, ev, rules) {
    let total = ev.subjects.reduce((sum, s) => sum + (this.profileSubjectUnits(tz, s, rules.coreSubjects.find(x => x.id === s.id)) || 0), 0);
    const groups = Store.groupsOf(tz);
    ev.major.cands.filter(c => !c.coreId).forEach(c => {
      const def = rules.majors.find(m => m.id === c.id);
      const group = def && groups.find(g => !g.reinforcement && Util.matchKeywords(g.subject, def.keywords) && Number(g.units));
      if (group) total += Number(group.units);
    });
    return total;
  },

  profileComponents(comps, variable) {
    const detail = comps.map((c, i) => {
      const q = Config.rules().questionnaires[c.code];
      const match = q && (q.name || '').match(/שאלון\s+([א-ת])(?:$|[\s"'׳״–-])/);
      const label = variable && comps.length > 1 ? `שאלון ${match ? `${match[1]}׳` : i + 1}: ` : '';
      const value = c.state === 'num' ? Util.fmt(c.reportedNum ?? c.num, 1) : c.state === 'pass' ? 'עבר' : c.failed ? 'לא עבר' : '—';
      return `${label}${value} (שאלון ${c.code}${c.weight ? ` · ${c.weight}%` : ''})`;
    }).join(' | ');
    const nums = comps.filter(c => c.state === 'num');
    const weight = nums.reduce((sum, c) => sum + c.weight, 0);
    const score = weight ? nums.reduce((sum, c) => sum + (c.reportedNum ?? c.num) * c.weight, 0) / weight :
      nums.length ? nums.reduce((sum, c) => sum + (c.reportedNum ?? c.num), 0) / nums.length : null;
    const value = score != null ? Util.fmt(score, 0) : comps.some(c => c.failed) ? 'לא עבר' : comps.some(c => c.state === 'pass') ? 'עבר' : '—';
    const cls = score != null && score < Config.rules().passGrade || value === 'לא עבר' ? 'score-alert' : value === '—' ? 'text-slate-400' : 'text-slate-800 font-normal';
    return `<span class="whitespace-nowrap ${cls}" title="${E(detail)}">${E(value)}</span>`;
  },

  profileSubjectStatus(s) {
    const badge = (cls, text) => `<span class="badge ${cls} whitespace-nowrap">${E(text)}</span>`;
    const plain = (cls, text) => `<span class="${cls} whitespace-nowrap">${E(text)}</span>`;
    if (s.comps.some(c => c.failed)) return badge('tier-4', 'לא עבר');
    if (s.noShow && s.unresolved.some(c => !c.internal)) return badge('tier-4', 'לא ניגש');
    if (s.enrolled === false) return plain('text-slate-500', 'לא משובץ');
    if (s.learning || s.pending.length || s.unresolved.length) return plain('text-slate-500', s.group ? 'לומד' : 'ממתין לדיווח');
    if ((s.forecast || s.filled.length) && s.status === 'pass') return plain('text-slate-500', 'לומד');
    if (s.compApplied) return badge('tier-3', `${s.forecast || s.source === 'current' ? 'תחזית ' : ''}${s.compApplied === 'points' ? 'פיצוי' : 'קיזוז'} (${Util.fmt(s.adj, 0)})`);
    if (s.status === 'pass') return plain('text-emerald-700 font-semibold', '✓ עובר');
    if (s.status === 'comp') return badge('tier-4', `קיזוז לא זמין (${Util.fmt(s.adj, 0)})`);
    if (s.status === 'fail' || s.status === 'severe') return badge('tier-4', 'נכשל');
    return plain('text-slate-500', s.group ? 'לומד' : 'אין נתון');
  },

  profileFocus(ev) {
    const items = [];
    ev.reverse.forEach(r => {
      const subject = ev.subjects.find(s => s.name === r.subject);
      const external = subject ? subject.comps.filter(c => !c.internal && c.state === 'num') : [];
      const weight = external.reduce((sum, c) => sum + c.weight, 0);
      const examScore = weight ? external.reduce((sum, c) => sum + (c.reportedNum ?? c.num) * c.weight, 0) / weight : r.externalScore;
      if (examScore >= Config.rules().passGrade || r.required30 <= 0) return;
      const prefix = `${r.subject} (${subject && subject.comps.some(c => c.magenForecast) ? 'בחינה ומגן משוער' : 'בחינה'} ${Util.fmt(r.externalScore, 0)})`;
      if (r.required30 > 100) {
        items.push(`${prefix}: עובר ב-${r.pct}% אינו אפשרי${r.level !== 'red' && r.requiredFor45 <= 100 ? `; לקיזוז נדרש ${r.requiredFor45}+` : ' – נדרש מועד נוסף'}`);
      } else items.push(`${prefix}: נדרש ${Math.max(1, r.required30)}+ ב-${r.pct}% לעובר`);
    });
    ev.subjects.filter(s => s.compApplied).forEach(s => {
      const low = s.comps.find(c => c.state === 'num' && c.num < Config.rules().passGrade);
      items.push(`${s.name}${s.variableUnits && s.units ? ` ${s.units} יח"ל` : ''}: ציון ${Util.fmt(s.adj, 0)}${low ? ` בשאלון ${low.code}` : ''} (${s.forecast || s.source === 'current' ? 'תחזית ' : 'מופעל '}${s.compApplied === 'points' ? 'פיצוי נקודות' : 'קיזוז'})`);
    });
    const failedCodes = new Set();
    ev.subjects.forEach(s => {
      const failed = s.comps.filter(c => c.failed);
      if (failed.length) items.push(`${s.name}: דווח לא עבר בשאלון`);
      failed.forEach(c => failedCodes.add(c.code));
    });
    ev.major.cands.filter(c => c.failed && !c.blocked).forEach(c => items.push(`${c.name}: דווח לא עבר בשאלון`));
    ev.blockers.filter(b => !b.info && b.k !== 'reverse30' && b.k !== 'reverse-pending' && !(b.inner && ev.reverse.length)).forEach(b => {
      if ((b.k === 'questionnaire' || b.k === 'noshow') && [...failedCodes].some(code => b.text.includes(`שאלון ${code}`))) return;
      const text = b.k === 'questionnaire' ? b.text.replace(/^שאלון [\d/]+ ב/, 'חסר שאלון ב') : b.text.replace(/\s*\(שאלון [\d/]+\)/g, '');
      items.push(text);
    });
    ev.suspect.filter(s => !s.startsWith('ציון חיצוני ללא רכיב בית-ספרי')).forEach(s => items.push(`לבדיקה: ${s}`));
    ev.subjects.forEach(s => {
      const low = s.comps.find(c => !c.internal && c.state === 'num' && (c.reportedNum ?? c.num) < Config.rules().passGrade);
      if (low && !items.some(text => text.includes(s.name))) items.push(`${s.name}: ציון ${Util.fmt(low.reportedNum ?? low.num, 0)} בבחינה`);
    });
    ev.internals.filter(i => i.explicitFail).forEach(i => {
      if (!items.some(text => text.includes(i.name))) items.push(`${i.name}: לא עבר`);
    });
    return [...new Set(items)];
  },

  renderTrainee360Panel() {
    const list = this.filtered();
    const sel = $('profSelect');
    if (!Store.hasData() || !list.length) {
      if (sel) sel.innerHTML = '';
      setText('profName', Store.hasData() ? 'אין חניכים בסינון הנוכחי' : 'טרם נטענה מצבת חניכים');
      ['profMeta', 'profBadges', 'profBody', 'profKpis'].forEach(id => setHtml(id, ''));
      ['profPrev', 'profNext', 'excTrack', 'excNote', 'excOpen'].forEach(id => { $(id).disabled = true; });
      return;
    }
    let idx = list.findIndex(t => t.tz === this.state.profileTz);
    if (idx < 0) idx = 0;
    const t = list[idx];
    this.state.profileTz = t.tz;
    const ev = this.getEval(t.tz), ex = Config.getException(t.tz), rules = Config.rules();
    ['excTrack', 'excNote', 'excOpen'].forEach(id => { $(id).disabled = false; });

    if (sel) sel.innerHTML = list.map(x => `<option value="${x.tz}" ${x.tz === t.tz ? 'selected' : ''}>${E(Config.classLabel(x.classKey))} · ${E(x.name)}</option>`).join('');
    const prev = $('profPrev'), next = $('profNext');
    if (prev) prev.disabled = idx === 0;
    if (next) next.disabled = idx === list.length - 1;
    setText('profName', t.name);
    setHtml('profMeta', `ת.ז ${E(t.tz)} · שכבה ${E(Util.gl(t.gradeKey))} · ${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)} · מסלול ${E(this.trackOf(t))} · ${idx + 1} מתוך ${list.length}`);
    const units = this.profileUnits(t.tz, ev, rules);
    setHtml('profBadges', `<span class="badge tier-${ev.tier} prof-status" title="${E(ev.diagnostic)}">${E(ev.tierText)}</span>
      <span class="badge fresh-slate" title="סכום יחידות מזוהות לפי שיבוצים או שאלונים; אינו סך זכאות רשמי">${units || '—'} יח"ל מזוהות</span>`);
    this.renderProfileKpis(t);
    const groupsFor = keywords => Store.groupsOf(t.tz).filter(g => !g.reinforcement && Util.matchKeywords(g.subject, keywords));
    const groupText = groups => groups.length ? `<span class="flex max-w-[9rem] items-center gap-1" title="${E(groups.map(g => `${g.teacher || 'ללא מורה'} [${g.groupId}]`).join(' · '))}"><span class="truncate min-w-0">${E(groups[0].teacher || 'ללא מורה')}</span>${groups.length > 1 ? `<span class="shrink-0">(+${groups.length - 1})</span>` : ''}</span>` : '<span class="text-slate-500">—</span>';
    const scoreText = (value, detail = '', compensated = false) => value == null ? '<span class="text-slate-400">—</span>' :
      `<span class="${compensated ? 'text-amber-700 font-semibold' : value < rules.passGrade ? 'score-alert' : 'text-slate-800 font-normal'}"${detail ? ` title="${E(detail)}"` : ''}>${E(Util.fmt(value, 0))}</span>`;
    const currentFor = keywords => Store.weightedAverage(Store.currentOf(t.tz).filter(e => Util.matchKeywords(e.subject, keywords)).flatMap(e => e.events)).avg;
    const g1 = ev.subjects.map(s => {
      const def = rules.coreSubjects.find(x => x.id === s.id);
      const groups = def ? groupsFor(def.keywords) : [];
      const subjectUnits = this.profileSubjectUnits(t.tz, s, def);
      const external = s.comps.filter(c => !c.internal), internal = s.comps.filter(c => c.internal);
      const partial = s.pending.length || s.unresolved.length;
      const value = partial && s.reportedScore != null ? s.reportedScore : s.adj;
      const suffix = partial && s.reportedScore != null ? ` (${s.reportedPct}%)` : s.forecast ? ' (תחזית)' : s.source === 'current' ? ' (שוטף)' : s.boosted ? ' (סימולציה)' : '';
      return `<tr><td><strong>${E(s.name)}</strong>${subjectUnits ? ` <span class="text-slate-500">· ${E(subjectUnits)} יח׳</span>` : ''}</td>
        <td>${groupText(groups)}</td><td>${scoreText(def ? currentFor(def.keywords) : null)}</td><td>${this.profileComponents(external, s.variableUnits)}</td><td>${this.profileComponents(internal, false)}</td>
        <td>${value != null ? scoreText(value, `${Util.fmt(value, 1)}${suffix}`, !!s.compApplied) : s.allPass ? 'עבר' : '—'}</td><td>${this.profileSubjectStatus(s)}</td></tr>`;
    }).join('');
    const majors = ev.major.cands.filter(c => !c.coreId);
    const g2 = majors.map(c => {
      const def = rules.majors.find(m => m.id === c.id);
      const groups = def ? groupsFor(def.keywords) : [];
      const units = groups.find(g => g.units);
      const codes = def ? def.codes.filter(code => Store.bagrutBest(t.tz, [code])) : [];
      const status = c.blocked || c.failed ? '<span class="badge tier-4">לא עבר</span>' : c.status === 'fail' ? '<span class="badge tier-4">נכשל</span>' : c.status === 'pass' && c.source === 'bagrut' && !c.missing.length && !c.forecast ? '<span class="text-emerald-700 font-semibold">✓ עובר</span>' : `<span class="text-slate-500">${c.enrolled ? 'לומד' : 'ממתין לדיווח'}</span>`;
      const value = c.adj != null ? c.adj : c.bagrut;
      const detail = c.adj != null ? (c.forecast ? 'תחזית' : c.source === 'current' ? 'שוטף' : '') : c.bagrut != null ? 'חלקי' : c.missing.length ? 'חלקי' : '';
      return `<tr><td><strong>${E(c.name)}</strong>${units ? ` <span class="text-slate-500">· ${E(units.units)} יח׳</span>` : ''}</td><td>${groupText(groups)}</td><td>${scoreText(def ? currentFor(def.keywords) : null)}</td>
        <td title="${E(codes.length ? `שאלונים: ${codes.join(', ')}` : '')}">${c.bagrut != null ? scoreText(c.bagrut) : c.bagrutPass ? 'עבר' : '—'}</td><td class="text-slate-400">—</td><td>${value != null ? scoreText(value, detail) : c.bagrutPass ? `<span title="${E(detail)}">עבר</span>` : '—'}</td><td>${status}</td></tr>`;
    }).join('') || `<tr><td colspan="7" class="text-slate-500">${ev.major.chosen && ev.major.chosen.coreId ? 'מקצוע מורחב נכלל במקצועות הליבה' : 'לא נמצאה מגמת בחירה'}</td></tr>`;
    const g3 = ev.internals.map(i => {
      const label = i.id === 'pe' ? 'חינוך גופני' : i.name;
      const cls = i.explicitFail ? 'badge tier-4' : i.done || i.exempt ? 'text-emerald-700 font-semibold' : 'text-slate-500';
      const text = i.explicitFail ? 'לא עבר' : i.exempt ? '✓ פטור' : i.done ? '✓ עבר' : i.ignored ? 'הוזנח בסימולציה' : typeof i.value === 'number' ? `ציון ${i.value} – לבדיקה` : 'בתהליך';
      return `<li class="flex justify-between items-center gap-1"><span class="font-medium">${E(label)}</span><span class="${cls} whitespace-nowrap">${E(text)}</span></li>`;
    }).join('');

    const groupsRows = Store.groupsOf(t.tz).map(g => {
      const e = Store.currentOf(t.tz).find(x => x.groupId === g.groupId);
      return `<tr><td>[${E(g.groupId)}]</td><td class="font-medium">${E(g.subject)}</td><td>${E(g.teacher || '—')}</td><td class="${e && e.avg != null && e.avg < rules.passGrade ? 'text-red-600 font-semibold' : ''}">${e ? Util.fmt(e.avg, 1) : '—'}</td></tr>`;
    }).join('');
    const events = Store.currentOf(t.tz).flatMap(e => e.events.map(x => ({ ...x, subj: e.subject }))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const eventsRows = events.map(x => `<tr><td>${E(x.date || '—')}</td><td>${E(x.subj)}</td><td>${E(x.eventName)}</td><td>${x.weight}</td>
      <td class="${x.score == null || x.score === 0 ? 'text-amber-600' : x.score < rules.passGrade ? 'text-red-600 font-semibold' : ''}">${x.score == null ? 'חסר' : x.score}</td></tr>`).join('');
    const attRows = Store.attemptsOf(t.tz).sort((a, b) => natural(a.code, b.code) || natural(a.moed, b.moed)).map(a => {
      const cls = a.cls.kind === 'num' ? (a.cls.num >= rules.passGrade ? ['text-emerald-700 font-semibold', '✓ עבר'] : ['badge tier-4', 'נכשל']) : a.cls.kind === 'pass' ? ['text-emerald-700 font-semibold', '✓ עבר'] : a.cls.kind === 'fail' ? ['badge tier-4', 'לא עבר'] : ['text-slate-500', '—'];
      return `<tr><td>${a.code}</td><td class="text-xs">${E((rules.questionnaires[a.code] || {}).name || '')}</td><td>${E(a.subject)}</td>
        <td>${E(a.submission || '—')}</td><td>${E(a.exam || '—')}</td><td class="font-medium">${E(a.final || '—')}</td><td>${E(a.moed || '—')}</td><td><span class="${cls[0]}">${cls[1]}</span></td></tr>`;
    }).join('');

    const emptyRow = (cols, text) => `<tr><td colspan="${cols}" class="text-slate-400">${text}</td></tr>`;
    const PROFILE_TABS = [['bagrut', 'שאלוני בגרות'], ['events', 'ציר אירועי הערכה'], ['groups', 'קבוצות לימוד ומורים']];
    const counts = { bagrut: Store.attemptsOf(t.tz).length, events: events.length, groups: Store.groupsOf(t.tz).length };
    const profTab = this.state.profTab && PROFILE_TABS.some(x => x[0] === this.state.profTab) ? this.state.profTab : 'bagrut';
    const tabTables = {
      bagrut: `<table class="grid w-full"><thead><tr><th class="text-right">סמל</th><th class="text-right">שאלון</th><th class="text-right">מקצוע</th><th class="text-right">הגשה</th><th class="text-right">בחינה</th><th class="text-right">סופי</th><th class="text-right">מועד</th><th class="text-right">סטטוס</th></tr></thead><tbody>${attRows || emptyRow(8, 'אין ציוני בגרות')}</tbody></table>`,
      events: `<table class="grid w-full"><thead><tr><th class="text-right">תאריך</th><th class="text-right">מקצוע</th><th class="text-right">אירוע</th><th class="text-right">משקל</th><th class="text-right">ציון</th></tr></thead><tbody>${eventsRows || emptyRow(5, 'אין אירועים')}</tbody></table>`,
      groups: `<table class="grid w-full"><thead><tr><th class="text-right">קבוצה</th><th class="text-right">מקצוע</th><th class="text-right">מורה</th><th class="text-right">ממוצע</th></tr></thead><tbody>${groupsRows || emptyRow(4, 'אין שיבוצים')}</tbody></table>`
    };

    const focus = this.profileFocus(ev);
    const focusList = rows => `<ul class="list-disc pr-4 space-y-1">${rows.map(text => `<li>${E(text)}</li>`).join('')}</ul>`;
    const hasGrades = ev.subjects.some(s => s.comps.some(c => c.state === 'num' || c.state === 'pass')) || majors.some(c => c.bagrut != null);
    const focusHtml = focus.length ? focusList(focus.slice(0, 5)) + (focus.length > 5 ? `<details class="mt-1"><summary class="cursor-pointer font-semibold text-indigo-700">עוד ${focus.length - 5} סעיפים</summary>${focusList(focus.slice(5))}</details>` : '') :
      ev.tier === 0 && !ev.manual || !hasGrades ? '<p class="text-slate-600">אין מספיק נתוני בגרות להצגת יעדים.</p>' : '<p class="text-emerald-700 font-semibold">✓ אין חסמים פתוחים — כל הבחינות שהתקיימו עברו בהצלחה</p>';
    const detailsOpen = !!($('profile-more') && $('profile-more').open);
    setHtml('profBody', `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        <div id="profile-academic" class="lg:col-span-8 card overflow-hidden">
          <div class="tbl-wrap"><table class="grid w-full" aria-label="מקצועות ליבה ומגמות — תמונת 360°"><thead><tr><th>מקצוע</th><th>קבוצה ומורה</th><th>ציון שוטף</th><th>בחינה חיצונית (70%/80%)</th><th>הערכה פנימית (30%/20%)</th><th>ציון סופי / נוכחי</th><th>סטטוס</th></tr></thead><tbody>
            <tr class="room-divider"><td colspan="7">מקצועות ליבה (שער 1)</td></tr>${g1 || '<tr><td colspan="7" class="text-slate-500">אין מקצועות פעילים</td></tr>'}
            <tr class="room-divider"><td colspan="7">מגמות בחירה (שער 2)</td></tr>${g2}
          </tbody></table></div>
        </div>
        <div class="lg:col-span-4 space-y-3">
          <div class="card p-3"><h3 class="font-bold mb-2">🎯 מיקוד פדגוגי ויעדים לחניך</h3><div class="text-xs leading-5">${focusHtml}</div></div>
          <div class="card p-3"><h3 class="font-bold mb-2">שער 3 – יחידות פנימיות</h3><ul class="space-y-1.5 text-xs">${g3}</ul></div>
        </div>
      </div>
      <details id="profile-more" class="card p-3" ${detailsOpen ? 'open' : ''}>
        <summary class="cursor-pointer font-semibold text-sm text-indigo-800">נתונים נוספים: שאלונים, אירועים וקבוצות</summary>
        <div class="flex flex-wrap gap-2 my-3" role="tablist" aria-label="נתוני חניך">${PROFILE_TABS.map(([id, label]) => `
          <button type="button" role="tab" class="chip" data-act="profTab" data-sub="${id}" aria-selected="${profTab === id}" aria-pressed="${profTab === id}">${label} (${counts[id]})</button>`).join('')}</div>
        <div class="tbl-wrap">${tabTables[profTab]}</div>
      </details>`);

    setHtml('excTrack', `<option value="">לפי המצבת (${E(Config.defaultTrack(t.track, t.classKey))})</option>` +
      Config.TRACKS.map(x => `<option value="${E(x)}" ${ex.trackOverride === x ? 'selected' : ''}>${E(x)}</option>`).join(''));
    setVal('excNote', ex.note);
    const openBtn = $('excOpen');
    if (openBtn) {
      openBtn.dataset.tz = t.tz;
      openBtn.classList.toggle('btn-primary', !!ex.isException);
      openBtn.classList.toggle('btn-ghost', !ex.isException);
      openBtn.textContent = ex.isException ? '⚡ מצב חריג פעיל' : '⚡ הגדר מצב חריג';
    }
  },

  /** תיבות KPI בראש כרטיס החניך: ממוצע החניך מול ממוצע הכיתה, מקצועות נכשלים/חסרים וסטטוס שיבוץ */
  renderProfileKpis(t) {
    const classmates = Store.traineeList().filter(x => x.classKey === t.classKey);
    const sheet = Store.loaded.grades ? GroupAnalyzer.sadinSheet(classmates, {}) : [];
    const mine = sheet.find(r => r.t.tz === t.tz);
    const scores = sheet.filter(r => r.overall != null).map(r => r.overall);
    const classAvg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const own = mine ? mine.overall : null;
    const risk = mine ? GroupAnalyzer.riskSubjects(mine) : [];
    const hasGrades = !!mine && mine.subjects.size > 0;
    const anomalies = Store.loaded.groups ? GroupAnalyzer.analyzeGroupAnomalies([t], 'all') : null;
    const delta = own != null && classAvg != null ? own - classAvg : null;
    const box = (label, value, sub, cls = '') => `<div class="prof-kpi"><div class="k">${label}</div><div class="v ${cls}">${value}</div><div class="s">${sub}</div></div>`;
    const placement = !anomalies ? ['—', 'לא נטען קובץ קבוצות', ''] :
      !anomalies.items.length ? ['✓ תקין', 'משובץ בכל המקצועות הנדרשים', 'txt-ok'] :
      [anomalies.items.length === 1 ? 'חריגה אחת' : `${anomalies.items.length} חריגות`, E(GroupAnalyzer.anomaliesByTrainee(anomalies).get(t.tz).text), anomalies.items.some(a => a.kind !== 'nomajor') ? 'txt-bad' : 'txt-warn'];
    setHtml('profKpis', [
      box('ממוצע חניך', own == null ? '—' : Util.fmt(own, 1),
        delta == null ? 'אין ציונים שוטפים' : `${delta >= 0 ? '+' : ''}${Util.fmt(delta, 1)} ביחס לכיתה`, own != null && delta != null && delta < 0 ? 'txt-warn' : ''),
      box('ממוצע כיתתי', classAvg == null ? '—' : Util.fmt(classAvg, 1), `${E(Config.classLabel(t.classKey))} · ${scores.length} חניכים עם ציונים`),
      box('מקצועות נכשלים / חסרים', hasGrades ? risk.length : '—', hasGrades ? (risk.length ? E(risk.slice(0, 3).map(s => s.name).join(', ') + (risk.length > 3 ? ` +${risk.length - 3}` : '')) : 'כל המקצועות עוברים') : 'אין ציונים שוטפים',
        risk.length ? 'txt-bad' : hasGrades ? 'txt-ok' : ''),
      box('סטטוס שיבוץ בקבוצות', placement[0], placement[1], placement[2])
    ].join(''));
  },

  openProfile(tz) {
    this.state.profileTz = tz;
    this.dirty.add('profile');
    this.closeModal();
    this.showTab('profile');
    this.scrollToTop();
  },

  profileStep(d) {
    const list = this.filtered();
    const i = list.findIndex(t => t.tz === this.state.profileTz) + d;
    if (list[i]) { this.state.profileTz = list[i].tz; this.dirty.add('profile'); this.renderTab('profile'); this.scrollToTop(); }
  },

  scrollToTop() { $('mainContent').scrollTop = 0; window.scrollTo({ top: 0 }); },

  saveProfileField(patch) {
    const tz = this.state.profileTz;
    if (!tz) return;
    const res = Config.setException(tz, patch);
    this.toast(res.ok === false ? res.error : 'נשמר', res.ok === false ? 'error' : 'ok');
  },

  /* ==================================================================
     פאנל 5 – הגדרות ומצבת חניכים
     ================================================================== */
  renderSettingsPanel() {
    this.renderFreshnessBar('roster');
    const roster = Config.getRoster();
    let html;
    if (!roster.length) {
      html = `<div class="text-slate-500">טרם נטענה מצבת. אפשר לטעון קובץ אקסל, או לנסות נתוני דמו.</div>
        <button type="button" class="btn btn-ghost btn-sm mt-2" data-act="loadMock">טעינת נתוני דמו</button>`;
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

    const mm = Config.detectRosterMismatches();
    const srcName = { groups: 'קבוצות', bagrut: 'בגרות' };
    const adoptable = mm.filter(m => m.adopt), unnamed = adoptable.filter(m => this.isUnnamedClass(m.homeroom));
    setHtml('ovConflicts', mm.length ? `
      <div class="rounded-lg bg-amber-50 p-3">
        <div class="font-medium text-amber-800 mb-2">סתירות שיוך בין המצבת לקובצי המשוב (${mm.length})</div>
        <div class="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="פעולות קבוצתיות לסתירות שיוך">
          <button type="button" class="btn btn-primary btn-sm" data-act="ovAdoptAll" data-scope="unnamed" ${unnamed.length ? '' : 'disabled'}>העבר את כל החניכים מקבוצות ללא שם לכיתה הנכונה (${unnamed.length})</button>
          <button type="button" class="btn btn-sm bg-white text-slate-800 hover:bg-indigo-100" data-act="ovAdoptAll" data-scope="all" ${adoptable.length ? '' : 'disabled'}>אמץ שיוך משו"ב לכל הסתירות (${adoptable.length})</button>
        </div>
        <div class="tbl-wrap"><table class="grid w-full bg-white">
          <thead><tr><th class="tz-col text-right">ת.ז</th><th class="text-right">חניך</th><th class="text-right">במצבת</th><th class="text-right">במשו"ב</th><th class="text-right">פעולה</th></tr></thead>
          <tbody>${mm.slice(0, 300).map(m => `<tr>
            <td class="tz-col text-right">${E(m.tz)}</td><td class="text-right font-medium">${E(m.name)}</td>
            <td class="text-right whitespace-nowrap">${E(m.homeroom)}</td>
            <td class="text-right">${m.sources.map(s => `<span class="whitespace-nowrap">${E(s.homeroom || Util.gl(s.grade))} <span class="text-xs text-slate-400">(${srcName[s.source]})</span></span>`).join(' · ')}</td>
            <td class="text-right whitespace-nowrap">
              <button type="button" class="btn btn-primary btn-sm" data-act="ovAdopt" data-tz="${m.tz}" ${m.adopt ? '' : 'disabled title="במשו&quot;ב אין כיתת אם לאימוץ"'}>אמץ שיוך משו"ב</button>
              <button type="button" class="btn btn-ghost btn-sm" data-act="ovKeep" data-tz="${m.tz}">השאר לפי מצבת</button></td></tr>`).join('')}</tbody></table></div>
      </div>` : '');

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
        <td class="text-right"><button type="button" class="btn btn-ghost btn-sm" data-act="ovRemove" data-tz="${o.tz}">בטל דריסה</button></td></tr>`;
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

  /** כיתה ללא שם: אין לה שם במצבת ואין לה כינוי */
  isUnnamedClass(classKey) { return !classKey || !(Config.rosterClassNames()[classKey] || Config.nickname(classKey)); },

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

  async loadMock() {
    try {
      Config.setRosterCleared(false);
      Config.clearRosterOverrides();
      Config.clearRoster();
      await Config.clearAllData();
      await initMockDataIfEmpty();
      this.rosterReport = null;
      this.afterDataChange();
      this.toast(`נטענו נתוני דמו: ${Store.trainees.size} חניכים, ${Store.groups.size} קבוצות`, 'ok');
    } catch (err) { console.error(err); this.toast(err.message || 'טעינת הדמו נכשלה', 'error'); }
  },

  /* ==================================================================
     אירועים
     ================================================================== */
  bindEvents() {
    /* תפיסה בשלב ה-capture: האפליקציה שולטת בטאבים, בהעלאה ובמגירה ואינה תלויה בסקריפט מעטפת */
    document.addEventListener('click', e => {
      if (e.target.closest('[data-go-overrides]')) {
        e.stopPropagation();
        this.showTab('settings');
        const section = $('ovTableSection');
        section.scrollIntoView({ block: 'start' });
        section.focus({ preventScroll: true });
        return;
      }
      const tab = e.target.closest('[data-tab]');
      if (tab) { e.stopPropagation(); this.showTab(tab.dataset.tab); return; }
      const up = e.target.closest('[data-upload]');
      if (up) { e.stopPropagation(); e.preventDefault(); this.pickFile(up.dataset.upload); return; }
      if (e.target.closest('#btnRulesToggle')) { e.stopPropagation(); this.toggleDrawer(); return; }
      if (e.target.closest('#rulesClose')) { e.stopPropagation(); this.toggleDrawer(false); }
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
    window.addEventListener('sd:exceptions-changed', () => this.schedule(() => this.invalidateAll()));

    /* סינון גלובלי */
    on('fGrade', 'change', e => { this.state.filters.grade = e.target.value; this.state.filters.cls = 'all'; this.onFilterChange(); });
    on('fHomeroom', 'change', e => { this.state.filters.cls = e.target.value; this.onFilterChange(); });
    on('fTrack', 'change', e => { this.state.filters.track = e.target.value; this.onFilterChange(); });
    on('globalSearch', 'input', e => {
      const value = e.target.value;
      clearTimeout(this._searchTimer);
      const applySearch = () => {
        this.state.filters.q = value;
        FILTERED_TABS.forEach(t => this.dirty.add(t));
        this.renderTab(this.state.tab);
      };
      if (this.state.tab === 'groups' && this.state.groups.view === 'explorer') applySearch();
      else this._searchTimer = setTimeout(applySearch, 180);
    });
    on('fClear', 'click', () => { clearTimeout(this._searchTimer); this.state.filters = { grade: 'all', cls: 'all', track: 'all', q: '' }; this.onFilterChange(); });
    on('bagrutStatusSelect', 'change', e => {
      this.state.bagrut.chip = e.target.value;
      this.dirty.add('bagrut'); this.renderTab('bagrut');
    });
    on('bagrutSubjectDrillSelect', 'change', e => {
      this.state.bagrut.drill = e.target.value;
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
      return res;
    });
    on('rulesReset', 'click', () => { if (confirm('לשחזר את כללי הזכאות והמשקלים לברירת המחדל?')) this.applyRule(Config.resetRules()); });

    /* קבוצות */
    on('groupsSubject', 'change', e => { this.state.groups.subject = e.target.value; this.dirty.add('groups'); this.renderTab('groups'); });
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
    on('profPrev', 'click', () => this.profileStep(-1));
    on('profNext', 'click', () => this.profileStep(1));
    on('profSelect', 'change', e => { this.state.profileTz = e.target.value; this.dirty.add('profile'); this.renderTab('profile'); });
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
    on('btnExportConfig', 'click', () => Config.exportJSON());
    on('fileImportConfig', 'change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try { await Config.importJSON(await f.text(), { silent: true }); this.toast('ההגדרות יובאו בהצלחה', 'ok'); this.afterDataChange(); }
      catch (err) { this.toast(err.message || 'קובץ config.json לא תקין', 'error'); }
    });
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
      if (!confirm('לאפס את כללי הזכאות, החריגים, הכינויים ופרופילי המיפוי? המצבת תישאר.')) return;
      Config.reset({ silent: true });
      this.afterDataChange();
      this.toast('ההגדרות אופסו', 'ok');
    });

    document.addEventListener('keydown', e => { if (e.key === 'Escape') { this.closeModal(); this.hideMxPop(); this.hideSadinPop(); } });
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
      const gv = e.target.closest('[data-gview]');
      if (gv) {
        const g = this.state.groups;
        g.view = gv.dataset.gview; g.subject = 'all'; g.teacher = 'all';
        this.dirty.add('groups');
        return this.renderTab('groups');
      }
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
      <p class="text-xs text-slate-500">כל שינוי נשמר לענן אוטומטית, והנתונים העדכניים נטענים בפתיחת האפליקציה בכל מחשב. יש להשתמש באותה כתובת בכל המחשבים. קוד בית-ספר אופציונלי מצפין את הנתונים ודורש אותו קוד בכל מחשב.</p>
      <p class="text-xs text-amber-700">כל מי שמחזיק בכתובת יכול לקרוא ולכתוב בענן ללא סיסמת מרכזת. אין לשתף את הכתובת מחוץ לצוות.</p>
      <div class="grid md:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1">כתובת Web App של Google Apps Script
          <input id="cloudUrl" class="inp" dir="ltr" placeholder="https://script.google.com/macros/s/…/exec" value="${E(CloudSync.url())}"></label>
        <label class="flex flex-col gap-1">קוד בית-ספר (הצפנה, אופציונלי)
          <input id="cloudPass" type="password" class="inp" autocomplete="off" value="${E(CloudSync.passcode())}"></label>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary btn-sm" data-act="cloudSave">שמירת הגדרות</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="cloudPull">⬇️ משיכה מהענן</button>
        <button type="button" class="btn btn-primary btn-sm" data-act="cloudSync">☁️ סנכרן לענן כעת</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="backupExport">💾 ייצוא קובץ גיבוי (.json)</button>
        <label id="backupImportLabel" class="btn btn-ghost btn-sm cursor-pointer">💾 ייבוא קובץ גיבוי (.json)
          <input type="file" id="backupImportFile" class="hidden" accept=".json,application/json" data-chg="backupImport"></label>
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
    host.innerHTML = `${banner}
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
    async cloudSave() {
      CloudSync.saveSettings({ url: $('cloudUrl').value, passcode: $('cloudPass').value });
      this.renderSync();
      this.toast('הגדרות הענן נשמרו', 'ok');
      if (CloudSync.url()) await this.cloudRefresh(() => CloudSync.pullCloudState());
    },
    async cloudPull() {
      if (!CloudSync.url()) return this.toast('לא הוגדרה כתובת סנכרון ענן', 'warn');
      if (CloudSync.hasUnpublished() && !confirm('יש שינויים שלא סונכרנו. משיכה מהענן תדרוס אותם. להמשיך?')) return;
      const r = await this.cloudRefresh(() => CloudSync.pullCloudState({ force: true }));
      if (r === 'kept-local') this.toast('בוצעו שינויים בזמן המשיכה; הם נשמרו ויישלחו לענן אוטומטית.', 'info');
      else if (r) this.toast(r === 'applied' ? 'הנתונים נטענו מהענן' : 'אין עדיין נתונים בענן', r === 'applied' ? 'ok' : 'info');
    },
    async cloudSync() {
      CloudSync.saveSettings({ url: $('cloudUrl').value, passcode: $('cloudPass').value });
      if (!CloudSync.url()) return this.toast('יש להגדיר כתובת סנכרון ענן בהגדרות', 'warn');
      try {
        const r = await this.cloudRefresh(() => CloudSync.pullCloudState());
        if (!r) return;
        await CloudSync.pushCloudState();
        this.toast('הנתונים סונכרנו לענן', 'ok');
      } catch (e) { this.toast(`הסנכרון נכשל: ${e.message}`, 'error'); }
      this.renderSync();
    },
    backupExport() { CloudSync.exportBackup(); },
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
    /** ניווט מכרטיסי חדר הבקרה ללשונית מסוננת מראש */
    ovGo(el) {
      const { go, chip, strip, view } = el.dataset;
      if (go === 'bagrut') { this.state.bagrut.chip = chip || 'all'; this.state.bagrut.drill = 'all'; this.dirty.add('bagrut'); }
      if (go === 'sadin') { Object.assign(this.state.sadin, { strip: strip || 'all', subject: 'all', teacher: 'all' }); this.dirty.add('sadin'); }
      if (go === 'groups') { Object.assign(this.state.groups, { view: view || 'explorer', kind: 'all', subject: 'all', teacher: 'all' }); this.dirty.add('groups'); }
      this.showTab(go);
    },
    ovClass(el) {
      const f = this.state.filters, key = el.dataset.class;
      f.cls = f.cls === key ? 'all' : key;
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
    ovAdopt(el) {
      const m = Config.detectRosterMismatches().find(x => x.tz === el.dataset.tz);
      if (!m || !m.adopt) return;
      const res = Config.setRosterOverride(m.tz, { grade: m.adopt.grade, homeroom: m.adopt.homeroom });
      if (res.ok === false) return this.toast(res.error, 'error');
      this.toast(`${m.name}: אומץ השיוך ${m.adopt.homeroom} לפי המשו"ב`, 'ok');
      this.afterDataChange();
    },
    ovAdoptAll(el) {
      const unnamedOnly = el.dataset.scope === 'unnamed';
      const items = Config.detectRosterMismatches().filter(m => m.adopt && (!unnamedOnly || this.isUnnamedClass(m.homeroom)));
      if (!items.length) return;
      const what = unnamedOnly ? 'מקבוצות ללא שם לכיתה שלפי המשו"ב' : 'לשיוך לפי המשו"ב';
      if (!confirm(`להעביר ${items.length} חניכים ${what}? הפעולה נשמרת כדריסות וניתנת לביטול.`)) return;
      const res = Config.setRosterOverridesBatch(items.map(m => ({ tz: m.tz, patch: { grade: m.adopt.grade, homeroom: m.adopt.homeroom } })));
      if (res.ok === false) return this.toast(res.error || 'ההעברה הקבוצתית נכשלה', 'error');
      this.toast(res.failed ? `הועברו ${res.applied} חניכים; ${res.failed} דולגו (${res.error})` : `הועברו ${res.applied} חניכים לכיתה הנכונה`, res.failed ? 'warn' : 'ok');
      this.afterDataChange();
    },
    classRoster(el) { this.openClassRoster(el.dataset.class); },
    ovKeep(el) {
      const m = Config.detectRosterMismatches().find(x => x.tz === el.dataset.tz);
      if (!m) return;
      Config.dismissRosterMismatch(m.tz, m.signature);
      this.renderRosterOverrides();
    },
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
    loadMock() { this.loadMock(); },
    openProfile(el) { this.openProfile(el.dataset.tz); },
    bagrutSort(el) {
      const st = this.state.bagrut, k = el.dataset.key;
      if (st.sort === k) st.dir *= -1; else { st.sort = k; st.dir = 1; }
      this.dirty.add('bagrut');
      this.renderTab('bagrut');
    },
    bagrutDrill(el) { this.state.bagrut.drill = el.dataset.sel; this.dirty.add('bagrut'); this.renderTab('bagrut'); },
    bagrutDrillBack() { this.state.bagrut.drill = 'all'; this.dirty.add('bagrut'); this.renderTab('bagrut'); },
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
    excModal(el) { this.openExceptionModal(el.dataset.tz); },
    excModalSave(el) {
      const is = $('xmIs') ? $('xmIs').checked : false;
      const res = Config.setException(el.dataset.tz, { isException: is, overrideStatus: is && $('xmStatus') ? $('xmStatus').value : '', reason: $('xmReason') ? $('xmReason').value.trim() : '' });
      this.closeModal();
      this.toast(res.ok === false ? res.error : 'החריג נשמר', res.ok === false ? 'error' : 'ok');
    },
    excModalClear(el) {
      Config.setException(el.dataset.tz, { isException: false, overrideStatus: '', reason: '' });
      this.closeModal();
      this.toast('החריג הוסר', 'ok');
    },
    profTab(el) { this.state.profTab = el.dataset.sub; this.dirty.add('profile'); this.renderTab('profile'); },
    rulesTab(el) { this.state.rulesTab = el.dataset.sub; this.renderRulesDrawer(); },
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
        `<tr class="cursor-pointer" data-act="openProfile" data-tz="${t.tz}"><td class="tz-col">${t.tz}</td><td class="font-medium">${E(t.name)}</td><td>${E(Config.classLabel(t.classKey))}</td></tr>`).join('');
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
    anKind(el) {
      this.state.groups.kind = el.dataset.kind;
      this.state.groups.view = 'anomalies';
      this.dirty.add('groups');
      this.renderTab('groups');
    },
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
      this.openProfile(t.tz);
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
      if (!f || !confirm('ייבוא הגיבוי יחליף את כל הנתונים וההגדרות הנוכחיים. להמשיך?')) return;
      await this.cloudRefresh(async () => { await CloudSync.importBackup(await f.text()); this.toast('הגיבוי נטען בהצלחה', 'ok'); return 'applied'; });
    },
    sim(el) { this.state.sim[el.dataset.key] = el.checked; this.evals.clear(); ['overview', 'bagrut', 'profile', 'sadin'].forEach(t => this.dirty.add(t)); this.renderTab(this.state.tab); },
    compEnabled(el) { this.patchComp(el, { enabled: el.checked }); },
    compCodes(el) { this.patchComp(el, { codes: el.value.split(',').map(x => x.trim()).filter(Boolean) }); },
    compWeight(el) { this.patchComp(el, { weight: Number(el.value) }); },
    ruleToggle(el) { this.applyRule(Config.toggleClause(el.dataset.kind, el.dataset.id)); },
    clauseCodes(el) { this.applyRule(Config.setClauseCodes(el.dataset.kind, el.dataset.id, el.value)); },
    clauseKeywords(el) { this.applyRule(Config.patchClause(el.dataset.kind, el.dataset.id, { keywords: el.value.split(',').map(x => x.trim()).filter(Boolean) })); },
    internalGrade(el) { this.applyRule(Config.patchClause('internal', el.dataset.id, { expectedGrade: el.value })); },
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
