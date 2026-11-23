(function () {
  'use strict';
  const E = Util.esc;
  const $ = id => document.getElementById(id);
  const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };
  const natural = (a, b) => String(a).localeCompare(String(b), 'he', { numeric: true });
  const isUnknown = signal => signal.pedagogical.some(f => f.id === 'bagrut.unknown');
  const noBagrutData = (signal, sim) =>
    !signal.prereqs.hasBagrut && !(sim.useCurrent && signal.prereqs.hasSadin);

  function signalsFor(rows, sim) {
    const adaptive = sim.fullMode && rows.some(r => r.t.gradeKey !== 'יב')
      ? SignalEngine.computeAll({ ...sim, fullMode: false }).byTz : null;
    const regular = SignalEngine.computeAll(sim).byTz;
    return new Map(rows.map(r => [r.t.tz, (r.t.gradeKey === 'יב' || !adaptive ? regular : adaptive).get(r.t.tz)]));
  }

  function signalSummary(rows, signals, sim) {
    const pedagogical = new Map(), quality = new Map();
    const add = (map, flag, tz) => {
      if (!map.has(flag.id)) map.set(flag.id, new Set());
      map.get(flag.id).add(tz);
    };
    rows.forEach(({ t }) => {
      const signal = signals.get(t.tz);
      signal.pedagogical.filter(f => f.family === 'bagrut').forEach(f => add(pedagogical, f, t.tz));
      signal.dataQuality.filter(f => f.id === 'data.manual_review').forEach(f => add(quality, f, t.tz));
    });
    const missing = [...new Set(rows.map(r => r.t.gradeKey))].filter(grade => {
      const p = SignalEngine.prerequisitesFor(grade);
      return !p.hasBagrut && !(sim.useCurrent && p.hasSadin);
    });
    const badges = map => [...map].map(([id, ids]) =>
      UI.signalBadge(id, `${SignalEngine.CATALOG[id].label}: ${ids.size}`)).join(' ');
    return `<div class="card p-3 mb-3" aria-label="דגלי בגרות ואיכות נתונים">
      ${missing.length ? `<div class="mb-2">${UI.signalBadge('bagrut.unknown', `לא ניתן לקבוע — חסר קובץ בגרות לשכבות ${missing.map(Util.gl).join(', ')}`)}</div>` : ''}
      <div class="grid md:grid-cols-2 gap-3">
        <section aria-label="דגלי בגרות פדגוגיים"><strong>דגלים פדגוגיים:</strong> ${badges(pedagogical) || '<span class="text-slate-500">אין חניכים להצגה</span>'}</section>
        <section aria-label="איכות נתוני בגרות"><strong>איכות נתונים והחלטת רכזת:</strong> ${badges(quality) || '<span class="text-slate-500">לא אותרו דגלי איכות נתונים</span>'}</section>
      </div><p class="text-xs text-slate-500 mt-1">נתוני הצפי והסינונים משקפים גם מצבים הממתינים להחלטת רכזת.</p></div>`;
  }

  window.BagrutView = {
  bagrutSubjectChange(value) {
    Object.assign(this.state.bagrut, { drill: value, readinessClass: '', readinessFilter: 'all' });
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

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

  bagrutSort(el) {
    const st = this.state.bagrut, key = el.dataset.key;
    if (st.sort === key) st.dir *= -1; else { st.sort = key; st.dir = 1; }
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  bagrutDrill(el) {
    Object.assign(this.state.bagrut, { drill: el.dataset.sel, readinessClass: '', readinessFilter: 'all' });
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

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

  bagrutDrillBack() {
    Object.assign(this.state.bagrut, { drill: 'all', readinessClass: '', readinessFilter: 'all' });
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  bagrutMxSort(el) {
    const st = this.state.bagrut, key = el.dataset.key;
    if (st.mxSort === key) st.mxDir *= -1; else { st.mxSort = key; st.mxDir = 1; }
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  bagrutChip(el) {
    const st = this.state.bagrut, chip = el.dataset.chip;
    st.chip = st.chip === chip ? 'all' : chip;
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  bagrutScope(el) {
    this.state.bagrut.chip = 'all';
    this.applyBagrutScope(el.dataset.scope);
    this.alertOut = [];
    this.renderTab(this.state.tab);
  },

  bagrutOnlyPending(el) {
    this.state.bagrut.onlyPending = el.checked;
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

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

  readinessBreakdown(m) {
    return `${m.fail} נכשלים · ${m.borderline} גבוליים · ${m.noGrade} ללא ציון${m.unreported ? ` · ${m.unreported} טרם דווח` : ''}`;
  },

  readinessCompact(r) {
    return `${r.fail} נכשלים · ${r.borderline} גבוליים${r.noGrade > 0 ? ` · ${r.noGrade} ללא ציון` : ''}`;
  },

  readinessAverage(avg) { return avg == null ? '—' : Util.fmt(avg, 1); },

  dashRows() { return this.filtered().map(t => ({ t, ev: this.getEval(t.tz) })); },

  /** י"ב, חריג ידני או ללא נתוני בגרות: נשפטים לפי צפי הזכאות המלא; י' / י"א: לפי תקינות צבירה לשכבה */
  tierBased(ev) { return ev.rank >= 12 || ev.manual || ev.tier === 0; },

  /** היקף השכבות בלשונית הבגרות. סינון שכבה גלובלי קובע לבדו; חניך שננעל בחיפוש מוצג תמיד. אם אין חניכים בהיקף ברירת המחדל – השכבה הגבוהה הראשונה שיש בה חניכים */
  /* מיפוי אחיד בין בורר השכבות בלשונית הבגרות לבין סינון השכבה העליון (#fGrade) */
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
  applyBagrutScope(scope, FILTERED_TABS) {
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

  filterByChip(rows, chip, signals) {
    if (chip === 'attention') {
      const { tzSet } = this.attentionModel(rows.map(r => r.t), rows);
      return rows.filter(r => tzSet.has(r.t.tz));
    }
    if (chip === 'all') return [...rows];
    if (!signals) signals = signalsFor(rows, this.state.sim);
    return rows.filter(r => this.chipMatch(r, chip, signals.get(r.t.tz)));
  },

  chipMatch(r, chip, signal = signalsFor([r], this.state.sim).get(r.t.tz)) {
    const ev = r.ev;
    if (chip === 'attention') return this.attentionTzs().has(r.t.tz);
    if (chip === 'all') return true;
    if (chip === 'exception') return ev.manual;
    if (isUnknown(signal)) return chip === 'tier0';
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
    const signals = signalsFor(rows, sim);
    const knownRows = rows.filter(r => !isUnknown(signals.get(r.t.tz)));
    const evalRows = knownRows.filter(r => this.tierBased(r.ev)), paceRows = knownRows.filter(r => !this.tierBased(r.ev));
    const stats = BagrutAdvisor.summarize(evalRows.map(r => r.ev));
    const list = this.bagrutList(rows, signals);
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
    const drill = st.drill !== 'all' && Store.hasData() ? this.subjectDrillModel(this.filterByChip(rows, st.chip, signals)) : null;
    this.renderBagrutKpis(stats, tierCount, TT, paceRows, rows, drill);
    setHtml('bagrutSubjectDrillSelect',
      `<option value="all" ${st.drill === 'all' ? 'selected' : ''}>📊 מבט על – כל המקצועות</option>` +
      drillOpts.map(o => `<option value="${E(o.value)}" ${st.drill === o.value ? 'selected' : ''}>${E(o.label)}</option>`).join(''));
    if (!Store.hasData()) return this.noRoster([], 'bagrut-table');
    const displayed = drill && drill.m ? drill.m.rows
      .filter(r => !drill.currentOn || ((!st.readinessClass || r.t.classKey === st.readinessClass) && this.readinessMatch(r, st.readinessFilter)))
      .map(r => ({ t: r.t })) : list;
    const summary = signalSummary(displayed, signals, sim);
    if (drill) return setHtml('bagrut-table', summary + this.bagrutSubjectMatrix(drill, signals));
    setHtml('bagrut-table', summary + this.bagrutTable(list, signals));
  },

  /** פס KPI מנהלים מעל הטבלה: אחוזי זכאות בקבוצה המסוננת ומונים לחיצים לסינון מהיר */
  renderBagrutKpis(stats, tierCount, TT, paceRows = [], rows = this.dashRows(), drill = null) {
    const box = $('bagrut-kpis');
    if (!box) return;
    if (!Store.hasData()) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    if (drill) { box.classList.remove('hidden'); box.innerHTML = this.subjectReadinessKpis(drill); return; }
    if (!stats.total && !paceRows.length && rows.length) {
      box.classList.remove('hidden');
      box.innerHTML = `<div class="card px-4 py-2.5">${UI.signalBadge('bagrut.unknown', 'לא ניתן לקבוע — חסרים נתוני בגרות לשכבה')}
        ${this.state.bagrut.chip !== 'all' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="bagrutChip" data-chip="all">✕ הצג הכל</button>' : ''}</div>`;
      return;
    }
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
  bagrutSubjectMatrix(d, signals) {
    const st = this.state.bagrut;
    const { currentOn, m } = d;
    if (!m || !m.name) return '<div class="text-center text-slate-400 py-8">המקצוע אינו פעיל בכללים</div>';
    const { mxSort: sort, mxDir: dir } = st;
    if (!signals) signals = signalsFor(m.rows.map(r => ({ t: r.t })), this.state.sim);
    const unknownCell = '<td class="text-slate-400" title="לא ניתן לקבוע ללא נתוני בגרות לשכבה">—</td>';
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
      if (noBagrutData(signals.get(r.t.tz), this.state.sim)) return unknownCell;
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
      if (noBagrutData(signals.get(r.t.tz), this.state.sim)) return unknownCell;
      const left = r.remainingW;
      const tip = r.accumulated >= r.pass && !left ? `נצבר: ${r.accumulated} נק' מתוך 100` :
        r.accumulated + left < r.pass - 0.5 ? `נצבר עד כה: ${r.accumulated} נק' מתוך 100 (גם בציון 100 בשאלוני ההמשך לא יושג ציון עובר ${r.pass})` :
        r.need > 0 ? `נצבר עד כה: ${r.accumulated} נק' מתוך 100 (חסרות עוד ${r.need} נק' משאלוני ההמשך כדי להבטיח ציון סופי עובר ${r.pass})` :
        `נצבר עד כה: ${r.accumulated} נק' מתוך 100 (ציון עובר ${r.pass} כבר מובטח)`;
      return `<td class="whitespace-nowrap text-slate-700" title="${E(tip)}">🧮 ${r.accumulated}</td>`;
    };
    const finalTd = r => noBagrutData(signals.get(r.t.tz), this.state.sim) ? unknownCell : r.finalScore != null
      ? `<td class="${r.finalScore >= r.pass ? 'text-emerald-700' : 'text-rose-600'} font-bold">${r.finalScore}</td>`
      : `<td class="text-slate-300" title="${E(r.partialAvg != null ? `בתהליך – ממוצע חלקי נוכחי: ${r.partialAvg} (על ${r.doneW}% מהמשקל)` : 'טרם הושלם אף שאלון')}">–</td>`;
    const currentTd = r => `<td data-readiness="${r.readiness}" class="whitespace-nowrap ${r.readiness === 'fail' ? 'text-rose-600 font-bold' : r.readiness === 'borderline' ? 'text-orange-600 font-bold' : 'text-emerald-700'}">
      <span${r.readiness === 'noGrade' ? ' class="badge bg-amber-100 text-amber-900"' : r.readiness === 'unreported' ? ' class="badge bg-slate-100 text-slate-500" title="בקבוצה/בכיתה טרם דווחו ציונים שוטפים במקצוע"' : r.readiness === 'notEnrolled' ? ' class="text-slate-400" title="לא משובץ לקבוצת לימוד במקצוע השנה"' : ''}>${r.readiness === 'noGrade' ? 'ללא ציון' : r.readiness === 'unreported' ? 'טרם דווח' : r.readiness === 'notEnrolled' ? '—' : this.readinessAverage(r.currentAvg)}</span>${r.missed ? ` <span class="block text-xs text-rose-600">${r.missed} אירועים שהוחמצו</span>` : ''}</td>`;
    const body = list.map(r => {
      const signal = signals.get(r.t.tz), quality = signal.dataQuality.find(f => f.id === 'data.manual_review');
      return `<tr>
        <td><button type="button" class="font-bold text-indigo-700 hover:text-indigo-900 text-right hover:underline whitespace-nowrap cursor-pointer" data-act="openProfile" data-tz="${E(r.t.tz)}" title="ת.ז ${E(r.t.tz)}">${E(r.t.name)}</button>
          ${isUnknown(signal) ? UI.overallBadge('unknown') : ''}
          ${quality ? `<span aria-label="איכות נתונים" title="${E(quality.detail)}">${UI.signalBadge(quality)}</span>` : ''}</td>
        <td><span class="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-800">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</span></td>
        <td class="whitespace-nowrap text-slate-700">${r.level ? `${E(r.level)} יח'` : ''}${r.teacher ? ` <span class="text-slate-500 text-xs">· ${E(r.teacher)}</span>` : ''}</td>
        ${qCells(r)}${accTd(r)}${finalTd(r)}${currentOn ? currentTd(r) : ''}</tr>`;
    }).join('');
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
    const grades = Util.GRADE_KEYS.filter(g => rows.some(r => r.t.gradeKey === g) && SignalEngine.prerequisitesFor(g).hasBagrut);
    if (!grades.length) { box.innerHTML = ''; return; }
    const lines = grades.map(g => {
      const all = BagrutEngine.activeCohortQuestionnaires(g);
      const name = x => `${E(x.subject)}${x.label.endsWith('%') ? ` ${E(x.label)}` : ''}`;
      const taken = all.filter(x => x.takenByCohort).map(x => `${name(x)} (${x.pct}%)`);
      const pending = all.filter(x => x.pendingCohort && !x.variable).map(name);
      return `<div><b>${E(Util.gl(g))}:</b> נבחנו בשכבה – ${taken.length ? taken.join(' · ') : 'עדיין לא'}${pending.length ? `<br><span class="text-slate-400">בתהליך השנה / טרם דווח לשכבה (&lt;${BagrutEngine.COHORT_MIN_PCT}%): ${pending.join(' · ')}</span>` : ''}</div>`;
    });
    box.innerHTML = `<details><summary>🕒 מה כבר נבחן בשכבה? (צפי מותאם: מקצוע ליבה נחשב "נבחן" כש-${BagrutEngine.COHORT_MIN_PCT}% מהשכבה לפחות קיבלו בו ציון; מגמה – ${BagrutEngine.COHORT_MAJOR_PCT}% מלומדיה)</summary><div class="mt-2 space-y-1 leading-relaxed">${lines.join('')}</div></details>`;
  },

  bagrutList(rows, signals) {
    const { chip, sort, dir } = this.state.bagrut;
    const val = r => ({ name: r.t.name, class: r.t.classKey, grade: Util.ord(r.t.gradeKey), track: this.trackOf(r.t), tier: this.tierBased(r.ev) ? r.ev.tier : BagrutEngine.PACE_TIER[r.ev.paceStatus], tz: r.t.tz, diag: r.ev.diagnostic })[sort];
    return this.filterByChip(rows, chip, signals).sort((a, b) => {
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
  bagrutTable(list, BAGRUT_CORE, signals) {
    const { sort, dir } = this.state.bagrut;
    const sim = this.state.sim;
    if (!signals) signals = signalsFor(list, sim);
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
    const focusTd = (ev, unknown) => {
      if (unknown) return '<td class="mx-focus text-slate-500">לא ניתן לקבוע ללא נתוני בגרות לשכבה</td>';
      const reviewReasons = ev.blockers.filter(b => b.k === 'exempt-review').map(b => b.text);
      // Pace focus starts with reviewCount coordinator-review entries.
      const paceReviews = new Set(ev.paceInfo.focus.slice(0, ev.paceInfo.reviewCount).map(f => f.text));
      const MAX = 1, items = ev.focus.filter(f => !paceReviews.has(f.text) && !reviewReasons.some(reason => f.text.includes(reason)));
      let body;
      if (ev.tier === 0) body = `<span class="text-xs text-slate-600">${E(ev.diagnostic)}</span>`;
      else if (!items.length) body = ev.manualReview.required
        ? '<span class="text-xs text-slate-600">לא אותרו חסמים פדגוגיים נוספים</span>'
        : '<span class="text-xs text-emerald-800">✓ תקין</span>';
      else {
        const b = x => `<span class="badge ${x.hard ? 'tier-4' : x.target ? 'bg-sky-100 text-sky-800' : 'tier-3'}">${E(x.text)}</span>`;
        const more = items.length - MAX;
        body = items.slice(0, MAX).map(b).join(' ') + (more > 0 ? ` <span class="badge fresh-slate border" title="${E(items.slice(MAX).map(x => x.text).join(' · '))}">+${more}</span>` : '');
      }
      return `<td class="mx-focus" title="${E(items.map(x => x.text).join(' · '))}">${body}${this.advisoryHtml(ev)}</td>`;
    };
    const pill = (ev, signal) => {
      let text = ev.tierText;
      const held = ev.manualReview.required, real = ev.blockers.filter(b => !b.info).length;
      if (ev.adaptive && ev.tier === 3 && !ev.manual && real > 0) text += ` (חסם ${real})`;
      const bagrutFlag = signal.pedagogical.find(f => ['bagrut.eligible', 'bagrut.watch', 'bagrut.risk', 'bagrut.twelve', 'bagrut.unknown'].includes(f.id));
      const status = isUnknown(signal) ? UI.overallBadge('unknown') :
        held ? UI.signalBadge(bagrutFlag) :
        !this.tierBased(ev) ? this.paceBadge(ev) : ev.tier === 1 ? `<span class="text-emerald-700 font-medium whitespace-nowrap" title="${E(ev.diagnostic)}">✓ ${E(text)}</span>` :
        ev.tier === 0 || ev.tier === 5 ? `<span class="text-slate-400 whitespace-nowrap" title="${E(ev.diagnostic)}">${E(text)}</span>` :
        `<span class="badge pill-t${ev.tier} whitespace-nowrap" title="${E(ev.diagnostic)}">${E(text)}</span>`;
      const suspect = held ? ev.suspectExtra : ev.suspect;
      const quality = signal.dataQuality.find(f => f.id === 'data.manual_review');
      const review = quality ? `<div aria-label="איכות נתונים" title="${E(quality.detail)}">${UI.signalBadge(quality, held ? 'נדרשת החלטת רכזת' : 'נדרשת בדיקה ידנית')}</div>` : '';
      return `<div>${status}</div>${noBagrutData(signal, sim) ? '' : `<div>${this.unitsBadge(ev)}</div>`}
        ${ev.manual ? '<div><span class="badge badge-exc">⚡ חריג</span></div>' : !isUnknown(signal) && suspect.length ? `<div><span class="badge tier-3" title="${E(suspect.join(' · '))}">חשד לחריג</span></div>` : ''}${review}`;
    };

    const cols = 6 + coreCols.length;
    const body = this.homeroomRows(list.slice(0, 1500), cols, ({ t, ev }) => {
      const track = this.trackOf(t);
      const signal = signals.get(t.tz), unknown = noBagrutData(signal, sim);
      const noDataCell = '<td class="text-slate-400" title="לא ניתן לקבוע ללא נתוני בגרות לשכבה">—</td>';
      return `
      <tr>
        <td><button type="button" class="font-bold text-indigo-700 hover:text-indigo-900 text-right hover:underline whitespace-nowrap cursor-pointer" data-act="openProfile" data-tz="${E(t.tz)}" title="ת.ז ${E(t.tz)}">${E(t.name)}</button></td>
        <td><span class="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-800">${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)}${track && track !== 'רגילה' ? ` <span class="badge fresh-slate border">${E(track)}</span>` : ''}</span></td>
        <td>${pill(ev, signal)}</td>
        ${coreCols.map(([id, label]) => unknown ? noDataCell : subjectTd(this.subjectDisplayCell(ev, id), label)).join('')}
        ${unknown ? noDataCell : subjectTd(this.majorDisplayCell(ev), 'מגמה 5 יח"ל')}
        ${unknown ? noDataCell : internalsTd(ev)}
        ${focusTd(ev, unknown)}
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
  };
})();
