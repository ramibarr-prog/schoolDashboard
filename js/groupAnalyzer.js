/* =====================================================================
   groupAnalyzer.js – מאגר נתונים בזיכרון (Store) והצלבת המצבת העליונה מול
   קובצי הקבוצות והסדין, וניתוחים: חריגות שיבוץ, מפת קבוצות ומורים,
   ציונים שוטפים משוקללים, אירועי הערכה שהוחמצו ומחולל התראות.

   המצבת העליונה (Config.getRoster) היא מקור האמת היחיד לחניכים פעילים, שכבה וכיתת אם.
   ת.ז בקובצי המשנה שאינן בה אינן הופכות לחניכים: הן נרשמות ב-Store.unknown בלבד.
   ===================================================================== */

/* מקצועות שגרתיים שבהם רישום לשתי קבוצות / ריבוי מורים הוא תקין (חינוך, מגדר, מפגש בוקר) */
const ROUTINE_DUPLICATE_SUBJECTS = ['חינוך', 'מגדר', 'מפגש בוקר'];
/* מקצועות שמכילים "חינוך" אך אינם שגרתיים: חינוך גופני ותעבורתי לעולם לא מוסתרים */
const NON_ROUTINE_SUBJECTS = ['חינוך גופני', 'חנ"ג', 'חנג', 'תעבורתי'];
const traineeNameCollator = new Intl.Collator('he');
/** האם שם המקצוע זהה לאחד המקצועות השגרתיים או מכיל אותו (מנורמל מגרשיים) */
function isRoutineDuplicateSubject(subjectName) {
  const s = Util.norm(subjectName);
  if (!s || NON_ROUTINE_SUBJECTS.some(term => s.includes(Util.norm(term)))) return false;
  return ROUTINE_DUPLICATE_SUBJECTS.some(term => s.includes(Util.norm(term)));
}

