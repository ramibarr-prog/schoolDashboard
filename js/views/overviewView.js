(function () {
  'use strict';
  const E = Util.esc;
  const $ = id => document.getElementById(id);
  const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };
  const prerequisites = list => new Map([...new Set(list.map(t => t.gradeKey))]
    .map(grade => [grade, SignalEngine.prerequisitesFor(grade)]));

  window.OverviewView = {
  overviewList(ignoreClass = false) {
    const f = this.state.filters;
    return this.sortTrainees(Store.traineeList().filter(t =>
      (f.grade === 'all' || t.gradeKey === f.grade) && (ignoreClass || f.cls === 'all' || t.classKey === f.cls)));
  },

  attentionModel(list = this.filtered(), rows, sheet, signalByTz) {
    const coverage = prerequisites(list);
    if (Store.loaded.bagrut && !signalByTz) signalByTz = SignalEngine.computeAll(this.state.sim).byTz;
    const bagrutRisk = Store.loaded.bagrut ? (rows || list.map(t => ({ t, ev: this.getEval(t.tz) })))
      .filter(r => {
        if (!(r.ev.manual || coverage.get(r.t.gradeKey)?.hasBagrut) || !r.ev.atRisk) return false;
        if (!r.ev.manualReview?.required) return true;
        const signal = signalByTz.get(r.t.tz);
        return signal && signal.pedagogical.some(f => f.family === 'bagrut' && (f.severity === 'risk' || f.severity === 'watch'));
      }) : [];
    const multi = Store.loaded.grades ? (sheet || GroupAnalyzer.sadinSheet(list, {}))
      .filter(r => coverage.get(r.t.gradeKey)?.hasSadin && GroupAnalyzer.riskSubjects(r).length >= 2) : [];
    const riskTzs = new Set(bagrutRisk.map(r => r.t.tz));
    const both = new Set(multi.map(r => r.t.tz).filter(tz => riskTzs.has(tz))).size;
    return { bagrutRisk, multi, both, tzSet: new Set([...riskTzs, ...multi.map(r => r.t.tz)]) };
  },

  attentionBreakdownText(att, multiLabel = '2+ שליליים/חסרים בשוטף') {
    return `${att.bagrutRisk.length} בסיכון בבגרות · ${att.multi.length} עם ${multiLabel}${att.both > 0 ? ` (${att.both} בשניהם)` : ''}`;
  },

  overviewReadinessModel(m) {
    if (!Store.loaded.grades) return { items: [], unreportedItems: [], message: 'טען ציונים שוטפים להצגת מוכנות לבגרויות השנה.' };
    const scheduled = new Map(), benchTrainees = m.bench.rows.map(r => r.t);
    [...m.bench.grades].forEach(grade => Config.withRulesForGrade(grade, () => {
      const rules = Config.rules();
      if (Store.loaded.groups) {
        // כשקובץ הקבוצות טעון: כל מקצוע בגרות פעיל שיש לו חניך משובץ בפועל באוכלוסיית הייחוס, גם אם שאלון ה-30% שלו בכספת י"ב.
        const groups = benchTrainees.filter(t => t.gradeKey === grade).flatMap(t => Store.groupsOf(t.tz)).filter(g => g.inFile && !g.reinforcement);
        GroupAnalyzer.coreSubjects().filter(s => s.enabled !== false).forEach(s => {
          if (groups.some(g => (GroupAnalyzer.coreOf(g.subject) || {}).id === s.id || Util.matchKeywords(g.subject, s.keywords))) scheduled.set(`core:${s.id}`, s.name);
        });
        rules.majors.filter(s => s.enabled !== false && groups.some(g => Util.matchKeywords(g.subject, s.keywords))).forEach(s => scheduled.set(`major:${s.id}`, s.name));
        return;
      }
      const due = c => c.enabled !== false && Util.normGrade(c.expectedGrade || (rules.questionnaires[String((c.codes || [])[0])] || {}).expectedGrade) === grade;
      rules.coreSubjects.filter(s => s.enabled !== false).forEach(s => {
        const comps = s.variableUnits ? Object.values(s.levels || {}).flat() : s.components || [];
        if (comps.some(due)) scheduled.set(`core:${s.id}`, s.name);
      });
      rules.majors.filter(s => s.enabled !== false && due(s)).forEach(s => scheduled.set(`major:${s.id}`, s.name));
    }));
    const models = [...scheduled].map(([sel, name]) => ({ ...this.subjectReadinessModel(sel, benchTrainees, true), name })).filter(r => r.total > 0);
    const active = r => r.graded >= 3 || (r.total > 0 && r.coveragePct >= 25);
    const items = models.filter(active)
      .sort((a, b) => (b.fail + b.borderline) - (a.fail + a.borderline) || b.offTrack - a.offTrack || b.offTrackPct - a.offTrackPct || natural(a.name, b.name));
    const unreportedItems = models.filter(r => !active(r)).sort((a, b) => natural(a.name, b.name));
    return { items, unreportedItems, message: models.length ? '' : 'אין שאלוני בגרות מתוכננים לשנה זו באוכלוסיית הייחוס.' };
  },

  overviewModel() {
    const list = this.overviewList();
    const rows = list.map(t => ({ t, ev: this.getEval(t.tz) }));
    const bench = this.bagrutBenchmark(rows);
    const benchEvals = bench.rows.map(r => r.ev);
    const stats = bench.pace ? BagrutAdvisor.summarizePace(benchEvals) : BagrutAdvisor.summarize(benchEvals);
    const sheet = Store.loaded.grades ? GroupAnalyzer.sadinSheet(list, {}) : [];
    const benchSheet = !Store.loaded.grades ? [] : bench.rows.length === rows.length ? sheet : GroupAnalyzer.sadinSheet(bench.rows.map(r => r.t), {});
    const anomaliesModel = this.placementAnomaliesModel(list);
    const signals = SignalEngine.computeAll(this.state.sim);
    const att = this.attentionModel(list, rows, sheet, signals.byTz);
    const { bagrutRisk, multi, tzSet } = att;
    const summary = this.sadinSummary(sheet);
    const graded = sheet.filter(r => r.overall != null);
    const coverage = prerequisites(list);
    return {
      list, rows, bench, stats, sheet, benchSheet, anomaliesModel, att, bagrutRisk, multi, graded,
      coverage, signals: list.map(t => signals.byTz.get(t.tz)),
      bagrutOn: Store.loaded.bagrut && stats.counted > 0 && [...bench.grades].every(g => coverage.get(g).hasBagrut),
      attention: tzSet,
      avg: summary.avg,
      clean: summary.cleanCount
    };
  },

  bagrutBenchmark(rows) {
    const explicit = this.state.filters.grade !== 'all';
    const byRank = rank => rows.filter(r => r.ev.rank === rank);
    const cohort = explicit ? rows : byRank(12).length ? byRank(12) : byRank(11).length ? byRank(11) : rows;
    const grades = Util.GRADE_KEYS.filter(g => cohort.some(r => r.t.gradeKey === g));
    return {
      rows: cohort,
      pace: cohort.length > 0 && cohort.every(r => r.ev.rank < 12),
      grades: new Set(grades),
      scope: grades.length === 1 ? String(Util.ord(grades[0])) : 'all',
      label: grades.length ? `שכבת ${grades.map(g => Util.gl(g)).join(', ')}` : 'שכבת י"ב'
    };
  },

  overviewBlockers(m, BAGRUT_CORE) {
    if (m.bench.pace && m.bagrutOn) {
      const bySubject = new Map();
      m.bench.rows.forEach(r => r.ev.paceInfo.subjects.forEach(name => {
        const e = bySubject.get(name) || { name, enrolled: 0, bad: 0 };
        e.enrolled++;
        if ([...r.ev.paceInfo.failedList, ...r.ev.paceInfo.missingDueList].some(item => item.subject === name)) e.bad++;
        bySubject.set(name, e);
      }));
      const items = [...bySubject.values()].filter(x => x.bad > 0).map(x => ({ ...x, pct: Math.round((x.bad / x.enrolled) * 100) }))
        .sort((a, b) => b.bad - a.bad || b.pct - a.pct).slice(0, 5);
      return { source: 'pace', items };
    }
    if (m.benchSheet.length) return { source: 'sadin', items: GroupAnalyzer.blockingSubjects(m.benchSheet, 5) };
    if (!m.bagrutOn) return { source: 'bagrut', items: [] };
    const failing = ['fail', 'lost', 'missing', 'noshow'];
    const items = BAGRUT_CORE.map(([id, name]) => {
      const cells = m.bench.rows.map(r => this.subjectDisplayCell(r.ev, id)).filter(c => c && c.state !== 'noenroll' && c.state !== 'exempt');
      const bad = cells.filter(c => failing.includes(c.state)).length;
      return { name, enrolled: cells.length, bad, pct: cells.length ? Math.round((bad / cells.length) * 100) : 0 };
    }).filter(x => x.bad > 0).sort((a, b) => b.bad - a.bad || b.pct - a.pct).slice(0, 5);
    return { source: 'bagrut', items };
  },

  overviewIssues(m) {
    const issues = new Map();
    const entry = (t, rank) => issues.get(t.tz) || { t, rank, parts: [] };
    m.anomaliesModel.byTrainee.forEach(a => {
      const t = Store.trainees.get(a.tz);
      const items = a.items.filter(item => item.kind !== 'sadin');
      const severe = items.some(item => item.kind !== 'nomajor');
      const text = items.map(item => `${GroupAnalyzer.ANOMALY_LABEL[item.kind] || item.kindLabel}: ${item.subject}`).join(' • ');
      if (t && items.length && m.coverage.get(t.gradeKey)?.hasGroups)
        issues.set(a.tz, { t, rank: severe ? 0 : 1, parts: [{ text, severe }] });
    });
    const multiTz = new Set(m.multi.map(r => r.t.tz));
    m.rows.forEach(({ t, ev }) => {
      const parts = [];
      if ((m.coverage.get(t.gradeKey)?.hasBagrut || ev.manual) && (ev.rank >= 12 || ev.manual)) {
        const real = ev.blockers.filter(b => !b.info && b.k !== 'exempt-review');
        if (ev.singleBlocker && real.length) parts.push({ text: `חסם יחיד לזכאות: ${real[0].text}`, severe: false });
      } else if (m.coverage.get(t.gradeKey)?.hasBagrut) {
        const pi = ev.paceInfo;
        const focus = pi.focus.filter(x => !x.text.startsWith('פטור ב'));
        focus.slice(0, 2).forEach(x => parts.push({ text: `חסם בגרות לשכבה: ${x.text}`, severe: x.hard }));
        if (focus.length > 2) parts.push({ text: `ועוד ${focus.length - 2} חסמי בגרות לשכבה`, severe: false });
      }
      if (ev.rank < 12 && !ev.manual && multiTz.has(t.tz)) parts.push({ text: 'ציונים שוטפים: 2+ מקצועות בסיכון', severe: false });
      if (!parts.length) return;
      const e = entry(t, parts.some(p => p.severe) ? 1 : 2);
      e.parts.push(...parts);
      issues.set(t.tz, e);
    });
    return [...issues.values()].sort((a, b) => a.rank - b.rank || b.parts.length - a.parts.length || natural(a.t.name, b.t.name));
  },

  renderOverviewPanel() {
    if (!Store.hasData()) return this.noRoster([], 'overview-body');
    const m = this.overviewModel(), f = this.state.filters, am = m.anomaliesModel;
    const grades = f.grade === 'all' ? [...m.coverage.keys()] : [f.grade];
    const covered = (loaded, key) => loaded && grades.every(g => SignalEngine.prerequisitesFor(g)[key]);
    const groupsOn = covered(Store.loaded.groups, 'hasGroups');
    const bagrutOn = covered(Store.loaded.bagrut, 'hasBagrut');
    const sadinOn = covered(Store.loaded.grades, 'hasSadin');
    const risk = bagrutOn ? this.filterByChip(m.rows, 'notok') : [];
    const near = risk.filter(r => r.ev.singleBlocker).length;
    const currentRisk = sadinOn ? SadinView.earlyWarningRows(m.list).length : 0;
    const card = (attrs, title, value, detail, ready) => `<button type="button" class="ov-card" data-act="ovGo" ${attrs}>
      <span class="ov-label">${title}</span>
      ${ready ? `<span class="ov-value">${value}</span><span class="ov-sub">${detail}</span>` : `<span class="ov-sub">${detail}</span>`}
      </button>`;
    const quality = [];
    if (m.signals.some(s => s.dataQuality.some(flag => flag.id === 'data.manual_review'))) quality.push('שאלונים זרים או פטורים');
    if (m.signals.some(s => s.dataQuality.some(flag => flag.id === 'data.sadin_not_enrolled'))) quality.push('ציונים ללא שיבוץ');
    if (Object.values(Store.unknown).some(ids => ids.length)) quality.push('חניכים מחוץ למצבת');
    if (window.ImportQuarantine && window.ImportQuarantine.list().length) quality.push('פריטים בהסגר קליטה');
    const scope = f.cls !== 'all' ? `כיתה ${Config.classLabel(f.cls)}` : f.grade !== 'all' ? `שכבת ${Util.gl(f.grade)}` : 'כלל בית הספר';
    setHtml('overview-body', `
      <div><h2 class="ov-title text-2xl font-extrabold text-[#355747]">היום — משימות לטיפול</h2>
        <p class="text-sm text-slate-500 mt-1">${E(scope)}</p></div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        ${card('data-go="groups" data-view="anomalies"', 'משימה 1 — שיבוצים לתיקון', `${am.studentsCount} חניכים`,
          groupsOn ? `חריגות: חוסר ${am.byCategory.missing} · כפילות ${am.byCategory.duplicate} · חשודים ${am.byCategory.suspect} (חוסר לפי סף שיבוץ כיתתי)` : 'לא ניתן לקבוע — חסר קובץ קבוצות לשכבה', groupsOn)}
        ${card('data-go="bagrut" data-chip="notok" data-scope="all"',         'משימה 2 — זכאות לבגרות', `${risk.length} חניכים בסיכון`,
                  bagrutOn ? `${near} קרובים לסף · איתור חניכים בסיכון לטיפול שוטף` :  'לא ניתן לקבוע — חסר קובץ בגרות לשכבה', bagrutOn)}
        ${card('data-go="sadin" data-strip="all"', 'משימה 3 — התראה מקדימה (שוטף)', `${currentRisk} חניכים עם נכשל/החמצה בשוטף`,
          sadinOn ? 'פתיחת מסך ההתראה המקדימה' : 'לא ניתן לקבוע — חסר קובץ ציונים שוטפים לשכבה', sadinOn)}
      </div>
      ${quality.length ? `<button type="button" class="fresh-bar fresh-slate w-full text-right" data-act="openDataQuality">איכות נתונים והסגר קליטה: ${E(quality.join(' · '))}</button>` : ''}`);
  },

  animateOverviewBars() {
    const fills = document.querySelectorAll('#overview-body .ov-fill[data-w]');
    fills.forEach(el => { el.style.transition = 'none'; el.style.width = '0%'; });
    void document.body.offsetWidth;
    fills.forEach(el => { el.style.transition = ''; el.style.width = `${el.dataset.w}%`; });
  },
  };
})();
