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
  const validRiskRules = rules => rules && Number.isInteger(rules.minFails) && rules.minFails >= 0 && rules.minFails <= 5 &&
    Number.isInteger(rules.minMissed) && rules.minMissed >= 0 && rules.minMissed <= 5 &&
    (rules.minFails > 0 || rules.minMissed > 0);
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
      el.textContent = value === 0 ? 'ללא' : String(value);
    });
    pop.querySelectorAll('[data-act="weaknessRiskAdjust"]').forEach(el => {
      const key = el.dataset.key, step = Number(el.dataset.step);
      el.disabled = !validRiskRules({ ...rules, [key]: rules[key] + step });
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
      if ((rules.minFails > 0 && fails >= rules.minFails) || (rules.minMissed > 0 && missedForStudent >= rules.minMissed)) { cls.risk++; riskTzs.add(row.t.tz); }
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

        const meetsRisk = (rules.minFails > 0 && fails >= rules.minFails) || (rules.minMissed > 0 && missedForStudent >= rules.minMissed);
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

    /* גימור משקפת 2 – מקצועות וקבוצות (מקצועות עם מדגם זעיר n < 4 נדחקים לתחתית כדי למנוע רעש) */
    const subjects = [...subjectMap.values()].map(s => {
      const avg = meanNum(s.scores);
      const failPct = s.studentCount ? Math.round((s.failCount / s.studentCount) * 100) : 0;
      const smallSample = s.studentCount < 4;
      const groups = [...s.groups.values()].map(g => {
        const gAvg = meanNum(g.scores);
        const gFailPct = g.studentCount ? Math.round((g.failCount / g.studentCount) * 100) : 0;
        const deltaFromSubject = gAvg != null && avg != null ? gAvg - avg : null;
        const gConcern = gFailPct * 1.3 + (g.studentCount ? (g.missedCount / g.studentCount) * 18 : 0) + Math.max(0, -(deltaFromSubject || 0)) * 1.5;
        return { ...g, avg: gAvg, failPct: gFailPct, deltaFromSubject, concernScore: gConcern };
      }).sort((a, b) => b.concernScore - a.concernScore || (a.avg ?? 999) - (b.avg ?? 999) || natural(a.teacher, b.teacher));
      const concernScore = failPct * 1.35 + (s.studentCount ? (s.missedCount / s.studentCount) * 18 : 0) + (avg != null ? Math.max(0, 68 - avg) * 0.7 : 0);
      const isCalm = s.failCount === 0 && s.missedCount === 0;
      return { ...s, avg, failPct, smallSample, groups, groupCount: groups.length, concernScore, isCalm };
    }).sort((a, b) => Number(a.smallSample) - Number(b.smallSample) || b.concernScore - a.concernScore || a.coreOrder - b.coreOrder || natural(a.name, b.name));

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
        weakSubjectKey: prev.weakSubjectKey || '',
        weakGroupKey: prev.weakGroupKey || null
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
    st.weakGroupKey = '';
    st.weakSubjectKind = 'all';
    st.weakStudentFilter = 'all';
    st.weakStudentTz = null;
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
    this.state.sadin.weakGroupKey = '';
    SadinView.renderWeakness.call(this, this.filtered(), this.state.sadin);
    const btn = [...document.querySelectorAll('#sadin-table [data-act="weakPickSubject"]')].find(b => b.dataset.subject === this.state.sadin.weakSubjectKey);
    if (btn) btn.focus();
  },

  weakGroupSelect(el) {
    this.state.sadin.weakGroupKey = el.dataset.groupKey || '';
    SadinView.renderWeakness.call(this, this.filtered(), this.state.sadin);
    const btn = [...document.querySelectorAll('#sadin-table [data-act="weakGroupSelect"]')].find(b => b.dataset.groupKey === this.state.sadin.weakGroupKey);
    if (btn) btn.focus();
  },

  weakPickStudent(el) {
    this.state.sadin.weakStudentTz = el.dataset.tz || null;
    SadinView.renderWeakness.call(this, this.filtered(), this.state.sadin);
    const btn = [...document.querySelectorAll('#sadin-table [data-act="weakPickStudent"]')].find(b => b.dataset.tz === this.state.sadin.weakStudentTz);
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
    if (st.weakRiskDraft && $('weak-risk-popover')) return SadinView.weaknessRiskClose.call(this, true);
    const control = document.querySelector('#sadin-mode .weak-risk-control, #sadin-table .weak-risk-control');
    if (!control) return;
    st.weakRiskDraft = { ...(st.weakRiskDraft || weaknessRiskRules(this)) };
    if (!$('weak-risk-popover')) control.insertAdjacentHTML('beforeend', riskPopover());
    const trigger = control.querySelector('[data-act="weaknessRiskToggle"]');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    updateRiskPopover(this);
    const pop = $('weak-risk-popover');
    if (pop) pop.focus();
  },

  weaknessRiskClose(restoreFocus = false) {
    const hadDraft = !!this.state.sadin.weakRiskDraft;
    this.state.sadin.weakRiskDraft = null;
    const pop = $('weak-risk-popover');
    if (pop) pop.remove();
    const button = document.querySelector('#sadin-mode [data-act="weaknessRiskToggle"], #sadin-table [data-act="weaknessRiskToggle"]');
    if (button) {
      button.setAttribute('aria-expanded', 'false');
      if (restoreFocus) button.focus();
    }
    if (hadDraft && this.state.sadin.mode !== 'full' && this.state.sadin.weakLens === 'students' && Store.loaded.grades) {
      SadinView.renderWeakness.call(this, this.filtered(), this.state.sadin);
    }
  },

  weaknessRiskAdjust(el) {
    const st = this.state.sadin, key = el.dataset.key, step = Number(el.dataset.step);
    if (!['minFails', 'minMissed'].includes(key) || ![-1, 1].includes(step)) return;
    const inPopover = !!(el.closest && el.closest('#weak-risk-popover'));
    if (inPopover) {
      const draft = st.weakRiskDraft || (st.weakRiskDraft = { ...weaknessRiskRules(this) });
      const next = { ...draft, [key]: draft[key] + step };
      if (!validRiskRules(next)) return;
      draft[key] = next[key];
      updateRiskPopover(this);
      return;
    }
    const current = weaknessRiskRules(this);
    const next = { ...current, [key]: current[key] + step };
    if (!validRiskRules(next)) return;
    st.weakRiskDraft = null;
    saveWeaknessRiskRules(this, next);
    if (st.mode !== 'full' && st.weakLens === 'students' && Store.loaded.grades) {
      SadinView.renderWeakness.call(this, this.filtered(), st);
    }
  },

  weaknessRiskReset() {
    const st = this.state.sadin;
    if ($('weak-risk-popover')) {
      st.weakRiskDraft = { minFails: 1, minMissed: 1 };
      updateRiskPopover(this);
      return;
    }
    st.weakRiskDraft = null;
    saveWeaknessRiskRules(this, { minFails: 1, minMissed: 1 });
    if (st.mode !== 'full' && st.weakLens === 'students' && Store.loaded.grades) {
      SadinView.renderWeakness.call(this, this.filtered(), st);
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
      weakSubjectKey: this.state.sadin.weakSubjectKey || '',
      weakGroupKey: this.state.sadin.weakGroupKey || null
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
    const stickyHost = $('weakStickyHeader');
    if (stickyHost) stickyHost.classList.toggle('is-sticky-weak', early);
    let modeBox = $('sadin-mode');
    if (!modeBox) {
      modeBox = document.createElement('div');
      modeBox.id = 'sadin-mode';
      modeBox.className = 'flex flex-wrap gap-2 mb-2';
    }
    const anchor = $('sadin-summary') || $('sadin-table');
    if (stickyHost && early) {
      if (modeBox.parentElement !== stickyHost) stickyHost.appendChild(modeBox);
    } else if (modeBox.parentElement !== anchor.parentElement) {
      anchor.insertAdjacentElement('beforebegin', modeBox);
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
    const lensIcons = {
      classes: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="8" height="7" rx="2"/><rect x="13" y="4" width="8" height="7" rx="2"/><rect x="3" y="13" width="8" height="7" rx="2"/><rect x="13" y="13" width="8" height="7" rx="2"/></svg>',
      subjects: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="3" x2="12" y2="21"/><rect x="4" y="6" width="8" height="4" rx="1.5"/><rect x="12" y="13" width="7" height="4" rx="1.5"/></svg>',
      students: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>'
    };
    const lensBtn = (id, label, sub) => `<button type="button" role="tab" class="weak-lens-tab" data-act="weakLens" data-lens="${id}" aria-selected="${String(lens === id)}">
      <span class="weak-lens-ic">${lensIcons[id]}</span>
      <span class="weak-lens-copy"><strong>${label}</strong><small>${sub}</small></span>
    </button>`;
    modeBox.className = early ? 'weak-toolbar' : 'flex flex-wrap gap-2 mb-2';
    modeBox.innerHTML = early
      ? `<div class="weak-toolbar-head">
          <div class="weak-title"><h1>מוקדי חולשה</h1></div>
          <span class="weak-quality-slot"></span>
        </div>
        <div class="weak-lens-hero" role="tablist" aria-label="משקפות מוקדי חולשה">
          <div class="weak-lenses">
            ${lensBtn('classes', 'כיתות אם', 'איזו כיתה נחלשת')}
            ${lensBtn('subjects', 'מקצועות וקבוצות', 'השוואת קבוצות ומורים')}
            ${lensBtn('students', 'חניכי קצה', 'איתור חניכים שקופים')}
          </div>
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

  /** משקפת 1: כיתות אם — "בית, שורש ושלולית שכבתית משותפת" */
  renderWeaknessClassesLens(data, st) {
    if (!data.classes.length) {
      setHtml('sadin-table', '<section class="card weak-card"><p class="weak-muted">אין כיתות אם זמינות בסינון הנוכחי.</p></section>');
      return;
    }
    const selected = data.classes.find(c => c.key === st.weakClassKey) || data.classes[0];
    st.weakClassKey = selected.key;
    const cohortAvgTxt = data.cohortAvg == null ? '—' : Util.fmt(data.cohortAvg, 1);
    const scoreTone = v => v == null ? 'is-muted' : v < 62 ? 'is-high' : v < 73 ? 'is-watch' : 'is-calm';
    const deltaChip = (delta, suffix = '') => {
      if (delta == null || !Number.isFinite(delta)) return '';
      const cls = delta <= -2 ? 'is-neg' : delta >= 2 ? 'is-pos' : 'is-even';
      return `<span class="weak-delta ${cls}">${E(fmtDelta(delta, suffix))}</span>`;
    };
    const cornerLeafSvg = '<svg class="weak-corner-leaf" viewBox="0 0 96 96" aria-hidden="true"><path d="M12 84 C20 48, 46 22, 84 14 C64 46, 44 68, 12 84 Z" fill="currentColor"/><path d="M14 82 C34 58, 56 38, 80 18" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.6" stroke-linecap="round"/></svg>';

    const pebblesHtml = data.classes.map(c => {
      const active = c.key === selected.key;
      const avgTxt = c.avg == null ? '—' : Util.fmt(c.avg, 1);
      const tone = c.isCalm ? 'is-calm' : c.failPct >= 22 || (c.deltaFromCohort != null && c.deltaFromCohort <= -6) ? 'is-high' : 'is-watch';
      const pulseBits = [
        `${c.total} חניכים`,
        c.failPct ? `${c.failPct}% נכשלים` : 'יציבה',
        c.missedCount ? `${c.missedCount} החמצות` : ''
      ].filter(Boolean).join(' · ');
      return `<button type="button" class="weak-home-pebble weak-pebble ${tone}${active ? ' is-selected' : ''}" data-act="weakPickClass" data-class="${E(c.key)}" aria-pressed="${String(active)}">
        ${active ? '<span class="weak-home-selected-tag">נבחרה כעת</span>' : ''}
        <span class="weak-score-ring ${scoreTone(c.avg)}" aria-label="ממוצע כיתה">${avgTxt}</span>
        <span class="weak-home-pebble-copy">
          <strong class="weak-item-title">${E(Config.classLabel(c.key))}</strong>
          <span class="weak-pebble-cap">${E(pulseBits)}</span>
        </span>
      </button>`;
    }).join('');

    /* מד חוגה עגול SVG לממוצע הכיתה הנבחרת */
    const selAvg = selected.avg;
    const selAvgTxt = selAvg == null ? '—' : Util.fmt(selAvg, 1);
    const gaugeTone = scoreTone(selAvg);
    const gaugeR = 46, gaugeC = 2 * Math.PI * gaugeR;
    const gaugePct = selAvg == null ? 0 : Math.max(0, Math.min(100, selAvg));
    const gaugeOffset = gaugeC * (1 - gaugePct / 100);
    const gaugeHtml = `<div class="weak-gauge ${gaugeTone}" aria-label="ממוצע כיתתי ${selAvgTxt}">
      <svg viewBox="0 0 112 112" width="118" height="118" aria-hidden="true">
        <circle class="weak-gauge-track" cx="56" cy="56" r="${gaugeR}" fill="none" stroke-width="9"/>
        <circle class="weak-gauge-arc" cx="56" cy="56" r="${gaugeR}" fill="none" stroke-width="9" stroke-linecap="round"
          stroke-dasharray="${gaugeC.toFixed(1)}" stroke-dashoffset="${gaugeOffset.toFixed(1)}" transform="rotate(-90 56 56)"/>
      </svg>
      <div class="weak-gauge-center">
        <strong>${selAvgTxt}</strong>
        <span>ממוצע כיתתי</span>
      </div>
    </div>`;

    const hurtSubs = selected.substantialSubjects.filter(s => s.failCount > 0 || s.missedCount > 0);
    const okSubs = selected.substantialSubjects.filter(s => s.failCount === 0 && s.missedCount === 0);
    const focusStrips = hurtSubs.map(s => {
      const stripTone = s.failPct >= 25 || s.missedCount >= 4 ? 'is-high' : 'is-watch';
      const sAvg = s.avg == null ? '—' : Util.fmt(s.avg, 1);
      const meta = [
        `ממוצע ${sAvg}`,
        s.failCount ? `${s.failCount} נכשלים (${s.failPct}%)` : '',
        s.missedCount ? `${s.missedCount} החמצות` : ''
      ].filter(Boolean).join(' · ');
      return `<div class="weak-focus-strip ${stripTone}">
        <div class="weak-focus-strip-main">
          <strong class="weak-impact-name">${E(s.name)}</strong>
          <span class="weak-focus-strip-meta">${E(meta)}</span>
        </div>
        <span class="weak-focus-badge">${s.failPct ? `${s.failPct}%` : `${s.missedCount} החמ'`}</span>
      </div>`;
    }).join('');

    const okPills = okSubs.length ? `<div class="weak-ok-section">
      <span class="weak-ok-label">מקצועות יציבים:</span>
      <div class="weak-ok-pills">${okSubs.map(s => `<span class="weak-ok-pill">${E(s.name)} <strong>${s.avg == null ? '—' : Util.fmt(s.avg, 1)}</strong></span>`).join('')}</div>
    </div>` : '';

    const detailHtml = `
      ${cornerLeafSvg}
      <div class="weak-home-zoom-head">
        <span class="weak-home-zoom-kicker">כיתה נבחרת</span>
        <h2>${E(Config.classLabel(selected.key))}</h2>
        <p class="weak-muted">מבט לתוך הבית · ${selected.total} חניכים ${deltaChip(selected.deltaFromCohort, ' מהשכבה')}</p>
      </div>
      ${gaugeHtml}
      <div class="weak-home-counters">
        <div class="weak-home-counter">
          <strong>${selected.failedEvals}/${selected.subjectEvals}</strong>
          <span>נכשלים (${selected.failPct}%)</span>
        </div>
        <span class="weak-home-counter-sep" aria-hidden="true"></span>
        <div class="weak-home-counter">
          <strong>${!selected.hasGroups && !selected.missedCount ? '—' : selected.missedCount}</strong>
          <span>החמצות</span>
        </div>
      </div>
      <p class="weak-home-pattern ${selected.isCalm ? 'is-calm' : 'is-alert'}">${E(selected.patternText)}</p>
      <div class="weak-impact-wrap">
        <h3 class="weak-sec-title">${hurtSubs.length ? 'מקצועות במיקוד' : 'מצב המקצועות בכיתה'}</h3>
        ${hurtSubs.length ? `<div class="weak-impact-list">${focusStrips}</div>` : '<p class="weak-calm-banner">כל המקצועות המרכזיים בכיתה יציבים וללא נכשלים.</p>'}
        ${okPills}
        ${selected.omittedSubjectsCount ? `<p class="weak-omitted-note">הושמטו ${selected.omittedSubjectsCount} מקצועות בחירה עם נוכחות זעירה בכיתה כדי למנוע רעש.</p>` : ''}
      </div>
      <div class="weak-home-zoom-foot">
        <button type="button" class="btn btn-primary weak-spotlight-cta" data-act="sadinCellSheet" data-class="${E(selected.key)}" data-subject="all">פתח בסדין</button>
      </div>`;

    setHtml('sadin-table', `<div class="weak-home-layout weak-lens-enter" data-weak-lens="classes">
      <section class="weak-pond-section" aria-label="השכבה כמרחב משותף">
        <div class="weak-pond-head">
          <div>
            <h2>השכבה כמרחב משותף</h2>
            <p class="weak-muted">${data.classes.length} כיתות אם · ממוצע שכבה ${cohortAvgTxt} · פריסה חופשית ללא חיבורים</p>
          </div>
        </div>
        <div class="weak-pond">
          ${cornerLeafSvg}
          <div class="weak-pond-field">${pebblesHtml}</div>
        </div>
      </section>
      <aside class="card weak-card weak-detail-pane weak-home-zoom" aria-label="מבט לתוך הבית">${detailHtml}</aside>
    </div>`);
  },

  /** משקפת 2: מקצועות וקבוצות — "מלאכה משותפת ושבילים מקבילים מול קו האופק" */
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
    const scoreTone = v => v == null ? 'is-muted' : v < 62 ? 'is-high' : v < 73 ? 'is-watch' : 'is-calm';

    const kindPills = hasMajors ? `<div class="weak-sub-pills" role="group" aria-label="סינון סוג מקצוע">
      ${[['all', 'הכול'], ['core', 'ליבה'], ['major', 'מגמות']].map(([k, lbl]) =>
        `<button type="button" class="hr-pill" data-act="weakSubjectKind" data-kind="${k}" aria-pressed="${String(kind === k)}">${lbl}</button>`
      ).join('')}
    </div>` : '';

    const listHtml = filteredSubjects.map(s => {
      const active = s.name === selected.name;
      const avgTxt = s.avg == null ? '—' : Util.fmt(s.avg, 1);
      const tone = s.smallSample ? 'is-small' : s.isCalm ? 'is-calm' : s.failPct >= 22 ? 'is-high' : 'is-watch';
      const cap = s.smallSample
        ? `מדגם קטן (${s.studentCount})`
        : `${s.groupCount} קבוצות לימוד · ${s.failPct}% נכשלים`;
      return `<button type="button" class="weak-pebble weak-subj-pebble ${tone}${active ? ' is-selected' : ''}" data-act="weakPickSubject" data-subject="${E(s.name)}" aria-pressed="${String(active)}">
        <span class="weak-score-ring is-sm ${s.smallSample ? 'is-muted' : scoreTone(s.avg)}">${avgTxt}</span>
        <div class="weak-pebble-body">
          <div class="weak-pebble-top">
            <strong class="weak-item-title">${E(s.name)}</strong>
            ${s.smallSample ? `<span class="weak-small-tag">מדגם קטן (${s.studentCount})</span>` : ''}
          </div>
          <span class="weak-pebble-cap">${E(cap)}</span>
        </div>
      </button>`;
    }).join('');

    /* מסקנה אבחונית על פיזור הקבוצות במקצוע */
    const deltas = selected.groups.map(g => g.deltaFromSubject).filter(d => d != null && Number.isFinite(d));
    const spread = deltas.length >= 2 ? Math.max(...deltas) - Math.min(...deltas) : 0;
    const maxAbsDelta = Math.max(8, ...deltas.map(d => Math.abs(d)));
    let insightText = `קבוצה יחידה בשכבה · ממוצע ${subAvgTxt}`;
    if (selected.groups.length >= 2) {
      if (spread >= 8) insightText = `פער ממוקד בקבוצה ספציפית — כדאי לקיים שיח מקצועי ממוקד · ממוצע שכבה ${subAvgTxt}`;
      else if (selected.failPct >= 15 || selected.missedCount > 0) insightText = `חולשה רוחבית בכל הקבוצות — כדאי לתכנן מענה שכבתי · ממוצע שכבה ${subAvgTxt}`;
      else insightText = `יציבות רוחבית בכל הקבוצות · ממוצע שכבה ${subAvgTxt}`;
    }

    /* סדר קבוצות ב-RTL: מהפער השלילי ביותר מימין ועד החיובי ביותר משמאל */
    const orderedGroups = [...selected.groups].sort((a, b) =>
      (a.deltaFromSubject ?? 0) - (b.deltaFromSubject ?? 0) || (a.avg ?? 999) - (b.avg ?? 999) || natural(a.teacher, b.teacher)
    );
    const groupKeyOf = g => g.groupId || `${g.teacher}|${g.groupLabel}`;
    const selectedGroup = orderedGroups.find(g => groupKeyOf(g) === st.weakGroupKey) || orderedGroups[0] || null;
    st.weakGroupKey = selectedGroup ? groupKeyOf(selectedGroup) : '';
    const shortTeacher = name => {
      const parts = String(name || 'ללא מורה').trim().split(/\s+/);
      return parts.length <= 2 ? parts.join(' ') : parts.slice(0, 2).join(' ');
    };

    const colButtons = orderedGroups.map(g => {
      const gKey = groupKeyOf(g);
      const isSelected = selectedGroup && gKey === st.weakGroupKey;
      const gAvgTxt = g.avg == null ? '—' : Util.fmt(g.avg, 0);
      const gAvgFull = g.avg == null ? '—' : Util.fmt(g.avg, 1);
      const d = g.deltaFromSubject;
      const isBelow = d != null && d < -0.15;
      const barPct = d != null && Number.isFinite(d) ? Math.min(100, Math.max(18, Math.round((Math.abs(d) / maxAbsDelta) * 100))) : 24;
      const deltaTxt = d != null && Number.isFinite(d) ? fmtDelta(d) : '0.0';
      const deltaCls = isBelow ? 'is-neg' : (d != null && d > 0.15 ? 'is-pos' : 'is-even');
      const tip = `${g.teacher} · ${g.groupLabel} · ממוצע ${gAvgFull} (${deltaTxt}) · ${g.studentCount} חניכים · ${g.failPct}% נכשלים`;
      const labelHtml = `<span class="weak-hcol-label">
        <span class="weak-hcol-teacher">${E(shortTeacher(g.teacher))}</span>
        <span class="weak-hcol-avg">${gAvgTxt}</span>
      </span>`;
      const barHtml = `<span class="weak-hcol-stack ${isBelow ? 'is-below' : 'is-above'}">
        ${!isBelow ? `<span class="weak-delta ${deltaCls}">${E(deltaTxt)}</span>` : ''}
        <span class="weak-hcol-bar ${isBelow ? 'is-below' : 'is-above'}" style="height:${barPct}%"></span>
        ${isBelow ? `<span class="weak-delta ${deltaCls}">${E(deltaTxt)}</span>` : ''}
      </span>`;

      return `<button type="button" class="weak-hcol ${isBelow ? 'is-below' : 'is-above'}${isSelected ? ' is-selected' : ''}" data-act="weakGroupSelect" data-group-key="${E(gKey)}" aria-pressed="${String(!!isSelected)}" title="${E(tip)}">
        <span class="weak-hcol-top">${isBelow ? labelHtml : barHtml}</span>
        <span class="weak-hcol-dot" aria-hidden="true"><i></i></span>
        <span class="weak-hcol-bot">${isBelow ? barHtml : labelHtml}</span>
      </button>`;
    }).join('');

    let focusCardHtml = '';
    if (selectedGroup) {
      const g = selectedGroup;
      const gAvgTxt = g.avg == null ? '—' : Util.fmt(g.avg, 1);
      const d = g.deltaFromSubject;
      const isBelow = d != null && d < -0.15;
      const deltaCls = isBelow ? 'is-neg' : (d != null && d > 0.15 ? 'is-pos' : 'is-even');
      const deltaTxt = d != null && Number.isFinite(d) ? fmtDelta(d, ' מהשכבה') : 'בממוצע השכבה';
      const hasTeacher = g.teacher && g.teacher !== 'ללא מורה';
      const teachersJson = E(JSON.stringify(hasTeacher ? [g.teacher] : []));
      focusCardHtml = `<article class="weak-group-card weak-group-focus${isBelow ? ' is-lag' : ''}" aria-label="פירוט הקבוצה הנבחרת">
        <div class="weak-group-focus-main">
          <span class="weak-score-ring is-sm ${scoreTone(g.avg)}">${gAvgTxt}</span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="weak-group-teacher">${E(g.teacher)}</strong>
              <span class="weak-delta ${deltaCls}">${E(deltaTxt)}</span>
            </div>
            <span class="weak-group-id">${E(g.groupLabel)} · ${g.studentCount} חניכים</span>
            <div class="weak-group-focus-pills">
              <span class="weak-mini-pill${g.failCount ? ' is-fail' : ''}">${g.failPct}% נכשלים (${g.failCount}/${g.studentCount})</span>
              <span class="weak-mini-pill">${g.uncertain && !g.missedCount ? 'החמצות: —' : `${g.missedCount} החמצות מאומתות`}</span>
            </div>
          </div>
        </div>
        <div class="weak-group-focus-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="sadinCellSheet" data-class="all" data-subject="${E(selected.name)}" data-teacher="${E(hasTeacher ? g.teacher : '')}">פתח בסדין</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="sadinCellAlerts" data-class="all" data-subject="${E(selected.name)}" data-group-id="${E(g.groupId)}" data-group-label="${E(g.groupLabel)}" data-teachers="${teachersJson}" ${hasTeacher ? '' : 'disabled title="אין מורה מזוהה בקבוצה"'}>התראה למורה</button>
        </div>
      </article>`;
    }

    const hillsBg = `<svg class="weak-horizon-hills" viewBox="0 0 1200 180" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 130 C220 75, 420 155, 680 105 C910 60, 1080 95, 1200 55 L1200 180 L0 180 Z" fill="#F4E2D4" opacity=".42"/>
      <path d="M0 150 C260 110, 490 170, 760 125 C980 90, 1110 135, 1200 110 L1200 180 L0 180 Z" fill="#DCEBD9" opacity=".38"/>
    </svg>`;

    setHtml('sadin-table', `<div class="weak-subj-layout weak-lens-enter" data-weak-lens="subjects">
      <section class="card weak-card weak-list-pane" aria-label="מקצועות בשכבה">
        <div class="weak-pane-head"><h2>מקצועות בשכבה</h2>${kindPills}</div>
        <div class="weak-list">${listHtml}</div>
      </section>
      <section class="card weak-card weak-detail-pane weak-horizon-card" aria-label="קבוצות הלימוד במקצוע מול קו האופק">
        ${hillsBg}
        <div class="weak-horizon-top">
          <div>
            <h2>${E(selected.name)} · קבוצות הלימוד במקצוע</h2>
            <p class="weak-muted">${selected.groupCount} קבוצות לימוד · ממוצע שכבה ${subAvgTxt} · ${selected.failPct}% נכשלים (${selected.failCount}/${selected.studentCount} חניכים)</p>
          </div>
          <span class="weak-horizon-pill">ממוצע שכבה <strong>${subAvgTxt}</strong></span>
        </div>
        ${orderedGroups.length ? `
          <div class="weak-hchart" aria-label="גרף פער קבוצות מול ממוצע השכבה">
            <div class="weak-hchart-dir is-above">↑ מעל הממוצע</div>
            <div class="weak-hchart-scroll">
              <div class="weak-hchart-stage">
                <span class="weak-hchart-line" aria-hidden="true"></span>
                <div class="weak-hchart-bars">${colButtons}</div>
              </div>
            </div>
            <div class="weak-hchart-dir is-below">↓ מתחת לממוצע</div>
          </div>
          ${focusCardHtml}` : '<p class="weak-muted text-center py-6">אין קבוצות לימוד מזוהות למקצוע זה.</p>'}
        <div class="weak-horizon-insight">${E(insightText)}</div>
      </section>
    </div>`);
  },

  /** משקפת 3: חניכי קצה — "איתור, אהבה, משמעות ועיטוף" */
  renderWeaknessStudentsLens(data, st, activeRules, incompleteGroups) {
    const subFilter = ['all', 'fails', 'missed'].includes(st.weakStudentFilter) ? st.weakStudentFilter : 'all';
    st.weakStudentFilter = subFilter;
    const allEdge = data.edgeStudents;
    const failsList = activeRules.minFails > 0
      ? allEdge.filter(s => s.fails >= activeRules.minFails)
      : allEdge.filter(s => s.fails > 0);
    const missedList = activeRules.minMissed > 0
      ? allEdge.filter(s => s.missedCount >= activeRules.minMissed)
      : allEdge.filter(s => s.missedCount > 0);
    const shown = subFilter === 'fails' ? failsList : subFilter === 'missed' ? missedList : allEdge;
    const scoreTone = v => v == null ? 'is-muted' : v < 55 ? 'is-high' : v < 70 ? 'is-watch' : 'is-calm';

    const selected = shown.find(s => s.t.tz === st.weakStudentTz) || shown[0] || null;
    st.weakStudentTz = selected ? selected.t.tz : null;

    const pills = [
      ['all', `הכול (${allEdge.length})`],
      ['fails', `נכשלים (${failsList.length})`],
      ['missed', `החמצות (${missedList.length})`]
    ].map(([k, lbl]) => `<button type="button" class="hr-pill" data-act="weakStudentFilter" data-filter="${k}" aria-pressed="${String(subFilter === k)}">${lbl}</button>`).join('');

    /* סיווג חניכי הקצה הפעילים ל-3 שכבות עיטוף גליות רכות (שכבה ריקה מוסתרת) */
    const tierImmediate = [], tierReach = [], tierWatch = [];
    shown.forEach(s => {
      const severe = (s.fails > 0 && s.missedCount > 0) || s.distinctFailTeachers >= 2 || s.fails >= 2 || (s.overallAvg != null && s.overallAvg < 52);
      const medium = s.missedCount >= 2 || (s.overallAvg != null && s.overallAvg < 65);
      if (severe) tierImmediate.push(s);
      else if (medium) tierReach.push(s);
      else tierWatch.push(s);
    });

    const tierIcons = {
      immediate: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 16.5s-6-3.7-6-8.2A3.4 3.4 0 0 1 10 6a3.4 3.4 0 0 1 6 2.3c0 4.5-6 8.2-6 8.2Z"/></svg>',
      reach: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="4"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4"/></svg>',
      watch: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.2 10s3-4.8 7.8-4.8S17.8 10 17.8 10s-3 4.8-7.8 4.8S2.2 10 2.2 10Z"/><circle cx="10" cy="10" r="2.2"/></svg>'
    };
    const visibleTiers = [
      { id: 'immediate', title: 'עיטוף מיידי', items: tierImmediate, fill: '#FBE3DA' },
      { id: 'reach', title: 'להושיט יד', items: tierReach, fill: '#FCEEC9' },
      { id: 'watch', title: 'מבט קרוב', items: tierWatch, fill: '#DFEFE2' }
    ].filter(t => t.items.length > 0);

    const careLayersHtml = visibleTiers.map((tier, idx) => {
      const nextTier = visibleTiers[idx + 1];
      const waveDivider = nextTier
        ? `<svg class="weak-care-wave" viewBox="0 0 1200 44" preserveAspectRatio="none" aria-hidden="true"><path d="M0 16 C280 46, 560 -6, 860 22 C1020 36, 1120 28, 1200 18 L1200 44 L0 44 Z" fill="${nextTier.fill}"/></svg>`
        : '';
      const pebbles = tier.items.map(s => {
        const isSel = selected && s.t.tz === selected.t.tz;
        const avgTxt = s.overallAvg == null ? '—' : Util.fmt(s.overallAvg, 1);
        return `<button type="button" class="weak-student-pebble${isSel ? ' is-selected' : ''}" data-act="weakPickStudent" data-tz="${E(s.t.tz)}" aria-pressed="${String(!!isSel)}">
          <strong class="weak-student-pebble-title">${E(s.t.name)} · <span class="weak-student-pebble-avg">${avgTxt}</span></strong>
          <span class="weak-student-pebble-cls">${E(Config.classLabel(s.t.classKey))}</span>
        </button>`;
      }).join('');
      return `<div class="weak-care-tier is-${tier.id}">
        <div class="weak-care-tier-head">
          <span class="weak-care-tier-pill">${tierIcons[tier.id]}<span>${tier.title}</span><small>(${tier.items.length})</small></span>
        </div>
        <div class="weak-care-pebbles">${pebbles}</div>
        ${waveDivider}
      </div>`;
    }).join('');

    const pedagogicalMeaning = s => {
      if (s.fails > 0 && s.missedCount > 0 && s.distinctFailTeachers >= 2) {
        return `צבירה שקטה אצל ${s.distinctFailTeachers} מורים לצד החמצות — כדאי ליזום שיחה אישית ועיטוף.`;
      }
      if (s.distinctFailTeachers >= 2) {
        return `צבירה שקטה אצל ${s.distinctFailTeachers} מורים — כדאי ליזום שיחה אישית ועיטוף.`;
      }
      if (s.fails > 0 && s.missedCount > 0) {
        return 'שילוב של קושי לימודי והחמצות — כדאי לבנות תוכנית ליווי אישית ועוטפת.';
      }
      if (s.fails === 0 && s.missedCount > 0) {
        return 'צבירת החמצות שקטה — כדאי לברר חסמים, נוכחות והגשה.';
      }
      if (s.fails >= 2) {
        return `קושי ב־${s.fails} מקצועות במקביל — כדאי לתאם עיטוף מערכתי מול המחנך.`;
      }
      return 'קושי ממוקד במקצוע אחד — כדאי לתאם חיזוק אישי מול המורה.';
    };

    const cornerLeafSvg = '<svg class="weak-corner-leaf" viewBox="0 0 96 96" aria-hidden="true"><path d="M12 84 C20 48, 46 22, 84 14 C64 46, 44 68, 12 84 Z" fill="currentColor"/><path d="M14 82 C34 58, 56 38, 80 18" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.6" stroke-linecap="round"/></svg>';

    let spotlightHtml = '';
    if (selected) {
      const avgTxt = selected.overallAvg == null ? '—' : Util.fmt(selected.overallAvg, 1);
      const failChips = selected.failedSubjects.map(f =>
        `<span class="weak-reason-chip is-fail">${E(f.name)} ${Util.fmt(f.avg, 0)}</span>`
      ).join('');
      const missTip = selected.missedSubjects.map(m => `${m.name} (${m.count})`).join(', ');
      const missChip = selected.missedCount > 0
        ? `<span class="weak-reason-chip is-miss" title="${E(missTip)}">${selected.missedCount} החמצות</span>` : '';
      const spreadChip = selected.distinctFailTeachers >= 2
        ? `<span class="weak-reason-chip is-spread">${selected.distinctFailTeachers} מורים</span>` : '';
      spotlightHtml = `<aside class="card weak-card weak-spotlight-card" aria-label="מבט אישי ועוטף">
        ${cornerLeafSvg}
        <span class="weak-spotlight-kicker">מבט אישי ועוטף</span>
        <h2 class="weak-spotlight-name">${E(selected.t.name)}</h2>
        <span class="weak-spotlight-cls">${E(Config.classLabel(selected.t.classKey))}</span>
        <div class="weak-spotlight-bubble ${scoreTone(selected.overallAvg)}">
          <strong>${avgTxt}</strong>
          <span>ממוצע שוטף</span>
        </div>
        <div class="weak-radar-tags weak-spotlight-tags">${failChips}${missChip}${spreadChip}</div>
        ${selected.missedCount > 0 && missTip ? `<p class="weak-spotlight-miss-note">החמצות ב: ${E(missTip)}</p>` : ''}
        <div class="weak-spotlight-meaning">${E(pedagogicalMeaning(selected))}</div>
        <button type="button" class="btn btn-primary weak-spotlight-cta" data-act="openProfile" data-tz="${E(selected.t.tz)}">פתח כרטיס 360°</button>
      </aside>`;
    }

    const noGradesHtml = data.noGradesStudents.length ? `
      <details class="weak-nogrades">
        <summary>ללא ציונים כלל בשוטף (${data.noGradesStudents.length})</summary>
        <p class="weak-muted mb-2">חניכים במצבת ללא אף ציון שוטף ואף החמצה מאומתת — מופרדים משכבות העיטוף הפעילות.</p>
        <ul class="weak-nogrades-list">
          ${data.noGradesStudents.map(item => `<li><button type="button" class="weak-name" data-act="openProfile" data-tz="${E(item.t.tz)}">${E(item.t.name)}</button> <span class="weak-muted">(${E(Config.classLabel(item.classKey))})</span></li>`).join('')}
        </ul>
      </details>` : '';

    const inlineStepper = (key, value, labelPrefix, labelSuffix) => {
      const canDec = validRiskRules({ ...activeRules, [key]: value - 1 });
      const canInc = validRiskRules({ ...activeRules, [key]: value + 1 });
      return `<div class="weak-inline-step">
        <span>${labelPrefix}</span>
        <div class="weak-risk-stepper">
          <button type="button" data-act="weaknessRiskAdjust" data-key="${key}" data-step="-1" ${canDec ? '' : 'disabled'} aria-label="הפחתת ${labelSuffix}">−</button>
          <span class="weak-risk-value" data-key="${key}">${value === 0 ? 'ללא' : value}</span>
          <button type="button" data-act="weaknessRiskAdjust" data-key="${key}" data-step="1" ${canInc ? '' : 'disabled'} aria-label="הגדלת ${labelSuffix}">+</button>
        </div>
        <span>${labelSuffix}</span>
      </div>`;
    };

    const riskSummaryLabel = [
      activeRules.minFails ? `נכשל ${activeRules.minFails}+` : '',
      activeRules.minMissed ? `החמצה ${activeRules.minMissed}+` : ''
    ].filter(Boolean).join(' או ');

    setHtml('sadin-table', `<div class="weak-students-lens weak-lens-enter" data-weak-lens="students">
      <div class="weak-inline-risk">
        <div class="weak-inline-risk-controls">
          ${inlineStepper('minFails', activeRules.minFails, 'נכשל ב־', 'מקצועות')}
          <span class="weak-inline-or">או</span>
          ${inlineStepper('minMissed', activeRules.minMissed, 'החמיץ', 'הערכות')}
          <span class="weak-risk-control"><button type="button" class="sr-only" data-act="weaknessRiskToggle" aria-haspopup="dialog" aria-controls="weak-risk-popover" aria-expanded="${!!(st.weakRiskDraft && $('weak-risk-popover'))}">${E(riskSummaryLabel)}</button></span>
        </div>
      </div>
      <div class="weak-radar-bar">
        <span class="weak-muted">מאותרים <strong>${allEdge.length}</strong> חניכי קצה${incompleteGroups && activeRules.minMissed > 0 ? ' · החמצות דורשות קובץ קבוצות' : ''}</span>
        <div class="flex flex-wrap gap-1.5" role="group" aria-label="סינון חניכי קצה">${pills}</div>
      </div>
      ${shown.length
        ? `<div class="weak-care-layout">
            <div class="weak-care-main">
              <section class="weak-care-field" aria-label="שכבות עיטוף חניכי קצה">${careLayersHtml}</section>
              ${noGradesHtml}
            </div>
            ${spotlightHtml}
          </div>`
        : `<p class="weak-calm-banner mt-4">אין חניכים פעילים העוברים את סף הסיכון שנבחר.</p>${noGradesHtml}`}
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