const Store = {
  version: 0,
  raw: { groups: [], grades: [], bagrut: [], roster: [] },
  loaded: { groups: false, grades: false, bagrut: false, roster: false },
  fileInfo: {},
  classNames: {},
  trainees: new Map(),
  groups: new Map(),
  unknown: { groups: [], grades: [], bagrut: [] },
  missed: [],
  _groupsByTz: new Map(),
  _current: new Map(),
  _groupGrades: new Set(),
  _bagrut: new Map(),
  _classes: [],
  _sortedTrainees: [],
  prerequisiteSets: { bagrut: new Set(), groups: new Set(), sadin: new Set() },
  _loadedCache: new Map(),
  _cohortCache: new Map(),
  latestEventDate: '',
  /** טוען מחדש את המצבת וקובצי המשנה השמורים ובונה את המאגר */
  refresh() {
    this.raw = {
      groups: Config.getRows('groupsData'), grades: Config.getRows('sadinData'),
      bagrut: Config.getRows('bagrutData'), roster: Config.getRoster()
    };
    this.loaded = {
      groups: this.raw.groups.length > 0, grades: this.raw.grades.length > 0,
      bagrut: this.raw.bagrut.length > 0, roster: this.raw.roster.length > 0
    };
    const info = key => {
      const e = key === 'masterRoster' ? Config.getRosterEntry() : Config.getDataset(key);
      return e ? { name: e.fileName, count: e.data.length, uploadedAt: e.uploadedAt } : null;
    };
    this.fileInfo = { roster: info('masterRoster'), groups: info('groupsData'), grades: info('sadinData'), bagrut: info('bagrutData') };
    this.rebuild();
  },

  hasData() { return this.trainees.size > 0; },

  rebuild() {
    this.version++;
    this._loadedCache = new Map();
    this._cohortCache = new Map();
    const T = new Map(), G = new Map();
    const unknown = { groups: new Set(), grades: new Set(), bagrut: new Set() };
    const getG = id => {
      let g = G.get(id);
      if (!g) {
        g = { groupId: id, name: '', subject: '', teacher: '', teacherTz: '', declared: null, targetClasses: '',
              members: new Set(), gradeMembers: new Set(), units: null, gradeKey: '', avg: null, actual: 0, inFile: false, reinforcement: false, major: false };
        G.set(id, g);
      }
      return g;
    };

    /* המצבת העליונה: רק מי שבה הוא חניך פעיל, עם השכבה וכיתת האם שהוגדרו בה */
    this.classNames = Config.rosterClassNames();
    const ignored = new Set([...Config.ignoredIds(), ...Config.hiddenIds()]), juniorGroups = new Set();
    this.raw.roster.forEach(r => {
      const name = `${r.firstName} ${r.lastName}`.trim() || r.tz;
      T.set(r.tz, {
        tz: r.tz, firstName: r.firstName, lastName: r.lastName, name, nameKey: Util.norm(name).toLocaleLowerCase(),
        gradeKey: r.grade, classKey: r.homeroom, classNum: Util.parseClass(r.grade, r.homeroom).num, track: r.track,
        inRoster: true, inGroups: false, inGrades: false, inBagrut: false, majorName: ''
      });
    });
    this._groupGrades = new Set();
    this.raw.groups.forEach(r => {
      const t = T.get(r.tz);
      const grade = t ? t.gradeKey : Util.normGrade(r.gradeKey || r.grade || '');
      if (grade) this._groupGrades.add(grade);
    });

    /* 1. קובץ קבוצות (שיבוץ מקצועי) */
    this.raw.groups.forEach(r => {
      const g = getG(r.groupId);
      g.inFile = true;
      if (r.groupName && !g.name) {
        g.name = r.groupName;
        /* שם קבוצה במבנה משוב ("אזרחות י1-יב6 רמי בר [9]") הוא המקור המהימן למקצוע, למורה ולכיתות היעד */
        if (g.name.includes('[')) {
          const p = Parser.parseGroupString(g.name);
          g.subject = p.subject; g.teacher = g.teacher || p.teacher; g.targetClasses = p.targetClasses;
          if (p.declaredCount != null) g.declared = p.declaredCount;
          g.parsedName = true; g.major = p.major;
        }
      }
      if (r.isTeacher) {
        g.teacher = g.teacher || `${r.firstName} ${r.lastName}`.trim();
        g.teacherTz = g.teacherTz || r.tz;
        return;
      }
      if (r.teacherName && !g.teacher) g.teacher = r.teacherName;
      const t = T.get(r.tz);
      if (!t) { if (ignored.has(r.tz)) juniorGroups.add(r.groupId); else unknown.groups.add(r.tz); return; }
      t.inGroups = true;
      if (r.majorName && !t.majorName) t.majorName = r.majorName;
      g.members.add(r.tz);
    });

    /* 2. סדין ציונים שוטפים */
    const gradesByTz = new Map();
    let latestEvent = '';
    this.raw.grades.forEach(r => {
      if (r.date && r.date > latestEvent) latestEvent = r.date;
      const t = T.get(r.tz);
      if (!t) { if (ignored.has(r.tz)) { if (r.groupId) juniorGroups.add(r.groupId); } else unknown.grades.add(r.tz); return; }
      t.inGrades = true;
      if (!gradesByTz.has(r.tz)) gradesByTz.set(r.tz, []);
      gradesByTz.get(r.tz).push(r);
      if (r.groupId) {
        const g = getG(r.groupId);
        if (r.subject && !g.subject) g.subject = r.subject;
        if (r.teacher && !g.teacher) g.teacher = r.teacher;
        if (r.declaredCount != null) g.declared = r.declaredCount;
        if (r.targetClasses && !g.targetClasses) g.targetClasses = r.targetClasses;
        g.gradeMembers.add(r.tz);
      }
    });

    /* 3. בגרות */
    const bagrut = new Map();
    this.raw.bagrut.forEach(r0 => {
      const t = T.get(r0.tz);
      if (!t) { if (!ignored.has(r0.tz)) unknown.bagrut.add(r0.tz); return; }
      /* ציון נגזר (הגשה + בחינה) מחושב מחדש לפי משקל המגן של השאלון במחזור של שכבת החניך, כך ששינוי ההגדרה חל גם על נתונים שנשמרו */
      let r = r0;
      if (r0.derived || r0.partial) {
        const res = Parser.resolveAttempt(r0.final, r0.exam, r0.submission, r0.code, Config.rulesForGrade(t.gradeKey));
        r = { ...r0, cls: res.cls, shown: res.shown, scoreRaw: res.shown, derived: res.derived, partial: res.partial };
      }
      t.inBagrut = true;
      if (!bagrut.has(r.tz)) bagrut.set(r.tz, new Map());
      const byCode = bagrut.get(r.tz);
      if (!byCode.has(r.code)) byCode.set(r.code, { code: r.code, subject: r.subject, attempts: [], best: null });
      byCode.get(r.code).attempts.push(r);
    });
    bagrut.forEach(byCode => byCode.forEach(e => { e.best = Store.bestOf(e.attempts); }));

    /* קבוצות שכל חבריהן מז-ט (נשארה רק שורת מורה) אינן מוצגות */
    juniorGroups.forEach(id => {
      const g = G.get(id);
      if (g && !g.members.size && !g.gradeMembers.size) G.delete(id);
    });

    /* גמר בניית קבוצות */
    G.forEach(g => {
      if (!g.subject) {
        const nm = g.name || '';
        g.subject = nm.includes('[') ? Parser.parseGroupString(nm).subject || nm : nm;
      }
      const subject = Util.stripQuotes(g.subject);
      const um = subject.match(/(?:^|[^\d+])([1-5])\s*(?:יחל|יחידות)(?![א-ת])/);
      const unitIndex = um ? um.index + um[0].indexOf(um[1]) : -1;
      g.units = um && !/\+\s*$/.test(subject.slice(0, unitIndex)) ? um[1] :
        /(?:^|\s)(?:רמה\s*5|מצטיינים|הקבצה\s*א)(?=$|[\s,./-])/.test(subject) ? '5' : null;
      g.reinforcement = /תגבור/.test(`${g.subject} ${g.name}`);
      const mem = g.inFile ? g.members : g.gradeMembers;
      const cnt = {};
      mem.forEach(tz => { const t = T.get(tz); if (t) cnt[t.gradeKey] = (cnt[t.gradeKey] || 0) + 1; });
      g.gradeKey = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || '';
      g.actual = mem.size;
    });

    /* שיוך חניך ← קבוצות (קובץ הקבוצות; ללא קובץ כזה – נגזר מהסדין) */
    const gbt = new Map();
    G.forEach(g => {
      const mem = this.raw.groups.length ? g.members : g.gradeMembers;
      mem.forEach(tz => { if (!gbt.has(tz)) gbt.set(tz, []); gbt.get(tz).push(g); });
    });

    /* ממוצע שוטף משוקלל (לפי משקל האירוע) לכל חניך × קבוצה. ציון חסר או ערך מילולי אינם נכללים; ציון 0 נכלל */
    const current = new Map();
    gradesByTz.forEach((rows, tz) => {
      const byGroup = new Map();
      rows.forEach(r => {
        const key = r.groupId || JSON.stringify([r.subject, r.teacher]);
        if (!byGroup.has(key)) byGroup.set(key, { groupId: r.groupId, subject: r.subject, teacher: r.teacher, events: [] });
        byGroup.get(key).events.push(r);
      });
      const entries = [];
      byGroup.forEach(e => {
        /* ציון 0 אמיתי נכלל בממוצע; אירועים במשקל 0 מתעלמים מהם, אלא אם כל אירועי הקבוצה במשקל 0 */
        const result = Store.weightedAverage(e.events);
        e.avg = result.avg;
        e.n = result.n;
        if (!e.subject && e.groupId && G.get(e.groupId)) e.subject = G.get(e.groupId).subject;
        /* כותרת סדין אינה מפרידה בין מקצוע למורה: כשהקבוצה מוכרת מקובץ הקבוצות, נלקחים ממנה */
        const gg = e.groupId && G.get(e.groupId);
        if (gg && gg.parsedName) { e.subject = gg.subject || e.subject; if (gg.teacher) e.teacher = gg.teacher; }
        entries.push(e);
      });
      current.set(tz, entries);
    });

    current.forEach((entries, tz) => {
      const t = T.get(tz);
      Config.withRulesForGrade(t.gradeKey, () => {
        const subjectKey = name => Util.norm(GroupAnalyzer.sadinSubject(name));
        const unavailable = subjectKey('ללא מקצוע');
        const activeSubjects = new Set((gbt.get(tz) || [])
          .filter(g => g.inFile && g.members.has(tz))
          .map(g => subjectKey(g.subject)).filter(s => s && s !== unavailable));
        entries.forEach(e => {
          const g = G.get(e.groupId);
          if (!this.hasGroupsForGrade(t.gradeKey) || !e.groupId || (g && g.inFile && g.members.has(tz))) {
            e.enrollmentStatus = 'active';
          } else {
            const subject = subjectKey(e.subject);
            e.enrollmentStatus = subject && subject !== unavailable && activeSubjects.has(subject) ? 'moved' : 'unassigned';
          }
        });
      });
    });

    G.forEach(g => {
      let s = 0, n = 0;
      (g.inFile ? g.members : g.gradeMembers).forEach(tz => {
        const e = (current.get(tz) || []).find(x => x.groupId === g.groupId);
        if (e && e.avg != null) { s += e.avg; n++; }
      });
      g.avg = n ? s / n : null;
    });

    this.trainees = T;
    this._sortedTrainees = [...T.values()].sort((a, b) =>
      Util.ord(a.gradeKey) - Util.ord(b.gradeKey) || natural(a.classKey, b.classKey) || traineeNameCollator.compare(a.name, b.name));
    this.prerequisiteSets = { bagrut: new Set(), groups: new Set(), sadin: new Set() };
    [['bagrut', 'bagrut', 'bagrut'], ['groups', 'groups', 'groups'], ['grades', 'grades', 'sadin']].forEach(([type, loaded, key]) => {
      if (!this.loaded[loaded]) return;
      this.raw[type].forEach(row => {
        const trainee = T.get(row.tz);
        const grade = trainee ? trainee.gradeKey : Util.normGrade(row.gradeKey || row.grade || '');
        if (grade) this.prerequisiteSets[key].add(grade);
      });
    });
    this.latestEventDate = latestEvent;
    this.groups = G;
    this.unknown = { groups: [...unknown.groups], grades: [...unknown.grades], bagrut: [...unknown.bagrut] };
    this._groupsByTz = gbt;
    this._current = current;
    this._bagrut = bagrut;
    this._classes = [...new Set([...T.values()].map(t => t.classKey).filter(Boolean))]
      .sort((a, b) => Util.ord(Util.parseClass('', a).gradeKey) - Util.ord(Util.parseClass('', b).gradeKey) || a.localeCompare(b, 'he', { numeric: true }));
    this.missed = GroupAnalyzer.detectMissed(gradesByTz);
  },

  bestOf(attempts) {
    let num = null, pass = false, exempt = false, fail = false, block = false, incomplete = false;
    attempts.forEach(a => {
      if (a.partial) { incomplete = true; return; }
      if (a.cls.exempt || Parser.classify(a.final || a.shown || a.scoreRaw).exempt) { exempt = true; return; }
      if (a.cls.kind === 'num') num = num == null ? a.cls.num : Math.max(num, a.cls.num);
      else if (a.cls.kind === 'pass') pass = true;
      else if (a.cls.kind === 'fail') { fail = true; if (a.cls.block) block = true; }
    });
    if (num != null) return { kind: 'num', num };
    if (pass) return { kind: 'pass' };
    if (exempt) return { kind: 'pass', exempt: true };
    if (fail) return { kind: 'fail', block };
    return incomplete ? { kind: 'none', incomplete: true } : { kind: 'none' };
  },

  /**
   * האם נטענו קבוצות במקצוע (מילות מפתח) בשכבה. התוצאה נשמרת במטמון עד לבנייה מחדש של המאגר.
   * כשקובץ קבוצות נטען, נספרות רק קבוצות שמקורן בו (לא קבוצות שנגזרו מהסדין בלבד); קבוצות תגבור אינן נספרות.
   */
  groupsLoaded(keywords, gradeKey, minUnits = 0) {
    const key = `${gradeKey}|${minUnits}|${(keywords || []).join('\u0001')}`;
    let hit = this._loadedCache.get(key);
    if (hit === undefined) {
      hit = false;
      for (const g of this.groups.values()) {
        if (g.reinforcement || g.gradeKey !== gradeKey || (this.loaded.groups && !g.inFile)) continue;
        if (minUnits && g.units && +g.units < minUnits) continue;
        if (Util.matchKeywords(g.subject, keywords)) { hit = true; break; }
      }
      this._loadedCache.set(key, hit);
    }
    return hit;
  },

  traineeList() { return [...this.trainees.values()]; },
  sortedTrainees() { return this._sortedTrainees.slice(); },
  classes() { return this._classes; },
  gradeKeys() {
    const set = new Set([...this.trainees.values()].map(t => t.gradeKey));
    return Util.GRADE_KEYS.filter(k => set.has(k));
  },
  groupsOf(tz) { return this._groupsByTz.get(tz) || []; },
  currentOf(tz) { return this._current.get(tz) || []; },
  hasGroupsForGrade(gradeKey) { return this._groupGrades.has(Util.normGrade(gradeKey)); },
  activeCurrentOf(tz) { return this.currentOf(tz).filter(e => e.enrollmentStatus === 'active'); },
  inactiveCurrentOf(tz) { return this.currentOf(tz).filter(e => e.enrollmentStatus === 'moved' || e.enrollmentStatus === 'unassigned'); },
  isActiveMissed(m) {
    const t = this.trainees.get(m.tz), g = this.groups.get(m.groupId);
    return !!t && (!this.hasGroupsForGrade(t.gradeKey) || !m.groupId || !!(g && g.inFile && g.members.has(m.tz)));
  },
  weightedAverage(events) {
    const scored = events.filter(ev => ev.score != null);
    const useWeights = scored.some(ev => ev.weight > 0);
    let sum = 0, weight = 0, n = 0;
    scored.forEach(ev => {
      const w = useWeights ? ev.weight : 1;
      if (!(w > 0)) return;
      sum += ev.score * w; weight += w; n++;
    });
    return { avg: weight ? sum / weight : null, n };
  },
  attemptsOf(tz) {
    const m = this._bagrut.get(tz);
    return m ? [...m.values()].flatMap(e => e.attempts) : [];
  },

  /** ציון שוטף למקצוע לפי מילות מפתח (הערך הראשון שנמצא) */
  currentGrade(tz, keywords) {
    const e = this.activeCurrentOf(tz).filter(x => x.avg != null && Util.matchKeywords(x.subject, keywords));
    return e.length ? e[0].avg : null;
  },

  /** התוצאה הטובה ביותר מבין כמה סמלי שאלון חלופיים */
  bagrutBest(tz, codes) {
    const m = this._bagrut.get(tz);
    if (!m) return null;
    let best = null;
    const rank = { num: 3, pass: 2, fail: 1, none: 0 };
    codes.forEach(c => {
      const e = m.get(String(c));
      if (!e) return;
      const b = { ...e.best, code: String(c) };
      if (!best || rank[b.kind] > rank[best.kind] || (b.kind === 'num' && best.kind === 'num' && b.num > best.num) ||
          (b.kind === 'pass' && best.kind === 'pass' && best.exempt && !b.exempt) ||
          (b.kind === 'none' && best.kind === 'none' && b.incomplete && !best.incomplete)) best = b;
    });
    return best;
  }
};

