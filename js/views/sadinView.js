(function () {
  'use strict';
  const E = Util.esc;
  const $ = id => document.getElementById(id);
  const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };
  const natural = (a, b) => String(a).localeCompare(String(b), 'he', { numeric: true });
  const compatible = (subject, teacher) => Store.traineeList().some(t => Store.currentOf(t.tz).some(e =>
    GroupAnalyzer.sadinSubject(e.subject) === subject && ((Store.groups.get(e.groupId) || {}).teacher || e.teacher) === teacher));
  const confirmedEvent = (m, hasGroups, tz) => {
    if (m.kind !== 'no-row') return true;
    if (!hasGroups) return false;
    if (!tz) return true;
    const group = Store.groups.get(m.groupId);
    return !!group && group.inFile && group.members.has(tz);
  };
  const confirmedMissed = (subject, hasGroups, tz) =>
    [...subject.missed.values()].filter(m => confirmedEvent(m, hasGroups, tz)).length;
  const prerequisitesByGrade = roster => new Map([...new Set(roster.map(t => t.gradeKey))]
    .map(grade => [grade, SignalEngine.prerequisitesFor(grade)]));
  const isSocial = name => Util.norm(name) === Util.norm('מעורבות חברתית');
  const failingSubject = s => s.avg != null && !SignalEngine.isPassingScore(s.avg, { social: isSocial(s.name) });
  const riskSubject = s => failingSubject(s) || s.missed.size > 0;
  const hasEventData = ev => ev && (ev.score != null || String(ev.scoreRaw || '').trim() !== '');

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
      Config.withRulesForGrade(row.t.gradeKey, () => {
        const borderline = Number(Config.rules().borderlineMin);
        row.subjects.forEach(subject => {
          if (!failingSubject(subject)) return;
          add(pedagogical, 'sadin.fail', row.t.tz);
          if (Number.isFinite(borderline) && subject.avg >= borderline) add(pedagogical, 'sadin.borderline', row.t.tz);
        });
      });
      if (signal.pedagogical.some(f => f.id === 'sadin.missed_event') &&
          [...row.subjects.values()].some(s => confirmedMissed(s, signal.prereqs.hasGroups, row.t.tz)))
        add(pedagogical, 'sadin.missed_event', row.t.tz);
      signal.dataQuality.filter(f => f.id === 'data.sadin_not_enrolled').forEach(f => add(quality, f.id, row.t.tz));
    });
    const unmatched = GroupAnalyzer.unmatchedIds().filter(item => item.sources.includes('סדין ציונים'));
    unmatched.forEach(item => add(quality, 'data.not_in_roster', item.tz));
    const badges = map => [...map].map(([id, ids]) =>     UI.signalBadge(id, `${SignalEngine.CATALOG[id].label}: ${ids.size} חניכים`)).join(' ');
    const incompleteGroups = [...prereqs.values()].some(p => !p.hasGroups);
    return `<div class="w-full space-y-2 mt-2" aria-label="דגלי ציונים ואיכות נתונים">
      ${missing.length ? `<div class="flex flex-wrap gap-1">${missing.join(' ')}</div>` : ''}
      ${incompleteGroups ? '<p class="text-xs text-slate-500">אירועים ללא שורה דורשים אימות שיבוץ; המסננים כוללים גם אירועים שטרם אומתו.</p>' : ''}
      <div class="grid md:grid-cols-2 gap-2">
        <section aria-label="דגלים פדגוגיים"><strong>דגלים פדגוגיים:</strong> ${badges(pedagogical) || '<span class="text-slate-500">לא אותרו בנתונים הזמינים</span>'}
          <div class="text-xs text-slate-500">הדגלים, הציונים והמסננים לפי הכללים הפעילים.</div></section>
        <section aria-label="איכות נתונים"><strong>איכות נתונים:</strong> ${badges(quality) || '<span class="text-slate-500">לא אותרו בנתונים הזמינים</span>'}
          <div class="text-xs text-slate-500">שיבוצים לפי חניכים מוצגים וכל מקצועותיהם; חניכים שאינם במצבת לפי כלל קובץ הסדין.</div></section>
      </div></div>`;
  }

  window.SadinView = {
  earlyWarningRows(roster, filters = {}) {
    return GroupAnalyzer.sadinSheet(roster, filters).map(r => normalizeRow(r, true)).filter(r => {
      const ex = Config.getException(r.t.tz);
      return !(ex.isException && ex.overrideStatus === 'twelve') &&
        Config.withRulesForGrade(r.t.gradeKey, () => [...r.subjects.values()].some(riskSubject));
    });
  },

  sadinMode(el) {
    this.state.sadin.mode = el.dataset.mode;
    if (el.dataset.mode === 'full') this.state.sadin.view = 'sheet';
    this.state.sadin.strip = 'all';
    this.dirty.add('sadin'); this.renderTab('sadin');
  },

  sadinSubjectChange(value) {
    const st = this.state.sadin;
    st.subject = value;
    if (st.subject !== 'all' && st.teacher !== 'all' && !compatible(st.subject, st.teacher)) st.teacher = 'all';
    this.alertOut = [];
    this.dirty.add('sadin'); this.renderTab('sadin');
  },

  sadinTeacherChange(value) {
    const st = this.state.sadin;
    st.teacher = value;
    if (st.teacher !== 'all' && st.subject !== 'all' && !compatible(st.subject, st.teacher)) st.subject = 'all';
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

  renderSadinPanel() {
    this.renderFreshnessBar('sadin');
    const st = this.state.sadin;
    const early = st.mode !== 'full';
    let modeBox = $('sadin-mode');
    if (!modeBox) {
      modeBox = document.createElement('div');
      modeBox.id = 'sadin-mode';
      modeBox.className = 'flex flex-wrap gap-2 mb-2';
      $('sadin-table').insertAdjacentElement('beforebegin', modeBox);
    }
    modeBox.innerHTML = `<button type="button" class="btn ${early ? 'btn-primary' : 'btn-ghost'} btn-sm" data-act="sadinMode" data-mode="early" aria-pressed="${early}">התראה מקדימה</button>
      <button type="button" class="btn ${early ? 'btn-ghost' : 'btn-primary'} btn-sm" data-act="sadinMode" data-mode="full" aria-pressed="${!early}">סדין מלא</button>`;
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
    $('sadin-table').className = !early && st.view === 'sheet' ? 'card overflow-hidden min-w-0' : 'tbl-wrap sticky-scroll';
    document.querySelectorAll('[data-sview]').forEach(b => {
      b.classList.toggle('hidden', early);
      b.setAttribute('aria-pressed', String(!early && b.dataset.sview === st.view));
    });
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
      setHtml('sadin-table', `<div class="p-8 text-center text-slate-500">${UI.signalBadge('sadin.unknown')}<p>לא נטען קובץ ציונים שוטפים. אפשר לטעון אותו בכפתור שבראש הפאנל.</p></div>`);
      return;
    }
    const roster = this.filtered();
    let all = early ? SadinView.earlyWarningRows(roster, st) : GroupAnalyzer.sadinSheet(roster, st);
    if (!early && st.view === 'sheet' && (st.subject !== 'all' || st.teacher !== 'all')) {
      const included = new Set(all.map(r => r.t.tz));
      GroupAnalyzer.sadinSheet(roster.filter(t => !included.has(t.tz))).forEach(r => {
        all.push({ ...r, subjects: new Map(), failing: 0, missed: 0 });
      });
    }
    if (!early) all = all.map(r => normalizeRow(r, false));
    const risks = r => Config.withRulesForGrade(r.t.gradeKey, () => [...r.subjects.values()].filter(riskSubject));
    const filters = [
      ['all', early ? 'כל החניכים לטיפול' : 'כל החניכים', all.length],
      ['fail', 'עם נכשל שוטף', all.filter(r => r.failing > 0).length],
      ['multiple', '2+ מקצועות בסיכון (שלילי/חסר)', all.filter(r => risks(r).length >= 2).length],
      ['missed', 'אירועים שהוחמצו', all.filter(r => r.missed > 0).length]
    ];
    setHtml('sadinFilterSelect', filters.map(([key, label, count]) => option(key, `${label} (${count})`, st.strip)).join(''));
    const selectedFilter = filters.find(([key]) => key === st.strip);
    const rows = all.filter(r => st.strip === 'all' || (st.strip === 'fail' && r.failing > 0) || (st.strip === 'multiple' && risks(r).length >= 2) || (st.strip === 'missed' && r.missed > 0));
    const summary = this.sadinSummary(rows);
    summary.cleanCount = rows.filter(r => r.overall != null && !risks(r).length).length;
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

  /** ציון כטקסט שטוח בשורה אחת, בלי רקע או מסגרת: אדום כהה לנכשל/חסר/מסומן, אפור-כהה לעובר */
  sadinScore(value, missed = false, social = false) {
    const text = value == null ? (missed ? 'חסר' : '—') : Util.fmt(value, 0);
    const alert = missed || (value != null && !SignalEngine.isPassingScore(value, { social }));
    return `<span class="sadin-score ${alert ? 'is-bad' : value == null ? 'is-empty' : ''}">${text}</span>`;
  },

  sadinTip(subject, hasGroups = true, tz) {
    const exact = v => v == null ? '—' : String(v);
    const lines = [`${subject.name} · ממוצע מקצוע ${exact(subject.avg)} · ${subject.events.length} אירועים`];
    subject.entries.forEach(e => {
      lines.push(`${e.displaySubject || e.subject} • ${e.teacher || 'ללא מורה'}${e.groupId ? ` [${e.groupId}]` : ''} · ממוצע ${exact(e.avg)}`);
      e.events.forEach(ev => lines.push(`${ev.eventName || 'אירוע'}${ev.date ? ` · ${ev.date}` : ''}: ${ev.score != null ? exact(ev.score) : (ev.scoreRaw || 'חסר')} (משקל ${ev.weight})`));
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
      const findings = Config.withRulesForGrade(r.t.gradeKey, () => [...r.subjects.values()].filter(riskSubject).map(s => {
        const missed = confirmedMissed(s, p.hasGroups, r.t.tz), uncertain = s.missed.size - missed;
        const parts = [];
        if (failingSubject(s)) parts.push(`ממוצע שוטף ${Util.fmt(s.avg, 1)} — נכשל`);
        if (missed) parts.push(`${missed} אירועי הערכה שהוחמצו`);
        if (uncertain) parts.push(`${uncertain} אירועים לא ניתנים לאימות ללא שיבוץ מאומת`);
        return `<div><strong>${E(s.name)}:</strong> ${E(parts.join(' · '))}</div>`;
      }).join(''));
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
    const DEFAULT_W = { name: 155, homeroom: 105, avg: 82, negatives: 118 };
    const widthOf = key => this.state.sadinColWidths[key] || DEFAULT_W[key] || 82;
    const wStyle = key => `width:${widthOf(key)}px;min-width:${widthOf(key)}px;max-width:${widthOf(key)}px`;
    const body = rowsSorted.map(r => {
      const readiness = prereqs.get(r.t.gradeKey);
      const score = (value, missed, social) => Config.withRulesForGrade(r.t.gradeKey, () => this.sadinScore(value, missed, social));
      const hasSocial = Store.currentOf(r.t.tz).some(e => e.avg != null && isSocial(e.subject));
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
          const eventTip = `${col.name} · ${col.event.eventName || 'אירוע'}${col.event.date ? ` · ${col.event.date}` : ''} · משקל ${col.event.weight} · ${val != null ? String(val) : text || (missed ? 'חסר' : uncertain ? 'לא ניתן לקבוע ללא שיבוץ מאומת' : '—')}`;
          return `<td class="sx-s" style="${sty}" title="${E(eventTip)}">${val != null || missed ? score(val, missed, isSocial(col.name)) : text ? E(text) : '<span class="text-slate-300">—</span>'}</td>`;
        }
        return `<td class="sx-s" style="${sty}"><button type="button" class="w-full text-center" data-act="sadinPop" data-tip="${E(this.sadinTip(s, readiness.hasGroups, r.t.tz))}" aria-label="${E(`${col.name}: ממוצע ${Util.fmt(s.avg, 1)}. הצגת פירוט`)}">${score(s.avg, confirmedMissed(s, readiness.hasGroups, r.t.tz) > 0, isSocial(col.name))}</button></td>`;
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
      return `<tr><td class="sx-name" style="${wStyle('name')}"><button type="button" class="font-bold text-indigo-700 hover:text-indigo-900 hover:underline cursor-pointer" data-act="openProfile" data-tz="${E(r.t.tz)}" title="${E(r.t.name)} · ת.ז ${E(r.t.tz)}">${E(r.t.name)}</button></td>
        <td class="sx-room" style="${wStyle('homeroom')}">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</td>
        <td class="sx-avg font-bold" style="${wStyle('avg')}" title="${E(`ממוצע שווה-משקל של ממוצעי המקצועות: ${r.overall == null ? '—' : String(r.overall)}${hasSocial ? ' · כולל מעורבות חברתית בסולם שונה' : ''}`)}">${overall}</td>
        <td class="sx-neg" style="${wStyle('negatives')}" title="${E(`${r.failing} נכשלים · ${missed} חסרים${uncertain ? ` · ${uncertain} ללא שיבוץ מאומת` : ''}`)}">${negBadges}</td>${cells}</tr>`;
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
    const prereqs = prerequisitesByGrade(rows.map(r => r.t));
    /* חניך וכיתה מוצגים פעם אחת לכל חניך (rowspan על כל מקצועותיו); השורה האחרונה של כל חניך נושאת קו תחתון חזק לסימון הקבוצה */
    const body = rows.filter(r => r.subjects.size).map(r => [...r.subjects.values()].map((s, i, all) => {
        const hasGroups = prereqs.get(r.t.gradeKey).hasGroups;
        const teacher = [...new Set(s.entries.map(e => e.teacher).filter(Boolean))].join(', ');
        const n = Store.weightedAverage(s.events).n;
        const last = i === all.length - 1;
        const end = last ? ' student-end' : '';
        const who = i === 0
          ? `<td rowspan="${all.length}" class="fx-name student-end"><button type="button" class="font-semibold text-indigo-700 hover:text-indigo-900 hover:underline cursor-pointer" data-act="openProfile" data-tz="${E(r.t.tz)}" title="ת.ז ${E(r.t.tz)}">${E(r.t.name)}</button></td><td rowspan="${all.length}" class="fx-room student-end">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.t.tz)}</td>`
          : '';
        return `<tr>${who}
          <td class="fx-subj${end}">${E(s.name)}</td><td class="fx-teacher${end}" title="${E(teacher)}">${E(teacher || '—')}</td><td class="fx-n${end}">${n}</td><td class="fx-avg${end}"><button type="button" data-act="sadinPop" data-tip="${E(this.sadinTip(s, hasGroups, r.t.tz))}" aria-label="${E(`${s.name}: הצגת פירוט הציונים`)}">${Config.withRulesForGrade(r.t.gradeKey, () => this.sadinScore(s.avg, confirmedMissed(s, hasGroups, r.t.tz) > 0, isSocial(s.name)))}</button></td></tr>`;
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
    const by = this.state.sadin.alertBy === 'class' ? 'homeroom' : this.state.sadin.alertBy;
    const roster = this.filtered();
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
    const sheet = GroupAnalyzer.sadinSheet(ready, st).map(r => normalizeRow(r, true));
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
          const teacher = (Store.groups.get(e.groupId) || {}).teacher || e.teacher || 'ללא מורה';
          bucket(teacher).events.push(...e.events);
        });
        s.missed.forEach(m => {
          if (!enrolled.has(String(m.groupId))) return;
          const teacher = (Store.groups.get(m.groupId) || {}).teacher || m.teacher || 'ללא מורה';
          bucket(teacher).missed.set(m.key, m);
        });
        teachers.forEach((items, teacher) => {
          const avg = Store.weightedAverage(items.events).avg;
          const severe = avg != null && Number.isFinite(threshold) && avg < threshold &&
            !SignalEngine.isPassingScore(avg, { social: isSocial(s.name) });
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
    const KIND = { 'no-row': 'אין שורה', empty: 'ללא ציון', zero: 'ציון 0' };
    const rows = res.missed.slice(0, 1000).map(m => {
      const t = Store.trainees.get(m.tz);
      const uncertain = !confirmedEvent(m, prereqs.get(t.gradeKey).hasGroups, t.tz);
      return `<tr class="cursor-pointer" data-act="openProfile" data-tz="${E(m.tz)}"><td class="font-medium whitespace-nowrap">${E(t.name)}</td><td>${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)}</td>
        <td>${E(m.subject)}</td><td>${E(m.teacher)}</td><td>${E(m.eventName)} (${m.weight})</td><td>${E(m.date || '—')}</td><td>${uncertain ? UI.signalBadge('placement.unknown', 'לא ניתן לקבוע ללא שיבוץ מאומת') : `<span class="badge tier-3">${KIND[m.kind]}</span>`}</td></tr>`;
    }).join('');
    const incomplete = [...prereqs].filter(([, p]) => !p.hasSadin || !p.hasGroups).map(([grade]) => grade);
    this.openModal(`
      <div class="flex items-center justify-between mb-2"><h3 class="text-lg font-semibold">אירועי הערכה שהוחמצו (${res.missed.length})</h3><button type="button" class="btn btn-ghost" data-act="closeModal">סגירה</button></div>
      <p class="text-xs text-slate-400 mb-3">חניכים עם ציון חסר או 0 באירוע שרוב חברי הקבוצה שלהם קיבלו בו ציון.</p>
      ${incomplete.length ? `<p class="text-sm text-slate-500 mb-3">לא ניתן לקבוע תמונה מלאה ללא סדין וקבוצות לשכבות ${E(incomplete.map(Util.gl).join(', '))}.</p>` : ''}
      <div class="tbl-wrap" style="max-height:480px"><table class="grid"><thead><tr><th>חניך</th><th>כיתה</th><th>מקצוע</th><th>מורה</th><th>אירוע (משקל)</th><th>תאריך</th><th>ממצא</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="text-center ${incomplete.length ? 'text-slate-500' : 'text-emerald-600'} py-6">${incomplete.length ? 'אין ממצאים בנתונים הזמינים' : 'לא זוהו אירועים שהוחמצו 🎉'}</td></tr>`}</tbody></table></div>`, true);
  },
  };
})();
