(function () {
  'use strict';
  const E = Util.esc;
  const $ = id => document.getElementById(id);
  const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };
  const natural = (a, b) => String(a).localeCompare(String(b), 'he', { numeric: true });
  const teachersForSubject = (roster, subject) => {
    const teachers = new Set();
    roster.forEach(t => {
      Store.groupsOf(t.tz).forEach(g => {
        if (g.subject && GroupAnalyzer.sadinSubject(g.subject) === subject && g.teacher) teachers.add(g.teacher);
      });
      Store.activeCurrentOf(t.tz).forEach(e => {
        const teacher = (Store.groups.get(e.groupId) || {}).teacher || e.teacher;
        if (e.subject && GroupAnalyzer.sadinSubject(e.subject) === subject && teacher) teachers.add(teacher);
      });
    });
    return [...teachers].sort(natural);
  };
  const confirmedEvent = (event, hasGroups, tz) => SignalEngine.isConfirmedMissed(event, hasGroups, tz);
  const confirmedMissed = (subject, hasGroups) => SignalEngine.subjectState(subject, subject.gradeKey, hasGroups).missed;
  const missedLabel = count => count ? ` <span class="miss-grade">${count} הוחמצו</span>` : '';
  const prerequisitesByGrade = roster => new Map([...new Set(roster.map(t => t.gradeKey))]
    .map(grade => [grade, SignalEngine.prerequisitesFor(grade)]));
  const isSocial = name => Util.norm(name) === Util.norm('מעורבות חברתית');
  const failingSubject = s => SignalEngine.subjectState(s, s.gradeKey, false).fail;
  const hasEventData = ev => ev && (ev.score != null || String(ev.scoreRaw || '').trim() !== '');
  const RISK_RULES_KEY = 'schoolDashboard.hotspots.riskRules.v1';
  const CORE_ORDER = ['math', 'english', 'hebrew', 'history', 'civics', 'literature', 'tanach'];
  const CORE_ALIASES = [
    ['מתמטיקה', 'חשבון'], ['אנגלית'], ['עברית', 'הבעה', 'לשון'],
    ['היסטוריה'], ['אזרחות'], ['ספרות'], ['תנך', 'מקרא']
  ];
  const excludedWeaknessSubject = s => [s.name, ...s.entries.map(e => e.displaySubject || e.subject)]
    .some(name => {
      const text = Util.norm(name);
      return text === 'חינוך' || /^(?:מגדר|חנג|חינוך גופני)(?:$|[\s(/-])/.test(text);
    });
  const coreRank = name => {
    const core = Config.rules().coreSubjects.find(s => Util.norm(s.name) === Util.norm(name) || Util.matchKeywords(name, s.keywords));
    const rank = core ? CORE_ORDER.indexOf(core.id) : -1;
    return rank >= 0 ? rank : CORE_ALIASES.findIndex(aliases => Util.matchKeywords(name, aliases));
  };
  const validRiskRules = rules => rules && Number.isInteger(rules.minFails) && rules.minFails >= 1 && rules.minFails <= 5 &&
    Number.isInteger(rules.minMissed) && rules.minMissed >= 0 && rules.minMissed <= 5;
  function weaknessRiskRules(app) {
    const st = app.state.sadin;
    if (st.weakRiskRules) return st.weakRiskRules;
    let raw;
    try { raw = window.localStorage.getItem(RISK_RULES_KEY); }
    catch (error) {
      console.warn('weakness risk rules storage', error);
      app.toast('לא ניתן לקרוא את הגדרת הסיכון מהאחסון; ההגדרה תקפה לסשן הנוכחי בלבד.', 'warn');
    }
    let saved = null;
    if (raw) {
      try { saved = JSON.parse(raw); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        console.warn('invalid weakness risk rules', error);
      }
      if (!validRiskRules(saved)) app.toast('הגדרת הסיכון השמורה אינה תקינה; נעשה שימוש בברירת המחדל.', 'warn');
    }
    st.weakRiskRules = validRiskRules(saved) ? { minFails: saved.minFails, minMissed: saved.minMissed } : { minFails: 1, minMissed: 1 };
    return st.weakRiskRules;
  }

  function saveWeaknessRiskRules(app, rules) {
    app.state.sadin.weakRiskRules = { ...rules };
    try { window.localStorage.setItem(RISK_RULES_KEY, JSON.stringify(app.state.sadin.weakRiskRules)); }
    catch (error) {
      console.warn('weakness risk rules storage', error);
      app.toast('לא ניתן לשמור את הגדרת הסיכון באחסון; היא תקפה לסשן הנוכחי בלבד.', 'warn');
    }
  }

  function riskPopover() {
    const stepper = (key, label, suffix) => `<div class="weak-risk-row"><span>${label}</span>
      <div class="weak-risk-stepper"><button type="button" data-act="weaknessRiskAdjust" data-key="${key}" data-step="-1" aria-label="הפחתת ${suffix}">−</button>
      <span class="weak-risk-value" data-key="${key}"></span>
      <button type="button" data-act="weaknessRiskAdjust" data-key="${key}" data-step="1" aria-label="הגדלת ${suffix}">+</button></div><span>${suffix}</span></div>`;
    return `<div id="weak-risk-popover" class="card weak-risk-popover" role="dialog" aria-labelledby="weak-risk-heading" tabindex="-1">
      <h2 id="weak-risk-heading">מתי חניך נחשב בסיכון?</h2>
      ${stepper('minFails', 'נכשל לפחות ב-', 'מקצועות')}
      ${stepper('minMissed', 'הוחמצו לו לפחות', 'הערכות')}
      <p class="weak-risk-help">מספיק שאחד התנאים יתקיים. ההגדרה חלה על כל המסך.</p>
      <div class="weak-risk-preview" role="status" aria-live="polite"></div>
      <div class="weak-risk-actions"><button type="button" class="btn btn-primary btn-sm" data-act="weaknessRiskApply">החל</button>
      <button type="button" class="weak-risk-reset" data-act="weaknessRiskReset">איפוס לברירת מחדל</button></div></div>`;
  }

  function updateRiskPopover(app) {
    const pop = $('weak-risk-popover'), rules = app.state.sadin.weakRiskDraft;
    if (!pop || !rules) return;
    pop.style.transform = '';
    const rect = pop.getBoundingClientRect();
    const shift = rect.left < 8 ? 8 - rect.left : rect.right > window.innerWidth - 8 ? window.innerWidth - 8 - rect.right : 0;
    if (shift) pop.style.transform = `translateX(${shift}px)`;
    pop.querySelectorAll('.weak-risk-value').forEach(el => {
      const value = rules[el.dataset.key];
      el.textContent = el.dataset.key === 'minMissed' && value === 0 ? 'ללא' : String(value);
    });
    pop.querySelectorAll('[data-act="weaknessRiskAdjust"]').forEach(el => {
      const min = el.dataset.key === 'minFails' ? 1 : 0, value = rules[el.dataset.key];
      el.disabled = Number(el.dataset.step) < 0 ? value <= min : value >= 5;
    });
    const preview = pop.querySelector('.weak-risk-preview'), roster = app.filtered();
    if (!Store.loaded.grades && roster.length) {
      preview.textContent = 'לא ניתן לקבוע ללא נתוני ציונים שוטפים.';
      return;
    }
    const model = weaknessModel(roster, app.state.sadin, rules);
    const incomplete = [...prerequisitesByGrade(roster).values()].some(p => !p.hasSadin || (rules.minMissed > 0 && !p.hasGroups));
    preview.textContent = `בהגדרה הזו: ${model.riskyClasses} מתוך ${model.classes.length} כיתות בסיכון · ${model.riskyStudents} חניכים בסיכון בסינון${incomplete || (rules.minMissed > 0 && model.uncertain) ? ' · הנתונים עשויים להיות חלקיים' : ''}`;
  }

  function relevantSubject(s) {
    const rules = Config.rules();
    const names = [s.name, ...s.entries.map(e => e.displaySubject || e.subject)];
    const defs = [...rules.coreSubjects, ...rules.majors, ...rules.internals].filter(d => d.enabled !== false);
    return defs.some(d => names.some(name =>
      Util.matchKeywords(name, [...(d.keywords || []), ...(d.groupKeywords || []), d.name]))) ||
      s.entries.some(e => {
        const group = Store.groups.get(e.groupId);
        return group && GroupAnalyzer.isMajorGroup(group);
      });
  }

  function normalizeRow(row, early) {
    return Config.withRulesForGrade(row.t.gradeKey, () => {
      const subjects = early ? new Map([...row.subjects].filter(([, s]) => relevantSubject(s))) : row.subjects;
      return { ...row, subjects, failing: [...subjects.values()].filter(failingSubject).length,
        missed: [...subjects.values()].reduce((n, s) => n + s.missed.size, 0) };
    });
  }

  function signalSummary(roster, rows, opts) {
    const prereqs = prerequisitesByGrade(roster);
    const missing = [...prereqs].flatMap(([grade, p]) => {
      return [
        !p.hasSadin ? UI.signalBadge('sadin.unknown', `לא ניתן לקבוע — חסר קובץ סדין לשכבה ${Util.gl(grade)}`) : '',
        !p.hasGroups ? UI.signalBadge('placement.unknown', `לא ניתן לקבוע שיבוץ — חסר קובץ קבוצות לשכבה ${Util.gl(grade)}`) : ''
      ].filter(Boolean);
    });
    const all = SignalEngine.computeAll(opts), pedagogical = new Map(), quality = new Map();
    const add = (map, id, tz) => {
      if (!map.has(id)) map.set(id, new Set());
      map.get(id).add(tz);
    };
    rows.forEach(row => {
      const signal = all.byTz.get(row.t.tz);
      row.subjects.forEach(subject => {
        const state = SignalEngine.subjectState(subject, row.t.gradeKey, signal.prereqs.hasGroups);
        if (state.fail) add(pedagogical, 'sadin.fail', row.t.tz);
        if (state.borderline) add(pedagogical, 'sadin.borderline', row.t.tz);
        if (state.missed) add(pedagogical, 'sadin.missed_event', row.t.tz);
      });
      signal.dataQuality.filter(f => f.id === 'data.sadin_not_enrolled').forEach(f => add(quality, f.id, row.t.tz));
    });
    const unmatched = GroupAnalyzer.unmatchedIds().filter(item => item.sources.includes('סדין ציונים'));
    unmatched.forEach(item => add(quality, 'data.not_in_roster', item.tz));
    const badges = map => [...map].map(([id, ids]) =>     UI.signalBadge(id, `${SignalEngine.CATALOG[id].label}: ${ids.size} חניכים`)).join(' ');
    const incompleteGroups = [...prereqs.values()].some(p => !p.hasGroups);
    return `<div class="w-full space-y-2 mt-2" aria-label="דגלי ציונים ואיכות נתונים">
      ${missing.length ? `<div class="flex flex-wrap gap-1">${missing.join(' ')}</div>` : ''}
      ${incompleteGroups ? '<p class="text-xs text-slate-500">החמצות דורשות אימות שיבוץ; אירועים שטרם אומתו מוצגים לבדיקה בלבד.</p>' : ''}
      <div class="grid md:grid-cols-2 gap-2">
        <section aria-label="דגלים פדגוגיים"><strong>דגלים פדגוגיים:</strong> ${badges(pedagogical) || '<span class="text-slate-500">לא אותרו בנתונים הזמינים</span>'}
          <div class="text-xs text-slate-500">הדגלים, הציונים והמסננים לפי הכללים הפעילים.</div></section>
        <section aria-label="איכות נתונים"><strong>איכות נתונים:</strong> ${badges(quality) || '<span class="text-slate-500">לא אותרו בנתונים הזמינים</span>'}
          <div class="text-xs text-slate-500">שיבוצים לפי חניכים מוצגים וכל מקצועותיהם; חניכים שאינם במצבת לפי כלל קובץ הסדין.</div></section>
      </div></div>`;
  }

  function weaknessModel(roster, st, rules) {
    const prereqs = prerequisitesByGrade(roster), cells = new Map(), classes = new Map(), coreRanks = new Map();
    const failed = new Set(), riskTzs = new Set(), averages = [], teachers = new Map();
    roster.forEach(t => {
      if (!classes.has(t.classKey)) classes.set(t.classKey, { key: t.classKey, grade: t.gradeKey, total: 0, risk: 0, scores: [] });
      classes.get(t.classKey).total++;
    });
    let missedTotal = 0, uncertain = false;
    GroupAnalyzer.sadinSheet(roster, st).forEach(row => Config.withRulesForGrade(row.t.gradeKey, () => {
      const hasGroups = prereqs.get(row.t.gradeKey).hasGroups, scores = [], classScores = [];
      let fails = 0, missedForStudent = 0;
      row.subjects.forEach(s => {
        if (s.avg != null) scores.push(s.avg);
        if (excludedWeaknessSubject(s)) return;
        const rank = coreRank(s.name);
        if (rank >= 0 && (!coreRanks.has(s.name) || rank < coreRanks.get(s.name))) coreRanks.set(s.name, rank);
        const missed = confirmedMissed(s, hasGroups, row.t.tz), fail = failingSubject(s);
        uncertain = uncertain || s.missed.size > missed;
        if (fail) { failed.add(row.t.tz); fails++; }
        missedForStudent += missed;
        missedTotal += missed;
        if (!missed && (s.avg == null || (s.avg === 0 && !fail && s.missed.size))) return;
        if (s.avg != null) classScores.push(s.avg);
        const key = JSON.stringify([row.t.classKey, s.name]);
        if (!cells.has(key)) cells.set(key, { cls: row.t.classKey, subject: s.name, students: [], scores: [], teachers: new Set(), missed: 0, uncertain: false });
        const cell = cells.get(key), risk = fail || (rules.minMissed > 0 && missed >= rules.minMissed);
        cell.uncertain = cell.uncertain || !hasGroups || s.missed.size > missed;
        cell.students.push({ t: row.t, avg: s.avg, fail, missed, risk });
        if (s.avg != null) cell.scores.push(s.avg);
        cell.missed += missed;
        const names = new Set(s.entries.map(e => e.teacher).concat([...s.missed.values()].map(m => m.teacher)).filter(Boolean));
        names.forEach(name => {
          cell.teachers.add(name);
          const teacherKey = JSON.stringify([s.name, name]);
          if (!teachers.has(teacherKey)) teachers.set(teacherKey, { subject: s.name, name, scores: [], total: 0, fail: 0, missed: 0, uncertain: false });
          const item = teachers.get(teacherKey);
          const events = s.events.filter(e => e.teacher === name);
          const avg = Store.weightedAverage(events).avg;
          const subject = { ...s, avg, events, missed: new Map([...s.missed].filter(([, m]) => m.teacher === name)) };
          if (avg != null) item.scores.push(avg);
          item.total++;
          if (failingSubject(subject)) item.fail++;
          const teacherMissed = confirmedMissed(subject, hasGroups, row.t.tz);
          item.missed += teacherMissed;
          item.uncertain = item.uncertain || !hasGroups || subject.missed.size > teacherMissed;
        });
      });
      if (scores.length) averages.push(scores.reduce((a, b) => a + b, 0) / scores.length);
      const cls = classes.get(row.t.classKey);
      if (classScores.length) cls.scores.push(classScores.reduce((a, b) => a + b, 0) / classScores.length);
      if (fails >= rules.minFails || (rules.minMissed > 0 && missedForStudent >= rules.minMissed)) { cls.risk++; riskTzs.add(row.t.tz); }
    }));
    const list = [...cells.values()];
    list.forEach(c => { c.risk = c.students.filter(s => s.risk).length; c.rate = c.risk / c.students.length * 100; });
    const fullCells = list.filter(c => c.students.length >= 3);
    const ranked = (fullCells.length ? fullCells : list).sort((a, b) => b.rate - a.rate || b.risk - a.risk || natural(a.subject, b.subject) || natural(a.cls, b.cls));
    const subjectStats = new Map();
    list.forEach(c => {
      if (!subjectStats.has(c.subject)) subjectStats.set(c.subject, { full: [], small: [] });
      subjectStats.get(c.subject)[c.students.length >= 3 ? 'full' : 'small'].push(c);
    });
    const subjectRate = name => {
      const stats = subjectStats.get(name), group = stats.full.length ? stats.full : stats.small;
      return group.reduce((n, c) => n + c.risk, 0) / group.reduce((n, c) => n + c.students.length, 0);
    };
    const subjects = [...new Set(list.map(c => c.subject))].sort((a, b) => {
      const aCore = coreRanks.has(a), bCore = coreRanks.has(b);
      if (aCore !== bCore) return aCore ? -1 : 1;
      if (aCore) return coreRanks.get(a) - coreRanks.get(b) || natural(a, b);
      const aFull = subjectStats.get(a).full.length > 0, bFull = subjectStats.get(b).full.length > 0;
      return Number(bFull) - Number(aFull) || subjectRate(b) - subjectRate(a) || natural(a, b);
    });
    const grades = new Map();
    classes.forEach(c => {
      if (!grades.has(c.grade)) grades.set(c.grade, []);
      grades.get(c.grade).push(c);
    });
    const classMean = c => c.scores.length ? c.scores.reduce((a, b) => a + b, 0) / c.scores.length : Infinity;
    let riskyClasses = 0;
    grades.forEach(group => {
      group.sort((a, b) => b.risk / b.total - a.risk / a.total || b.risk - a.risk || classMean(a) - classMean(b) || natural(a.key, b.key));
      riskyClasses += group.slice(0, Math.ceil(group.length / 3)).filter(c => c.risk > 0).length;
    });
    return { cells, ranked, subjects, coreRanks, classes: [...classes.keys()].sort(natural), failed: failed.size, missed: missedTotal,
      riskyClasses, riskyStudents: riskTzs.size, riskTzs: [...riskTzs], averages, teachers: [...teachers.values()], uncertain };
  }

  const meanNum = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const mean = values => values.length ? Util.fmt(meanNum(values), 1) : '—';
  const fmtDelta = (delta, suffix = '') => {
    if (delta == null || !Number.isFinite(delta)) return '';
    const rounded = Math.round(delta * 10) / 10;
    if (Math.abs(rounded) < 0.1) return `0.0${suffix}`;
    return `${rounded > 0 ? '+' : '−'}${Util.fmt(Math.abs(rounded), 1)}${suffix}`;
  };

  /**
   * מודל 3 המשקפות ההרמטיות של מסך "מוקדי חולשה":
   *  1. classes – כיתות אם בשכבה ופירוק סיבות (ללא רעש מגמות קטנות).
   *  2. subjects – מקצועות בשכבה ופירוק לקבוצות לימוד (groupId) ומורים כולל פער מממוצע המקצוע.
   *  3. students – חניכי קצה פעילים מעל הסף בנפרד מחניכים ללא ציונים כלל בשוטף.
   */
  function buildWeaknessLensesModel(roster, rules) {
    const prereqs = prerequisitesByGrade(roster);
    const classMap = new Map();
    roster.forEach(t => {
      if (!classMap.has(t.classKey)) {
        classMap.set(t.classKey, {
          key: t.classKey, grade: t.gradeKey, total: 0, gradedStudents: 0,
          studentAvgs: [], subjectEvals: 0, failedEvals: 0, studentsWithFail: 0,
          missedCount: 0, uncertain: false, subjects: new Map()
        });
      }
      classMap.get(t.classKey).total++;
    });

    const subjectMap = new Map();
    const cohortStudentAvgs = [];
    const edgeStudents = [];
    const noGradesStudents = [];
    let globalUncertain = false;

    const sheetRows = GroupAnalyzer.sadinSheet(roster, {});
    const rowByTz = new Map(sheetRows.map(r => [r.t.tz, r]));

    roster.forEach(t => {
      const row = rowByTz.get(t.tz) || { t, subjects: new Map() };
      Config.withRulesForGrade(t.gradeKey, () => {
        const p = prereqs.get(t.gradeKey) || { hasGroups: false, hasSadin: false };
        const hasGroups = p.hasGroups;
        const cls = classMap.get(t.classKey);
        const studentScores = [];
        const failedSubjects = [];
        const missedSubjects = [];
        const failTeacherSet = new Set();
        let fails = 0, missedForStudent = 0, activeSubjectCount = 0;

        row.subjects.forEach(s => {
          if (excludedWeaknessSubject(s)) return;
          const missed = confirmedMissed(s, hasGroups, t.tz);
          const unverifiedMissed = s.missed.size > missed;
          if (unverifiedMissed || !hasGroups) {
            globalUncertain = globalUncertain || unverifiedMissed;
            if (cls) cls.uncertain = cls.uncertain || !hasGroups || unverifiedMissed;
          }
          const hasValidAvg = s.avg != null && !(s.avg === 0 && !failingSubject(s) && s.missed.size > 0);
          if (!hasValidAvg && !missed) return;

          activeSubjectCount++;
          const fail = hasValidAvg && failingSubject(s);
          if (hasValidAvg) studentScores.push(s.avg);
          if (fail) fails++;
          missedForStudent += missed;
          if (missed > 0) missedSubjects.push({ name: s.name, count: missed });

          /* עדכון משקפת 1: כיתות אם */
          if (cls) {
            cls.subjectEvals++;
            if (fail) cls.failedEvals++;
            cls.missedCount += missed;
            if (!cls.subjects.has(s.name)) {
              cls.subjects.set(s.name, { name: s.name, isCore: coreRank(s.name) >= 0, n: 0, scores: [], failCount: 0, missedCount: 0 });
            }
            const cs = cls.subjects.get(s.name);
            cs.n++;
            if (hasValidAvg) cs.scores.push(s.avg);
            if (fail) cs.failCount++;
            cs.missedCount += missed;
          }

          /* עדכון משקפת 2: מקצועות וקבוצות לימוד */
          if (!subjectMap.has(s.name)) {
            const cRank = coreRank(s.name);
            subjectMap.set(s.name, {
              name: s.name, isCore: cRank >= 0, coreOrder: cRank >= 0 ? cRank : 99,
              studentCount: 0, scores: [], failCount: 0, missedCount: 0,
              uncertain: false, groups: new Map()
            });
          }
          const sub = subjectMap.get(s.name);
          sub.studentCount++;
          sub.uncertain = sub.uncertain || !hasGroups || unverifiedMissed;
          if (hasValidAvg) sub.scores.push(s.avg);
          if (fail) sub.failCount++;
          sub.missedCount += missed;

          /* פיצול לקבוצות לימוד (groupId) ומורים מתוך s.entries ו-s.missed */
          const groupBuckets = new Map();
          const ensureBucket = (groupId, rawTeacher) => {
            const gid = groupId ? String(groupId) : '';
            const gObj = gid ? Store.groups.get(gid) : null;
            const teacher = (gObj && gObj.teacher) || rawTeacher || 'ללא מורה';
            const bKey = gid ? `grp:${gid}` : `tch:${teacher}`;
            if (!groupBuckets.has(bKey)) {
              const groupLabel = gid
                ? ((gObj && gObj.targetClasses ? `${gObj.targetClasses} ` : '') + `[${gid}]`).trim()
                : 'ללא קבוצה מזוהה';
              groupBuckets.set(bKey, { key: bKey, groupId: gid, groupLabel, teacher, events: [], entryAvgs: [], missedMap: new Map() });
            }
            return groupBuckets.get(bKey);
          };
          s.entries.forEach(e => {
            const b = ensureBucket(e.groupId, e.teacher);
            if (e.events && e.events.length) b.events.push(...e.events);
            else if (e.avg != null) b.entryAvgs.push(e.avg);
          });
          s.missed.forEach((m, mKey) => {
            const b = ensureBucket(m.groupId, m.teacher);
            b.missedMap.set(mKey, m);
          });
          if (!groupBuckets.size) {
            /* גיבוי כשאין entry מזוהה: בדיקה בקבוצות הרשומות של החניך למקצוע */
            const enrolledGrp = Store.groupsOf(t.tz).find(g => g.subject && GroupAnalyzer.sadinSubject(g.subject) === s.name);
            const b = ensureBucket(enrolledGrp ? enrolledGrp.groupId : '', enrolledGrp ? enrolledGrp.teacher : '');
            if (hasValidAvg) b.entryAvgs.push(s.avg);
          }

          const subjTeachersForFail = [];
          groupBuckets.forEach(b => {
            const gAvg = b.events.length ? Store.weightedAverage(b.events).avg : meanNum(b.entryAvgs);
            const synth = { ...s, avg: gAvg, events: b.events, missed: b.missedMap };
            const gMissed = confirmedMissed(synth, hasGroups, t.tz);
            const gValidAvg = gAvg != null && !(gAvg === 0 && !failingSubject(synth) && b.missedMap.size > 0);
            if (!gValidAvg && !gMissed) return;
            const gFail = gValidAvg && failingSubject(synth);
            if (fail && b.teacher && b.teacher !== 'ללא מורה') {
              failTeacherSet.add(b.teacher);
              subjTeachersForFail.push(b.teacher);
            }
            if (!sub.groups.has(b.key)) {
              sub.groups.set(b.key, {
                key: b.key, groupId: b.groupId, groupLabel: b.groupLabel, teacher: b.teacher,
                studentCount: 0, scores: [], failCount: 0, missedCount: 0, uncertain: false
              });
            }
            const grp = sub.groups.get(b.key);
            grp.studentCount++;
            if (gValidAvg) grp.scores.push(gAvg);
            if (gFail) grp.failCount++;
            grp.missedCount += gMissed;
            grp.uncertain = grp.uncertain || !hasGroups || b.missedMap.size > gMissed;
          });

          if (fail) {
            failedSubjects.push({ name: s.name, avg: s.avg, teachers: [...new Set(subjTeachersForFail)] });
          }
        });

        /* סיווג חניך למשקפת 3: הפרדה מוחלטת של חניכים ללא ציונים כלל בשוטף */
        if (activeSubjectCount === 0) {
          noGradesStudents.push({ t, classKey: t.classKey });
          return;
        }

        const studentMean = meanNum(studentScores);
        if (studentMean != null) {
          cohortStudentAvgs.push(studentMean);
          if (cls) cls.studentAvgs.push(studentMean);
        }
        if (cls) {
          cls.gradedStudents++;
          if (fails > 0) cls.studentsWithFail++;
        }

        const meetsRisk = fails >= rules.minFails || (rules.minMissed > 0 && missedForStudent >= rules.minMissed);
        if (meetsRisk) {
          edgeStudents.push({
            t, overallAvg: studentMean, fails, missedCount: missedForStudent,
            failedSubjects: failedSubjects.sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999) || natural(a.name, b.name)),
            missedSubjects: missedSubjects.sort((a, b) => b.count - a.count || natural(a.name, b.name)),
            distinctFailTeachers: failTeacherSet.size
          });
        }
      });
    });

    const cohortAvg = meanNum(cohortStudentAvgs);

    /* גימור משקפת 1 – כיתות אם */
    const classes = [...classMap.values()].map(c => {
      const avg = meanNum(c.studentAvgs);
      const deltaFromCohort = avg != null && cohortAvg != null ? avg - cohortAvg : null;
      const failRate = c.subjectEvals ? (c.failedEvals / c.subjectEvals) * 100 : 0;
      const failPct = Math.round(failRate);
      const hasGroups = (prereqs.get(c.grade) || {}).hasGroups;
      /* ניקוי רעש מגמות: הצג רק מקצועות עם נוכחות ממשית בכיתה (n >= 4 או >= 25% מהחניכים בעלי נתונים; בכיתות זעירות <= 4 מותאם) */
      const allSubs = [...c.subjects.values()].map(s => ({
        ...s, avg: meanNum(s.scores), failPct: s.n ? Math.round((s.failCount / s.n) * 100) : 0
      }));
      const isSubstantial = s => c.total <= 4
        ? (s.n >= 2 || (c.total <= 2 && s.n >= 1))
        : (s.n >= 4 || (c.gradedStudents > 0 && s.n >= 3 && s.n / c.gradedStudents >= 0.25));
      const substantialSubjects = allSubs.filter(isSubstantial)
        .sort((a, b) => b.failPct - a.failPct || b.missedCount - a.missedCount || (a.avg ?? 999) - (b.avg ?? 999) || natural(a.name, b.name));
      const omittedSubjectsCount = allSubs.length - substantialSubjects.length;
      const concernScore = failRate * 1.4 + (c.gradedStudents ? (c.missedCount / c.gradedStudents) * 18 : 0) + Math.max(0, -(deltaFromCohort || 0)) * 1.2;
      const isCalm = c.failedEvals === 0 && c.missedCount === 0 && (deltaFromCohort == null || deltaFromCohort >= -3);
      let patternText = 'כיתה יציבה — ללא ציונים נכשלים או החמצות מאומתות בנתונים הזמינים.';
      if (c.gradedStudents === 0) patternText = 'טרם דווחו ציונים שוטפים לחניכי הכיתה.';
      else if (c.failedEvals > 0 && c.missedCount >= c.failedEvals) patternText = `שילוב של ציונים נכשלים (${failPct}% מציוני המקצועות) וצבירת החמצות הערכה (${c.missedCount}).`;
      else if (c.failedEvals > 0) patternText = `מוקד קושי לימודי — ${failPct}% מציוני המקצועות בכיתה נכשלים (${c.studentsWithFail} חניכים עם נכשל)${c.missedCount ? ` · ${c.missedCount} החמצות` : ''}.`;
      else if (c.missedCount > 0) patternText = `מוקד היעדרות מהערכות — ${c.missedCount} החמצות מאומתות ללא ממוצעים נכשלים.`;
      else if (!isCalm) patternText = `ממוצע כיתתי נמוך מממוצע השכבה (${fmtDelta(deltaFromCohort)}) ללא נכשלים פעילים.`;
      return {
        ...c, avg, deltaFromCohort, failRate, failPct, hasGroups,
        substantialSubjects, omittedSubjectsCount, concernScore, isCalm, patternText
      };
    }).sort((a, b) => b.concernScore - a.concernScore || (a.avg ?? 999) - (b.avg ?? 999) || natural(a.key, b.key));

    /* גימור משקפת 2 – מקצועות וקבוצות */
    const subjects = [...subjectMap.values()].map(s => {
      const avg = meanNum(s.scores);
      const failPct = s.studentCount ? Math.round((s.failCount / s.studentCount) * 100) : 0;
      const groups = [...s.groups.values()].map(g => {
        const gAvg = meanNum(g.scores);
        const gFailPct = g.studentCount ? Math.round((g.failCount / g.studentCount) * 100) : 0;
        const deltaFromSubject = gAvg != null && avg != null ? gAvg - avg : null;
        const gConcern = gFailPct * 1.3 + (g.studentCount ? (g.missedCount / g.studentCount) * 18 : 0) + Math.max(0, -(deltaFromSubject || 0)) * 1.5;
        return { ...g, avg: gAvg, failPct: gFailPct, deltaFromSubject, concernScore: gConcern };
      }).sort((a, b) => b.concernScore - a.concernScore || (a.avg ?? 999) - (b.avg ?? 999) || natural(a.teacher, b.teacher));
      const concernScore = failPct * 1.35 + (s.studentCount ? (s.missedCount / s.studentCount) * 18 : 0) + (avg != null ? Math.max(0, 68 - avg) * 0.7 : 0);
      const isCalm = s.failCount === 0 && s.missedCount === 0;
      return { ...s, avg, failPct, groups, groupCount: groups.length, concernScore, isCalm };
    }).sort((a, b) => b.concernScore - a.concernScore || a.coreOrder - b.coreOrder || natural(a.name, b.name));

    /* גימור משקפת 3 – חניכי קצה */
    edgeStudents.sort((a, b) =>
      (b.fails * 2 + b.distinctFailTeachers * 0.4 + b.missedCount) - (a.fails * 2 + a.distinctFailTeachers * 0.4 + a.missedCount) ||
      (a.overallAvg ?? 999) - (b.overallAvg ?? 999) ||
      natural(a.t.name, b.t.name)
    );
    noGradesStudents.sort((a, b) => natural(a.classKey, b.classKey) || natural(a.t.name, b.t.name));

    return { cohortAvg, classes, subjects, edgeStudents, noGradesStudents, prereqs, globalUncertain };
  }

  const severity = rate => rate < 20 ? 0 : rate < 40 ? 1 : rate < 60 ? 2 : 3;

  window.SadinView = {
  getHotspotsSummary(roster, filters = this.state.sadin) {
    const model = weaknessModel(roster, filters, weaknessRiskRules(this));
    const ranked = model.ranked.filter(c => c.risk);
    return {
      model, riskStudentsCount: model.riskyStudents, riskStudentTzs: model.riskTzs,
      riskClassesCount: model.riskyClasses, totalClassesCount: model.classes.length,
      hotspotsCount: ranked.length, hotspots: ranked.slice(0, 3),
      average: model.averages.length ? model.averages.reduce((a, b) => a + b, 0) / model.averages.length : null
    };
  },

  earlyWarningRows(roster, filters = {}) {
    return GroupAnalyzer.sadinSheet(roster, filters).map(r => normalizeRow(r, true)).filter(r => {
      const ex = Config.getException(r.t.tz);
      return !(ex.isException && ex.overrideStatus === 'twelve') &&
        GroupAnalyzer.riskSubjects(r).length > 0;
    });
  },

  sadinMode(el, preserveFilter = false) {
    if (el.dataset.mode === 'full') SadinView.weaknessRiskClose.call(this);
    if (el.dataset.mode === 'early' && el.dataset.backWeakness && this._weaknessBackState) {
      const prev = this._weaknessBackState;
      this._weaknessBackState = null;
      this.state.filters.grade = prev.grade;
      this.state.filters.cls = prev.cls;
      this.state.filters.track = prev.track;
      Object.assign(this.state.sadin, {
        mode: 'early', strip: 'all', subject: 'all', teacher: 'all',
        weakLens: prev.weakLens || 'classes',
        weakClassKey: prev.weakClassKey || '',
        weakSubjectKey: prev.weakSubjectKey || ''
      });
      this.syncFilters();
      this.onFilterChange();
      this.showTab('sadin');
      return;
    }
    if (el.dataset.mode === 'early') {
      this._weaknessBackState = null;
      this.state.sadin.subject = 'all';
      this.state.sadin.teacher = 'all';
    }
    this.state.sadin.mode = el.dataset.mode;
    if (el.dataset.mode === 'full') this.state.sadin.view = 'sheet';
    if (!preserveFilter) this.state.sadin.strip = 'all';
    this.dirty.add('sadin'); this.showTab('sadin');
  },

  weakLens(el) {
    const st = this.state.sadin;
    const lens = ['classes', 'subjects', 'students'].includes(el.dataset.lens) ? el.dataset.lens : 'classes';
    if (st.weakRiskDraft && lens !== 'students') SadinView.weaknessRiskClose.call(this, false);
    st.weakLens = lens;
    st.weakSubjectKind = 'all';
    st.weakStudentFilter = 'all';
    st.subject = 'all';
    st.teacher = 'all';
    this.dirty.add('sadin');
    this.renderTab('sadin');
  },

  weakPickClass(el) {
    this.state.sadin.weakClassKey = el.dataset.class || '';
    SadinView.renderWeakness.call(this, this.filtered(), this.state.sadin);
    const btn = [...document.querySelectorAll('#sadin-table [data-act="weakPickClass"]')].find(b => b.dataset.class === this.state.sadin.weakClassKey);
    if (btn) btn.focus();
  },

  weakPickSubject(el) {
    this.state.sadin.weakSubjectKey = el.dataset.subject || '';
    SadinView.renderWeakness.call(this, this.filtered(), this.state.sadin);
    const btn = [...document.querySelectorAll('#sadin-table [data-act="weakPickSubject"]')].find(b => b.dataset.subject === this.state.sadin.weakSubjectKey);
    if (btn) btn.focus();
  },

  weakSubjectKind(el) {
    this.state.sadin.weakSubjectKind = el.dataset.kind || 'all';
    SadinView.renderWeakness.call(this, this.filtered(), this.state.sadin);
  },

  weakStudentFilter(el) {
    this.state.sadin.weakStudentFilter = el.dataset.filter || 'all';
    SadinView.renderWeakness.call(this, this.filtered(), this.state.sadin);
  },

  weaknessRiskToggle() {
    const st = this.state.sadin;
    if (st.weakLens !== 'students') return;
    if (st.weakRiskDraft) return SadinView.weaknessRiskClose.call(this, true);
    const control = document.querySelector('#sadin-mode .weak-risk-control');
    if (!control) return;
    st.weakRiskDraft = { ...weaknessRiskRules(this) };
    control.insertAdjacentHTML('beforeend', riskPopover());
    control.querySelector('[data-act="weaknessRiskToggle"]').setAttribute('aria-expanded', 'true');
    updateRiskPopover(this);
    $('weak-risk-popover').focus();
  },

  weaknessRiskClose(restoreFocus = false) {
    const hadDraft = !!this.state.sadin.weakRiskDraft;
    this.state.sadin.weakRiskDraft = null;
    const pop = $('weak-risk-popover');
    if (pop) pop.remove();
    const button = document.querySelector('#sadin-mode [data-act="weaknessRiskToggle"]');
    if (button) {
      button.setAttribute('aria-expanded', 'false');
      if (restoreFocus) button.focus();
    }
    if (hadDraft && this.state.sadin.mode !== 'full' && this.state.sadin.weakLens === 'students' && Store.loaded.grades) {
      SadinView.renderWeakness.call(this, this.filtered(), this.state.sadin);
    }
  },

  weaknessRiskAdjust(el) {
    const st = this.state.sadin, draft = st.weakRiskDraft, key = el.dataset.key, step = Number(el.dataset.step);
    if (!draft || !['minFails', 'minMissed'].includes(key) || ![-1, 1].includes(step) ||
        !validRiskRules({ ...draft, [key]: draft[key] + step })) {
      this.toast('הגדרת הסיכון שנבחרה אינה תקינה.', 'warn');
      return;
    }
    draft[key] += step;
    updateRiskPopover(this);
    if (st.mode !== 'full' && st.weakLens === 'students' && Store.loaded.grades) {
      SadinView.renderWeakness.call(this, this.filtered(), st);
    }
  },

  weaknessRiskReset() {
    if (!this.state.sadin.weakRiskDraft) return;
    this.state.sadin.weakRiskDraft = { minFails: 1, minMissed: 1 };
    updateRiskPopover(this);
    if (this.state.sadin.mode !== 'full' && this.state.sadin.weakLens === 'students' && Store.loaded.grades) {
      SadinView.renderWeakness.call(this, this.filtered(), this.state.sadin);
    }
  },

  weaknessRiskApply() {
    if (!this.requireEdit()) return;
    const draft = this.state.sadin.weakRiskDraft;
    if (!validRiskRules(draft)) {
      this.toast('הגדרת הסיכון שנבחרה אינה תקינה.', 'warn');
      return;
    }
    saveWeaknessRiskRules(this, draft);
    SadinView.weaknessRiskClose.call(this);
    this.dirty.add('sadin'); this.renderTab('sadin');
    const button = document.querySelector('#sadin-mode [data-act="weaknessRiskToggle"]');
    if (button) button.focus();
  },

  weaknessRiskChange(el) {
    if (!this.requireEdit()) return;
    const key = el.dataset.key, value = Number(el.value), current = weaknessRiskRules(this);
    if (!['minFails', 'minMissed'].includes(key) || !validRiskRules({ ...current, [key]: value })) {
      this.toast('הגדרת הסיכון שנבחרה אינה תקינה.', 'warn');
      this.dirty.add('sadin'); this.renderTab('sadin');
      return;
    }
    saveWeaknessRiskRules(this, { ...current, [key]: value });
    this.dirty.add('sadin'); this.renderTab('sadin');
    const next = document.querySelector(`[data-chg="weaknessRiskRules"][data-key="${key}"]`);
    if (next) next.focus();
  },

  selectWeakness(el) {
    const scroll = document.querySelector('#sadin-table .weak-scroll');
    const left = scroll ? scroll.scrollLeft : 0;
    this.state.sadin.cell = { cls: el.dataset.class, subject: el.dataset.subject };
    this.dirty.add('sadin'); this.renderTab('sadin');
    const next = document.querySelector('#sadin-table .weak-scroll');
    if (next) next.scrollLeft = left;
    const button = [...document.querySelectorAll('#sadin-table .weak-heat')].find(b =>
      b.dataset.class === el.dataset.class && b.dataset.subject === el.dataset.subject);
    if (button) button.focus();
  },

  openWeaknessEligibility(el) {
    this.rememberScreenFilters();
    this.resetOverviewDrillFilters();
    this.state.filters.cls = el.dataset.class;
    this.state.bagrutScopeSet = true;
    Object.assign(this.state.bagrut, { chip: 'all', drill: 'all', onlyPending: false, readinessClass: '', readinessFilter: 'all', targets: false });
    this.onFilterChange();
    this.showTab('bagrut');
  },

  openWeaknessSheet(el) {
    this._weaknessBackState = {
      grade: this.state.filters.grade, cls: this.state.filters.cls, track: this.state.filters.track,
      subject: 'all', teacher: 'all',
      weakLens: this.state.sadin.weakLens || 'classes',
      weakClassKey: this.state.sadin.weakClassKey || '',
      weakSubjectKey: this.state.sadin.weakSubjectKey || ''
    };
    let teachers = [];
    try { teachers = el.dataset.teachers ? JSON.parse(el.dataset.teachers) : []; } catch (e) { teachers = []; }
    const explicitTeacher = el.dataset.teacher;
    const teacher = explicitTeacher !== undefined
      ? (explicitTeacher || 'all')
      : (this.state.sadin.teacher && this.state.sadin.teacher !== 'all' ? this.state.sadin.teacher : teachers.length === 1 ? teachers[0] : 'all');
    const targetCls = el.dataset.class || 'all';
    const targetSubject = el.dataset.subject || 'all';
    this.rememberScreenFilters();
    this.resetOverviewDrillFilters();
    this.state.filters.cls = targetCls;
    Object.assign(this.state.sadin, { mode: 'full', view: 'sheet', strip: 'all', subject: targetSubject, teacher });
    this.syncFilters();
    this.onFilterChange();
    this.showTab('sadin');
  },

  openWeaknessAlerts(el) {
    const subject = el.dataset.subject;
    if (!subject) return;
    let teachers = [];
    try { teachers = el.dataset.teachers ? JSON.parse(el.dataset.teachers) : []; } catch (e) { teachers = []; }
    this.alertOut = [];
    SadinView.openSadinAlerts.call(this, {
      cls: el.dataset.class || 'all',
      subject,
      teachers,
      groupId: el.dataset.groupId || '',
      groupLabel: el.dataset.groupLabel || ''
    });
  },

  sadinSubjectChange(value) {
    const st = this.state.sadin;
    st.subject = value;
    if (st.subject !== 'all' && st.teacher !== 'all' && !teachersForSubject(this.filtered(false), st.subject).includes(st.teacher)) st.teacher = 'all';
    this.alertOut = [];
    this.dirty.add('sadin'); this.renderTab('sadin');
  },

  sadinTeacherChange(value) {
    const st = this.state.sadin;
    st.teacher = value;
    if (st.teacher !== 'all' && st.subject !== 'all' && !teachersForSubject(this.filtered(false), st.subject).includes(st.teacher)) st.subject = 'all';
    this.alertOut = [];
    this.dirty.add('sadin'); this.renderTab('sadin');
  },

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

  sadinSummary(sheet) {
    const graded = sheet.filter(r => r.overall != null);
    return {
      avg: graded.length ? graded.reduce((sum, r) => sum + r.overall, 0) / graded.length : null,
      gradedCount: graded.length,
      cleanCount: graded.filter(r => !GroupAnalyzer.riskSubjects(r).length).length,
      totalCount: sheet.length
    };
  },

  submittedQuestionnaireChange(el) {
    const st = this.state.sadin;
    if (el.dataset.field === 'threshold') {
      const value = Number(el.value);
      if (el.value === '' || !Number.isFinite(value) || value < 0 || value > 100) {
        el.value = st.questionnaireThreshold == null ? 60 : st.questionnaireThreshold;
        this.toast('יש לבחור רף ציון בין 0 ל־100', 'warn');
        return;
      }
      st.questionnaireThreshold = value;
    } else st.questionnaireCode = el.value;
    SadinView.renderSubmittedQuestionnaires.call(this, this.filtered(), st);
    const control = document.querySelector(`#weak-questionnaires [data-field="${el.dataset.field}"]`);
    if (control) control.focus();
  },

  renderSubmittedQuestionnaires(roster, st) {
    const box = $('weak-questionnaires');
    if (!box) return;
    const population = st.subject !== 'all' || st.teacher !== 'all'
      ? GroupAnalyzer.sadinSheet(roster, st).map(row => row.t) : roster;
    const options = new Map(), scores = new Map();
    population.forEach(t => {
      const attempts = Store.attemptsOf(t.tz), byCode = new Map();
      [...new Set(attempts.map(a => String(a.code)))].forEach(code => {
        const best = Store.bagrutBest(t.tz, [code]);
        if (!best || best.kind !== 'num' || !Number.isFinite(best.num)) return;
        byCode.set(code, best.num);
        if (!options.has(code)) {
          const catalog = Config.rulesForGrade(t.gradeKey).questionnaires || {};
          const attempt = attempts.find(a => String(a.code) === code && a.subject);
          options.set(code, (catalog[code] || {}).name || (attempt && attempt.subject) || 'שאלון ללא שם');
        }
      });
      scores.set(t.tz, byCode);
    });
    const codes = [...options.keys()].sort((a, b) => natural(options.get(a), options.get(b)) || natural(a, b));
    if (!codes.includes(st.questionnaireCode)) st.questionnaireCode = codes[0] || '';
    const threshold = st.questionnaireThreshold == null ? 60 : st.questionnaireThreshold;
    const results = population.filter(t => scores.get(t.tz).has(st.questionnaireCode) && scores.get(t.tz).get(st.questionnaireCode) < threshold)
      .sort((a, b) => natural(a.name, b.name));
    const list = results.map(t => {
      const grades = scores.get(t.tz), low = [...grades.values()].filter(n => n < threshold).length;
      return `<li><button type="button" class="weak-name" data-act="openProfile" data-tz="${E(t.tz)}">${E(t.name)}</button>
        <span>ציון ${E(grades.get(st.questionnaireCode))} · ${low} מתוך ${grades.size} שאלונים מתחת לרף ${threshold}</span></li>`;
    }).join('');
    box.innerHTML = `<h2>שאלונים שכבר הוגשו</h2><p class="weak-muted">הציון הקובע לפי הנתונים שנקלטו, גם אם דווח ציון חלקי בלבד. ציון מתחת לרף אינו בהכרח חסם לזכאות.</p>
      <div class="weak-questionnaire-controls"><label>שאלון
        <select class="inp" data-chg="submittedQuestionnaire" data-field="code" ${codes.length ? '' : 'disabled'}>
          ${codes.length ? codes.map(code => `<option value="${E(code)}" ${code === st.questionnaireCode ? 'selected' : ''}>${E(options.get(code))} · ${E(code)}</option>`).join('') : '<option>אין שאלונים עם ציון מספרי</option>'}
        </select></label>
        <label>ציונים מתחת ל־ <input class="inp" type="number" min="0" max="100" step="any" value="${threshold}" data-chg="submittedQuestionnaire" data-field="threshold"></label></div>
      <ul class="weak-students">${list}</ul>${codes.length ? (results.length ? '' : '<p class="weak-muted">אין חניכים עם ציון מתחת לרף.</p>') : '<p class="weak-muted">אין שאלונים עם ציון מספרי באוכלוסייה שנבחרה.</p>'}`;
  },

  renderSadinPanel() {
    this.renderFreshnessBar('sadin');
    const st = this.state.sadin;
    const early = st.mode !== 'full';
    const weaknessScope = document.querySelector('[data-scope-controls="weakness"]');
    if (weaknessScope) weaknessScope.classList.toggle('hidden', !early);
    const panel = $('panel-sadin');
    if (panel && !$('weakness-styles')) {
      const link = document.createElement('link');
      link.id = 'weakness-styles'; link.rel = 'stylesheet'; link.href = 'css/style.css';
      document.head.appendChild(link);
    }
    document.body.classList.toggle('sadin-weak-active', early);
    let modeBox = $('sadin-mode');
    if (!modeBox) {
      modeBox = document.createElement('div');
      modeBox.id = 'sadin-mode';
      modeBox.className = 'flex flex-wrap gap-2 mb-2';
      $('sadin-table').insertAdjacentElement('beforebegin', modeBox);
    }
    const subjectSelect = $('sadinSubjectSelect'), teacherSelect = $('sadinTeacherSelect');
    const alertButton = document.querySelector('#sadinActions [data-act="sadinAlerts"]');
    if (!this._sadinControlHome && panel && subjectSelect && teacherSelect && alertButton) {
      this._sadinControlHome = { parent: subjectSelect.parentElement, actions: alertButton.parentElement, alertButton };
    }
    const home = this._sadinControlHome;
    if (home) {
      home.parent.insertBefore(subjectSelect, $('sadinFilterSelect'));
      home.parent.insertBefore(teacherSelect, $('sadinFilterSelect'));
      home.actions.insertBefore(home.alertButton, $('unknown-sadinData'));
    }
    const grade = this.state.filters.grade;
    const lens = ['classes', 'subjects', 'students'].includes(st.weakLens) ? st.weakLens : 'classes';
    st.weakLens = lens;
    if (early && lens !== 'students' && st.weakRiskDraft) st.weakRiskDraft = null;
    const riskRules = early && lens === 'students' ? (st.weakRiskDraft || weaknessRiskRules(this)) : null;
    const riskLabel = riskRules ? `סיכון: נכשל ${riskRules.minFails}+${riskRules.minMissed ? ` או החמצה ${riskRules.minMissed}+` : ' בלבד'}` : '';
    const lensBtn = (id, label) => `<button type="button" role="tab" class="weak-lens-tab" data-act="weakLens" data-lens="${id}" aria-selected="${String(lens === id)}">${label}</button>`;
    modeBox.className = early ? 'weak-toolbar' : 'flex flex-wrap gap-2 mb-2';
    modeBox.innerHTML = early
      ? `<div class="weak-title"><h1>מוקדי חולשה</h1><p>${grade === 'all' ? 'כל השכבות' : `שכבה ${E(Util.gl(grade))}`}</p></div>
        <div class="weak-lenses" role="tablist" aria-label="משקפות מוקדי חולשה">
          ${lensBtn('classes', 'כיתות אם')}${lensBtn('subjects', 'מקצועות וקבוצות')}${lensBtn('students', 'חניכי קצה')}
        </div>
        <div class="weak-controls">
          ${lens === 'students' ? `<div class="weak-risk-control"><button type="button" class="weak-risk-trigger" data-act="weaknessRiskToggle" aria-haspopup="dialog" aria-controls="weak-risk-popover" aria-expanded="${!!st.weakRiskDraft}">${E(riskLabel)} <span aria-hidden="true">▾</span></button>${st.weakRiskDraft ? riskPopover() : ''}</div>` : ''}
          <span class="weak-quality-slot"></span>
        </div>`
      : `<button type="button" class="nav-back" data-act="sadinMode" data-mode="early" data-back-weakness="1">→ חזרה למוקדי חולשה</button>`;
    if (home) home.alertButton.textContent = '🔔 התראות';
    let summaryBox = $('sadin-summary');
    if (!summaryBox) {
      summaryBox = document.createElement('div');
      summaryBox.id = 'sadin-summary';
      summaryBox.className = 'card px-4 py-2.5 mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm';
      summaryBox.setAttribute('role', 'status');
      summaryBox.addEventListener('click', ev => {
        const subj = ev.target.closest('[data-sadin-focus-subject]'), cls = ev.target.closest('[data-sadin-focus-class]');
        if (subj) {
          const same = this.state.sadin.subject === subj.dataset.sadinFocusSubject;
          SadinView.sadinSubjectChange.call(this, same ? 'all' : subj.dataset.sadinFocusSubject);
        } else if (cls) {
          const sel = $('fHomeroom');
          if (!sel || ![...sel.options].some(o => o.value === cls.dataset.sadinFocusClass)) return;
          sel.value = cls.dataset.sadinFocusClass;
          sel.dispatchEvent(new Event('change'));
        }
      });
      $('sadin-table').insertAdjacentElement('beforebegin', summaryBox);
    }
    summaryBox.innerHTML = '';
    summaryBox.classList.add('hidden');
    let questionnaires = $('weak-questionnaires');
    if (!questionnaires) {
      questionnaires = document.createElement('section');
      questionnaires.id = 'weak-questionnaires';
      questionnaires.className = 'card weak-card';
      $('sadin-table').insertAdjacentElement('afterend', questionnaires);
    }
    questionnaires.hidden = !early;
    $('sadin-table').className = early ? 'weakness-screen' : st.view === 'sheet' ? 'card overflow-hidden min-w-0' : 'tbl-wrap sticky-scroll';
    document.querySelectorAll('[data-sview]').forEach(b => {
      b.classList.toggle('hidden', early);
      b.setAttribute('aria-pressed', String(!early && b.dataset.sview === st.view));
    });
    const entries = Store.traineeList().flatMap(t => Store.activeCurrentOf(t.tz));
    const rawUnknown = Store.raw.grades.filter(r => !Store.trainees.has(r.tz));
    const subjects = [...new Set(entries.map(e => e.subject).concat(rawUnknown.map(r => r.subject)).filter(Boolean).map(s => GroupAnalyzer.sadinSubject(s)))].sort(natural);
    if (st.subject !== 'all' && !subjects.includes(st.subject)) st.subject = 'all';
    const teachers = st.subject === 'all'
      ? [...new Set(entries.map(e => (Store.groups.get(e.groupId) || {}).teacher || e.teacher).concat(rawUnknown.map(r => r.teacher)).filter(Boolean))].sort(natural)
      : teachersForSubject(this.filtered(false), st.subject);
    if (st.teacher !== 'all' && !teachers.includes(st.teacher)) st.teacher = 'all';
    const option = (v, label, selected) => `<option value="${E(v)}" ${v === selected ? 'selected' : ''}>${E(label)}</option>`;
    setHtml('sadinSubjectSelect', option('all', 'כל המקצועות', st.subject) + subjects.map(s => option(s, s, st.subject)).join(''));
    setHtml('sadinTeacherSelect', option('all', 'כל המורים', st.teacher) + teachers.map(t => option(t, t, st.teacher)).join(''));
    if (early) SadinView.renderSubmittedQuestionnaires.call(this, this.filtered(), st);
    if (early && st.weakRiskDraft) updateRiskPopover(this);
    if (!Store.hasData()) {
      setHtml('sadinFilterSelect', option('all', 'כל החניכים (0)', 'all'));
      return this.noRoster([], 'sadin-table');
    }
    if (!Store.loaded.grades) {
      st.strip = 'all';
      setHtml('sadinFilterSelect', option('all', 'כל החניכים (0)', 'all'));
      setHtml('sadin-table', `<div class="p-8 text-center text-slate-500">${UI.signalBadge('sadin.unknown')}<p>לא נטען קובץ ציונים שוטפים. אפשר לטעון אותו בכפתור טעינת הנתונים.</p></div>`);
      return;
    }
    const roster = this.filtered();
    if (early) {
      st.strip = 'all';
      return SadinView.renderWeakness.call(this, roster, st);
    }
    let all = early ? SadinView.earlyWarningRows(roster, st) : GroupAnalyzer.sadinSheet(roster, st);
    if (!early && st.view === 'sheet' && (st.subject !== 'all' || st.teacher !== 'all')) {
      const included = new Set(all.map(r => r.t.tz));
      GroupAnalyzer.sadinSheet(roster.filter(t => !included.has(t.tz))).forEach(r => {
        all.push({ ...r, subjects: new Map(), failing: 0, missed: 0 });
      });
    }
    if (!early) all = all.map(r => normalizeRow(r, false));
    const prereqs = prerequisitesByGrade(roster);
    const missed = r => [...r.subjects.values()].reduce((n, s) => n + confirmedMissed(s, prereqs.get(r.t.gradeKey).hasGroups, r.t.tz), 0);
    const risks = r => GroupAnalyzer.riskSubjects(r);
    const filters = [
      ['all', early ? 'כל החניכים לטיפול' : 'כל החניכים', all.length],
      ['fail', 'עם נכשל שוטף', all.filter(r => r.failing > 0).length],
      ['multiple', '2+ מקצועות בסיכון (שלילי/חסר)', all.filter(r => risks(r).length >= 2).length],
      ['missed', 'אירועים שהוחמצו', all.filter(r => missed(r) > 0).length]
    ];
    setHtml('sadinFilterSelect', filters.map(([key, label, count]) => option(key, `${label} (${count})`, st.strip)).join(''));
    const selectedFilter = filters.find(([key]) => key === st.strip);
    const rows = all.filter(r => st.strip === 'all' || (st.strip === 'fail' && r.failing > 0) || (st.strip === 'multiple' && risks(r).length >= 2) || (st.strip === 'missed' && missed(r) > 0));
    const summary = this.sadinSummary(rows);
    $('sadinFilterSelect').title = `${selectedFilter ? `${selectedFilter[1]} (${selectedFilter[2]}) · ` : ''}ממוצע כללי בסינון: ${Util.fmt(summary.avg, 1)}`;
    summaryBox.classList.remove('hidden');
    summaryBox.innerHTML = `<span><strong>ממוצע כללי בסינון:</strong> ${Util.fmt(summary.avg, 1)}</span>
      <span><strong>100% ציונים עוברים:</strong> ${summary.cleanCount} מתוך ${summary.gradedCount} עם ציונים</span>
      <span>מוצגים ${summary.totalCount} מתוך ${roster.length} חניכים בחיתוך</span>
      ${early ? '<p class="w-full text-xs text-slate-500">מקצועות בגרות ויחידות פנימיות לפי כללי השכבה; מסלול 12 שנות לימוד בהכרעה ידנית אינו נכלל. ממצאים לא מאומתים מוצגים לבדיקה.</p>' : ''}
      ${signalSummary(roster, rows, this.state.sim)}`;
    if (early) return SadinView.renderEarlyWarning.call(this, rows);
    if (st.view === 'flat') this.renderSadinFlat(rows);
    else this.renderSadinSheet(rows, st.subject !== 'all' || st.teacher !== 'all');
  },

  renderWeakness(roster, st) {
    const lens = ['classes', 'subjects', 'students'].includes(st.weakLens) ? st.weakLens : 'classes';
    st.weakLens = lens;
    const activeRules = lens === 'students' && st.weakRiskDraft ? st.weakRiskDraft : weaknessRiskRules(this);
    const data = buildWeaknessLensesModel(roster, activeRules);

    /* עדכון חיווי איכות הנתונים בראש המסך */
    const signals = SignalEngine.computeAll(this.state.sim).byTz;
    const unmatched = GroupAnalyzer.unmatchedIds().some(item => item.sources.includes('סדין ציונים'));
    const notEnrolled = roster.some(t => signals.get(t.tz).dataQuality.some(f => f.id === 'data.sadin_not_enrolled'));
    const quality = unmatched || notEnrolled;
    const prereqs = [...data.prereqs.values()];
    const incompleteGroups = prereqs.some(p => !p.hasGroups);
    const incompleteSadin = prereqs.some(p => !p.hasSadin);
    const notices = [
      data.globalUncertain || incompleteGroups ? 'לא ניתן לקבוע החמצות ללא שיבוץ מאומת; הנתונים עשויים להיות חלקיים.' : '',
      incompleteSadin ? 'חסרים נתוני ציונים לחלק מהשכבות; הנתונים עשויים להיות חלקיים.' : '',
      unmatched ? 'קיימים חניכים בקובץ הציונים שאינם במצבת.' : '',
      notEnrolled ? 'קיימים ציונים ללא שיבוץ מאומת לקבוצה.' : ''
    ].filter(Boolean);
    const qualitySlot = document.querySelector('#sadin-mode .weak-quality-slot');
    if (qualitySlot) qualitySlot.innerHTML = notices.length
      ? `<button type="button" class="badge ${quality ? 'gate-warn' : 'gate-off'} weak-quality" data-act="openDataQuality" title="${E(notices.join(' '))}" aria-label="${E(notices.join(' '))}">${quality ? 'לבדיקה' : 'מידע חסר'}</button>` : '';

    if (lens === 'classes') return SadinView.renderWeaknessClassesLens.call(this, data, st);
    if (lens === 'subjects') return SadinView.renderWeaknessSubjectsLens.call(this, data, st);
    return SadinView.renderWeaknessStudentsLens.call(this, data, st, activeRules, incompleteGroups);
  },

  /** משקפת 1: כיתות אם — רשימה מדורגת מימין ופירוק סיבות משמאל */
  renderWeaknessClassesLens(data, st) {
    if (!data.classes.length) {
      setHtml('sadin-table', '<section class="card weak-card"><p class="weak-muted">אין כיתות אם זמינות בסינון הנוכחי.</p></section>');
      return;
    }
    const selected = data.classes.find(c => c.key === st.weakClassKey) || data.classes[0];
    st.weakClassKey = selected.key;
    const cohortAvgTxt = data.cohortAvg == null ? '—' : Util.fmt(data.cohortAvg, 1);
    const deltaChip = delta => {
      if (delta == null || !Number.isFinite(delta)) return '';
      const cls = delta <= -2 ? 'is-neg' : delta >= 2 ? 'is-pos' : 'is-even';
      return `<span class="weak-delta ${cls}">${E(fmtDelta(delta, ' מהשכבה'))}</span>`;
    };

    const listHtml = data.classes.map(c => {
      const active = c.key === selected.key;
      const avgTxt = c.avg == null ? '—' : Util.fmt(c.avg, 1);
      const missedTxt = !c.hasGroups && !c.missedCount ? 'החמצות: —' : `${c.missedCount} החמצות`;
      const tone = c.isCalm ? 'is-calm' : c.failPct >= 25 || (c.deltaFromCohort != null && c.deltaFromCohort <= -6) ? 'is-high' : 'is-watch';
      return `<button type="button" class="weak-list-item ${tone}${active ? ' is-selected' : ''}" data-act="weakPickClass" data-class="${E(c.key)}" aria-pressed="${String(active)}">
        <div class="weak-item-top">
          <strong class="weak-item-title">${E(Config.classLabel(c.key))}</strong>
          <div class="flex items-center gap-1.5">
            <span class="weak-item-avg">ממוצע ${avgTxt}</span>
            ${deltaChip(c.deltaFromCohort)}
          </div>
        </div>
        <div class="weak-item-sub">
          <span>${c.failPct}% נכשלים במקצועות</span>
          <span>·</span>
          <span>${E(missedTxt)}</span>
          <span>·</span>
          <span>${c.total} חניכים</span>
        </div>
      </button>`;
    }).join('');

    const subRows = selected.substantialSubjects.map(s => {
      const sAvg = s.avg == null ? '—' : Util.fmt(s.avg, 1);
      const missedCell = !selected.hasGroups && !s.missedCount ? '—' : s.missedCount;
      const rowWarn = s.failPct >= 20 || s.missedCount >= 3;
      return `<tr class="${rowWarn ? 'is-warn-row' : ''}">
        <td class="font-semibold text-[#355747]">${E(s.name)}</td>
        <td>${s.n}</td>
        <td>${sAvg}</td>
        <td>${s.failCount ? `<span class="text-[#C86432] font-semibold">${s.failPct}% (${s.failCount})</span>` : '0%'}</td>
        <td>${missedCell}</td>
      </tr>`;
    }).join('');

    const detailHtml = `
      <div class="weak-detail-head">
        <div>
          <h2>${E(Config.classLabel(selected.key))}</h2>
          <p class="weak-muted">${selected.total} חניכים בכיתה · ממוצע שכבה להשוואה: ${cohortAvgTxt}</p>
        </div>
        <button type="button" class="btn btn-primary" data-act="sadinCellSheet" data-class="${E(selected.key)}" data-subject="all">פתח בסדין</button>
      </div>
      <div class="weak-pattern-box ${selected.isCalm ? 'is-calm' : 'is-alert'}">${E(selected.patternText)}</div>
      <div class="weak-metrics">
        <div><span>ממוצע כיתתי</span><strong>${selected.avg == null ? '—' : Util.fmt(selected.avg, 1)} ${deltaChip(selected.deltaFromCohort)}</strong></div>
        <div><span>נכשלים במקצועות</span><strong>${selected.failPct}% (${selected.failedEvals}/${selected.subjectEvals})</strong></div>
        <div><span>החמצות מאומתות</span><strong>${!selected.hasGroups && !selected.missedCount ? '—' : selected.missedCount}</strong></div>
      </div>
      <h3 class="weak-sec-title">מקצועות מרכזיים בכיתה</h3>
      ${subRows
        ? `<div class="tbl-wrap"><table class="weak-sub-table"><thead><tr><th>מקצוע</th><th>חניכים</th><th>ממוצע</th><th>נכשלים</th><th>החמצות</th></tr></thead><tbody>${subRows}</tbody></table></div>`
        : '<p class="weak-muted">אין מקצועות עם נוכחות כיתתית מספקת בנתונים הזמינים.</p>'}
      ${selected.omittedSubjectsCount ? `<p class="weak-omitted-note">הושמטו ${selected.omittedSubjectsCount} מקצועות בחירה עם נוכחות זעירה בכיתה כדי למנוע רעש סטטיסטי.</p>` : ''}`;

    setHtml('sadin-table', `<div class="weak-split" data-weak-lens="classes">
      <section class="card weak-card weak-list-pane" aria-label="דירוג כיתות אם">
        <div class="weak-pane-head"><h2>כיתות אם בשכבה</h2><span class="weak-muted">${data.classes.length} כיתות · ממוצע שכבה ${cohortAvgTxt}</span></div>
        <div class="weak-list">${listHtml}</div>
      </section>
      <section class="card weak-card weak-detail-pane" aria-label="פירוק סיבות לכיתה">${detailHtml}</section>
    </div>`);
  },

  /** משקפת 2: מקצועות וקבוצות — רשימת מקצועות מימין ופירוק לקבוצות לימוד ומורים משמאל */
  renderWeaknessSubjectsLens(data, st) {
    const hasMajors = data.subjects.some(s => !s.isCore);
    const kind = hasMajors && ['all', 'core', 'major'].includes(st.weakSubjectKind) ? st.weakSubjectKind : 'all';
    st.weakSubjectKind = kind;
    const filteredSubjects = data.subjects.filter(s => kind === 'all' || (kind === 'core' ? s.isCore : !s.isCore));

    if (!filteredSubjects.length) {
      setHtml('sadin-table', '<section class="card weak-card"><p class="weak-muted">אין נתוני מקצועות זמינים בסינון הנוכחי.</p></section>');
      return;
    }
    const selected = filteredSubjects.find(s => s.name === st.weakSubjectKey) || filteredSubjects[0];
    st.weakSubjectKey = selected.name;
    const subAvgTxt = selected.avg == null ? '—' : Util.fmt(selected.avg, 1);

    const kindPills = hasMajors ? `<div class="weak-sub-pills" role="group" aria-label="סינון סוג מקצוע">
      ${[['all', 'הכול'], ['core', 'ליבה'], ['major', 'מגמות']].map(([k, lbl]) =>
        `<button type="button" class="hr-pill" data-act="weakSubjectKind" data-kind="${k}" aria-pressed="${String(kind === k)}">${lbl}</button>`
      ).join('')}
    </div>` : '';

    const listHtml = filteredSubjects.map(s => {
      const active = s.name === selected.name;
      const avgTxt = s.avg == null ? '—' : Util.fmt(s.avg, 1);
      const missedTxt = s.uncertain && !s.missedCount ? 'החמצות: —' : `${s.missedCount} החמצות`;
      const tone = s.isCalm ? 'is-calm' : s.failPct >= 25 ? 'is-high' : 'is-watch';
      return `<button type="button" class="weak-list-item ${tone}${active ? ' is-selected' : ''}" data-act="weakPickSubject" data-subject="${E(s.name)}" aria-pressed="${String(active)}">
        <div class="weak-item-top">
          <strong class="weak-item-title">${E(s.name)}</strong>
          <span class="weak-item-avg">ממוצע ${avgTxt}</span>
        </div>
        <div class="weak-item-sub">
          <span>${s.failPct}% נכשלים</span>
          <span>·</span>
          <span>${E(missedTxt)}</span>
          <span>·</span>
          <span>${s.groupCount} קבוצות (${s.studentCount} חניכים)</span>
        </div>
      </button>`;
    }).join('');

    const groupCards = selected.groups.map(g => {
      const gAvgTxt = g.avg == null ? '—' : Util.fmt(g.avg, 1);
      const deltaCls = g.deltaFromSubject == null ? '' : g.deltaFromSubject <= -3 ? 'is-neg' : g.deltaFromSubject >= 3 ? 'is-pos' : 'is-even';
      const deltaHtml = g.deltaFromSubject != null && selected.groups.length > 1
        ? `<span class="weak-delta ${deltaCls}">${E(fmtDelta(g.deltaFromSubject, ' מממוצע המקצוע'))}</span>`
        : '';
      const hasTeacher = g.teacher && g.teacher !== 'ללא מורה';
      const teachersJson = E(JSON.stringify(hasTeacher ? [g.teacher] : []));
      return `<article class="weak-group-card">
        <div class="weak-group-top">
          <div>
            <strong class="weak-group-teacher">${E(g.teacher)}</strong>
            <span class="weak-group-id">${E(g.groupLabel)} · ${g.studentCount} חניכים</span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="weak-item-avg">ממוצע ${gAvgTxt}</span>
            ${deltaHtml}
          </div>
        </div>
        <div class="weak-group-stats">
          <span>נכשלים: <strong class="${g.failCount ? 'text-[#C86432]' : ''}">${g.failPct}% (${g.failCount}/${g.studentCount})</strong></span>
          <span>החמצות מאומתות: <strong>${g.uncertain && !g.missedCount ? '—' : g.missedCount}</strong></span>
        </div>
        <div class="weak-group-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="sadinCellSheet" data-class="all" data-subject="${E(selected.name)}" data-teacher="${E(hasTeacher ? g.teacher : '')}">פתח בסדין</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="sadinCellAlerts" data-class="all" data-subject="${E(selected.name)}" data-group-id="${E(g.groupId)}" data-group-label="${E(g.groupLabel)}" data-teachers="${teachersJson}" ${hasTeacher ? '' : 'disabled title="אין מורה מזוהה בקבוצה"'}>התראה למורה</button>
        </div>
      </article>`;
    }).join('');

    setHtml('sadin-table', `<div class="weak-split" data-weak-lens="subjects">
      <section class="card weak-card weak-list-pane" aria-label="דירוג מקצועות בשכבה">
        <div class="weak-pane-head"><h2>מקצועות בשכבה</h2>${kindPills}</div>
        <div class="weak-list">${listHtml}</div>
      </section>
      <section class="card weak-card weak-detail-pane" aria-label="פירוק המקצוע לקבוצות ומורים">
        <div class="weak-detail-head">
          <div>
            <h2>${E(selected.name)}</h2>
            <p class="weak-muted">ממוצע שכבתי במקצוע: ${subAvgTxt} · ${selected.failPct}% נכשלים (${selected.failCount}/${selected.studentCount} חניכים) · ${selected.groupCount} קבוצות לימוד</p>
          </div>
        </div>
        <div class="weak-groups-list">${groupCards || '<p class="weak-muted">אין קבוצות לימוד מזוהות למקצוע זה.</p>'}</div>
      </section>
    </div>`);
  },

  /** משקפת 3: חניכי קצה — צבירה שקטה מעל הסף והפרדת חניכים ללא ציונים כלל בתחתית */
  renderWeaknessStudentsLens(data, st, activeRules, incompleteGroups) {
    const subFilter = ['all', 'fails', 'missed'].includes(st.weakStudentFilter) ? st.weakStudentFilter : 'all';
    st.weakStudentFilter = subFilter;
    const allEdge = data.edgeStudents;
    const failsList = allEdge.filter(s => s.fails >= activeRules.minFails);
    const missedList = allEdge.filter(s => s.missedCount > 0);
    const shown = subFilter === 'fails' ? failsList : subFilter === 'missed' ? missedList : allEdge;

    const pills = [
      ['all', `הכול (${allEdge.length})`],
      ['fails', `נכשלים (${failsList.length})`],
      ['missed', `החמצות (${missedList.length})`]
    ].map(([k, lbl]) => `<button type="button" class="hr-pill" data-act="weakStudentFilter" data-filter="${k}" aria-pressed="${String(subFilter === k)}">${lbl}</button>`).join('');

    const rowsHtml = shown.map(s => {
      const failChips = s.failedSubjects.map(f =>
        `<span class="weak-reason-chip is-fail">${E(f.name)} · ${Util.fmt(f.avg, 0)}</span>`
      ).join('');
      const spreadNote = s.distinctFailTeachers >= 2
        ? `<span class="weak-reason-chip is-spread">מפוזר אצל ${s.distinctFailTeachers} מורים</span>` : '';
      const missChip = s.missedCount > 0
        ? `<span class="weak-reason-chip is-miss">${s.missedCount} החמצות (${E(s.missedSubjects.map(m => m.name).join(', '))})</span>` : '';
      return `<tr>
        <td><button type="button" class="weak-name" data-act="openProfile" data-tz="${E(s.t.tz)}">${E(s.t.name)}</button></td>
        <td>${E(Config.classLabel(s.t.classKey))}</td>
        <td>${s.overallAvg == null ? '—' : Util.fmt(s.overallAvg, 1)}</td>
        <td><div class="flex flex-wrap items-center gap-1">${failChips}${spreadNote}${missChip}</div></td>
      </tr>`;
    }).join('');

    const noGradesHtml = data.noGradesStudents.length ? `
      <details class="weak-nogrades">
        <summary>חניכים ללא ציונים כלל בשוטף (${data.noGradesStudents.length})</summary>
        <p class="weak-muted mb-2">חניכים הרשומים במצבת שלגביהם לא דווח אף ציון שוטף ואף החמצה מאומתת — מופרדים כדי לא לעוות את רשימת הצבירה הפעילה.</p>
        <ul class="weak-nogrades-list">
          ${data.noGradesStudents.map(item => `<li><button type="button" class="weak-name" data-act="openProfile" data-tz="${E(item.t.tz)}">${E(item.t.name)}</button> <span class="weak-muted">(${E(Config.classLabel(item.classKey))})</span></li>`).join('')}
        </ul>
      </details>` : '';

    const ruleSummary = `סף פעיל: נכשל ב-${activeRules.minFails}+ מקצועות${activeRules.minMissed > 0 ? ` או ${activeRules.minMissed}+ החמצות מאומתות` : ' (ללא ספירת החמצות)'}${incompleteGroups && activeRules.minMissed > 0 ? ' · החמצות דורשות קובץ קבוצות לשכבה' : ''}`;

    setHtml('sadin-table', `<div class="weak-students-lens" data-weak-lens="students">
      <section class="card weak-card">
        <div class="weak-detail-head mb-3">
          <div>
            <h2>חניכי קצה מעל סף הסיכון (${allEdge.length})</h2>
            <p class="weak-muted">${E(ruleSummary)}</p>
          </div>
          <div class="flex flex-wrap gap-1.5" role="group" aria-label="סינון חניכי קצה">${pills}</div>
        </div>
        <div class="tbl-wrap">
          <table class="weak-edge-table">
            <thead><tr><th>חניך</th><th>כיתת אם</th><th>ממוצע שוטף</th><th>סיבת איתור (נכשלים והחמצות)</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="4" class="text-center text-slate-500 py-8">אין חניכים פעילים העוברים את סף הסיכון שנבחר.</td></tr>'}</tbody>
          </table>
        </div>
        ${noGradesHtml}
      </section>
    </div>`);
  },

  /** ציון כטקסט שטוח בשורה אחת, בלי רקע או מסגרת: אדום כהה לנכשל/חסר/מסומן, אפור-כהה לעובר */
  sadinScore(value, missed = false, social = false, fail = null) {
    const text = value == null ? (missed ? 'חסר' : '—') : Util.fmt(value, 0);
    const alert = missed || (fail == null ? value != null && !SignalEngine.isPassingScore(value, { social }) : fail);
    return `<span class="sadin-score ${alert ? 'is-bad' : value == null ? 'is-empty' : ''}">${text}</span>`;
  },

  sadinTip(subject, hasGroups = true, tz) {
    const exact = v => v == null ? '—' : String(v);
    const eventCount = new Set([...subject.events.map(e => e.key), ...subject.missed.keys()]).size;
    const eventId = e => JSON.stringify([e.groupId || '', e.eventName || '', e.date || '', e.weight]);
    const eventsById = new Map(subject.events.map(e => [eventId(e), e]));
    const lines = [`${subject.name} · ממוצע מקצוע ${exact(subject.avg)} · ${eventCount} אירועים`];
    subject.entries.forEach(e => {
      lines.push(`${e.displaySubject || e.subject} • ${e.teacher || 'ללא מורה'}${e.groupId ? ` [${e.groupId}]` : ''} · ממוצע ${exact(e.avg)}`);
      e.events.forEach(ev => {
        const item = eventsById.get(eventId({ ...ev, groupId: e.groupId }));
        const missing = item && subject.missed.get(item.key);
        const confirmed = missing && confirmedEvent(missing, hasGroups, tz);
        const value = ev.score != null ? `${exact(ev.score)}${ev.score === 0 && confirmed ? ' · הוחמץ' : ''}` :
          ev.scoreRaw || (confirmed ? 'חסר' : missing ? 'לא ניתן לקבוע ללא שיבוץ מאומת' : '—');
        lines.push(`${ev.eventName || 'אירוע'}${ev.date ? ` · ${ev.date}` : ''}: ${value} (משקל ${ev.weight})`);
      });
    });
    subject.missed.forEach(m => {
      if (!subject.events.some(e => e.key === m.key)) lines.push(`${m.eventName || 'אירוע'}${m.date ? ` · ${m.date}` : ''}: ${confirmedEvent(m, hasGroups, tz) ? 'חסר' : 'לא ניתן לקבוע ללא שיבוץ מאומת'} (משקל ${m.weight})`);
    });
    return lines.join('\n');
  },

  renderEarlyWarning(rows) {
    const prereqs = prerequisitesByGrade(rows.map(r => r.t));
    const signals = SignalEngine.computeAll(this.state.sim).byTz;
    const body = rows.map(r => {
      const p = prereqs.get(r.t.gradeKey);
      const findings = GroupAnalyzer.riskSubjects(r).map(s => {
        const missed = confirmedMissed(s, p.hasGroups, r.t.tz), uncertain = s.missed.size - missed;
        const parts = [];
        if (failingSubject(s)) parts.push(`ממוצע שוטף ${Util.fmt(s.avg, 1)} — נכשל`);
        if (missed) parts.push(`${missed} אירועי הערכה שהוחמצו`);
        if (uncertain) parts.push(`${uncertain} אירועים לא ניתנים לאימות ללא שיבוץ מאומת`);
        return `<div><strong>${E(s.name)}:</strong> ${E(parts.join(' · '))}</div>`;
      }).join('');
      const quality = signals.get(r.t.tz).dataQuality.some(f => f.id === 'data.sadin_not_enrolled')
        ? '<div class="text-slate-500">איכות נתונים: ציונים ללא שיבוץ — לבדיקה</div>' : '';
      return `<tr><td><button type="button" class="font-bold text-indigo-700 hover:underline" data-act="openProfile" data-tz="${E(r.t.tz)}" title="${E(r.t.name)} · ת.ז ${E(r.t.tz)}">${E(r.t.name)}</button></td>
        <td>${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</td><td>${findings}</td><td>${quality || '—'}</td></tr>`;
    }).join('');
    setHtml('sadin-table', `<table class="grid w-full text-right"><thead><tr><th>חניך</th><th>כיתה</th><th>ממצאים בשוטף</th><th>איכות נתונים</th></tr></thead>
      <tbody>${body || '<tr><td colspan="4" class="text-center text-slate-500 py-8">אין ממצאים להצגה בנתונים הזמינים</td></tr>'}</tbody></table>`);
  },

  renderSadinSheet(rows, eventsMode) {
    const prereqs = prerequisitesByGrade(rows.map(r => r.t));
    const coreOrder = GroupAnalyzer.coreSubjects().map(s => s.name);
    const rank = s => { const i = coreOrder.indexOf(s); return i < 0 ? coreOrder.length : i; };
    /* עמודות קבועות: כל מקצועות הסדין של השכבה (ללא תלות בחיפוש, בכיתה או בסינון השורות) */
    const all = GroupAnalyzer.sadinSheet(this.filtered(false, true), this.state.sadin);
    const columnPrereqs = prerequisitesByGrade(all.map(r => r.t));
    const hasMissing = (s, r, key) => {
      const m = s.missed.get(key);
      return !!m && confirmedEvent(m, columnPrereqs.get(r.t.gradeKey).hasGroups, r.t.tz);
    };
    const names = [...new Set(all.flatMap(r => [...r.subjects.keys()]))]
      .filter(name => all.some(r => {
        const s = r.subjects.get(name);
        return s && (s.avg != null || s.events.some(hasEventData) || [...s.missed.keys()].some(key => hasMissing(s, r, key)));
      }))
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
          if (!all.some(r => {
            const s = r.subjects.get(name);
            return s && (s.events.some(ev => ev.key === e.key && hasEventData(ev)) || hasMissing(s, r, e.key));
          })) return;
          const header = `${names.length > 1 ? `${name} · ` : ''}${e.eventName || 'אירוע'}${e.date ? ` · ${e.date}` : ''} (משקל ${e.weight})${e.teacher ? ` · ${e.teacher}` : ''}${e.groupId ? ` [${e.groupId}]` : ''}`;
          columns.push({ kind: 'event', name, event: e, header });
        });
      }
      columns.push({ kind: 'subject', name, header: eventsMode ? (names.length > 1 ? `ממוצע ${name}` : 'ממוצע מקצוע') : name });
    });
    const rowsSorted = this.sadinSortRows(rows, columns);
    const colKey = c => (c.kind === 'event' ? `evt:${c.name}|${c.event.key}` : `subj:${c.name}`);
    /* רוחב עמודה: ערך שהמשתמש גרר (נשמר ב-state.sadinColWidths) או ברירת המחדל */
    const DEFAULT_W = { number: 44, name: 155, homeroom: 105, avg: 120, negatives: 145 };
    const columnWidths = new Map(columns.map(c => [colKey(c), Math.min(240, Math.max(130, [...c.header].length * 8 + 32))]));
    const widthOf = key => this.state.sadinColWidths[key] || DEFAULT_W[key] || columnWidths.get(key) || 130;
    const wStyle = key => `width:${widthOf(key)}px;min-width:${widthOf(key)}px`;
    const body = rowsSorted.map((r, index) => {
      const readiness = prereqs.get(r.t.gradeKey);
      const score = (value, missed, social, fail) => Config.withRulesForGrade(r.t.gradeKey, () => this.sadinScore(value, missed, social, fail));
      const hasSocial = Store.activeCurrentOf(r.t.tz).some(e => e.avg != null && isSocial(e.subject));
      const overall = hasSocial && r.overall != null
        ? `<span class="sadin-score">${Util.fmt(r.overall, 0)}</span>` : score(r.overall, false, false);
      const cells = columns.map(col => {
        const s = r.subjects.get(col.name);
        const sty = wStyle(colKey(col));
        if (!s) return `<td class="sx-s text-slate-300" style="${sty}">—</td>`;
        if (col.kind === 'event') {
          const ev = s.events.find(x => x.key === col.event.key), missing = s.missed.get(col.event.key);
          const uncertain = missing && !confirmedEvent(missing, readiness.hasGroups, r.t.tz);
          const missed = !!missing && !uncertain;
          const val = ev && ev.score != null ? ev.score : null;
          const text = ev && ev.score == null && ev.scoreRaw ? String(ev.scoreRaw) : '';
          const eventTip = `${col.name} · ${col.event.eventName || 'אירוע'}${col.event.date ? ` · ${col.event.date}` : ''} · משקל ${col.event.weight} · ${val != null ? String(val) : text || (missed ? 'חסר' : uncertain ? 'לא ניתן לקבוע ללא שיבוץ מאומת' : '—')}${missed && val === 0 ? ' · הוחמץ' : ''}`;
          return `<td class="sx-s" style="${sty}" title="${E(eventTip)}">${val != null || missed ? score(val, missed, isSocial(col.name)) : text ? E(text) : '<span class="text-slate-300">—</span>'}${missed && val === 0 ? ' <span class="miss-grade">הוחמץ</span>' : ''}</td>`;
        }
        const missed = confirmedMissed(s, readiness.hasGroups, r.t.tz);
        return `<td class="sx-s" style="${sty}"><button type="button" class="w-full text-center" data-act="sadinPop" data-tip="${E(this.sadinTip(s, readiness.hasGroups, r.t.tz))}" aria-label="${E(`${col.name}: ממוצע ${Util.fmt(s.avg, 1)}. ${missed ? `${missed} אירועים שהוחמצו. ` : ''}הצגת פירוט`)}">${score(s.avg, missed > 0, isSocial(col.name), failingSubject(s))}${missedLabel(missed)}</button></td>`;
      }).join('');
      /* נכשלים וחסרים בתגים נפרדים, כדי שלא יתבלבלו זה בזה */
      const missed = [...r.subjects.values()].reduce((n, s) => n + confirmedMissed(s, readiness.hasGroups, r.t.tz), 0);
      const uncertain = r.missed - missed;
      const hasGrade = [...r.subjects.values()].some(s => s.avg != null);
      const negBadges = !readiness.hasSadin || (!hasGrade && !r.failing && !missed && !uncertain)
        ? '<span class="text-slate-500">לא ניתן לקבוע</span>'
        : r.failing || missed || uncertain
          ? `<span class="neg-cell">${r.failing ? `<span class="neg-badge neg-fail">${r.failing} נכשל</span>` : ''}${missed ? `<span class="neg-badge neg-miss">${missed} חסר</span>` : ''}${uncertain ? `<span class="text-slate-500" title="לא ניתן לאמת ללא שיבוץ מאומת">${uncertain} לבדיקה</span>` : ''}</span>`
          : '<span class="neg-ok">✓ תקין</span>';
      return `<tr><td class="sx-number">${index + 1}</td><td class="sx-name" style="${wStyle('name')}"><button type="button" class="font-bold text-indigo-700 hover:text-indigo-900 hover:underline cursor-pointer" data-act="openProfile" data-tz="${E(r.t.tz)}" title="${E(r.t.name)} · ת.ז ${E(r.t.tz)}">${E(r.t.name)}</button></td>
        <td class="sx-room" style="${wStyle('homeroom')}">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</td>
        <td class="sx-avg font-bold" style="${wStyle('avg')}" title="${E(`ממוצע שווה-משקל של ממוצעי המקצועות: ${r.overall == null ? '—' : String(r.overall)}${hasSocial ? ' · כולל מעורבות חברתית בסולם שונה' : ''}`)}">${overall}</td>
        <td class="sx-neg" style="${wStyle('negatives')}" title="${E(`${r.failing} נכשלים · ${missed} חסרים${uncertain ? ` · ${uncertain} ללא שיבוץ מאומת` : ''}`)}">${negBadges}</td>${cells}</tr>`;
    }).join('');
    const sort = this.state.sadinSort, sortKey = sort.key === 'class_name' ? 'homeroom' : sort.key;
    const th = (key, label, cls = '', title = '') => {
      const active = sortKey === key;
      return `<th class="${cls}" style="${wStyle(key)}" data-ck="${E(key)}" aria-sort="${active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}"><button type="button" class="sx-sort${active ? ' is-active' : ''}" data-act="sadinSort" data-key="${E(key)}" title="${E(title || `מיון לפי ${label}`)}"><span class="sx-label">${E(label)}</span><span class="sx-ind" aria-hidden="true">${active ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}</span></button><span class="col-resizer" aria-hidden="true" title="גרור לשינוי רוחב עמודה (לחיצה כפולה להתאמה אוטומטית)"></span></th>`;
    };
    const keys = ['number', 'name', 'homeroom', 'avg', 'negatives', ...columns.map(colKey)];
    const width = keys.reduce((sum, k) => sum + widthOf(k), 0);
    setHtml('sadin-table', `<div class="sticky-scroll overscroll-contain"><table class="grid sadin-sheet" style="width:${width}px;min-width:100%"><colgroup>${keys.map(k => `<col style="width:${widthOf(k)}px">`).join('')}</colgroup>
      <thead><tr><th class="sx-number" scope="col">#</th>${th('name', 'חניך', 'sx-name')}${th('homeroom', 'כיתה', 'sx-room')}${th('avg', 'ממוצע כללי', 'sx-avg')}${th('negatives', 'נכשלים / חסרים', 'sx-neg', 'מיון לפי מספר הנכשלים והחסרים')}${columns.map(c => th(colKey(c), c.header, 'sx-s', c.header)).join('')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${columns.length + 5}" class="text-center text-slate-700 py-8">אין חניכים בסינון הנוכחי</td></tr>`}</tbody></table></div>`);
    const table = $('sadin-table').querySelector('table.sadin-sheet'), number = table.querySelector('th.sx-number');
    const updateOffset = () => {
      const actual = number.getBoundingClientRect().width;
      if (actual) table.style.setProperty('--sadin-number-width', `${actual}px`);
    };
    if (this._sadinNumberObserver) this._sadinNumberObserver.disconnect();
    if (window.ResizeObserver) {
      this._sadinNumberObserver = new ResizeObserver(updateOffset);
      this._sadinNumberObserver.observe(number);
    }
    updateOffset();
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
    const prereqs = prerequisitesByGrade(rows.map(r => r.t));
    /* חניך וכיתה מוצגים פעם אחת לכל חניך (rowspan על כל מקצועותיו); השורה האחרונה של כל חניך נושאת קו תחתון חזק לסימון הקבוצה */
    const body = rows.filter(r => r.subjects.size).map(r => [...r.subjects.values()].map((s, i, all) => {
        const hasGroups = prereqs.get(r.t.gradeKey).hasGroups;
        const teacher = [...new Set(s.entries.map(e => e.teacher).filter(Boolean))].join(', ');
        const n = Store.weightedAverage(s.events).n;
        const missed = confirmedMissed(s, hasGroups, r.t.tz);
        const last = i === all.length - 1;
        const end = last ? ' student-end' : '';
        const who = i === 0
          ? `<td rowspan="${all.length}" class="fx-name student-end"><button type="button" class="font-semibold text-indigo-700 hover:text-indigo-900 hover:underline cursor-pointer" data-act="openProfile" data-tz="${E(r.t.tz)}" title="ת.ז ${E(r.t.tz)}">${E(r.t.name)}</button></td><td rowspan="${all.length}" class="fx-room student-end">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</td>`
          : '';
        return `<tr>${who}
          <td class="fx-subj${end}">${E(s.name)}</td><td class="fx-teacher${end}" title="${E(teacher)}">${E(teacher || '—')}</td><td class="fx-n${end}">${n}</td><td class="fx-avg${end}"><button type="button" data-act="sadinPop" data-tip="${E(this.sadinTip(s, hasGroups, r.t.tz))}" aria-label="${E(`${s.name}: ${missed ? `${missed} אירועים שהוחמצו. ` : ''}הצגת פירוט הציונים`)}">${Config.withRulesForGrade(r.t.gradeKey, () => this.sadinScore(s.avg, missed > 0, isSocial(s.name), failingSubject(s)))}${missedLabel(missed)}</button></td></tr>`;
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

  openSadinAlerts(context = null) {
    const st = this.state.sadin;
    this._weakAlertContext = context;
    if (context) st.alertBy = 'teacher';
    const scopeTitle = context
      ? `${E(context.subject)}${context.cls && context.cls !== 'all' ? ` · ${E(Config.classLabel(context.cls))}` : context.groupLabel ? ` · ${E(context.groupLabel)}` : ''}`
      : '';
    const singleTeacher = context && context.teachers && context.teachers.length === 1 ? context.teachers[0] : '';
    this.openModal(`<div class="flex items-center justify-between gap-2 mb-3"><h3 class="text-lg font-semibold">🔔 התראות ציונים שוטפים</h3><button type="button" class="btn btn-ghost btn-sm" data-act="closeModal">סגירה</button></div>
      <div class="flex flex-wrap items-center gap-3 mb-3">
        ${context ? `<span>${scopeTitle}</span><select id="weakAlertTeacher" class="inp" aria-label="מורה להתראה">${singleTeacher ? '' : '<option value="all">כל מורי הקבוצה</option>'}${context.teachers.map(t => `<option value="${E(t)}" ${t === singleTeacher ? 'selected' : ''}>${E(t)}</option>`).join('')}</select>` :
          `<select id="alertBy" class="inp" aria-label="קיבוץ התראות לפי"><option value="class" ${st.alertBy === 'class' ? 'selected' : ''}>לפי כיתה</option><option value="teacher" ${st.alertBy === 'teacher' ? 'selected' : ''}>לפי מורה</option></select>`}
        <label class="flex items-center gap-1 text-sm"><input type="checkbox" id="alertInitials" ${st.initials ? 'checked' : ''}>ראשי תיבות בלבד</label>
        <button type="button" class="btn btn-primary btn-sm" data-act="generateAlerts">הפק רשימת התראות</button>
      </div><p class="text-xs text-slate-500 mb-3">לטיפול מיידי: ממוצע מתחת לסף הקיזוז של השכבה או שתי החמצות מאומתות באותו מקצוע ואצל אותו מורה. רק שיבוצים מאומתים ומקצועות הרלוונטיים לבגרות נכללים.</p>
      <div id="alertOut" class="grid md:grid-cols-2 gap-3" aria-live="polite"></div>`, true);
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
    const context = this._weakAlertContext;
    const by = context ? 'teacher' : this.state.sadin.alertBy === 'class' ? 'homeroom' : this.state.sadin.alertBy;
    const roster = this.filtered().filter(t => !context || !context.cls || context.cls === 'all' || t.classKey === context.cls);
    const prereqs = prerequisitesByGrade(roster);
    const ready = roster.filter(t => {
      const p = prereqs.get(t.gradeKey);
      return p.hasSadin && p.hasGroups;
    });
    const skipped = roster.length - ready.length;
    if (skipped && !ready.length) {
      this.alertOut = [];
      this.renderAlerts();
      return this.toast('לא ניתן להפיק התראות: חסר קובץ סדין או קבוצות לשכבות שבסינון', 'warn');
    }
    const groups = new Map(), st = this.state.sadin;
    const teacherFilter = context && $('weakAlertTeacher') ? $('weakAlertTeacher').value : st.teacher;
    const sheet = GroupAnalyzer.sadinSheet(ready, context ? { subject: context.subject, teacher: teacherFilter } : st).map(r => normalizeRow(r, true));
    sheet.forEach(r => Config.withRulesForGrade(r.t.gradeKey, () => {
      const ex = Config.getException(r.t.tz);
      if (ex.isException && ex.overrideStatus === 'twelve') return;
      const enrolled = new Set(Store.groupsOf(r.t.tz).filter(g => g.inFile).map(g => String(g.groupId)));
      const threshold = Math.min(Number(Config.rules().passGrade), Number(Config.rules().compensationMin));
      r.subjects.forEach(s => {
        const teachers = new Map();
        const bucket = teacher => {
          if (!teachers.has(teacher)) teachers.set(teacher, { events: [], missed: new Map() });
          return teachers.get(teacher);
        };
        s.entries.forEach(e => {
          if (!enrolled.has(String(e.groupId))) return;
          if (context && context.groupId && String(e.groupId) !== String(context.groupId)) return;
          const teacher = (Store.groups.get(e.groupId) || {}).teacher || e.teacher || 'ללא מורה';
          bucket(teacher).events.push(...e.events);
        });
        s.missed.forEach(m => {
          if (!enrolled.has(String(m.groupId))) return;
          if (context && context.groupId && String(m.groupId) !== String(context.groupId)) return;
          const teacher = (Store.groups.get(m.groupId) || {}).teacher || m.teacher || 'ללא מורה';
          bucket(teacher).missed.set(m.key, m);
        });
        teachers.forEach((items, teacher) => {
          if (context && !context.teachers.includes(teacher)) return;
          const avg = Store.weightedAverage(items.events).avg;
          const teacherEvents = s.events.filter(e => (e.teacher || 'ללא מורה') === teacher && enrolled.has(String(e.groupId)));
          const severe = avg != null && Number.isFinite(threshold) && avg < threshold &&
            failingSubject({ ...s, avg, events: teacherEvents, missed: items.missed });
          if (!severe && items.missed.size < 2) return;
          const parts = [];
          if (severe) parts.push(`ממוצע ${Util.fmt(avg, 1)} (מתחת לסף ${threshold})`);
          if (items.missed.size >= 2) parts.push(`${items.missed.size} אירועים שהוחמצו`);
          const name = st.initials && r.t.lastName ? `${r.t.firstName} ${r.t.lastName[0]}.` : r.t.name;
          const title = by === 'teacher' ? `מורה: ${teacher}` : `כיתה: ${Config.classLabel(r.t.classKey)}`;
          if (!groups.has(title)) groups.set(title, []);
          groups.get(title).push(`• ${name} (${Config.classLabel(r.t.classKey)}) – ${s.name}: ${parts.join(' · ')}${by === 'teacher' ? '' : ` | מורה: ${teacher}`}`);
        });
      });
    }));
    this.alertOut = [...groups].sort((a, b) => natural(a[0], b[0])).map(([title, lines]) =>
      ({ title, count: lines.length, text: `*${title}*\n${lines.join('\n')}` }));
    this.renderAlerts();
    const note = skipped ? `; דולגו ${skipped} חניכים ללא סדין או קבוצות לשכבתם` : '';
    if (!this.alertOut.length) return this.toast(`לא נמצאו פריטים קריטיים להתראה בנתונים הזמינים${note}`, skipped ? 'warn' : 'ok');
    const total = this.alertOut.reduce((n, section) => n + section.count, 0);
    const text = `*התראות ציונים שוטפים לטיפול מיידי – ${new Date().toLocaleDateString('he-IL')}*\n\n${this.alertOut.map(s => s.text).join('\n\n')}\n\nנא לטפל / לעדכן. תודה.`;
    const copied = await this.copyText(text);
    this.toast((copied ? `הופקו ${this.alertOut.length} רשימות (${total} פריטים) והועתקו ללוח` : 'הרשימות הופקו, אך ההעתקה ללוח נכשלה – אפשר להעתיק מכל כרטיס') + note, copied && !skipped ? 'ok' : 'warn');
  },

  showMissed() {
    const roster = this.filtered(), prereqs = prerequisitesByGrade(roster);
    const res = GroupAnalyzer.analyzeCurrentGrades(roster, { subject: this.state.sadin.subject });
    const confirmedCount = res.missed.filter(m => {
      const t = Store.trainees.get(m.tz);
      return t && confirmedEvent(m, prereqs.get(t.gradeKey).hasGroups, t.tz);
    }).length;
    const KIND = { 'no-row': 'אין שורה', empty: 'ללא ציון', zero: 'ציון 0' };
    const rows = res.missed.slice(0, 1000).map(m => {
      const t = Store.trainees.get(m.tz);
      const uncertain = !confirmedEvent(m, prereqs.get(t.gradeKey).hasGroups, t.tz);
      return `<tr class="cursor-pointer" data-act="openProfile" data-tz="${E(m.tz)}"><td class="font-medium whitespace-nowrap">${E(t.name)}</td><td>${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)}</td>
        <td>${E(m.subject)}</td><td>${E(m.teacher)}</td><td>${E(m.eventName)} (${m.weight})</td><td>${E(m.date || '—')}</td><td>${uncertain ? UI.signalBadge('placement.unknown', 'לא ניתן לקבוע ללא שיבוץ מאומת') : `<span class="badge tier-3">${KIND[m.kind]}</span>`}</td></tr>`;
    }).join('');
    const incomplete = [...prereqs].filter(([, p]) => !p.hasSadin || !p.hasGroups).map(([grade]) => grade);
    this.openModal(`
      <div class="flex items-center justify-between mb-2"><h3 class="text-lg font-semibold">אירועי הערכה שהוחמצו (${confirmedCount} מאומתים)</h3><button type="button" class="btn btn-ghost" data-act="closeModal">סגירה</button></div>
      <p class="text-xs text-slate-400 mb-3">חניכים עם ציון חסר או 0 באירוע שרוב חברי הקבוצה שלהם קיבלו בו ציון.</p>
      ${incomplete.length ? `<p class="text-sm text-slate-500 mb-3">לא ניתן לקבוע תמונה מלאה ללא סדין וקבוצות לשכבות ${E(incomplete.map(Util.gl).join(', '))}.</p>` : ''}
      <div class="tbl-wrap" style="max-height:480px"><table class="grid"><thead><tr><th>חניך</th><th>כיתה</th><th>מקצוע</th><th>מורה</th><th>אירוע (משקל)</th><th>תאריך</th><th>ממצא</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="text-center ${incomplete.length ? 'text-slate-500' : 'text-emerald-600'} py-6">${incomplete.length ? 'אין ממצאים בנתונים הזמינים' : 'לא זוהו אירועים שהוחמצו 🎉'}</td></tr>`}</tbody></table></div>`, true);
  },
  };
})();
