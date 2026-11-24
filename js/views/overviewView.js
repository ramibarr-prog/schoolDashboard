(function () {
  'use strict';
  const E = Util.esc;
  const $ = id => document.getElementById(id);
  const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };
  const prerequisites = list => new Map([...new Set(list.map(t => t.gradeKey))]
    .map(grade => [grade, SignalEngine.prerequisitesFor(grade)]));

  document.addEventListener('click', event => {
    const target = event.target.closest && event.target.closest('[data-act="bagrutPin"], [data-act="weaknessRiskApply"]');
    if (target && window.App) window.App.dirty.add('overview');
  }, true);

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
    if ($('panel-overview') && !$('weakness-styles')) {
      const link = document.createElement('link');
      link.id = 'weakness-styles'; link.rel = 'stylesheet'; link.href = 'css/style.css';
      document.head.appendChild(link);
    }
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
    const completion = m.bagrutOn ? this.filterByChip(m.bench.rows, 'completion').filter(r => r.ev.tier !== 0 && r.ev.tier !== 5) : [];
    const completionIds = new Set(completion.map(r => r.t.tz));
    const counted = m.bench.rows.filter(r => r.ev.tier !== 0 && r.ev.tier !== 5 &&
      (!m.bench.pace || !['no_data', 'twelve_years'].includes(r.ev.paceStatus)) && this.trackOf(r.t) !== Config.SPECIAL_ED);
    const projectedEvals = m.bench.rows.map(r => completionIds.has(r.t.tz)
      ? { ...r.ev, tier: 1, paceStatus: 'on_track' } : r.ev);
    const projected = m.bench.pace ? BagrutAdvisor.summarizePace(projectedEvals).pctExSpecialEd
      : BagrutAdvisor.summarize(projectedEvals).eligibilityExSpecialEd;
    const current = m.bench.pace ? m.stats.pctExSpecialEd : m.stats.eligibilityExSpecialEd;
    const measure = m.bench.pace ? 'תקינות הצבירה' : 'צפי הזכאות';
    const bannerTitle = !m.bagrutOn ? 'אין נתונים מספקים להצגת תמונת השכבה'
      : completion.length ? `${completion.length} חניכים ${m.bench.pace ? 'קרובים לחזרה לקצב' : 'במסלול השלמה או החלטה'}` : 'אין חניכים במסלול השלמה או החלטה';
    const bannerDetail = !m.bagrutOn ? 'יש לטעון נתוני בגרות לשכבת הייחוס.'
      : !counted.length ? 'אין חניכים ללא חנ״מ לחישוב המדד.'
      : completion.length ? `טיפול בהם עשוי להעלות את ${measure} מ-${current}% ל-${projected}% · המדד ללא חנ״מ`
      : `${measure}: ${current}% ללא חנ״מ`;
    const pins = this.filterByChip(m.rows, 'pinned');
    const pinnedList = pins.slice(0, 3).map(({ t, ev }) => {
      const focus = ev.tier === 5 ? 'מסלול 12 שנות לימוד' :
        !m.coverage.get(t.gradeKey)?.hasBagrut ? 'אין נתוני בגרות לשכבה' :
        (this.tierBased(ev) ? ev.blockers.filter(b => !b.info).map(b => b.text) : ev.paceInfo.focus.map(item => item.text))[0] || 'לא אותרו חסמים';
      return `<li><span class="ov-task-star" aria-hidden="true">★</span><button type="button" class="ov-task-link" data-act="openProfile" data-tz="${E(t.tz)}">${E(t.name)}</button><span>${E(Config.classLabel(t.classKey))}</span><span class="ov-task-truncate" title="${E(focus)}">${E(focus)}</span></li>`;
    }).join('');
    const hotspots = sadinOn ? SadinView.getHotspotsSummary.call(this, m.list, { ...this.state.sadin, subject: 'all', teacher: 'all' }).hotspots : [];
    const hotspotList = hotspots.map(c => `<li><button type="button" class="ov-hotspot" data-act="ovHotspot" data-class="${E(c.cls)}" data-subject="${E(c.subject)}"><span>${E(c.subject)} · ${E(Config.classLabel(c.cls))}</span><strong>${Math.round(c.rate)}% בסיכון${c.students.length < 3 ? ` · ${c.risk}/${c.students.length}` : ''}</strong></button></li>`).join('');
    const card = (attrs, label, title, value, detail, ready, body, action) => `<section class="card ov-task">
      <button type="button" class="ov-card" data-act="ovGo" ${attrs}>
        <span class="ov-label">${label}</span><strong class="ov-task-title">${title}</strong>
        ${ready ? `<span class="ov-value">${value}</span>` : ''}
        <span class="ov-sub">${detail}</span>
      </button>
      <div class="ov-task-body">${body}</div>
      <button type="button" class="btn btn-primary ov-task-action" data-act="ovGo" ${attrs}>${action}</button>
    </section>`;
    const quality = [];
    if (m.signals.some(s => s.dataQuality.some(flag => flag.id === 'data.manual_review'))) quality.push('שאלונים זרים או פטורים');
    if (m.signals.some(s => s.dataQuality.some(flag => flag.id === 'data.sadin_not_enrolled'))) quality.push('ציונים ללא שיבוץ');
    if (Object.values(Store.unknown).some(ids => ids.length)) quality.push('חניכים מחוץ למצבת');
    if (window.ImportQuarantine && window.ImportQuarantine.list().length) quality.push('פריטים בהסגר קליטה');
    const scope = f.cls !== 'all' ? `כיתה ${Config.classLabel(f.cls)}` : f.grade !== 'all' ? `שכבת ${Util.gl(f.grade)}` : 'כלל בית הספר';
    setHtml('overview-body', `
      <div class="ov-dashboard">
        <header class="ov-dashboard-head"><div><h2>היום</h2><span class="ov-dashboard-scope">משימות לטיפול · ${E(scope)}</span></div>
          ${quality.length ? `<button type="button" class="ov-dashboard-quality" data-act="openDataQuality" title="${E(quality.join(' · '))}" aria-label="${E(`איכות נתונים: ${quality.join(' · ')}`)}">${quality.length} לבדיקה</button>` : ''}</header>
        <section class="ov-opportunity" aria-label="${m.bench.pace ? 'הזדמנות לחזרה לקצב' : 'הזדמנות להרמת הזכאות'}">
          <div><span class="ov-opportunity-label">${m.bench.pace ? 'הזדמנות מהירה לחזרה לקצב' : 'הזדמנות מהירה להרמת הזכאות'} · ${E(m.bench.label)}</span>
            <h3>${E(bannerTitle)}</h3><p>${E(bannerDetail)}</p></div>
          <div class="ov-opportunity-actions"><button type="button" class="btn ov-opportunity-primary" data-act="ovCompletion" data-scope="${E(m.bench.scope)}">לחניכים להשלמה</button>
            <button type="button" class="btn ov-opportunity-secondary" data-act="ovCompletion" data-scope="${E(m.bench.scope)}" data-simulation="true">סימולציית מה-אם</button></div>
        </section>
        <div class="ov-task-grid">
          ${card('data-go="groups" data-view="anomalies"', 'שיבוצים', 'שיבוצים לתיקון', `${am.studentsCount} חניכים`,
            groupsOn ? `<span class="ov-task-chips"><span>חוסר ${am.byCategory.missing}</span><span>כפילות ${am.byCategory.duplicate}</span><span>חשודים ${am.byCategory.suspect}</span></span>` : 'לא ניתן לקבוע — חסר קובץ קבוצות לשכבה', groupsOn,
            '<p class="ov-task-note">חוסר לפי סף שיבוץ כיתתי.</p>', 'לתיקון שיבוצים')}
          ${card('data-go="bagrut" data-chip="notok" data-scope="all"', 'מעקב יומיומי', 'זכאות לבגרות', `${risk.length} חניכים בסיכון`,
            bagrutOn ? `${near} קרובים לסף` : 'לא ניתן לקבוע — חסר קובץ בגרות לשכבה', bagrutOn,
            `<h4>במעקב צמוד</h4><ul class="ov-task-list">${pinnedList || '<li>אין חניכים נעוצים בסינון הנוכחי</li>'}</ul>${pins.length > 3 ? `<p class="ov-task-note">ועוד ${pins.length - 3} חניכים</p>` : ''}`, 'למעקב הזכאות')}
          ${card('data-go="sadin" data-strip="all"', 'מבט שכבתי', 'מוקדי חולשה', `${currentRisk} חניכים עם נכשל/החמצה בשוטף`,
            sadinOn ? 'מוקדים בוערים לפי הגדרת הסיכון' : 'לא ניתן לקבוע — חסר קובץ ציונים שוטפים לשכבה', sadinOn,
            `<ul class="ov-task-list">${hotspotList || `<li>${sadinOn ? 'לא נמצאו מוקדים בסיכון' : 'אין נתוני מוקדים זמינים'}</li>`}</ul>`, 'למבט השכבתי')}
        </div>
      </div>`);
  },

  animateOverviewBars() {
    const fills = document.querySelectorAll('#overview-body .ov-fill[data-w]');
    fills.forEach(el => { el.style.transition = 'none'; el.style.width = '0%'; });
    void document.body.offsetWidth;
    fills.forEach(el => { el.style.transition = ''; el.style.width = `${el.dataset.w}%`; });
  },
  };
})();
