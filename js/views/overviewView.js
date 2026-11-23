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

  renderOverviewPanel(DATASETS) {
    if (!Store.hasData()) return this.noRoster([], 'overview-body');
    const m = this.overviewModel(), f = this.state.filters, st = m.stats, bench = m.bench;
    const bagrutOn = m.bagrutOn, sadinOn = m.sheet.length > 0 && [...m.coverage.values()].some(p => p.hasSadin);
    const missing = Object.keys(DATASETS).filter(key => !Config.getDataset(key));
    const groupsComplete = [...m.coverage.values()].every(p => p.hasGroups);

    const card = (data, label, value, sub, extra = '', icon = '') => `<button type="button" class="ov-card" data-act="ovGo" ${data}>
      <span class="ov-head"><span class="ov-label">${label}</span>${icon}</span>${extra || `<span class="ov-value">${value}</span>`}<span class="ov-sub">${sub}</span></button>`;
    const badge = (cls, paths) => `<span class="ov-icon ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24">${paths}</svg></span>`;
    const ICONS = {
      attn: badge('i-attn', '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
      trophy: badge('i-ok', '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
      grad: badge('i-ok', '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>'),
      alert: badge('i-bad', '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>')
    };
    const donut = (pct, title) => {
      const c = 2 * Math.PI * 30;
      return `<svg viewBox="0 0 80 80" class="w-20 h-20 shrink-0" role="img" aria-label="${E(`${title} ${pct}%`)}">
        <circle cx="40" cy="40" r="30" fill="none" stroke="#ECEFE9" stroke-width="10"/>
        <circle cx="40" cy="40" r="30" fill="none" stroke="#75977D" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * pct / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/></svg>`;
    };

    const notLoaded = 'טרם נטען קובץ';
    const attentionGo = Store.loaded.bagrut ? 'data-go="bagrut" data-chip="attention" data-scope="all"' : 'data-go="sadin" data-strip="multiple"';
    const card1 = card(attentionGo, 'חניכים במעקב / דורש תשומת לב', m.attention.size,
      bagrutOn || sadinOn ? `${this.attentionBreakdownText(m.att, '2+ שליליים או חסרים')} · מתוך ${m.list.length}` : notLoaded, '', ICONS.attn);
    const card2 = card('data-go="sadin" data-strip="all"', 'ממוצע הישגים שוטפים', m.avg == null ? '—' : Util.fmt(m.avg, 1),
      sadinOn ? `${m.clean} חניכים עם 100% ציונים עוברים (מתוך ${m.graded.length} עם ציונים)` : notLoaded, '', ICONS.trophy);
    const kpiPct = bench.pace ? st.pctInclSpecialEd : st.eligibilityInclSpecialEd;
    /* כשנבחרה כיתה, כותרות הכרטיס והגרפים נושאות את שם הכיתה ולא את תווית השכבה */
    const classOn = f.cls !== 'all';
    const scopeLabel = classOn ? Config.classLabel(f.cls) : bench.label;
    const readiness = this.overviewReadinessModel(m);
    const readinessAttrs = r => `data-act="ovReadiness" data-sel="${E(r.sel)}" data-scope="${E(bench.scope)}" data-off-track="${r.offTrack}" data-total="${r.total}"`;
    const readinessCards = readiness.items.map(r => {
      const w = f.cls === 'all' && r.classes.filter(c => !c.unreportedOnly).length > 1 ? r.weakest : null;
      return `<button type="button" class="text-right rounded-lg border border-slate-200 bg-slate-50 hover:bg-amber-50 hover:border-amber-300 px-3 py-2 space-y-1" ${readinessAttrs(r)}>
        <span class="flex items-center justify-between gap-2"><span class="font-bold text-slate-800 truncate">${E(r.name)}</span><span class="badge bg-white text-slate-700 shrink-0" title="ממוצע שוטף">⌀ ${this.readinessAverage(r.avg)}</span></span>
        <span class="block text-sm"><span class="txt-warn font-bold">${r.offTrack} לא בכיוון</span> <span class="text-slate-500">(${r.offTrackPct}% מ-${r.assessed})</span></span>
        <span class="block text-xs text-slate-600">${this.readinessCompact(r)}${r.unreported > 0 ? ` <span class="text-slate-400">(+ ${r.unreported} טרם דווח)</span>` : ''}</span>
        ${w ? `<span class="block text-xs text-slate-500">הכיתה החלשה: <b>${E(Config.classLabel(w.key))}</b> · ${this.readinessAverage(w.avg)} / ${w.offTrackPct}% לא בכיוון</span>` : ''}</button>`;
    }).join('');
    const readinessPending = readiness.unreportedItems.length ? `<div class="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><span>טרם דווחו ציונים שוטפים:</span>${readiness.unreportedItems.map(r =>
      `<button type="button" class="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-slate-500 hover:bg-slate-200" ${readinessAttrs(r)} title="${r.graded} מתוך ${r.total} עם ציון שוטף">${E(r.name)} (${r.graded}/${r.total})</button>`).join('')}</div>` : '';
    const readinessHtml = (readinessCards ? `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">${readinessCards}</div>` : '') + readinessPending ||
      `<p class="text-sm text-slate-500">${E(readiness.message || 'טרם דווחו ציונים שוטפים במקצועות הבגרות של השנה.')}</p>`;
    const kpiTitle = `${bench.pace ? 'תקינות צבירה לבגרות' : 'צפי זכאות לבגרות'} (${scopeLabel})`;
    const kpiSub = bench.pace
      ? `ללא חנ"מ: ${st.pctExSpecialEd}% • כולל חנ"מ: ${st.pctInclSpecialEd}%<br>${st.warning} בחסם צבירה יחיד · ${st.lag} בפיגור צבירה`
      : `ללא חנ"מ: ${st.eligibilityExSpecialEd}% • כולל חנ"מ: ${st.eligibilityInclSpecialEd}%<br>${st.singleBlocker} חניכים במרחק מקצוע אחד מזכאות`;
    const card3 = card(`data-go="bagrut" data-chip="all" data-scope="${bench.scope}"`, kpiTitle, '', bagrutOn ? kpiSub : notLoaded,
      `<span class="flex items-center justify-between gap-3"><span class="ov-value">${bagrutOn ? `${kpiPct}%` : '—'}</span>${bagrutOn ? donut(kpiPct, bench.pace ? 'תקינות צבירה' : 'צפי זכאות') : ''}</span>`, ICONS.grad);
    const am = m.anomaliesModel, c = am.byCategory, groupsOn = am.ready && groupsComplete;
    const card4 = card('data-go="groups" data-view="anomalies"', 'חריגות שיבוץ בקבוצות', '',
      groupsOn ? `${am.studentsCount} חניכים · חוסר ${c.missing} • כפילות ${c.duplicate} • חשודים ${c.suspect}` : 'לא ניתן לקבוע — חסר קובץ קבוצות לשכבה',
      `<span class="ov-value${groupsOn ? ' warm' : ' text-slate-400'}">${groupsOn ? am.total : '—'}</span>`, groupsOn ? ICONS.alert : '');

    const coverageFlags = [...m.coverage.entries()].flatMap(([grade, p]) => [
      !p.hasBagrut && UI.signalBadge('bagrut.unknown', `שכבת ${Util.gl(grade)}: לא ניתן לקבוע — חסר קובץ בגרות`),
      !p.hasGroups && UI.signalBadge('placement.unknown', `שכבת ${Util.gl(grade)}: לא ניתן לקבוע — חסר קובץ קבוצות`),
      !p.hasSadin && UI.signalBadge('sadin.unknown', `שכבת ${Util.gl(grade)}: לא ניתן לקבוע — חסר קובץ ציונים שוטפים`)
    ].filter(Boolean));
    const signalCounts = new Map(), qualityCounts = new Map();
    m.signals.forEach(signal => {
      const add = (counts, flags) => [...new Set(flags.map(f => f.id))].forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
      add(signalCounts, signal.pedagogical.filter(f =>
        (f.severity === 'risk' || f.severity === 'watch' || f.id === 'bagrut.twelve') &&
        (f.id !== 'placement.duplicate' || this.state.showRoutineDuplicates || !isRoutineDuplicateSubject(f.detail))));
      add(qualityCounts, signal.dataQuality);
    });
    const badges = counts => [...counts.entries()].map(([id, n]) =>
      UI.signalBadge(id, `${SignalEngine.CATALOG[id].label}: ${n}`)).join(' ');
    const qualityRows = m.signals.filter(signal => signal.dataQuality.length).slice(0, 8).map(signal => {
      const t = Store.trainees.get(signal.tz);
      return `<li><button type="button" class="text-right underline text-[#355747]" data-act="openProfile" data-tz="${E(signal.tz)}">${E(t.name)}</button> · ${E(signal.dataQuality.map(f => f.detail || f.label).join(' · '))}</li>`;
    }).join('');
    const signalHtml = `<div class="grid grid-cols-1 md:grid-cols-2 gap-3" aria-label="דגלים לפי סוג">
      <section class="card p-4"><h3 class="font-bold text-[#355747] mb-2">דגלים פדגוגיים</h3>
        <div class="flex flex-wrap gap-1.5">${badges(signalCounts) || '<span class="text-sm text-slate-500">לא אותרו דגלי סיכון או מעקב בנתונים הזמינים.</span>'}</div></section>
      <section class="card p-4"><h3 class="font-bold text-[#355747] mb-2">איכות נתונים והחלטת רכזת</h3>
        <div class="flex flex-wrap gap-1.5">${badges(qualityCounts) || '<span class="text-sm text-slate-500">לא אותרו דגלי איכות נתונים.</span>'}</div>
        ${qualityRows ? `<ul class="mt-2 text-xs text-slate-600 space-y-1">${qualityRows}</ul>` : ''}</section></div>`;

    /* אחוז זכאות / תקינות צבירה לפי כיתות של אוכלוסיית הייחוס (או ממוצע שוטף כשקובץ הבגרות טרם נטען); הסינון לפי כיתה אינו מצמצם את הגרף כדי שאפשר יהיה לעבור בין כיתות */
    const pool = f.cls === 'all' ? m.list : this.overviewList(true);
    let poolRows = f.cls === 'all' ? m.rows : pool.map(t => ({ t, ev: this.getEval(t.tz) }));
    if (bagrutOn) poolRows = poolRows.filter(r => bench.grades.has(r.t.gradeKey));
    const poolGraded = f.cls === 'all' ? m.graded : (sadinOn ? GroupAnalyzer.sadinSheet(pool, {}).filter(r => r.overall != null) : []);
    const byClass = new Map();
    poolRows.forEach(r => { const k = r.t.classKey || ''; if (!byClass.has(k)) byClass.set(k, []); byClass.get(k).push(r); });
    const sheetByClass = new Map();
    poolGraded.forEach(r => { const k = r.t.classKey || ''; if (!sheetByClass.has(k)) sheetByClass.set(k, []); sheetByClass.get(k).push(r.overall); });
    const classBars = [...byClass.entries()].sort((a, b) => Util.ord(a[1][0].t.gradeKey) - Util.ord(b[1][0].t.gradeKey) || natural(a[0], b[0])).map(([key, members]) => {
      if (bagrutOn) {
        const s = bench.pace ? BagrutAdvisor.summarizePace(members.map(r => r.ev)) : BagrutAdvisor.summarize(members.map(r => r.ev));
        const pct = bench.pace ? s.pctInclSpecialEd : s.eligibilityInclSpecialEd;
        return { key, value: s.counted ? pct : null, text: s.counted ? `${pct}%` : '—' };
      }
      const scores = sheetByClass.get(key) || [];
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      return { key, value: avg, text: avg == null ? '—' : Util.fmt(avg, 0) };
    });
    const bar = (label, value, cls = '') => `<span class="min-w-0 truncate text-sm font-semibold text-[#355747]">${label}</span><span class="ov-track"><span class="ov-fill ${cls}" style="width:0%" data-w="${Math.max(0, Math.min(100, value || 0))}"></span></span>`;
    const classHtml = classBars.length && (bagrutOn || sadinOn)
      ? `<div class="space-y-1 ov-class-bars${classOn ? ' has-selection' : ''}">${classBars.map(b => {
        const on = f.cls === b.key;
        return `<button type="button" class="ov-bar" data-act="ovClass" data-class="${E(b.key)}" aria-pressed="${on}" title="${on ? 'מוצגת כיתה זו בלבד; לחיצה נוספת מחזירה לכל השכבה' : 'סינון לפי כיתה'}">${bar(`${E(Config.classLabel(b.key))} (${b.text})`, b.value)}${on ? '<span class="ov-now">✓ מוצג כעת</span>' : ''}</button>`;
      }).join('')}</div>`
      : `<div class="text-sm text-slate-500 py-3">${notLoaded} – אחוז הזכאות או הממוצע לפי כיתות יוצגו לאחר הטעינה.</div>`;

    const blockers = this.overviewBlockers(m);
    const maxBad = Math.max(1, ...blockers.items.map(x => x.bad));
    const blockerHtml = blockers.items.length
      ? blockers.items.map((x, i) => `<div class="ov-bar" title="${E(`${x.bad} מתוך ${x.enrolled} חניכים`)}"><span class="min-w-0 truncate text-sm font-semibold text-[#355747]">${E(x.name)} <span class="${i === 0 ? 'txt-bad' : 'txt-warn'} font-bold">(${x.bad} - ${x.pct}%)</span></span><span class="ov-track"><span class="ov-fill mustard" style="width:0%" data-w="${Math.round((x.bad / maxBad) * 100)}"></span></span></div>`).join('')
      : `<div class="text-sm text-slate-500 py-3">${bagrutOn || sadinOn ? 'לא נמצאו מקצועות עם ציונים נכשלים או חסרים בסינון הנוכחי.' : notLoaded}</div>`;

    const issues = this.overviewIssues(m), SHOWN = 8;
    const issueRows = issues.slice(0, SHOWN).map(i => `<tr class="ov-row" data-act="openProfile" data-tz="${E(i.t.tz)}">
      <td><button type="button" class="text-right font-semibold text-[#355747] hover:underline" data-act="openProfile" data-tz="${E(i.t.tz)}">${E(i.t.name)}</button><div class="text-xs text-slate-500">${E(Config.classLabel(i.t.classKey))}</div></td>
      <td>${i.parts.map(p => `<div class="text-xs font-medium ${p.severe ? 'txt-bad' : 'txt-warn'}">${E(p.text)}</div>`).join('')}</td></tr>`).join('');
    const issueHtml = issues.length
      ? `<table class="ov-table"><thead><tr><th>תלמידים (שם + כיתה)</th><th>תיאור החריגה / חסם</th></tr></thead><tbody>${issueRows}</tbody></table>
        ${issues.length > SHOWN ? `<div class="pt-2 text-xs text-slate-500">מוצגים ${SHOWN} מתוך ${issues.length} · <button type="button" class="underline text-[#75977D]" data-act="ovGo" data-go="groups" data-view="anomalies">כל חריגי השיבוץ</button></div>` : ''}`
      : `<div class="text-sm text-slate-500 py-3">${am.ready || bagrutOn ? 'אין חניכים בחריגת שיבוץ או במרחק מקצוע אחד מזכאות בסינון הנוכחי.' : notLoaded}</div>`;

    /* חיווי ההיקף הפעיל: כדור ההיקף (כיתה / שכבה) וכדור "חזרה" בהיר לצידו */
    const capIcon = '<svg class="scope-cap" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>';
    const rays = '<svg class="scope-rays" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13 8 6M16 18 4 17M21 8 18 1"/></svg>';
    const back = (reset, text) => `<button type="button" class="scope-back" data-act="ovScopeReset" data-reset="${reset}"><span class="scope-chev" aria-hidden="true">›</span>${text}</button>`;
    let banner;
    if (classOn) {
      const g = f.grade !== 'all' ? f.grade : Util.parseClass('', f.cls).gradeKey;
      banner = `<div class="active-scope-banner is-class" role="status"><span class="scope-pill">${rays}${capIcon}כיתה ${E(scopeLabel)}</span>${back('cls', `חזרה לכל שכבת ${E(Util.gl(g))}`)}</div>`;
    } else if (f.grade !== 'all') {
      banner = `<div class="active-scope-banner is-grade" role="status"><span class="scope-pill">${capIcon}שכבת ${E(Util.gl(f.grade))}</span>${back('grade', 'חזרה לכל השכבות')}</div>`;
    } else {
      banner = `<div class="active-scope-banner is-all" role="status"><span class="scope-pill">כלל בית הספר</span></div>`;
    }
    setHtml('overview-body', `
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div class="text-xs font-semibold text-[#75977D]">מוניטור פדגוגי ‹ חדר בקרה</div>
          <h2 class="ov-title text-2xl font-extrabold text-[#355747] mt-0.5">חדר בקרה פדגוגי – תמונת מצב</h2>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span id="ovSyncPill" class="ov-pill" role="status">${E(($('syncStatus') || {}).textContent || '')}</span>
        </div>
      </div>
      ${banner}
      ${missing.length ? `<div class="card px-4 py-2 flex flex-wrap items-center gap-2 text-sm"><span class="text-slate-500">טרם נטענו קבצים:</span>${missing.map(key => `<button type="button" class="btn btn-primary btn-sm" data-upload="${key}">📂 ${E(DATASETS[key].title)}</button>`).join('')}</div>` : ''}
      ${coverageFlags.length ? `<div class="flex flex-wrap gap-1.5" role="status" aria-label="מידע חסר לפי שכבה">${coverageFlags.join(' ')}</div>` : ''}
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">${card1}${card2}${card3}${card4}</div>
      ${signalHtml}
      <div id="overview-readiness" class="card p-5"><h3 class="font-bold text-[#355747] mb-2">מוכנות לבגרויות השנה (לפי ציונים שוטפים) · ${E(scopeLabel)}</h3><div class="space-y-2">${readinessHtml}</div></div>
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div class="card p-5 lg:col-span-7 space-y-5">
          <div><h3 class="font-bold text-[#355747] mb-2">${bagrutOn ? (bench.pace ? `תקינות צבירה לבגרות לפי כיתות (${E(bench.label)})` : `אחוז זכאות לבגרות לפי כיתות (${E(bench.label)})`) : 'ממוצע הישגים שוטפים לפי כיתות'}</h3>          ${classHtml}
                    </div>
                    <div class="border-t border-[#E6ECE6] pt-4"><h3 class="font-bold text-[#355747] mb-2">התפלגות החוסמים ביותר${classOn ? ` • ${E(scopeLabel)}` : ''} <span class="text-xs font-normal text-slate-500">${E(({ sadin: 'מקצועות עם ציון נכשל או חסר', pace: 'כשלים ושאלונים שמועדם הגיע לשכבה' }[blockers.source] || 'מקצועות ליבה בבגרות') + (!classOn && (bagrutOn || sadinOn) ? ` · ${bench.label}` : ''))}</span></h3><div class="space-y-1">${blockerHtml}</div></div>
        </div>
        <div class="card p-5 lg:col-span-5"><h3 class="font-bold text-[#355747] mb-2">חניכים בחריגה וצווארי בקבוק</h3>${issueHtml}</div>
      </div>`);
    this.animateOverviewBars();
  },

  animateOverviewBars() {
    const fills = document.querySelectorAll('#overview-body .ov-fill[data-w]');
    fills.forEach(el => { el.style.transition = 'none'; el.style.width = '0%'; });
    void document.body.offsetWidth;
    fills.forEach(el => { el.style.transition = ''; el.style.width = `${el.dataset.w}%`; });
  },
  };
})();
