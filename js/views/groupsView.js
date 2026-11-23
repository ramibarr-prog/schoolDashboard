(function () {
  'use strict';
  const E = Util.esc;
  const $ = id => document.getElementById(id);
  const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };
  const treatedByApp = new WeakMap();

  function signalSummary(list, outside, opts) {
    const all = SignalEngine.computeAll(opts), details = [];
    list.forEach(t => {
      const signal = all.byTz.get(t.tz);
      const data = signal.dataQuality.filter(f => f.id === 'data.sadin_not_enrolled');
      if (data.length) details.push(`<li><button type="button" class="underline" data-act="openProfile" data-tz="${E(t.tz)}">${E(t.name)}</button> · ${E(data.map(f => f.detail || f.label).join(' · '))}</li>`);
    });
    const unmatched = outside.unmatchedList || [];
    if (!details.length && !unmatched.length) return '';
    return `<details class="p-3 text-sm text-slate-600" aria-label="איכות נתוני שיבוץ">
      <summary class="font-semibold">איכות נתונים: ${details.length} חניכים עם ציונים ללא שיבוץ · ${unmatched.length} חניכים מחוץ למצבת בכלל הקבצים</summary>
      ${details.length ? `<ul class="mt-1 text-xs space-y-1">${details.join('')}</ul>` : ''}
      ${unmatched.length ? `<ul class="mt-1 text-xs space-y-1">${unmatched.map(u => `<li><span class="tz-col">${E(u.tz)}</span> ${E(u.name || '—')} · ${E(u.sources.join(' • '))}</li>`).join('')}</ul>` : ''}
      </details>`;
  }

  window.GroupsView = {
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

  groupSubjectChange(value) {
    const st = this.state.groups;
    st.subjectKey = value;
    st.strip = 'all';
    st.missingSelected = false;
    if (value !== 'all' && st.teacher !== 'all' && !GroupAnalyzer.explorerModel().groups.some(g => g.teacher === st.teacher && g.cat.key === value)) st.teacher = 'all';
    this.groupsRerender();
  },

  groupTeacherChange(value) {
    const st = this.state.groups;
    st.teacher = value;
    if (st.teacher !== 'all') { st.subjectKey = 'all'; st.strip = 'all'; st.missingSelected = false; }
    this.groupsRerender();
  },

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

  toggleRoutine() {
    this.state.showRoutineDuplicates = !this.state.showRoutineDuplicates;
    this.dirty.add('groups');
    this.renderTab('groups');
    const btn = document.querySelector('#groups-mode-extra [data-act="toggleRoutine"]');
    if (btn) btn.focus();
  },

  inspectOpenGroup(el) { this.closeModal(); this.selectGroup(el.dataset.id); },
  studentMap(el) {
    const t = Store.trainees.get(el.dataset.tz);
    if (!t) return;
    this.state.selectedSearchTz = t.tz;
    this.state.filters.q = '';
    const search = $('globalSearch');
    if (search) search.value = t.name;
    this.renderSearchChrome();
    this.dirty.add('groups');
    this.renderTab('groups');
  },
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

  openBoardProfile(el, filteredTabs) {
    const t = Store.trainees.get(el.dataset.tz);
    if (!t) return;
    const f = this.state.filters;
    if (f.grade !== 'all' && f.grade !== t.gradeKey) f.grade = 'all';
    if (f.cls !== 'all' && f.cls !== t.classKey) f.cls = 'all';
    if (f.track !== 'all' && f.track !== this.trackOf(t)) f.track = 'all';
    if (!this.filtered().some(person => person.tz === t.tz)) f.q = '';
    this.syncFilters();
    filteredTabs.forEach(tab => this.dirty.add(tab));
    this.openProfile(t.tz, el);
  },

  renderGroupsPanel() {
    this.syncGroupLayout();
    this.renderFreshnessBar('groups');
    const st = this.state.groups, explorer = this.state.groupsViewMode === 'explorer';
    const show = (id, on) => { const el = $(id); if (el) el.classList.toggle('hidden', !on); };
    const hideAll = () => ['groups-explorer', 'groups-table', 'groups-kpis', 'groups-strip', 'gctl-explorer', 'groups-mode', 'groups-head'].forEach(id => show(id, false));
    const message = (text, signals = '') => {
      this._explorerView = []; this._boardMissing = [];
      hideAll(); show('groups-table', true); show('groups-mode', true); show('groups-head', true);
      setHtml('groups-table', `<div class="p-8 text-center text-slate-500">${text}</div>${signals}`);
    };
    if (!Store.hasData()) {
      this._explorerView = []; this._boardMissing = [];
      this.noRoster(['groups-kpis', 'groups-master', 'groups-detail', 'groups-mode'], 'groups-table');
      hideAll(); show('groups-table', true); show('groups-student-map', false);
      return;
    }
    /* חניך נעול (נבחר בחיפוש): במקום שני המצבים מוצגת מפת השיבוצים שלו */
    const lockT = this.lockedTrainee();
    show('groups-student-map', !!lockT);
    if (lockT) {
      hideAll();
      $('groups-kpis').classList.remove('grid');
      this._explorerView = []; this._boardMissing = [];
      return this.renderStudentGroupsMap(lockT.tz);
    }
    const list = this.filtered();
    const am = this.placementAnomaliesModel(list);
    const grades = new Set(list.map(t => t.gradeKey));
    if (this.state.filters.grade !== 'all') grades.add(this.state.filters.grade);
    const missingGrades = [...grades].filter(grade => !SignalEngine.prerequisitesFor(grade).hasGroups);
    const incomplete = missingGrades.length > 0 || !Store.loaded.groups;
    this.renderGroupsModeBar();
    if (incomplete) {
      const grades = missingGrades.map(grade => E(Util.gl(grade))).join(', ');
      return message(`לא ניתן לקבוע — חסר קובץ קבוצות${grades ? ` לשכבות ${grades}` : ''}.`,
        signalSummary(list, am.outside, this.state.sim, this.state.showRoutineDuplicates));
    }
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
    const scoped = f.grade !== 'all' || f.cls !== 'all';
    const people = new Set(this.filtered(false).map(t => t.tz));
    let n = 0;
    Store.groups.forEach(g => { if (g.inFile && (!scoped || [...g.members].some(tz => people.has(tz)))) n++; });
    return n;
  },

  /** כפתור משני לסייר הקבוצות, ללא ספירות נוספות. */
  renderGroupsModeBar(anomalies, groups) {
    const box = $('groups-mode');
    if (!box) return;
    const mode = this.state.groupsViewMode;
    const next = mode === 'explorer' ? 'anomalies' : 'explorer';
    const label = mode === 'explorer' ? 'חזרה לשיבוצים לתיקון' : 'סייר קבוצות';
    box.innerHTML = `<div class="gm-row"><div class="flex items-center gap-3"><h2 class="font-bold text-lg text-[#355747]">${mode === 'explorer' ? 'סייר קבוצות' : 'שיבוצים לתיקון'}</h2>
      <button type="button" class="btn btn-ghost btn-sm" data-act="groupsMode" data-mode="${next}">${label}</button></div><div id="groups-mode-extra" class="gm-extra"></div></div>`;
  },

  /** מוקד חריגי שיבוץ: כרטיסי קטגוריה, סינון מקצוע וטבלת חריגים */
  renderAnomalyWorkspace(am) {
    const state = this.state, rows = am.rows;
    if (!['missing', 'missing_major', 'duplicate', 'suspect'].includes(state.anomalyCategoryFilter))
      state.anomalyCategoryFilter = 'missing';
    const cat = state.anomalyCategoryFilter;
    const forCategory = c => rows.filter(r => r.category === c);
    const studentCount = items => new Set(items.map(r => r.tz)).size;
    const categoryRows = forCategory(cat);
    const subjects = [...new Set(categoryRows.map(r => r.subject))].sort(natural);
    if (state.anomalySubject !== 'all' && !subjects.includes(state.anomalySubject)) state.anomalySubject = 'all';
    const subject = state.anomalySubject;
    if (!treatedByApp.has(this)) treatedByApp.set(this, new Map());
    const categories = treatedByApp.get(this);
    if (!categories.has(cat)) categories.set(cat, new Set());
    const treated = categories.get(cat);

    const card = (id, cls, label, explanation) => {
      const items = forCategory(id), n = studentCount(items);
      return `<button type="button" class="an-card ${cls}" data-act="anCat" data-cat="${id}" aria-pressed="${cat === id}" title="${E(explanation)}">
        <span class="top"><span class="t">${label}</span><span><span class="n">${n}</span> חניכים ייחודיים</span></span>
        <span class="s" style="white-space:normal">${items.length} חריגות · ${explanation}</span></button>`;
    };
    setHtml('groups-kpis',
      card('missing', 'an-sage', 'היעדר מקצוע ליבה', 'סף שיבוץ כיתתי (30%): חסר במקצוע שבו לפחות 30% מהכיתה משובצים') +
      card('missing_major', 'an-terra', 'ללא שיבוץ מגמה', 'חניכים ללא קבוצת מגמה') +
      card('duplicate', 'an-mustard', 'כפילות קבוצה במקצוע', 'רשומים ב-2 קבוצות ויותר') +
      card('suspect', 'an-peach', 'חשד לשיבוץ שגוי', 'כולל פערי נתונים מול הסדין'));

    const filteredRows = categoryRows.filter(r => subject === 'all' || r.subject === subject);
    const { anomSort: sortCol, anomDir: sortDir } = state.groups;
    const shown = this.sortAnomalyRows(filteredRows, sortCol, sortDir);
    const byTrainee = new Map();
    shown.forEach(r => {
      if (!byTrainee.has(r.tz)) byTrainee.set(r.tz, []);
      byTrainee.get(r.tz).push(r);
    });
    setHtml('groups-mode-extra', `<p class="text-xs text-slate-600">כל כרטיס סופר חניכים ייחודיים בקטגוריה; חניך יכול להופיע בכמה קטגוריות, ולכן סכומן עשוי לעלות על סך החניכים. סימון כטופל הוא זמני ולכל קטגוריה בנפרד.</p>
      <label class="flex items-center gap-2 text-xs font-semibold text-[#355747]">סינון לפי מקצוע
        <select class="inp" data-chg="anSubject" aria-label="סינון לפי מקצוע"><option value="all">כל המקצועות</option>${subjects.map(s => `<option value="${E(s)}" ${s === subject ? 'selected' : ''}>${E(s)} (${categoryRows.filter(r => r.subject === s).length} חריגות)</option>`).join('')}</select></label>
      <button type="button" class="routine-toggle" data-act="toggleRoutine" aria-pressed="${state.showRoutineDuplicates}" title="כפילות רישום במקצועות שגרתיים היא בדרך כלל תקינה">הצג גם חינוך / מגדר / מפגש בוקר (${am.hiddenRoutineCount} חריגות)</button>`);

    const groupTxt = g => `<span dir="ltr" class="font-semibold">[${E(g.groupId)}]</span> ${E(g.teacher || 'ללא מורה')}`;
    const currentText = r => {
      const current = r.groups.map(groupTxt).join(' · ');
      const sadin = r.sadinGroups.map(g => ` · בסדין: <span dir="ltr">[${E(g.groupId)}]</span>${g.teacher ? ` ${E(g.teacher)}` : ''}`).join('');
      return `${current}${sadin}`;
    };
    const ordered = [...byTrainee.values()];
    const pending = ordered.filter(items => !treated.has(items[0].tz));
    const completed = ordered.filter(items => treated.has(items[0].tz));
    const body = pending.slice(0, 1500).concat(completed).map(items => {
      const r = items[0];
      const bySubject = new Map();
      items.forEach(item => {
        const key = item.category === 'missing_major' ? GroupAnalyzer.MAJOR_KEY : item.subject;
        if (!bySubject.has(key)) bySubject.set(key, []);
        bySubject.get(key).push(item);
      });
      const details = [...bySubject].map(([key, findings]) => {
        const label = findings[0].subject;
        const title = key === GroupAnalyzer.MAJOR_KEY ? 'השוואת מגמות בשכבה' : `השוואת קבוצות במקצוע ${label}`;
        const findingDetails = findings.map(item => {
          const description = item.kind === 'sadin' ? UI.signalBadge('data.sadin_not_enrolled', `איכות נתונים: ${item.kindLabel}`) :
            item.kind === 'outlier' ? '<span class="an-k an-k-suspect">בודד מכיתתו</span>' :
            item.category === 'suspect' ? `<span class="an-k an-k-suspect">${E(item.kindLabel)}</span>` : '';
          return [description, item.isRoutineDuplicate ? '<span class="routine-tag">מקצוע מערכתי</span>' : '', currentText(item)].filter(Boolean).join(' ');
        }).filter(Boolean).join(' · ');
        return `<span class="inline-block align-top max-w-full ml-3 mb-1 text-xs">
          <button type="button" class="font-semibold text-[#355747] underline text-right" data-act="inspectGroups" data-tz="${E(r.tz)}" data-subject="${E(key)}" title="${E(title)}" aria-label="${E(`${title} עבור ${r.t.name}`)}">${E(label)}</button>${findingDetails ? `: <span class="text-slate-600">${findingDetails}</span>` : ''}
          </span>`;
      }).join('');
      return `<tr>
        <td class="text-right"><button type="button" class="font-semibold text-[#355747] hover:underline text-right" data-act="openProfile" data-tz="${E(r.tz)}" title="ת.ז ${E(r.tz)}">${E(r.t.name)}</button></td>
        <td class="text-right whitespace-nowrap">${E(Config.classLabel(r.t.classKey))}${this.overrideBadge(r.tz)}</td>
        <td class="text-right">${details}</td>
        <td class="text-right whitespace-nowrap">${items.length} חריגות</td>
        <td class="text-right"><button type="button" class="text-xs text-[#75977D] underline" data-act="studentMap" data-tz="${E(r.tz)}">מפת חניך</button>
          <button type="button" class="text-xs text-[#355747] underline" data-groups-treated="${E(r.tz)}" aria-pressed="${treated.has(r.tz)}">${treated.has(r.tz) ? 'בטל סימון - החזר לסדר רגיל' : 'סמן כטופל - הורד לסוף הרשימה'}</button></td></tr>`;
    }).join('');
    const th = (col, label) => {
      const active = sortCol === col;
      return `<th class="text-right cursor-pointer select-none" aria-sort="${active ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="font-semibold cursor-pointer select-none" data-act="grpAnomSort" data-col="${col}" title="מיון לפי ${E(label)}">${E(label)}<span class="${active ? '' : 'opacity-40'}" aria-hidden="true"> ${active ? (sortDir > 0 ? '▲' : '▼') : '⇅'}</span></button></th>`;
    };
    const sortFinding = (col, label) => {
      const active = sortCol === col;
      return `<button type="button" class="underline" data-act="grpAnomSort" data-col="${col}" aria-pressed="${active}" title="מיון לפי הממצא הראשון של החניך">${label}${active ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</button>`;
    };
    const signals = signalSummary(this.filtered(), am.outside, this.state.sim, state.showRoutineDuplicates);
    const filteredSummary = `<div class="px-4 py-2 text-sm text-slate-600">${byTrainee.size} חניכים · ${shown.length} חריגות${pending.length > 1500 ? ' · מוצגים 1500 חניכים לא מסומנים ראשונים וכל המסומנים' : ''}</div>`;
    setHtml('groups-table', `${filteredSummary}
      <table class="grid w-full" aria-label="טבלת חריגי שיבוץ לטיפול"><thead><tr>
        ${th('name', 'שם החניך')}${th('cls', 'כיתת אם')}<th class="text-right">ממצאים ופעולות <span class="text-xs font-normal">· מיון לפי ${sortFinding('subject', 'מקצוע')} / ${sortFinding('kind', 'סוג')} / ${sortFinding('current', 'קבוצה')}</span></th><th class="text-right">מספר חריגות</th><th class="text-right">פעולות</th></tr></thead>
        <tbody>${body || '<tr><td colspan="5" class="text-center text-[#355747] py-8">לא נמצאו חריגות שיבוץ בסינון הנוכחי</td></tr>'}</tbody></table>${signals}`);
    $('groups-table').querySelectorAll('[data-groups-treated]').forEach(button => button.addEventListener('click', () => {
      const tz = button.dataset.groupsTreated;
      if (treated.has(tz)) treated.delete(tz); else treated.add(tz);
      this.dirty.add('groups');
      this.renderTab('groups');
      const next = [...$('groups-table').querySelectorAll('[data-groups-treated]')].find(el => el.dataset.groupsTreated === tz);
      if (next) next.focus();
    }));
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
      const roster = g.members.map(x => `<li class="${x.sameRoom ? 'ti-same' : ''} ${x.self ? 'font-bold' : ''}">${E(x.t.name)} <span class="text-slate-500"><bdi dir="rtl">${E(Config.classLabel(x.t.classKey))}</bdi></span>${x.self ? ' (החניך)' : ''}${x.diag.length ? ` ${x.diag[0].kind === 'sadin-other' ? UI.signalBadge('data.sadin_not_enrolled', x.diag[0].text) : `<span class="an-k an-k-suspect">${E(x.diag[0].text)}</span>`}` : ''}</li>`).join('');
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
    const others = m.otherGrades.length ? `<details class="mt-3"><summary class="cursor-pointer font-semibold text-[#355747]">${m.isMajor ? 'קבוצות מגמה' : 'קבוצות במקצוע'} בשכבות אחרות (${m.otherGrades.length} קבוצות)</summary><div class="space-y-2 mt-2">${m.otherGrades.map(card).join('')}</div></details>` : '';
    this.openModal(`
      <div class="flex items-start justify-between gap-3">
        <h3 class="text-lg font-bold text-[#355747]">בדיקת קבוצות יעד במקצוע: ${E(m.subject)} • עבור ${E(t.name)} (<bdi dir="rtl">${E(room)}</bdi>)</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-act="closeModal" aria-label="סגירה">סגירה</button>
      </div>
      <div class="ti-banner mt-3">${banner}</div>
      <h4 class="font-semibold text-[#355747] mt-4 mb-2">${m.isMajor ? 'קבוצות מגמה' : 'קבוצות'} בשכבת ${E(Util.gl(t.gradeKey))} (${m.sameGrade.length} קבוצות) · ממוין לפי התאמה לכיתת האם</h4>
      <div class="space-y-2">${m.sameGrade.map(card).join('') || `<div class="text-sm text-slate-500">${m.isMajor ? 'לא נמצאו קבוצות מגמה בשכבת החניך' : 'לא נמצאו קבוצות במקצוע זה בשכבת החניך'}</div>`}</div>
      ${others}`, true);
  },

  /** מפת שיבוצים לחניך: שורה לכל מקצוע (ליבה, מגמה ושאר המקצועות שבהם רשום או מקבל ציונים) מול הסדין, עם חיווי בקרה */
  renderStudentGroupsMap(tz) {
    const trainee = Store.trainees.get(tz);
    if (trainee && !SignalEngine.prerequisitesFor(trainee.gradeKey).hasGroups) {
      return setHtml('groups-student-map', `<div class="card p-5">
        <div class="font-bold text-lg">${E(trainee.name)} · ${E(Config.classLabel(trainee.classKey))}</div>
        <div class="mt-2">${UI.signalBadge('placement.unknown')}</div>
        <div class="mt-3 flex flex-wrap gap-2"><button type="button" class="btn btn-ghost" data-act="openProfile" data-tz="${E(tz)}">👤 מעבר לכרטיס 360°</button>
          <button type="button" class="nav-back" data-act="mapBack">← חזרה למוקד חריגי שיבוץ</button></div></div>`);
    }
    const m = GroupAnalyzer.studentPlacementMap(tz);
    if (!m) return setHtml('groups-student-map', '');
    const t = m.t, c = m.counts;
    const dash = '<span class="text-slate-300">—</span>';
    const kpi = (label, value, sub, cls = '') => `<div class="prof-kpi"><div class="k">${label}</div><div class="v ${cls}">${value}</div><div class="s">${sub}</div></div>`;
    const groupBtn = g => `<button type="button" class="font-semibold text-[#355747] hover:underline text-right" data-act="sgOpenGroup" data-id="${E(g.groupId)}" title="פתיחת הקבוצה בסייר הקבוצות">${E(g.subject)} <span dir="ltr">[${E(g.groupId)}]</span>${g.reinforcement ? ' <span class="text-xs text-slate-500">תגבור</span>' : ''}</button>`;
    const dataIssue = issue => issue.text.startsWith('ציונים בסדין');
    const placementCount = m.rows.reduce((n, r) => n + r.issues.filter(i => !dataIssue(i)).length, 0);
    const body = m.rows.map(r => {
      const tag = r.kind === 'core' ? 'ליבה' : r.kind === 'major' ? 'מגמה' : '';
      const groups = r.enrolled.filter(g => g.inFile);
      const enrolled = groups.length ? groups.map(g => `<div>${groupBtn(g)}</div>`).join('') : '<span class="text-slate-500">ללא שיבוץ</span>';
      const teachers = groups.length ? groups.map(g => `<div>${E(g.teacher || 'ללא מורה')}</div>`).join('') : dash;
      const sadin = r.sadin.length ? r.sadin.map(s => `<div class="${s.mismatch ? 'text-slate-600 font-semibold' : ''}">${s.groupId ? `<button type="button" class="hover:underline" data-act="sgOpenGroup" data-id="${E(s.groupId)}"><span dir="ltr">[${E(s.groupId)}]</span> ${E(s.teacher || 'ללא מורה')}</button>` : E(s.teacher || 'ללא קבוצה')}${s.avg != null ? ` <span class="text-slate-500 font-normal">· ממוצע ${Util.fmt(s.avg, 0)}</span>` : ''}</div>`).join('') : dash;
      const status = r.issues.length ? r.issues.map(i => dataIssue(i) ? `<div>${UI.signalBadge('data.sadin_not_enrolled', i.text)}</div>` : `<div class="text-xs font-semibold ${i.level === 'severe' ? 'txt-bad' : 'txt-warn'}">${E(i.text)}</div>`).join('')
        : groups.length ? '<span class="txt-ok font-semibold">✓ תקין</span>' : dash;
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
            ${kpi('חריגות שיבוץ', placementCount, placementCount ? 'לבדיקה בטבלה' : 'אין חריגות', placementCount ? 'txt-bad' : 'txt-ok')}
          </div>
          <div class="mr-auto flex flex-wrap gap-2">
            <button type="button" class="btn btn-ghost" data-act="openProfile" data-tz="${E(t.tz)}">👤 מעבר לכרטיס 360°</button>
            <button type="button" class="nav-back" data-act="mapBack">← חזרה למוקד חריגי שיבוץ</button>
          </div>
        </div>
      </div>
      ${signalSummary([t], { unmatchedList: [] }, this.state.sim, this.state.showRoutineDuplicates)}
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
    const scoped = !!lockT || f.grade !== 'all' || f.cls !== 'all';
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
      pill('all', 'gstat-ok', '🟢 הכל / משובצים תקין', `${h.ok} מתוך ${h.total} חניכים`),
      pill('missing', 'gstat-bad', `לא משובצים כלל ל${cat.label}`, `${h.missing.length} חניכים`),
      pill('dup', 'gstat-violet', `🔀 רשומים ל-2 קבוצות ב${cat.label}`, `${h.dup.length} חניכים`),
      pill('stray', 'gstat-amber', `חריגי שכבה/כיתה ב${cat.label}`, `${h.stray.length} שיבוצים · ${new Set(h.stray.map(x => x.t.tz)).size} חניכים`)
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
      <span class="block text-[11px] leading-4 mt-1 truncate ${muted}">${g.classes.length ? `הרכב: ${this.compositionText(g)}` : 'אין חניכים רשומים'}${g.anomalyCount ? ` · ${g.anomalyCount} חניכים עם ממצאים` : ''}</span></button>`;
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
      const tint = hit(t) ? 'bg-yellow-100' : m.diag.some(d => d.kind !== 'sadin-other') ? 'an-row' : '';
      const notes = m.diag.map(d => d.kind === 'sadin-other' ? UI.signalBadge('data.sadin_not_enrolled', d.text) : this.flatNote(d.kind === 'outlier' ? 'warn' : 'severe', d.text, d.title)).join('');
      return `<tr class="${tint}"><td class="tz-col">${E(t.tz)}</td><td><button type="button" class="font-semibold text-indigo-800 hover:underline text-right" data-act="openBoardProfile" data-tz="${E(t.tz)}" title="${E(`סדין: ${count} אירועים`)}">${E(t.name)}</button></td>
        <td><bdi dir="rtl">${E(Config.classLabel(t.classKey))}</bdi>${this.overrideBadge(t.tz)}</td><td>${notes || (g ? '<span class="text-emerald-800">✓ תקין</span>' : 'ללא שיבוץ')}</td></tr>`;
    };
    const divider = (text, cls = '') => `<tr class="room-divider ${cls}"><td colspan="4">${text}</td></tr>`;
    const body = byName ? [...members].sort((a, b) => a.t.name.localeCompare(b.t.name, 'he')).map(row).join('') :
      (anomalies.length ? divider(`${anomalies.some(m => m.diag.some(d => d.kind === 'sadin-other')) ? 'ממצאי שיבוץ ואיכות נתונים' : 'חריגי שיבוץ'} בקבוצה זו (${anomalies.length} חניכים)`, 'anomaly-divider') + anomalies.map(row).join('') : '') +
      [...rooms.entries()].map(([key, items]) => divider(`כיתה <bdi dir="rtl">${E(Config.classLabel(key))}</bdi> (${items.length} חניכים)`) + items.map(row).join('')).join('');
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
      <div class="sticky-scroll lg:flex-1 lg:min-h-0 overscroll-contain">${signalSummary(members.map(m => m.t), { unmatchedList: [] }, this.state.sim, this.state.showRoutineDuplicates)}<table class="grid w-full"><thead><tr><th>ת.ז</th><th>שם חניך</th><th>כיתת אם</th><th>חיווי בקרה</th></tr></thead>
      <tbody>${body || '<tr><td colspan="4" class="text-center text-slate-700 py-6">אין חניכים להצגה</td></tr>'}</tbody></table></div></article>`);
  },

  /** ממצא שטוח: טקסט בלבד בלי רקע, מסגרת או ריפוד; חמור בבורדו, בינוני בענבר. כל ממצא בשורה משלו */
  flatNote(level, text, title = '') {
    return `<span class="block text-xs font-medium ${level === 'severe' ? 'text-rose-900' : 'text-amber-800'}"${title ? ` title="${E(title)}"` : ''}>${E(text)}</span>`;
  },

  };
})();