/* ---------------------------------------------------------------------
   ניתוחים
   --------------------------------------------------------------------- */
let sadinSheetVersion = '', sadinSheetCache = [];
const GroupAnalyzer = {
  coreSubjects() { return Config.rules().coreSubjects.filter(s => s.enabled !== false); },

  coreOf(subjectText) {
    return this.coreSubjects().find(s => Util.matchKeywords(subjectText, s.keywords)) || null;
  },
  sadinSubject(subjectText) {
    const core = this.coreOf(subjectText);
    return core ? core.name : (subjectText || 'ללא מקצוע');
  },

  /** מגמה 5 יח"ל מתאימה לקבוצה (קבוצה עם יח"ל מוצהרות מתחת לדרישה אינה נחשבת) */
  majorOf(group) {
    const rules = Config.rules();
    const required = (rules.gates && rules.gates.major && rules.gates.major.requiredUnits) || 5;
    if (group.reinforcement) return null;
    const m = rules.majors.find(x => x.enabled !== false && Util.matchKeywords(group.subject, x.keywords));
    if (!m) return null;
    if (group.units && +group.units < required) return null;
    return m;
  },

  isMajorGroup(group) {
    if (!group || typeof group !== 'object') return false;
    const hasMajorPrefix = value => /^(?:מג['׳]|מגמת)/.test(String(value || '').trim());
    return group.major === true || hasMajorPrefix(group.subject) || hasMajorPrefix(group.name) ||
      Config.rules().majors.some(m => m.enabled !== false && Util.matchKeywords(group.subject, m.keywords));
  },

  /**
   * קטגוריית מקצוע לקבוצה (לכפתורי המקצוע ולזיהוי שיבוץ כפול): מקצוע ליבה / מגמה / יחידה פנימית / אחר.
   * שתי קבוצות באותו key הן "אותו מקצוע". order קובע את סדר התצוגה.
   */
  categoryOf(g) {
    if (this.isMajorGroup(g)) return { key: `major:${g.subject}`, label: g.subject || 'מגמה', kind: 'major', order: 100 };
    const core = this.coreSubjects();
    const ci = core.findIndex(s => Util.matchKeywords(g.subject, s.keywords));
    if (ci >= 0) return { key: `core:${core[ci].id}`, label: core[ci].name, kind: 'core', order: ci };
    const internal = (Config.rules().internals || []).some(i => i.enabled !== false && i.groupKeywords && Util.matchKeywords(g.subject, i.groupKeywords));
    if (internal) return { key: `int:${g.subject}`, label: g.subject, kind: 'internal', order: 200 };
    return { key: `other:${g.subject}`, label: g.subject || 'ללא מקצוע', kind: 'other', order: 300 };
  },

  /**
   * מודל "סייר הקבוצות" (קריאה בלבד): כל קבוצה כפי שרשומה במשוב עם הרשימה השמית המלאה שלה,
   * פילוח כיתות אם, וחיווי בקרה לכל חניך. חיווי מופיע רק כשיש בעיית שיבוץ אמיתית:
   *  dup – רשום גם בקבוצה אחרת באותו מקצוע · grade – חריג שכבה · outlier – חניך בודד מכיתה אחרת בקבוצה ·
   *  sadin-other – ציונים בסדין מתקבלים בקבוצה אחרת באותו מקצוע.
   * חריג כיתה: 1–2 חניכים מכיתה אחרת בקבוצה שבה כיתה אחת מהווה רוב ברור; חריג שכבה – 1–2 משכבה אחרת מול שכבה דומיננטית.
   * state של קבוצה: clean / minor (עירוב כיתות קל) / bad (כפולים או חניכי שכבה אחרת).
   */
  explorerModel() {
    const MIN_MAIN = 5, GRADE_SHARE = 0.6, CLASS_SHARE = 0.5, MAX_STRAY = 2, STRAY_GRADE_SHARE = 0.25;
    const sadinLoaded = Store.loaded.grades;
    const roster = Config.rosterMap();
    const sadinGrades = new Set();
    if (sadinLoaded) Config.getRows('sadinData').forEach(r => { const gk = r.gradeKey || (roster.get(r.tz) || {}).grade; if (gk) sadinGrades.add(gk); });
    const cats = new Map();
    Store.groups.forEach(g => cats.set(g.groupId, this.categoryOf(g)));
    const topOf = m => [...m.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
    const label = g => `${g.subject}${g.teacher ? ` • ${g.teacher}` : ''} [${g.groupId}]`;
    const byRoom = (a, b) => Util.ord(a.gradeKey) - Util.ord(b.gradeKey) || natural(a.classKey, b.classKey) || a.name.localeCompare(b.name, 'he');
    const SEVERITY = { dup: 0, grade: 0, 'sadin-other': 1, outlier: 2 };

    const groups = [];
    Store.groups.forEach(g => {
      if (!g.inFile) return;
      const cat = cats.get(g.groupId);
      const people = [...g.members].map(tz => Store.trainees.get(tz)).filter(Boolean).sort(byRoom);
      const total = people.length;
      const byClass = new Map(), byGrade = new Map();
      people.forEach(t => {
        const c = byClass.get(t.classKey) || { classKey: t.classKey, gradeKey: t.gradeKey, n: 0 };
        c.n++; byClass.set(t.classKey, c);
        byGrade.set(t.gradeKey, (byGrade.get(t.gradeKey) || 0) + 1);
      });
      const [domGrade, domGradeN] = topOf(byGrade);
      const gradeDominant = domGradeN >= MIN_MAIN && domGradeN / total >= GRADE_SHARE;
      const [domClass, domClassN] = topOf(new Map([...byClass.values()].filter(c => c.gradeKey === domGrade).map(c => [c.classKey, c.n])));
      const classDominant = domClassN >= MIN_MAIN && domClassN / total >= CLASS_SHARE;
      const classes = [...byClass.values()].map(c => ({
        ...c,
        /* שכבה אחרת: מיעוט קטן (עד 25% מהקבוצה) המפוזר בכיתות של 1–2 חניכים */
        kind: gradeDominant && c.gradeKey !== domGrade && c.n <= MAX_STRAY && byGrade.get(c.gradeKey) / total <= STRAY_GRADE_SHARE ? 'straggler'
          : classDominant && c.gradeKey === domGrade && c.classKey !== domClass && c.n <= MAX_STRAY ? 'minor'
            : classDominant && c.classKey === domClass ? 'main' : 'normal'
      })).sort((a, b) => b.n - a.n || natural(a.classKey, b.classKey));
      const kindOf = new Map(classes.map(c => [c.classKey, c.kind]));
      const coreClasses = classes.filter(c => c.kind === 'main' || c.kind === 'normal');
      const mainLabel = coreClasses.map(c => c.classKey).slice(0, 3).join('-') || domClass;

      const members = people.map(t => {
        const diag = [];
        Store.groupsOf(t.tz).filter(o => o.groupId !== g.groupId && o.inFile && (cats.get(o.groupId) || {}).key === cat.key)
          .forEach(o => diag.push({ kind: 'dup', other: o.groupId, text: `כפול: רשום גם אצל ${o.teacher || 'ללא מורה'} [${o.groupId}]`, title: 'רשום ביותר מקבוצה אחת באותו מקצוע במשוב' }));
        const k = kindOf.get(t.classKey);
        if (k === 'straggler') diag.push({ kind: 'grade', text: `חריג שכבה (משובץ מ-${t.classKey})`, title: `חניך משכבה ${Util.gl(t.gradeKey)} בקבוצה של שכבה ${Util.gl(domGrade)} – ייתכן מעבר שלא עודכן במשוב` });
        else if (k === 'minor' && cat.kind !== 'major') diag.push({ kind: 'outlier', text: `בודד מכיתה ${t.classKey} בקבוצה של ${mainLabel}`, title: 'חניך בודד מכיתת אם שונה מרוב הקבוצה – ייתכן מעבר שלא עודכן במשוב' });
        /* הצלבה מול הסדין: מוצגת רק כשהחניך מקבל ציונים בקבוצה אחרת באותו מקצוע */
        if (sadinLoaded && sadinGrades.has(t.gradeKey)) {
          const entries = Store.currentOf(t.tz).filter(e => e.groupId && e.events.length);
          if (!entries.some(e => e.groupId === g.groupId)) {
            const other = entries.find(e => (cats.get(e.groupId) || {}).key === cat.key);
            if (other) {
              const og = Store.groups.get(other.groupId);
              diag.push({ kind: 'sadin-other', other: other.groupId, text: `ציונים בסדין בקבוצה אחרת [${other.groupId}]`, title: og ? `מקבל ציונים ב-${label(og)} ולא בקבוצה הרשומה` : 'מקבל ציונים בקבוצה אחרת' });
            }
          }
        }
        diag.sort((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind]);
        return { t, diag, severity: diag.length ? SEVERITY[diag[0].kind] : 9 };
      });
      const count = kind => members.filter(m => m.diag.some(d => d.kind === kind)).length;
      const counts = { dup: count('dup'), grade: count('grade'), outlier: count('outlier'), sadin: count('sadin-other') };
      groups.push({
        groupId: g.groupId, subject: g.subject, teacher: g.teacher || '', targetClasses: g.targetClasses || '', declared: g.declared,
        reinforcement: g.reinforcement, cat, total, classes, domClass, domGrade, members, counts,
        state: counts.dup || counts.grade ? 'bad' : counts.outlier || counts.sadin ? 'minor' : 'clean',
        anomalyCount: members.filter(m => m.diag.length).length
      });
    });
    return { groups, sadinLoaded };
  },

  /**
   * תמונת מצב למקצוע לפי אוכלוסיית הייחוס, מול כל קבוצות המקצוע.
   * כאשר לא נבחרה שכבה מפורשת, רק שכבות שיש בהן קבוצות נכללות באוכלוסייה.
   */
  subjectHealth(cat, groups, pop, explicitGrade = false) {
    const rel = groups.filter(g => g.cat.key === cat.key);
    const covered = new Set(rel.map(g => g.domGrade).filter(Boolean));
    const byTz = new Map(), stray = [], population = new Set(pop.map(t => t.tz));
    rel.forEach(g => g.members.forEach(m => {
      if (!byTz.has(m.t.tz)) byTz.set(m.t.tz, []);
      byTz.get(m.t.tz).push(g);
      if (population.has(m.t.tz) && m.diag.some(d => d.kind === 'grade' || d.kind === 'outlier')) stray.push({ t: m.t, g });
    }));
    const gs = t => byTz.get(t.tz) || [];
    /* מקצוע ליבה: חסרי שיבוץ נספרים רק בכיתות אם שלפחות 30% מהן משובצות למקצוע (אותו מקור כמו חריגי השיבוץ) */
    const coreId = cat.kind === 'core' ? String(cat.key).replace(/^core:/, '') : null;
    const coverage = coreId ? this.coreClassCoverage() : null;
    const people = coreId ? pop.filter(t => gs(t).length || (coverage.get(`${t.classKey}|${coreId}`) || {}).expected)
      : explicitGrade ? pop : pop.filter(t => covered.has(t.gradeKey));
    return {
      total: people.length,
      ok: people.filter(t => gs(t).length === 1).length,
      missing: people.filter(t => !gs(t).length),
      dup: people.filter(t => gs(t).length >= 2).map(t => ({ t, groups: gs(t) })),
      stray, grades: [...covered]
    };
  },

  /** ת.ז שמופיעות בקובצי הקבוצות/הסדין אך אינן במצבת העליונה (לא במצבת) */
  unmatchedIds() {
    const roster = Config.rosterMap(), ignored = new Set([...Config.ignoredIds(), ...Config.hiddenIds()]);
    const found = new Map();
    const add = (tz, source, name) => {
      if (!tz || roster.has(tz) || ignored.has(tz)) return;
      if (!found.has(tz)) found.set(tz, { tz, sources: new Set(), name: '' });
      const e = found.get(tz);
      e.sources.add(source);
      if (name && !e.name) e.name = name;
    };
    Config.getRows('groupsData').forEach(r => { if (!r.isTeacher) add(r.tz, 'קובץ קבוצות', r.studentName || `${r.firstName || ''} ${r.lastName || ''}`.trim()); });
    Config.getRows('sadinData').forEach(r => add(r.tz, 'סדין ציונים', ''));
    Config.getRows('bagrutData').forEach(r => add(r.tz, 'קובץ בגרות', r.name || ''));
    return [...found.values()].map(e => ({ tz: e.tz, name: e.name, sources: [...e.sources] })).sort((a, b) => a.tz.localeCompare(b.tz));
  },

  /**
   * חובת שיבוץ במקצועות ליבה לפי כיתת אם, תמיד מול כלל המצבת הפעילה (לא מול הסינון), כדי שהתוצאה לחניך בודד תהיה זהה לתוצאה בבית הספר כולו.
   * מפתח: `${classKey}|${subjectId}` → { classSize, enrolled, expected }. כל קבוצה מקובץ הקבוצות נספרת כקבוצת לימוד במקצוע.
   * expected: לפחות 30% מחניכי הכיתה משובצים לקבוצה במקצוע.
   */
  CORE_CLASS_SHARE: 0.3,
  coreClassCoverage() {
    const roster = Store.traineeList(), sizes = new Map(), out = new Map();
    roster.forEach(t => sizes.set(t.classKey, (sizes.get(t.classKey) || 0) + 1));
    const groupsOf = new Map(roster.map(t => [t.tz, Store.groupsOf(t.tz).filter(g => g.inFile)]));
    this.coreSubjects().forEach(s => {
      const enrolled = new Map();
      roster.forEach(t => { if (groupsOf.get(t.tz).some(g => Util.matchKeywords(g.subject, s.keywords))) enrolled.set(t.classKey, (enrolled.get(t.classKey) || 0) + 1); });
      sizes.forEach((classSize, classKey) => {
        const n = enrolled.get(classKey) || 0;
        out.set(`${classKey}|${s.id}`, { classKey, subjectId: s.id, classSize, enrolled: n, expected: classSize > 0 && n / classSize >= this.CORE_CLASS_SHARE });
      });
    });
    return out;
  },

  classCoreExpectation(classKey, coreSubject, coverage = this.coreClassCoverage()) {
    const id = coreSubject && typeof coreSubject === 'object' ? coreSubject.id : coreSubject;
    return coverage.get(`${classKey}|${id}`) || { classKey, subjectId: id, classSize: 0, enrolled: 0, expected: false };
  },

  /**
   * חריגות שיבוץ לחניכי המצבת שבסינון:
   *  none – חוסר שיבוץ במקצוע ליבה, רק כשלפחות 30% מכיתת האם משובצים למקצוע (classEnrolled / classTotal),
   *  dup – כפילות שיבוץ (2+ קבוצות באותו מקצוע ליבה, בכל מקצוע שיש לו קבוצות),
   *  nomajor – ללא מגמת בחירה, וכן unmatched – ת.ז שאינן במצבת.
   * subjectId: 'all' | מזהה מקצוע ליבה | 'major'
   */
  analyzeGroupAnomalies(filteredRoster, subjectId = 'all') {
    const roster = Array.isArray(filteredRoster) ? filteredRoster : Store.traineeList();
    const sid = (subjectId && typeof subjectId === 'object' ? subjectId.subject : subjectId) || 'all';
    const allGroups = [...Store.groups.values()].filter(g => g.inFile);
    const gradesOf = pred => new Set(allGroups.filter(g => pred(g)).map(g => g.gradeKey));
    const active = this.coreSubjects()
      .filter(s => allGroups.some(g => Util.matchKeywords(g.subject, s.keywords)) && (sid === 'all' || s.id === sid));
    const coverage = active.length ? this.coreClassCoverage() : new Map();
    const majorGrades = gradesOf(g => this.isMajorGroup(g));
    const items = [];
    roster.forEach(t => {
      const groups = Store.groupsOf(t.tz).filter(g => g.inFile);
      active.forEach(s => {
        const matched = groups.filter(g => Util.matchKeywords(g.subject, s.keywords));
        if (matched.length > 1) items.push({ tz: t.tz, kind: 'dup', subject: s.name, groups: matched });
        else if (!matched.length) {
          const c = this.classCoreExpectation(t.classKey, s, coverage);
          if (c.expected) items.push({ tz: t.tz, kind: 'none', subject: s.name, groups: [], classEnrolled: c.enrolled, classTotal: c.classSize });
        }
      });
      if ((sid === 'all' || sid === 'major') && majorGrades.has(t.gradeKey) && !/צירוף/.test(t.majorName || '') && !groups.some(g => this.isMajorGroup(g))) {
        items.push({ tz: t.tz, kind: 'nomajor', subject: this.MAJOR_LABEL, groups: [] });
      }
    });
    const unmatched = this.unmatchedIds();
    const count = k => items.filter(i => i.kind === k).length;
    return {
      items, unmatched, traineeCount: new Set(items.map(i => i.tz)).size,
      counts: { none: count('none'), dup: count('dup'), nomajor: count('nomajor'), unmatched: unmatched.length }
    };
  },

  /**
   * ציונים שוטפים לחניכי המצבת שבסינון: ממוצע משוקלל (לפי משקל האירוע) לכל מקצוע/קבוצה
   * ואירועי הערכה שהוחמצו. filters: { subject, onlyFail }
   */
  analyzeCurrentGrades(filteredRoster, filters = {}) {
    const roster = Array.isArray(filteredRoster) ? filteredRoster : Store.traineeList();
    const { subject = 'all', onlyFail = false } = filters;
    const set = new Set(roster.map(t => t.tz));
    const entries = [];
    roster.forEach(t => Store.activeCurrentOf(t.tz).forEach(e => {
      if (subject !== 'all' && e.subject !== subject) return;
      const low = e.avg != null && !SignalEngine.isPassingScore(e.avg, { social: Util.norm(e.subject) === Util.norm('מעורבות חברתית') }, Config.rulesForGrade(t.gradeKey));
      if (onlyFail && !low) return;
      const g = Store.groups.get(e.groupId);
      entries.push({ t, subject: e.subject, groupId: e.groupId, teacher: (g && g.teacher) || e.teacher || '', n: e.n, avg: e.avg, low, events: e.events });
    }));
    const missed = Store.missed.filter(m => set.has(m.tz) && Store.isActiveMissed(m) && (subject === 'all' || m.subject === subject));
    const avgs = entries.filter(e => e.avg != null);
    return {
      entries, missed,
      stats: {
        mean: avgs.length ? avgs.reduce((a, e) => a + e.avg, 0) / avgs.length : null,
        pairs: avgs.length,
        belowCount: new Set(roster.filter(t => Store.activeCurrentOf(t.tz).some(e => e.avg != null &&
          !SignalEngine.isPassingScore(e.avg, { social: Util.norm(e.subject) === Util.norm('מעורבות חברתית') }, Config.rulesForGrade(t.gradeKey)))).map(t => t.tz)).size,
        missedCount: missed.length,
        noGradesCount: roster.filter(t => !t.inGrades).length
      }
    };
  },

  /** גיליון רוחבי: ממוצע משוקלל לאירועים בכל מקצוע, וממוצע כללי שווה-משקל למקצועות. */
  sadinSheet(roster, filters = {}) {
    const subject = filters.subject || 'all', teacher = filters.teacher || 'all';
    const version = `${Store.version}|${Config.rev}`;
    if (version !== sadinSheetVersion) { sadinSheetVersion = version; sadinSheetCache = []; }
    const cacheable = roster.every(t => Store.trainees.get(t.tz) === t);
    const key = cacheable ? JSON.stringify([subject, teacher, roster.map(t => t.tz)]) : '';
    const rules = Config.rules();
    const index = cacheable ? sadinSheetCache.findIndex(entry => entry.key === key && entry.rules === rules) : -1;
    if (index >= 0) {
      const entry = sadinSheetCache.splice(index, 1)[0];
      sadinSheetCache.push(entry);
      return entry.rows.slice();
    }
    const teacherOf = e => (Store.groups.get(e.groupId) || {}).teacher || e.teacher || '';
    const eventKey = (groupId, subjectName, teacherName, name, date, weight) => JSON.stringify([groupId || '', subjectName, teacherName, name || '', date || '', weight]);
    const matches = (s, t) => (subject === 'all' || subject === s) && (teacher === 'all' || teacher === t);
    const missedByTz = new Map();
    Store.missed.forEach(m => {
      if (!Store.isActiveMissed(m)) return;
      if (!missedByTz.has(m.tz)) missedByTz.set(m.tz, []);
      missedByTz.get(m.tz).push(m);
    });
    const rows = [];
    roster.forEach(t => Config.withRulesForGrade(t.gradeKey, () => {
      const entries = Store.activeCurrentOf(t.tz).map(e => ({ ...e, displaySubject: e.subject, teacher: teacherOf(e), subject: this.sadinSubject(e.subject) }));
      const allSubjects = new Map();
      entries.forEach(e => {
        if (!allSubjects.has(e.subject)) allSubjects.set(e.subject, []);
        allSubjects.get(e.subject).push(...e.events);
      });
      const overallScores = [...allSubjects.values()].map(events => Store.weightedAverage(events).avg).filter(avg => avg != null);
      const overall = overallScores.length ? overallScores.reduce((a, b) => a + b, 0) / overallScores.length : null;
      const subjects = new Map();
      const getSubject = name => {
        if (!subjects.has(name)) subjects.set(name, { name, tz: t.tz, gradeKey: t.gradeKey, entries: [], events: [], missed: new Map() });
        return subjects.get(name);
      };
      entries.filter(e => matches(e.subject, e.teacher)).forEach(e => {
        const s = getSubject(e.subject);
        s.entries.push(e);
        e.events.forEach(ev => {
          const item = { ...ev, subject: e.subject, teacher: e.teacher, groupId: e.groupId };
          item.key = eventKey(item.groupId, item.subject, item.teacher, item.eventName, item.date, item.weight);
          s.events.push(item);
          if (item.score === 0) s.missed.set(item.key, { ...item, kind: 'zero' });
        });
      });
      (missedByTz.get(t.tz) || []).forEach(m => {
        const entry = entries.find(e => e.groupId === m.groupId);
        const s = entry ? entry.subject : this.sadinSubject(m.subject);
        const teacherName = entry ? entry.teacher : teacherOf(m);
        if (!matches(s, teacherName)) return;
        const item = { ...m, subject: s, teacher: teacherName };
        item.key = eventKey(item.groupId, item.subject, item.teacher, item.eventName, item.date, item.weight);
        getSubject(s).missed.set(item.key, item);
      });
      subjects.forEach(s => { s.avg = Store.weightedAverage(s.events).avg; });
      if ((subject !== 'all' || teacher !== 'all') && !subjects.size) return;
      const hasGroups = SignalEngine.prerequisitesFor(t.gradeKey).hasGroups;
      const failing = [...subjects.values()].filter(s => SignalEngine.subjectState(s, t.gradeKey, hasGroups).fail).length;
      const missed = [...subjects.values()].reduce((n, s) => n + s.missed.size, 0);
      rows.push({ t, subjects, overall, failing, missed });
    }));
    if (cacheable) {
      if (sadinSheetCache.length >= 4) sadinSheetCache.shift();
      sadinSheetCache.push({ key, rules, rows });
    }
    return rows.slice();
  },

  /** מקצוע בסדין נחשב חוסם לחניך: ממוצע מתחת לציון עובר או אירוע הערכה שהוחמץ */
  isRiskSubject(s, gradeKey = s.gradeKey, hasGroups = SignalEngine.prerequisitesFor(gradeKey).hasGroups) {
    const state = SignalEngine.subjectState(s, gradeKey, hasGroups);
    return state.fail || state.missed > 0;
  },

  riskSubjects(row) {
    const gradeKey = row.t.gradeKey, hasGroups = SignalEngine.prerequisitesFor(gradeKey).hasGroups;
    return [...row.subjects.values()].filter(s => this.isRiskSubject(s, gradeKey, hasGroups));
  },

  /** מקצועות חוסמים: לכל מקצוע – כמה חניכים רשומים בו וכמה מהם נכשלים או חסרים; ממוין לפי כמות, אחר כך אחוז */
  blockingSubjects(sheetRows, limit = 5) {
    const by = new Map();
    sheetRows.forEach(r => r.subjects.forEach(s => {
      if (!(s.entries.length || s.events.length || s.missed.size)) return;
      const e = by.get(s.name) || { name: s.name, enrolled: 0, bad: 0 };
      e.enrolled++;
      if (this.isRiskSubject(s, r.t.gradeKey)) e.bad++;
      by.set(s.name, e);
    }));
    return [...by.values()].filter(e => e.bad > 0).map(e => ({ ...e, pct: Math.round((e.bad / e.enrolled) * 100) }))
      .sort((a, b) => b.bad - a.bad || b.pct - a.pct || natural(a.name, b.name)).slice(0, limit);
  },

  ANOMALY_LABEL: { none: 'חוסר שיבוץ', dup: 'כפילות שיבוץ', nomajor: 'ללא מגמה' },

  /**
   * "מוקד חריגי שיבוץ": שורה לכל חריגה לטיפול, לחניכי הסינון, בשלוש קטגוריות:
   *  missing – היעדר מקצוע ליבה · duplicate – 2+ קבוצות באותו מקצוע ·
   *  suspect – חשד לשיבוץ שגוי: outlier (בודד מכיתתו), grade (חריג שכבה), sadin (פער מול סדין).
   * המקור זהה ל-analyzeGroupAnomalies ול-explorerModel, כך שהמספרים תואמים לשאר הפאנל.
   * groups = הקבוצות הרשומות במקצוע; sadinGroups = קבוצה שבה מתקבלים ציונים בסדין (בפער מול סדין).
   */
  placementAnomalies(roster) {
    const people = new Map(roster.map(t => [t.tz, t]));
    const enrolled = (tz, catKey) => Store.groupsOf(tz).filter(g => g.inFile && this.categoryOf(g).key === catKey)
      .map(g => ({ groupId: g.groupId, teacher: g.teacher || '', subject: g.subject }));
    const brief = gs => gs.map(g => ({ groupId: g.groupId, teacher: g.teacher || '', subject: g.subject }));
    const rows = [];
    const add = (t, category, kind, kindLabel, subject, groups, sadinGroups = [], extra = {}) =>
      rows.push({ tz: t.tz, t, category, kind, kindLabel, subject, groups, sadinGroups, isRoutineDuplicate: category === 'duplicate' && isRoutineDuplicateSubject(subject), ...extra });

    const analysis = this.analyzeGroupAnomalies(roster, 'all');
    analysis.items.forEach(a => {
      const t = people.get(a.tz);
      if (!t) return;
      if (a.kind === 'none') add(t, 'missing', 'none', 'היעדר מקצוע ליבה', a.subject, [], [], { classEnrolled: a.classEnrolled, classTotal: a.classTotal });
      else if (a.kind === 'dup') add(t, 'duplicate', 'dup', 'כפילות קבוצה', a.subject, brief(a.groups));
      else if (a.kind === 'nomajor') add(t, 'missing_major', 'nomajor', 'ללא שיבוץ מגמה', this.MAJOR_LABEL, []);
    });

    const KIND_LABEL = { outlier: 'חשד לשיבוץ שגוי: בודד מכיתתו', grade: 'חריג שכבה', 'sadin-other': 'פער מול סדין' };
    const seenDup = new Set();
    this.explorerModel().groups.forEach(g => g.members.forEach(m => {
      const t = people.get(m.t.tz);
      if (!t) return;
      m.diag.forEach(d => {
        if (d.kind === 'dup') {
          const key = `${t.tz}|${g.cat.key}`;
          if (g.cat.kind === 'core' || seenDup.has(key)) return;
          seenDup.add(key);
          add(t, 'duplicate', 'dup', 'כפילות קבוצה', g.cat.label, enrolled(t.tz, g.cat.key));
        } else if (KIND_LABEL[d.kind]) {
          const other = d.kind === 'sadin-other' ? Store.groups.get(d.other) : null;
          add(t, 'suspect', d.kind === 'sadin-other' ? 'sadin' : d.kind, KIND_LABEL[d.kind], g.cat.label, enrolled(t.tz, g.cat.key),
            d.kind === 'sadin-other' ? [{ groupId: d.other, teacher: (other && other.teacher) || '' }] : []);
        }
      });
    }));

    const ORDER = { missing: 0, missing_major: 1, duplicate: 2, suspect: 3 };
    rows.sort((a, b) => ORDER[a.category] - ORDER[b.category] || Util.ord(a.t.gradeKey) - Util.ord(b.t.gradeKey) || natural(a.t.classKey, b.t.classKey) || a.t.name.localeCompare(b.t.name, 'he') || natural(a.subject, b.subject));
    return { rows, outside: { unmatched: analysis.counts.unmatched, unmatchedList: analysis.unmatched } };
  },

  /** תווית "מקצוע" לחריגת היעדר מגמה, ומפתח המקצוע המיוחד שמעביר את בדיקת קבוצת היעד למצב השוואת מגמות */
  MAJOR_LABEL: 'מגמת בחירה',
  MAJOR_KEY: '__MAJOR__',

  /**
   * "בדיקת קבוצת יעד ותפוסה": כל קבוצות המקצוע (לפי תווית הקטגוריה) להשוואה עבור חניך:
   * תפוסה, מספר חניכי כיתת האם של החניך בקבוצה, הרכב כיתות ורשימה שמית. קבוצות שכבת החניך קודם, ובתוכן לפי ההתאמה לכיתת האם;
   * שאר השכבות בנפרד. קבוצות תגבור שאינן מגמות אינן נכללות.
   */
  targetGroupInspector(tz, subjectName) {
    const t = Store.trainees.get(tz);
    if (!t) return null;
    const isMajor = subjectName === this.MAJOR_KEY;
    const diagBy = new Map();
    this.explorerModel().groups.forEach(g => g.members.forEach(m => { if (m.diag.length) diagBy.set(`${g.groupId}|${m.t.tz}`, m.diag); }));
    const sadinIds = new Set(Store.currentOf(tz).filter(e => e.groupId).map(e => e.groupId));
    const card = g => {
      const people = [...g.members].map(x => Store.trainees.get(x)).filter(Boolean);
      const byClass = new Map();
      people.forEach(p => byClass.set(p.classKey, (byClass.get(p.classKey) || 0) + 1));
      const members = people.map(p => ({ t: p, sameRoom: p.classKey === t.classKey, self: p.tz === tz, diag: diagBy.get(`${g.groupId}|${p.tz}`) || [] }))
        .sort((a, b) => (b.sameRoom ? 1 : 0) - (a.sameRoom ? 1 : 0) || natural(a.t.classKey, b.t.classKey) || a.t.name.localeCompare(b.t.name, 'he'));
      return {
        groupId: g.groupId, subject: g.subject, teacher: g.teacher || '', targetClasses: g.targetClasses || '', gradeKey: g.gradeKey,
        total: people.length, homeroomN: byClass.get(t.classKey) || 0,
        composition: [...byClass.entries()].map(([classKey, n]) => ({ classKey, n })).sort((a, b) => b.n - a.n || natural(a.classKey, b.classKey)),
        enrolled: g.members.has(tz), inSadin: sadinIds.has(g.groupId), members
      };
    };
    const all = [...Store.groups.values()].filter(g => {
      if (!g.inFile) return false;
      const cat = this.categoryOf(g);
      return (cat.kind === 'major' || !g.reinforcement) && (isMajor ? cat.kind === 'major' : cat.label === subjectName);
    }).map(card);
    const rank = (a, b) => b.homeroomN - a.homeroomN || b.total - a.total || natural(a.teacher, b.teacher) || natural(a.groupId, b.groupId);
    const sameGrade = all.filter(g => g.gradeKey === t.gradeKey).sort(rank);
    const otherGrades = all.filter(g => g.gradeKey !== t.gradeKey)
      .sort((a, b) => Util.ord(a.gradeKey) - Util.ord(b.gradeKey) || rank(a, b));
    return {
      t, subject: isMajor ? this.MAJOR_LABEL : subjectName, isMajor, sameGrade, otherGrades,
      current: all.filter(g => g.enrolled),
      sadin: all.filter(g => g.inSadin && !g.enrolled)
    };
  },

  /** חריגות שיבוץ מקובצות לפי חניך: Map(tz ← { items, severe, text }); "ללא מגמה" נחשב בינוני, השאר חמורות */
  anomaliesByTrainee(analysis) {
    const by = new Map();
    analysis.items.forEach(a => {
      if (!by.has(a.tz)) by.set(a.tz, { tz: a.tz, items: [], severe: false, text: '' });
      const e = by.get(a.tz);
      e.items.push(a);
      if (a.kind !== 'nomajor') e.severe = true;
    });
    by.forEach(e => { e.text = e.items.map(a => `${this.ANOMALY_LABEL[a.kind]}: ${a.subject}`).join(' • '); });
    return by;
  },

  /**
   * מפת שיבוצים לחניך אחד: שורה לכל מקצוע (מקצועות ליבה שיש להם קבוצות בשכבתו + כל מקצוע שבו הוא רשום או מקבל ציונים),
   * עם הקבוצות הרשומות, הקבוצות שבהן יש לו ציונים בסדין וחיווי בקרה. issues: { level: 'severe' | 'warn', text }.
   * מקור החריגות זהה לטבלת החריגים ולסייר הקבוצות (analyzeGroupAnomalies / explorerModel).
   */
  studentPlacementMap(tz) {
    const t = Store.trainees.get(tz);
    if (!t) return null;
    const diagByGroup = new Map();
    if (Store.loaded.groups) {
      this.explorerModel().groups.forEach(g => { const m = g.members.find(x => x.t.tz === tz); if (m) diagByGroup.set(g.groupId, m.diag); });
    }
    const items = Store.loaded.groups ? this.analyzeGroupAnomalies([t], 'all').items : [];
    const rows = new Map();
    const rowOf = cat => {
      if (!rows.has(cat.key)) rows.set(cat.key, { key: cat.key, label: cat.label, kind: cat.kind, order: cat.order, enrolled: [], sadin: [], issues: [] });
      return rows.get(cat.key);
    };
    if (Store.loaded.groups) {
      const coverage = this.coreClassCoverage();
      this.coreSubjects().forEach((s, i) => { if (this.classCoreExpectation(t.classKey, s, coverage).expected) rowOf({ key: `core:${s.id}`, label: s.name, kind: 'core', order: i }); });
    }
    Store.groupsOf(tz).forEach(g => {
      rowOf(this.categoryOf(g)).enrolled.push({ groupId: g.groupId, subject: g.subject, teacher: g.teacher || '', reinforcement: g.reinforcement, inFile: g.inFile, diag: diagByGroup.get(g.groupId) || [] });
    });
    Store.currentOf(tz).forEach(e => {
      const g = e.groupId ? Store.groups.get(e.groupId) : null;
      rowOf(this.categoryOf(g || { subject: e.subject })).sadin.push({ groupId: e.groupId || '', teacher: (g && g.teacher) || e.teacher || '', avg: e.avg });
    });
    if (items.some(a => a.kind === 'nomajor')) rowOf({ key: 'major:none', label: this.MAJOR_LABEL, kind: 'major', order: 100 });

    rows.forEach(r => {
      const ids = r.enrolled.map(g => g.groupId), regular = r.enrolled.filter(g => g.inFile);
      if (r.kind === 'core' && !r.enrolled.length && items.some(a => a.kind === 'none' && a.subject === r.label)) r.issues.push({ level: 'severe', text: 'חסר שיבוץ' });
      if (r.key === 'major:none') r.issues.push({ level: 'warn', text: 'חסר שיבוץ: ללא מגמת בחירה' });
      if (regular.length >= 2) r.issues.push({ level: 'severe', text: `כפול: רשום ב-${regular.length} קבוצות` });
      if (r.enrolled.some(g => g.diag.some(d => d.kind === 'grade'))) r.issues.push({ level: 'severe', text: 'חריג שכבה' });
      if (r.enrolled.some(g => g.diag.some(d => d.kind === 'outlier'))) r.issues.push({ level: 'warn', text: 'בודד מכיתתו' });
      if (Store.loaded.grades) {
        r.sadin.forEach(s => { s.mismatch = !!(s.groupId && ids.length && !ids.includes(s.groupId)); });
        if (r.sadin.some(s => s.mismatch)) r.issues.push({ level: 'warn', text: 'ציונים בסדין בקבוצה אחרת' });
        else if (!ids.length && r.sadin.length && r.kind !== 'core') r.issues.push({ level: 'warn', text: 'ציונים בסדין ללא שיבוץ' });
      }
    });
    const KIND = { core: 0, major: 1, internal: 2, other: 3 };
    const list = [...rows.values()].filter(r => r.enrolled.length || r.sadin.length || r.issues.length)
      .sort((a, b) => KIND[a.kind] - KIND[b.kind] || a.order - b.order || natural(a.label, b.label));
    return {
      t, rows: list,
      counts: {
        groups: Store.groupsOf(tz).length,
        missingCore: list.filter(r => r.kind === 'core' && r.issues.some(i => i.text === 'חסר שיבוץ')).length,
        anomalies: list.reduce((n, r) => n + r.issues.length, 0)
      }
    };
  },

  /**
   * חניכים עם ציון חסר או 0 באירוע שרוב חברי הקבוצה (לפי [groupId]) קיבלו בו ציון.
   * kind: no-row (אין שורה) | empty (ללא ציון) | zero (ציון 0)
   */
  detectMissed(gradesByTz) {
    /* ערך מילולי של עבר / פטור / חסם וכד' הוא תוצאה מתועדת ואינו אירוע שהוחמץ */
    const recorded = r => r.score > 0 || (r.score == null && r.scoreRaw != null && Parser.classify(r.scoreRaw).kind !== 'none');
    const events = new Map();
    gradesByTz.forEach(rows => rows.forEach(r => {
      if (!r.groupId) return;
      const key = `${r.groupId}|${r.eventName}|${r.date}|${r.weight}`;
      if (!events.has(key)) events.set(key, { groupId: r.groupId, eventName: r.eventName, date: r.date, weight: r.weight, byTz: new Map() });
      events.get(key).byTz.set(r.tz, r);
    }));
    const out = [];
    events.forEach(ev => {
      const g = Store.groups.get(ev.groupId);
      const members = new Set(g ? (g.inFile ? g.members : g.gradeMembers) : []);
      if (!g || !g.inFile) ev.byTz.forEach((_, tz) => members.add(tz));
      const valid = [...ev.byTz.entries()].filter(([tz, row]) => members.has(tz) && recorded(row)).length;
      if (valid < Math.max(1, Math.ceil(members.size * 0.5))) return;
      members.forEach(tz => {
        if (!Store.trainees.has(tz)) return;
        const row = ev.byTz.get(tz);
        if (row && recorded(row)) return;
        out.push({
          tz, groupId: ev.groupId, subject: g ? g.subject : '', teacher: g ? g.teacher : '',
          eventName: ev.eventName, date: ev.date, weight: ev.weight, kind: !row ? 'no-row' : (row.score == null ? 'empty' : 'zero')
        });
      });
    });
    return out;
  },

  /**
   * טקסט התראות מוכן להעתקה (וואטסאפ / מייל), מקובץ לפי מורה או כיתת אם:
   * חניכים עם ממוצע שוטף נמוך מציון עובר, אירועי הערכה שהוחמצו וציונים פנימיים חסרים.
   * filterBy: 'teacher' | 'homeroom' | { by, roster, sim, initials, getEval }
   *  initials – שם פרטי + ראשי תיבות של המשפחה ("דנה ל."), לפרטיות בשליחה;
   *  getEval – פונקציה (tz) ← הערכת זכאות מוכנה (מטמון), כדי לא להעריך את כל החניכים פעם שנייה.
   * מחזיר { text, sections: [{ title, count, text }], total }
   */
  generateAlertsText(filterBy = 'teacher') {
    const opts = typeof filterBy === 'string' ? { by: filterBy } : (filterBy || {});
    const byTeacher = opts.by === 'teacher';
    const roster = Array.isArray(opts.roster) ? opts.roster : Store.traineeList();
    const set = new Set(roster.map(t => t.tz));
    const groups = new Map();
    const add = (key, line) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(line); };
    const teacherOf = (groupId, fallback) => { const g = Store.groups.get(groupId); return (g && g.teacher) || fallback || 'ללא מורה'; };
    const nameOf = t => {
      if (!opts.initials) return t.name;
      const parts = String(t.name).trim().split(/\s+/);
      const first = t.firstName || parts[0], last = t.lastName || parts.slice(1).join(' ');
      return last ? `${first} ${last[0]}.` : first;
    };

    roster.forEach(t => Store.activeCurrentOf(t.tz).forEach(e => {
      if (e.avg == null || SignalEngine.isPassingScore(e.avg, { social: Util.norm(e.subject) === Util.norm('מעורבות חברתית') }, Config.rulesForGrade(t.gradeKey))) return;
      const teacher = teacherOf(e.groupId, e.teacher);
      add(byTeacher ? `מורה: ${teacher}` : `כיתה: ${Config.classLabel(t.classKey)}`,
        `• ${nameOf(t)} (${t.classKey}) – ${e.subject}: ממוצע ${Math.round(e.avg)}${byTeacher ? '' : ` | מורה: ${teacher}`}`);
    }));

    Store.missed.filter(m => set.has(m.tz) && Store.isActiveMissed(m)).forEach(m => {
      const t = Store.trainees.get(m.tz);
      const what = { 'no-row': 'חסר ציון', empty: 'חסר ציון', zero: 'ציון 0' }[m.kind];
      add(byTeacher ? `מורה: ${m.teacher || 'ללא מורה'}` : `כיתה: ${Config.classLabel(t.classKey)}`,
        `• ${nameOf(t)} (${t.classKey}) – ${what} באירוע "${m.eventName}" (${m.subject}${m.date ? `, ${m.date}` : ''})`);
    });

    if (typeof BagrutEngine !== 'undefined') {
      const evalOf = opts.getEval || (tz => BagrutEngine.evaluate(tz, opts.sim));
      roster.forEach(t => {
        const ev = evalOf(t.tz);
        if (!ev) return;
        ev.blockers.filter(b => b.k === 'internal').forEach(b => {
          add(byTeacher ? 'ציונים פנימיים חסרים (מרכזת)' : `כיתה: ${Config.classLabel(t.classKey)}`, `• ${nameOf(t)} (${t.classKey}) – חסר: ${b.text.replace('ציון ', '')}`);
        });
      });
    }

    const sections = [...groups.entries()].sort((a, b) => natural(a[0], b[0])).map(([title, lines]) => ({
      title, count: lines.length, text: `*${title}*\n${lines.join('\n')}`
    }));
    const stamp = new Date().toLocaleDateString('he-IL');
    const text = sections.length
      ? `*התראות ציונים שוטפים – ${stamp}*\n(ממוצע מתחת ל-${pass}, אירועי הערכה שהוחמצו וציונים פנימיים חסרים)\n\n${sections.map(s => s.text).join('\n\n')}\n\nנא לטפל / לעדכן. תודה.`
      : '';
    return { text, sections, total: sections.reduce((a, s) => a + s.count, 0) };
  }
};

function natural(a, b) { return String(a).localeCompare(String(b), 'he', { numeric: true }); }
