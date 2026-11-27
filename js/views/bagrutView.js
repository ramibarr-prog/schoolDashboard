(function () {
  'use strict';
  const E = Util.esc;
  const $ = id => document.getElementById(id);
  const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };
  const natural = (a, b) => String(a).localeCompare(String(b), 'he', { numeric: true });
  const isUnknown = signal => signal.pedagogical.some(f => f.id === 'bagrut.unknown');
  const noBagrutData = (signal, sim) =>
    !signal.prereqs.hasBagrut && !(sim.useCurrent && signal.prereqs.hasSadin);

  const finalOptions = { fullMode: true, useCurrent: false, ignoreInternals: false, plus5: false };
  const scienceHint = '<small class="bagrut-internal-hint">(ניתן לקבל פטור אם יש 2 מגמות מדעיות)</small>';

  function internalStatus(item, ev, noData) {
    if (noData) return 'לא ידוע';
    if (item.exempt) return 'פטור';
    if (item.done) return 'עובר';
    if (item.explicitFail || typeof item.value === 'number' ||
        ev.blockers.some(b => b.gate === 3 && b.k === 'bagrut-block' && b.text.includes(item.name))) return 'נכשל';
    return 'חסר';
  }

  function renderInternalDetails(ev, noData) {
    const items = ev.internals.map(item => ({ ...item, status: internalStatus(item, ev, noData) }));
    const adaptive = ev.rank < 12 && ev.adaptive;
    const due = adaptive ? items.filter(item => item.required) : items;
    const passed = due.filter(item => item.status === 'עובר' || item.status === 'פטור').length;
    const ok = passed === due.length;
    const ignored = !noData && items.some(item => item.ignored);
    const summary = noData || !items.length ? 'לא ניתן לקבוע' :
      ignored ? 'עובר (סימולציה)' :
      adaptive ? (ok ? 'תקין לשלב בשנה' : 'חסר / נכשל') :
        `${ok ? 'עובר' : 'חסר / נכשל'} (${passed}/${due.length})`;
    const statusClass = noData || !items.length ? 'neutral' : (ok || ignored) ? 'pass' : 'bad';
    const rows = items.map(item => {
      const state = item.status === 'עובר' || item.status === 'פטור' ? 'pass' : item.status === 'לא ידוע' ? 'neutral' : 'bad';
      const value = typeof item.value === 'number' ? Util.fmt(item.value, 1) :
        item.value === 'pass' ? 'עבר' : item.value === 'fail' ? 'נכשל' : '—';
      return `<li><span><strong>${E(item.name)}</strong>${!noData && adaptive && !item.required && !item.done && !item.exempt ? ' <small class="bagrut-internal-hint">(טרם נדרש לשלב בשנה)</small>' : ''}${item.id === 'science' && (item.status === 'נכשל' || item.status === 'חסר') ? ` ${scienceHint}` : ''}</span>
        <span class="bagrut-internal-result"><span>ציון: <bdi>${E(value)}</bdi></span><span class="bagrut-subject-status is-${state}">${E(item.status)}</span></span></li>`;
    }).join('');
    return `<details class="bagrut-internal-details"><summary><span>מקצועות פנימיים (שער 3)</span> <span class="bagrut-subject-status is-${statusClass}">${E(summary)}</span></summary>
      ${items.length ? `<ul>${rows}</ul>` : '<p>אין מקצועות פנימיים מוגדרים.</p>'}
      ${items.some(item => item.ignored) ? '<p>הבדיקה מתעלמת מהיחידות הפנימיות; מוצגים הציונים בפועל.</p>' : ''}
    </details>`;
  }

  const PINS_KEY = 'schoolDashboard.bagrut.pins.v1';
  const DEFERRED_KEY = 'sd.bagrut.deferred.v1';
  const WIDTHS_KEY = 'schoolDashboard.bagrut.colWidths.v1';
  const WORK_SPLIT_KEY = 'schoolDashboard.bagrut.workSplit.v1';
  const WORK_SPLIT_DEFAULT = 42, WORK_SPLIT_MIN = 24, WORK_SPLIT_MAX = 72;
  const WORK_COLUMNS = {
    list: [['name', 'חניך', 150], ['class', 'כיתה', 85], ['issues', 'מה חוסם או דורש בדיקה', 240], ['order', 'סדר ברשימה', 135]],
    subjects: [['subject', 'מקצוע', 140], ['exams', 'תוצאות שאלונים', 180], ['status', 'סטטוס נוכחי', 135], ['target', 'ציון נדרש ב-30%', 165], ['details', 'פרטי חישוב', 110]]
  };
  let pinsCache = null;
  let deferredCache = null;
  let widthsCache = null;
  let workSplitCache = null;
  function loadWorkSplit() {
    if (workSplitCache !== null) return workSplitCache;
    workSplitCache = WORK_SPLIT_DEFAULT;
    try {
      const saved = window.localStorage.getItem(WORK_SPLIT_KEY);
      if (saved !== null) {
        const value = JSON.parse(saved);
        if (!Number.isFinite(value) || value < WORK_SPLIT_MIN || value > WORK_SPLIT_MAX) throw new Error('רוחב החלוקה אינו תקין');
        workSplitCache = value;
      }
    } catch (e) { console.error('טעינת רוחב חלוקת הזכאות נכשלה', e); }
    return workSplitCache;
  }
  function saveWorkSplit() {
    try { window.localStorage.setItem(WORK_SPLIT_KEY, JSON.stringify(loadWorkSplit())); }
    catch (e) { console.error('שמירת רוחב חלוקת הזכאות נכשלה', e); }
  }
  function setWorkSplit(layout, value) {
    workSplitCache = Math.max(WORK_SPLIT_MIN, Math.min(WORK_SPLIT_MAX, value));
    layout.style.setProperty('--bagrut-work-split', `${workSplitCache}%`);
    layout.querySelector('.bagrut-work-splitter').setAttribute('aria-valuenow', String(workSplitCache));
  }
  function loadWorkWidths() {
    if (widthsCache) return widthsCache;
    widthsCache = { list: {}, subjects: {} };
    try {
      const saved = JSON.parse(window.localStorage.getItem(WIDTHS_KEY) || '{}');
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('רוחבי העמודות אינם תקינים');
      Object.keys(WORK_COLUMNS).forEach(kind => {
        const group = saved[kind];
        if (group == null) return;
        if (typeof group !== 'object' || Array.isArray(group)) throw new Error(`רוחבי עמודות ${kind} אינם תקינים`);
        WORK_COLUMNS[kind].forEach(([key]) => {
          if (group[key] == null) return;
          if (!Number.isFinite(group[key]) || group[key] <= 0) throw new Error(`רוחב עמודה ${key} אינו תקין`);
          widthsCache[kind][key] = group[key];
        });
      });
    } catch (e) {
      console.error('טעינת רוחבי עמודות הזכאות נכשלה', e);
      widthsCache = { list: {}, subjects: {} };
    }
    return widthsCache;
  }
  function saveWorkWidths() {
    try { window.localStorage.setItem(WIDTHS_KEY, JSON.stringify(loadWorkWidths())); }
    catch (e) { console.error('שמירת רוחבי עמודות הזכאות נכשלה', e); }
  }
  function workColumns(kind) {
    const saved = loadWorkWidths()[kind];
    const customized = Object.keys(saved).length > 0;
    const columns = WORK_COLUMNS[kind].map(([key, label, defaultWidth]) => ({ key, label, width: saved[key] || defaultWidth }));
    const width = columns.reduce((sum, c) => sum + c.width, 0);
    return {
      width: customized ? `${width}px` : '100%',
      cols: columns.map(c => `<col style="width:${customized ? `${c.width}px` : `${c.width / width * 100}%`}">`).join(''),
      headers: columns.map(c => `<th scope="col" data-ck="${c.key}"><span class="bagrut-col-label">${E(c.label)}</span><span class="col-resizer" aria-hidden="true" title="גרור לשינוי רוחב עמודה (לחיצה כפולה לאיפוס רוחבי הטבלה)"></span></th>`).join('')
    };
  }
  function lockWorkColWidths(table) {
    const kind = table.dataset.widthGroup, widths = loadWorkWidths()[kind];
    const cols = table.querySelectorAll('colgroup col');
    const headers = table.querySelectorAll('thead th');
    headers.forEach((th, index) => {
      const width = th.getBoundingClientRect().width;
      cols[index].style.width = `${width}px`;
      widths[th.dataset.ck] = width;
    });
    table.style.width = `${[...cols].reduce((sum, col) => sum + parseFloat(col.style.width), 0)}px`;
  }
  function setWorkColWidth(table, index, key, width) {
    const kind = table.dataset.widthGroup, widths = loadWorkWidths();
    if (!WORK_COLUMNS[kind] || !WORK_COLUMNS[kind].some(c => c[0] === key)) throw new Error('עמודת זכאות לא מוכרת');
    const cols = table.querySelectorAll('colgroup col');
    const otherWidth = [...cols].reduce((sum, col, i) => sum + (i === index ? 0 : parseFloat(col.style.width)), 0);
    const container = table.parentElement, style = getComputedStyle(container);
    const containerWidth = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    // Shrinking below the container width would redistribute space to the other columns.
    const w = Math.max(56, containerWidth - otherWidth, width);
    if (cols[index]) cols[index].style.width = `${w}px`;
    table.style.width = `${[...cols].reduce((sum, c) => sum + parseFloat(c.style.width), 0)}px`;
    widths[kind][key] = w;
  }
  const resizeHandle = e => e.target.closest && e.target.closest('#bagrut-table table[data-width-group] .col-resizer');
  document.addEventListener('mousedown', e => {
    const h = resizeHandle(e);
    if (!h || e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const th = h.closest('th'), table = th.closest('table'), key = th.dataset.ck, index = th.cellIndex;
    const startX = e.clientX, startW = th.getBoundingClientRect().width;
    let dragged = false;
    document.body.classList.add('col-resizing');
    const move = ev => {
      if (!dragged && ev.clientX === startX) return;
      if (!dragged) { lockWorkColWidths(table); dragged = true; }
      setWorkColWidth(table, index, key, startW + (startX - ev.clientX));
    };
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      document.body.classList.remove('col-resizing');
      if (dragged) saveWorkWidths();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, true);
  document.addEventListener('click', e => { if (resizeHandle(e)) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('dblclick', e => {
    const h = resizeHandle(e);
    if (!h) return;
    e.stopPropagation(); e.preventDefault();
    const table = h.closest('table'), kind = table.dataset.widthGroup;
    loadWorkWidths()[kind] = {};
    const columns = workColumns(kind);
    table.style.width = columns.width;
    table.querySelector('colgroup').innerHTML = columns.cols;
    saveWorkWidths();
  }, true);
  const workSplitter = e => e.target.closest && e.target.closest('#bagrut-table .bagrut-work-splitter');
  document.addEventListener('mousedown', e => {
    const handle = workSplitter(e);
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    handle.focus();
    const layout = handle.closest('.bagrut-work-layout');
    let dragged = false;
    handle.classList.add('is-dragging');
    document.body.classList.add('col-resizing');
    const move = ev => {
      const rect = layout.getBoundingClientRect();
      if (!rect.width) return;
      setWorkSplit(layout, (rect.right - ev.clientX) / rect.width * 100);
      dragged = true;
    };
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      handle.classList.remove('is-dragging');
      document.body.classList.remove('col-resizing');
      if (dragged) saveWorkSplit();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, true);
  document.addEventListener('dblclick', e => {
    const handle = workSplitter(e);
    if (!handle) return;
    e.preventDefault();
    setWorkSplit(handle.closest('.bagrut-work-layout'), WORK_SPLIT_DEFAULT);
    saveWorkSplit();
  });
  document.addEventListener('keydown', e => {
    const handle = workSplitter(e);
    if (!handle || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const layout = handle.closest('.bagrut-work-layout'), width = layout.getBoundingClientRect().width;
    const visibleSplit = width ? Math.max(220 / width * 100, Math.min(loadWorkSplit(), (width - 270) / width * 100)) : loadWorkSplit();
    setWorkSplit(layout, visibleSplit + (e.key === 'ArrowLeft' ? 2 : -2));
    saveWorkSplit();
  });
  function loadPins() {
    if (pinsCache) return pinsCache;
    pinsCache = new Set();
    try {
      const saved = JSON.parse(window.localStorage.getItem(PINS_KEY) || '[]');
      if (Array.isArray(saved)) saved.forEach(tz => pinsCache.add(String(tz)));
    } catch (e) { /* אחסון חסום או נתון פגום: ממשיכים בלי סיכות שמורות */ }
    return pinsCache;
  }
  function savePins() {
    try { window.localStorage.setItem(PINS_KEY, JSON.stringify([...loadPins()])); } catch (e) { /* האחסון לא זמין: הסיכות תקפות לסשן הנוכחי */ }
  }
  function loadDeferred() {
    if (deferredCache) return deferredCache;
    try {
      const saved = JSON.parse(window.localStorage.getItem(DEFERRED_KEY) || '[]');
      if (!Array.isArray(saved)) throw new Error('רשימת החניכים שהורדו אינה תקינה');
      deferredCache = new Set(saved.map(String));
      return deferredCache;
    } catch (e) {
      console.error('טעינת חניכים שהורדו נכשלה', e);
      throw e;
    }
  }

  function hideBreakdownTooltip() {
    const tip = $('bg-drawer-tooltip');
    if (tip) tip.remove();
    document.querySelectorAll('#bagrut-table .bg-drawer-required[aria-describedby]').forEach(el => el.removeAttribute('aria-describedby'));
  }

  function describeMxCell(el, add) {
    if (!el) return;
    const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== 'mxPop');
    if (add) ids.push('mxPop');
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  }

  function showBreakdownTooltip(cell) {
    hideBreakdownTooltip();
    const lines = JSON.parse(cell.dataset.breakdownLines);
    const tip = document.createElement('div');
    tip.id = 'bg-drawer-tooltip';
    tip.className = 'bg-drawer-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.innerHTML = `${lines.map(line => `<div>${E(line)}</div>`).join('')}<small>לחיצה על השורה לפירוט מלא</small>`;
    document.body.appendChild(tip);
    cell.setAttribute('aria-describedby', tip.id);
    const r = cell.getBoundingClientRect(), width = tip.offsetWidth, height = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
    tip.style.top = `${r.bottom + height + 8 <= window.innerHeight ? r.bottom + 4 : Math.max(8, r.top - height - 4)}px`;
  }

  function renderBreakdownDrawer(app, list, signals) {
    const tz = app.state.bagrut.drawerTz;
    const row = list.find(r => r.t.tz === tz);
    if (!row) return BagrutView.bagrutDrawerClose.call(app);
    const table = $('bagrut-table'), parent = $('panel-bagrut') || table.parentElement;
    let drawer = $('bagrut-breakdown-drawer');
    if (!drawer) {
      drawer = document.createElement('aside');
      drawer.id = 'bagrut-breakdown-drawer';
      drawer.className = 'bg-drawer';
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-label', 'פירוט זכאות לחניך');
      parent.appendChild(drawer);
    }
    const options = row.t.gradeKey === 'יב' && app.state.bagrut.overviewEntry && app.state.filters.grade === 'all'
      ? finalOptions : app.state.sim;
    const noData = noBagrutData(signals.get(tz), options);
    const breakdown = UI.buildBagrutBreakdown(row.t, row.ev, {
      className: Config.classLabel(row.t.classKey), noData
    });
    const cells = app._bagrutMatrixRows && app._bagrutMatrixRows.get(tz);
    if (!cells) throw new Error('חסרים נתוני שורת הזכאות למגירת החניך');
    const matrixSubjects = cells.map(cell => {
      const subject = row.ev.subjects.find(s => s.id === cell.id);
      const findings = breakdown.subjects.filter(s => cell.id === 'major'
        ? s.name === 'מגמה' || s.name.startsWith('מגמה: ')
        : subject && s.name === subject.name);
      const tags = findings.flatMap(s => s.tags);
      const count = new Set(tags.filter(tag => tag.code).map(tag => tag.code)).size;
      const gaps = [...new Set(tags.filter(tag => !tag.code).map(tag => tag.label))];
      if (count) gaps.push(`${count} ${count === 1 ? 'שאלון' : 'שאלונים'}`);
      if (cell.forecastSecondary) gaps.push(cell.forecastSecondary);
      return { label: cell.label, text: cell.text, state: cell.state, more: cell.more, gap: gaps.join(' · '),
        forecastOnly: cell.forecastOnly };
    });
    drawer.innerHTML = `<button type="button" class="bg-drawer-close" data-act="bagrutDrawerClose" aria-label="סגירת פירוט זכאות">✕</button>${UI.renderBagrutBreakdown(breakdown, { showHeader: true, showPin: true, pinned: loadPins().has(tz), showOpen360: true, matrixSubjects })}`;
    const internalSection = [...drawer.querySelectorAll('.bg-drawer-body > section')]
      .find(section => section.querySelector('h3').textContent === 'חסמים במקצועות פנימיים');
    if (!internalSection) throw new Error('חסר אזור החסמים הפנימיים במגירת הזכאות');
    const science = row.ev.internals.find(item => item.id === 'science');
    if (science && ['חסר', 'נכשל'].includes(internalStatus(science, row.ev, noData))) {
      const tag = [...internalSection.querySelectorAll('.bg-bd-tag')].find(el => el.textContent === science.name);
      if (tag) tag.insertAdjacentHTML('afterend', ` ${scienceHint}`);
    }
    internalSection.insertAdjacentHTML('afterend', renderInternalDetails(row.ev, noData));
    table.querySelectorAll('tr[data-act="bagrutDrawerOpen"]').forEach(el => el.classList.toggle('bg-drawer-row-active', el.dataset.tz === tz));
  }

  document.addEventListener('mouseover', event => {
    const cell = event.target.closest && event.target.closest('#bagrut-table .bg-drawer-required');
    if (cell && !cell.contains(event.relatedTarget)) showBreakdownTooltip(cell);
  });
  document.addEventListener('mouseout', event => {
    const cell = event.target.closest && event.target.closest('#bagrut-table .bg-drawer-required');
    if (cell && !cell.contains(event.relatedTarget)) hideBreakdownTooltip();
  });
  document.addEventListener('focusin', event => {
    const cell = event.target.closest && event.target.closest('#bagrut-table .bg-drawer-required');
    if (cell) showBreakdownTooltip(cell);
  });
  document.addEventListener('focusout', event => {
    if (event.target.closest && event.target.closest('#bagrut-table .bg-drawer-required')) hideBreakdownTooltip();
  });
  document.addEventListener('scroll', hideBreakdownTooltip, true);
  document.addEventListener('click', event => {
    const button = event.target.closest && event.target.closest('#bagrut-table [data-bagrut-subject-details]');
    if (!button) return;
    const row = button.closest('tr'), details = row && row.nextElementSibling;
    if (!details || details.id !== button.getAttribute('aria-controls')) throw new Error('חסרה שורת פירוט למקצוע');
    details.hidden = !details.hidden;
    button.setAttribute('aria-expanded', String(!details.hidden));
  });
  document.addEventListener('click', event => {
    const app = window.App;
    if (!app || app.state.tab !== 'bagrut' || !app.state.bagrut.drawerTz) return;
    const target = event.target;
    if (target.closest && (target.closest('#bagrut-breakdown-drawer') || target.closest('#bagrut-table tr[data-act="bagrutDrawerOpen"]'))) return;
    BagrutView.bagrutDrawerClose.call(app);
  }, true);
  document.addEventListener('keydown', event => {
    const app = window.App;
    if (event.key === 'Escape' && app && app.state.tab === 'bagrut' && app.state.bagrut.drawerTz) {
      BagrutView.bagrutDrawerClose.call(app, true);
      event.preventDefault(); event.stopImmediatePropagation();
      return;
    }
    const row = event.target.closest && event.target.closest('tr[data-act="bagrutDrawerOpen"]');
    if (row && (event.target === row || event.target.classList.contains('bg-drawer-required')) &&
        (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      row.click();
    }
  }, true);

  function signalsFor(rows, sim) {
    const signals = SignalEngine.computeAll(sim).byTz;
    return new Map(rows.map(r => [r.t.tz, signals.get(r.t.tz)]));
  }

  function signalSummary(rows, signals, sim) {
    const quality = rows.filter(({ t }) => signals.get(t.tz).ev.tier !== 5 && signals.get(t.tz).ev.manualReview.required &&
      signals.get(t.tz).dataQuality.some(f => f.id === 'data.manual_review')).length;
    const missing = [...new Set(rows.filter(r => signals.get(r.t.tz).ev.tier !== 5).map(r => r.t.gradeKey))].filter(grade => {
      const p = SignalEngine.prerequisitesFor(grade);
      return !p.hasBagrut && !(sim.useCurrent && p.hasSadin);
    });
    if (!missing.length && !quality) return '';
    const details = [
      missing.length ? `לא ניתן לקבוע — חסר קובץ בגרות לשכבות ${missing.map(Util.gl).join(', ')}` : '',
      quality ? `איכות נתונים: ${quality} חניכים נדרשים לבדיקת רכזת. הבדיקה אינה דגל סיכון פדגוגי.` : ''
    ].filter(Boolean).join(' · ');
    return `<span class="badge gate-warn bagrut-quality" tabindex="0" aria-label="${E(details)}" title="${E(details)}">${quality ? `${quality} לבדיקה` : 'חסר מידע'}</span>`;
  }

  function target30(s, ev, rules, includeDirectTargets = false) {
    const missing = s.unresolved.concat(s.pending);
    const internal = missing.filter(c => c.internal);
    const allInternal = s.comps.filter(c => c.internal);
    const total = s.comps.reduce((n, c) => n + c.weight, 0);
    const internalWeight = internal.reduce((n, c) => n + c.weight, 0);
    const totalInternalWeight = allInternal.reduce((n, c) => n + c.weight, 0);
    if (!total || !internal.length || Math.abs(totalInternalWeight * 100 / total - 30) > 0.000001) return null;
    const r = s.reverse;
    const notes = [];
    if (ev.manual) notes.push('קיימת הכרעה ידנית; היעד אינו משנה אותה');
    if (ev.manualReview.required) notes.push('נדרשת החלטת רכזת');
    let target = 'לא ניתן לקבוע', directTarget = null, compensationTarget = null;
    if (!r || missing.some(c => !c.internal)) {
      notes.push('נדרשים נתונים נוספים או בדיקה של הרכיבים החסרים');
    } else {
      const recordedInternal = allInternal.filter(c => c.state === 'num').reduce((n, c) => n + c.num * c.weight, 0);
      const fullTarget = n => Math.ceil(+((recordedInternal + Math.max(1, n) * internalWeight) / totalInternalWeight).toFixed(6));
      if (r.required30 <= 100) directTarget = fullTarget(r.required30);
      if (r.requiredFor45 <= 100) compensationTarget = fullTarget(r.requiredFor45);
      const canCompensate = !!r.compensationAvailable &&
        r.requiredFor45 <= 100 && r.requiredFor45 < Math.max(1, r.required30);
      if (canCompensate) {
        target = String(fullTarget(r.requiredFor45));
        notes.push(`לקיזוז ${r.compMin}; כפוף לכללי הזכאות ולמכסת הקיזוז`);
        notes.push(r.required30 <= 100 ? `למעבר ללא קיזוז נדרש ${fullTarget(r.required30)} ב-30%` : `מעבר ללא קיזוז אינו אפשרי; מקסימום ${r.max}`);
      } else if (r.required30 <= 100) {
        target = String(fullTarget(r.required30));
        notes.push('למעבר במקצוע ללא קיזוז');
      } else {
        target = 'לא אפשרי';
        notes.push(`גם 100 אינו מספיק; מקסימום במקצוע ${r.max}`);
      }
      if (internalWeight !== totalInternalWeight) {
        const required = canCompensate ? r.requiredFor45 : r.required30;
        if (required <= 100) notes.push(`ברכיב החסר (${r.pct}% ממשקל המקצוע) נדרש ${Math.max(1, required)}`);
      }
      if (allInternal.length > 1) notes.push('היעד הוא ממוצע משוקלל של רכיבי ה-30%');
    }
    const current = s.reportedScore == null ? 'אין ציון מספרי מדווח' :
      `ממוצע הציונים המדווחים ${Util.fmt(s.reportedScore, 1)}; דווחו ${s.reportedPct}% ממשקל המקצוע`;
    return { current, target, note: notes.join(' · '), ...(includeDirectTargets ? { directTarget, compensationTarget } : {}) };
  }

  window.BagrutView = {
  bagrutSubjectChange(value) {
    if (this.state.bagrut.targets) return;
    Object.assign(this.state.bagrut, { drill: value, readinessClass: '', readinessFilter: 'all', targets: false });
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  mxPop(el) {
    if (this._mxPinned === el) return this.hideMxPop();
    this.showMxPop(el, true);
  },

  bagrutMode(el) {
    if (el.disabled || this.state.bagrut.targets) return;
    const fullMode = el.dataset.mode === 'final';
    this.state.bagrut.drillSim = { ...this.state.sim, ...this.state.bagrut.drillSim, fullMode, useCurrent: !fullMode };
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  bagrutSort(el) {
    const st = this.state.bagrut, key = el.dataset.key;
    if (st.sort === key) st.dir *= -1; else { st.sort = key; st.dir = key === 'tier' ? -1 : 1; }
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  bagrutPin(el) {
    if (!this.requireEdit()) return;
    if (el.dataset.defer === 'true') {
      const deferred = loadDeferred(), tz = el.dataset.tz, wasDeferred = deferred.has(tz);
      const next = new Set(deferred);
      if (wasDeferred) next.delete(tz); else next.add(tz);
      try {
        window.localStorage.setItem(DEFERRED_KEY, JSON.stringify([...next]));
      } catch (e) {
        console.error('שמירת חניכים שהורדו נכשלה', e);
        this.toast('לא ניתן לשמור את השינוי בסדר החניכים.', 'error');
        return;
      }
      deferredCache = next;
      if (!wasDeferred && this.state.bagrut.workTz === tz) {
        const ids = this._bagrutWorkIds || [], index = ids.indexOf(tz);
        this.state.bagrut.workTz = ids[index + 1] || ids[index - 1] || '';
      }
      this.dirty.add('bagrut'); this.renderTab('bagrut');
      return;
    }
    const pins = loadPins(), tz = el.dataset.tz;
    if (pins.has(tz)) pins.delete(tz); else pins.add(tz);
    savePins();
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  bagrutDrawerOpen(el) {
    const rows = this.dashRows(), signals = signalsFor(rows, this.state.sim);
    const list = this._bagrutLegacyList || this.bagrutList(rows, signals);
    if (!list.some(r => r.t.tz === el.dataset.tz)) {
      this.toast('החניך אינו זמין בסינון הנוכחי.', 'warn');
      return;
    }
    this.state.bagrut.drawerTz = el.dataset.tz;
    hideBreakdownTooltip();
    renderBreakdownDrawer(this, list, this._bagrutLegacySignals || signals);
  },

  bagrutDrawerClose(restoreFocus = false) {
    const tz = this.state.bagrut.drawerTz;
    this.state.bagrut.drawerTz = null;
    const drawer = $('bagrut-breakdown-drawer'), table = $('bagrut-table');
    if (drawer) drawer.remove();
    hideBreakdownTooltip();
    if (table) {
      const rows = [...table.querySelectorAll('tr[data-act="bagrutDrawerOpen"]')];
      rows.forEach(row => row.classList.remove('bg-drawer-row-active'));
      const row = restoreFocus && rows.find(el => el.dataset.tz === tz);
      if (row) row.focus();
    }
  },

  bagrutDrill(el) {
    if (this.state.bagrut.targets) return;
    Object.assign(this.state.bagrut, { drill: el.dataset.sel, readinessClass: '', readinessFilter: 'all', targets: false });
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
    if (st.targets) return;
    st.chip = st.chip === chip ? 'all' : chip;
    st.overviewEntry = false;
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  bagrutTargets() {
    const st = this.state.bagrut;
    st.targets = !st.targets;
    if (st.targets) {
      st.targetPreviousChip = st.chip;
      Object.assign(st, { drill: 'all', readinessClass: '', readinessFilter: 'all' });
    } else {
      st.chip = st.targetPreviousChip;
      delete st.targetPreviousChip;
    }
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  bagrutTargetSort(el) {
    const st = this.state.bagrut, key = el.dataset.key;
    if (st.targetSort === key) st.targetDir *= -1; else { st.targetSort = key; st.targetDir = 1; }
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  target30Rows(list) {
    const rules = Config.rulesForGrade('יב'), result = [];
    list.filter(({ t }) => t.gradeKey === 'יב').forEach(({ t }) => {
      const ev = BagrutEngine.evaluate(t.tz, { fullMode: true });
      ev.subjects.forEach(s => {
        const target = target30(s, ev, rules);
        if (target) result.push({ t, subject: s.name, ...target });
      });
    });
    return result;
  },

  exportTargets30() {
    if (this.state.filters.grade !== 'יב') {
      this.toast('כדי לייצא ציוני 30% יש לבחור בשכבת י״ב.', 'warn');
      return;
    }
    if (!SignalEngine.prerequisitesFor('יב').hasBagrut) {
      this.toast('לא ניתן לייצא: חסר קובץ בגרות לשכבת י"ב', 'error');
      return;
    }
    const roster = this.filtered().filter(t => t.gradeKey === 'יב');
    const st = this.state.bagrut;
    const sim100 = !!st.sim100 && st.drill === 'all' && !st.targets;
    const options = { ...finalOptions, ignoreInternals: !!st.ignoreInternals, ...(sim100 ? { sim100: true } : {}) };
    const signals = signalsFor(roster.map(t => ({ t })), options);
    const rows = roster.map(t => ({ t, ev: signals.get(t.tz).ev }));
    const overviewSource = st.overviewEntry && !st.targets && !sim100;
    const source = overviewSource ? roster.map(t => ({ t, ev: this.getEval(t.tz) })) : rows;
    const selected = this.filterByChip(source, st.targets ? 'all' : st.chip, overviewSource ? undefined : signals);
    const targets = BagrutView.target30Rows.call(this, selected);
    if (!targets.length) {
      this.toast('אין יעדי 30% לייצוא בסינון הנוכחי', 'warn');
      return;
    }
    const quote = value => `"${String(value).replace(/"/g, '""')}"`;
    const safe = value => {
      const text = String(value == null ? '' : value);
      return quote(/^[\t\r\n]|^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text);
    };
    const id = value => /^\d+$/.test(value) ? quote(`="${value}"`) : safe(value);
    const header = ['ת"ז', 'שם חניך', 'כיתה', 'מקצוע', 'מצב/ציון נוכחי', 'יעד מינימלי ב-30%', 'הערה'];
    const lines = [header.map(safe).join(','), ...targets.map(r =>
      [id(r.t.tz), ...[r.t.name, Config.classLabel(r.t.classKey), r.subject, r.current, r.target, r.note].map(safe)].join(','))];
    const blob = new Blob(['\ufeff', lines.join('\r\n'), '\r\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bagrut-target-30-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  bagrutScope(el) {
    if (!this.state.bagrut.targets) this.state.bagrut.chip = 'all';
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
    return `${m.fail} חניכים נכשלים · ${m.borderline} חניכים גבוליים · ${m.noGrade} חניכים ללא ציון${m.unreported ? ` · ${m.unreported} חניכים טרם דווחו` : ''}`;
  },

  readinessCompact(r) {
    return `${r.fail} נכשלים · ${r.borderline} גבוליים${r.noGrade > 0 ? ` · ${r.noGrade} ללא ציון` : ''}`;
  },

  readinessAverage(avg) { return avg == null ? '—' : Util.fmt(avg, 1); },

  workSelect(el) {
    this.state.bagrut.workTz = el.dataset.tz;
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  workStep(el) {
    const ids = this._bagrutWorkIds || [], index = ids.indexOf(this.state.bagrut.workTz);
    if (index < 0) return;
    const next = index + Number(el.dataset.step);
    if (next < 0 || next >= ids.length) return;
    this.state.bagrut.workTz = ids[next];
    this.dirty.add('bagrut'); this.renderTab('bagrut');
  },

  workGrade12() {
    Object.assign(this.state.bagrut, { chip: 'all', drill: 'all', targets: false, overviewEntry: false, whatifEntry: false, workTz: '' });
    this.changeGradeFilter('יב');
  },

  renderBagrutWorklist() {
    const st = this.state.bagrut, roster = this.filtered().filter(t => t.gradeKey === 'יב');
    const listColumns = workColumns('list'), subjectColumns = workColumns('subjects');
    const options = { ...finalOptions, ignoreInternals: !!st.ignoreInternals };
    const actualSignals = signalsFor(roster.map(t => ({ t })), options);
    const signalMap = st.sim100 ? signalsFor(roster.map(t => ({ t })), { ...options, sim100: true }) : actualSignals;
    const rows = roster.map(t => ({ t, ev: signalMap.get(t.tz).ev }));
    const rules = Config.rulesForGrade('יב');
    const offsetCache = new WeakMap();
    const offsetInfo = ev => {
      if (offsetCache.has(ev)) return offsetCache.get(ev);
      const failures = ev.gates[1] === 'off' ? [] : ev.subjects.filter(s => {
        if (s.exempt || s.comps.some(c => !c.internal && (c.state === 'missing' || c.failed || c.blocked))) return false;
        const missing = s.unresolved.concat(s.pending);
        return (!missing.length && s.adj != null && Math.round(s.adj) < rules.passGrade) ||
          (missing.length > 0 && missing.every(c => c.internal && !c.failed && !c.blocked) &&
            s.reverse && s.reverse.required30 > 100) ||
          (st.sim100 && missing.some(c => c.internal && (c.failed || c.blocked)));
      });
      const majorBlock = ev.blockers.find(b => b.gate === 2 && b.k === 'major-fail');
      const failedMajor = majorBlock && ev.major.cands.find(c => majorBlock.text.includes(c.name));
      if (failedMajor && !failures.some(s => s.id === failedMajor.coreId)) failures.push(failedMajor);
      const single = failures.length === 1 ? failures[0] : null;
      const applied = single && single.compApplied && !single.critical ? single : null;
      const pending = applied && (ev.subjects.some(s => s !== applied && !s.exempt &&
        s.unresolved.concat(s.pending).some(c => !c.failed && !c.blocked)) ||
        ev.blockers.some(b => b.gate === 2 && ['major-missing', 'major-none'].includes(b.k)));
      const complete = single && single.comps && !single.unresolved.length && !single.pending.length;
      const rejected = failures.length > 1 || !!(single && (single.critical || !single.comps || (complete && !applied)));
      const result = { failures, applied, pending, rejected };
      offsetCache.set(ev, result);
      return result;
    };
    const known = rows.filter(r => !noBagrutData(signalMap.get(r.t.tz), options) && r.ev.tier !== 0 && r.ev.tier !== 5);
    const forecastOptions = { ...options, fullMode: false, useCurrent: true };
    const forecast = signalsFor(known, forecastOptions);
    const eligible = ev => (ev.tier === 1 || ev.tier === 2) &&
      (ev.manual || (!offsetInfo(ev).rejected && !offsetInfo(ev).pending));
    const todayCount = known.filter(r => eligible(r.ev)).length;
    const forecastCount = known.filter(r => [1, 2].includes(forecast.get(r.t.tz).ev.tier)).length;
    const metric = (count, label) => `<span><strong>${known.length ? `${Math.round(count / known.length * 100)}%` : '—'}</strong> ${label}: ${count} מתוך ${known.length}</span>`;
    const globalRows = roster.map(t => ({ t, ev: this.getEval(t.tz) }));
    const overviewIds = st.overviewEntry && !st.sim100 ? new Set(this.filterByChip(globalRows, st.chip).map(r => r.t.tz)) : null;
    const attention = st.overviewEntry && st.chip === 'attention' ? this.attentionModel(roster, globalRows) : null;
    const matches = (r, chip) => chip === 'eligible' ? eligible(r.ev) : this.chipMatch(r, chip, signalMap.get(r.t.tz));
    const selected = rows.filter(r => overviewIds ? overviewIds.has(r.t.tz) : matches(r, st.chip));
    const order = r => r.ev.tier === 5 ? 0 : r.ev.tier === 0 || r.ev.manualReview.required || r.ev.tier >= 3 || !eligible(r.ev) ? 2 : 1;
    selected.sort((a, b) => order(b) - order(a) || b.ev.tier - a.ev.tier || natural(a.t.name, b.t.name) || natural(a.t.tz, b.t.tz));
    const deferred = loadDeferred(), active = selected.filter(r => !deferred.has(r.t.tz)), lowered = selected.filter(r => deferred.has(r.t.tz));
    this._bagrutWorkIds = active.map(r => r.t.tz);
    if (!selected.some(r => r.t.tz === st.workTz)) st.workTz = active.length ? active[0].t.tz : '';
    const quick = (id, label) => `<button type="button" class="gstat" data-act="bagrutChip" data-chip="${id}" aria-pressed="${st.chip === id}"><span>${label}</span><span>${rows.filter(r => matches(r, id)).length}</span></button>`;
    setHtml('bagrut-kpis', `<div class="card bagrut-work-summary">
      <div class="bagrut-work-metrics">${metric(todayCount, st.sim100 ? 'עומדים בתנאי סוף י״ב בסימולציה' : 'עומדים היום בתנאי סוף י״ב')}${metric(forecastCount, 'צפי לסוף השנה')}</div>
      <p>מתוך חניכי י״ב בסינון עם נתוני בגרות, כולל חנ״מ והכרעות ידניות; ללא מסלול 12 שנות לימוד. ${st.ignoreInternals ? 'הבדיקה מתעלמת מיחידות פנימיות ואינה קביעה סופית. ' : ''}הצפי מותאם לשלב בשנה ומשלב ציונים שוטפים; רכיבי י״ב שטרם דווחו בהיקף הנדרש בשכבה אינם נחשבים חסרים. הצפי אינו הבטחה לזכאות.</p>
      ${st.overviewEntry ? '<p>הרשימה שומרת על החניכים שנבחרו בחדר הבקרה; מצב כל חניך נבדק כאן לפי סוף י״ב.</p>' : ''}
      ${attention ? `<p>במעקב: ${attention.tzSet.size} חניכים · ${attention.bagrutRisk.length} בסיכון בבגרות · ${attention.multi.length} עם 2+ שליליים/חסרים בשוטף${attention.both ? ` (${attention.both} בשניהם)` : ''}</p>` : ''}
      <div class="bagrut-tabs" role="group" aria-label="סינון רשימת העבודה">${quick('all', 'הכל')}${quick('risk', 'בסיכון')}${quick('eligible', 'עומדים בתנאים')}${quick('pinned', 'במעקב צמוד')}</div></div>`);
    const kpis = $('bagrut-kpis');
    if (kpis) kpis.classList.remove('hidden');
    const pinButton = t => `<button type="button" class="btn btn-ghost btn-sm" data-act="bagrutPin" data-defer="true" data-tz="${E(t.tz)}" aria-pressed="${deferred.has(t.tz)}" aria-label="${deferred.has(t.tz) ? 'החזר למעלה' : 'הורד למטה'}: ${E(t.name)}">${deferred.has(t.tz) ? 'החזר למעלה' : 'הורד למטה'}</button>`;
    const workRows = list => list.map(({ t, ev }) => {
      const noData = noBagrutData(signalMap.get(t.tz), options);
      const b = UI.buildBagrutBreakdown(t, ev, { noData });
      const offset = offsetInfo(ev);
      const summary = !b.noData && !b.isTrack12 && offset.rejected ? `${ev.manual ? 'בבדיקה האוטומטית: ' : ''}לא ניתן להחיל קיזוז או קומפנסציה` :
        !b.noData && !b.isTrack12 && offset.pending ? `${b.cellSummary} · הקיזוז או הפיצוי מותנים בציונים החסרים` : b.cellSummary;
      return `<tr class="${t.tz === st.workTz ? 'is-selected' : ''}" data-act="bagrutWorkSelect" data-tz="${E(t.tz)}"><td><button type="button" class="bagrut-name" data-act="openProfile" data-tz="${E(t.tz)}" title="ת.ז ${E(t.tz)}">${E(t.name)}</button></td>
        <td>${E(Config.classLabel(t.classKey))}</td><td>${E(summary)}</td><td>${pinButton(t)}</td></tr>`;
    }).join('');
    const selectedRow = selected.find(r => r.t.tz === st.workTz);
    let detail = '<p>אין חניכים להצגה בסינון הנוכחי.</p>';
    if (selectedRow) {
      const { t, ev } = selectedRow, actualEv = actualSignals.get(t.tz).ev, noData = noBagrutData(signalMap.get(t.tz), options);
      const b = UI.buildBagrutBreakdown(t, ev, { noData });
      const index = this._bagrutWorkIds.indexOf(t.tz);
      const issues = ev.blockers.filter(x => !x.info);
      const offset = offsetInfo(ev);
      const simulatedForOffset = offset.applied && st.sim100 && ev.subjects.some(s =>
        s.comps.some(c => c.simulated) && (s === offset.applied ||
          (s.status === 'pass' && actualEv.subjects.find(a => a.id === s.id)?.status !== 'pass')));
      const pointsRules = Config.withRules(rules, () => Config.pointsCompensation());
      const examTag = comp => {
        const value = comp.simulated ? '100 (סימולציה)' : comp.state === 'num' ? Util.fmt(comp.reportedNum ?? comp.num, 1) :
          comp.state === 'pass' ? 'עבר' : comp.state === 'exempt' ? 'פטור' :
          comp.blocked ? 'חסום' : comp.failed ? 'נכשל' : '-';
        return `<span class="bagrut-exam"><bdi dir="ltr">${E(comp.code)}</bdi> – ${comp.internal ? '30%' : 'חיצוני'}: <bdi>${E(value)}</bdi></span>`;
      };
      const alternatives = comps => comps.filter(c => c.state === 'missing' && !c.failed && !c.blocked && c.codes.length > 1)
        .map(c => `חלופות לשאלון ${c.code}: ${c.codes.join(' / ')}`);
      let detailIndex = 0;
      const subjectRow = (id, name, exams, target, status, notes, statusTip = '') => {
        const unique = [...new Set(notes.filter(Boolean))], detailsId = `bagrut-subject-details-${detailIndex++}`;
        const statusClass = status.startsWith('עובר') ? 'pass' : status === 'נכשל' ? 'bad' : 'neutral';
        const button = unique.length ? `<button type="button" class="bagrut-subject-toggle" data-bagrut-subject-details aria-expanded="false" aria-controls="${detailsId}" aria-label="${E(`פרטים: ${name}`)}">פרטים</button>` : '-';
        return `<tr data-subject="${E(id)}"><th scope="row"><strong>${E(name)}</strong></th>
          <td><div class="bagrut-exams">${exams.map(examTag).join('') || '-'}</div></td>
          <td><span class="bagrut-subject-status is-${statusClass}"${statusTip ? ` title="${E(statusTip)}"` : ''}>${E(status)}</span></td><td>${target}</td><td>${button}</td></tr>
          ${unique.length ? `<tr id="${detailsId}" class="bagrut-subject-detail-row" hidden><td colspan="5">${unique.map(note => `<div>${E(note)}</div>`).join('')}</td></tr>` : ''}`;
      };
      const subjects = ev.subjects.map(s => {
        const actual = actualEv.subjects.find(subject => subject.id === s.id);
        if (!actual) throw new Error(`חסרים נתוני המקצוע המקורי: ${s.id}`);
        const blockers = issues.filter(x => x.gate === 1 && x.k !== 'units' && (x.subject === s.id || x.text.includes(s.name)));
        const external = actual.comps.filter(c => !c.internal && c.state === 'missing' && !c.failed && !c.blocked);
        const target = !b.noData && !external.length && actual.status !== 'pass' && !actual.compApplied
          ? target30(actual, actualEv, rules, true) : null;
        const impossible = target && actual.reverse && actual.reverse.required30 > 100 &&
          actual.unresolved.concat(actual.pending).every(c => c.internal);
        const tooltip = 'גם 100 ב-30% אינו מספיק למעבר ישיר. במקצוע שאינו עברית ואינו מוחרג ניתן לבחון קיזוז או קומפנסציה (פיצוי נקודות), בכפוף לכללי הזכאות.';
        const targetCell = impossible ? `<span class="badge tier-4" title="${E(tooltip)}">נכשל</span>` :
          target && target.directTarget != null ? E(target.directTarget) : '-';
        const mechanism = offset.applied === s ? (s.compApplied === 'points' ? 'קומפנסציה' : 'קיזוז') : '';
        const statusTip = mechanism === 'קיזוז' ? 'קיזוז לפי טווח הציונים וכללי הזכאות.' :
          mechanism ? 'קומפנסציה באמצעות פיצוי נקודות ממקצועות עוברים, לפי כללי הזכאות.' : '';
        const status = b.noData ? '-' : s.exempt ? 'פטור' : mechanism
          ? `עובר (${mechanism})${simulatedForOffset ? ' (סימולציה)' : ''}` : s.status === 'pass'
          ? s.comps.some(c => c.simulated) && actual.status !== 'pass' ? 'עובר (סימולציה)' : 'עובר' : 'נכשל';
        const notes = alternatives(s.comps);
        blockers.filter(x => x.k !== 'questionnaire' && !['reverse30', 'reverse-pending'].includes(x.k))
          .forEach(x => notes.push(x.text));
        if (s.compApplied && mechanism) {
          const compensation = ev.notes.filter(note => note.includes(s.name) && /קיזוז|פיצוי/.test(note));
          notes.push(...(compensation.length ? compensation : [s.compApplied === 'points' ? 'פיצוי נקודות' : 'עבר בקיזוז']));
        }
        if (target && (impossible || target.directTarget == null || /לקיזוז|הרכיב החסר|משוקלל|הכרעה ידנית|החלטת רכזת/.test(target.note))) {
          notes.push(target.note);
        }
        if (impossible) {
          if (actual.critical) notes.push('המקצוע מוחרג מקיזוז ומפיצוי נקודות.');
          else {
            if (target.compensationTarget != null) notes.push(`להגעה לציון ${actual.reverse.compMin} במקצוע נדרש ${target.compensationTarget} ב-30%; ${rules.allowCompensationRule ? 'הקיזוז כפוף לכללים ולמכסה' : 'הקיזוז מושבת בכללי המחזור'}.`);
            else notes.push(`גם 100 ב-30% אינו מספיק להגעה לציון ${actual.reverse.compMin} הנדרש לקיזוז.`);
            if (rules.allowCompensationRule) notes.push(`טווח הקיזוז הוא ${actual.reverse.compMin}–${rules.compensationMax}; מספר המקצועות המקוזזים כפוף למכסה של ${rules.maxCompensations}.`);
            notes.push(pointsRules.enabled
              ? `פיצוי נקודות נבחן למקצוע אחד בציון ${pointsRules.minScore}–${actual.reverse.compMin - 1}, מול שני מקצועות עוברים של ${pointsRules.minUnits} יח״ל ומעלה. סכום הציונים הנדרש לפי סך היח״ל: ${Object.entries(pointsRules.table).map(([units, score]) => `${units} יח״ל: ${score}`).join(', ')}.`
              : 'פיצוי נקודות מושבת בכללי המחזור.');
          }
        }
        return subjectRow(s.id, s.name, s.comps, targetCell, status, notes, statusTip);
      }).join('');
      const majors = ev.major.cands.filter(c => !c.coreId).map(c => {
        const def = rules.majors.find(m => m.id === c.id);
        if (!def) throw new Error(`חסרה הגדרת מגמה: ${c.id}`);
        const groups = def.codeMode === 'any' ? [def.codes] : def.codes.map(code => [code]);
        const exams = groups.flatMap(codes => {
          const reported = codes.map(code => BagrutFacts.bestResult(t.tz, [code])).filter(result => result && result.kind !== 'none');
          return reported.length ? reported.map(result => ({
            code: result.code, codes, state: result.exempt ? 'exempt' : result.kind, num: result.num, blocked: result.block, failed: result.kind === 'fail'
          })) : [{ code: codes[0], codes, state: 'missing' }];
        });
        const requiredUnits = (rules.gates && rules.gates.major && rules.gates.major.requiredUnits) || 5;
        const status = b.noData ? '-' : c.units < requiredUnits ? `${c.units} יח״ל — לא מגמה מורחבת` : c.exempt ? 'פטור' : c.status === 'pass' ? 'עובר' : 'נכשל';
        const notes = alternatives(exams);
        if (c.blocked) notes.push(`חסם בשאלון ${c.blocked}`);
        if (c.exempt) notes.push('פטור במגמה דורש החלטת רכזת');
        return subjectRow(`major:${c.id}`, `${c.name} · מגמה`, exams, '-', status, notes);
      }).join('');
      const other = !b.noData && !b.isTrack12 ? issues.filter(x =>
        !(x.gate === 1 && x.k !== 'units' && ev.subjects.some(s => x.subject === s.id || x.text.includes(s.name)))) : [];
      const science = ev.internals.find(item => item.id === 'science');
      const scienceNeedsHint = science && ['נכשל', 'חסר'].includes(internalStatus(science, ev, noData));
      const impossibleSubjects = actualEv.subjects.filter(s => s.reverse && s.reverse.required30 > 100 &&
        s.unresolved.concat(s.pending).every(c => c.internal) && target30(s, actualEv, rules));
      const singleImpossible = impossibleSubjects.length === 1 ? impossibleSubjects[0] : null;
      const additionalFailure = singleImpossible && (actualEv.subjects.some(s => s !== singleImpossible &&
        ((!s.compApplied || s.compApplied === 'points') && ['comp', 'severe', 'fail'].includes(s.status) ||
         s.comps.some(c => c.failed || c.blocked) || (s.reverse && s.reverse.required30 > 100))) ||
        actualEv.blockers.some(x => !x.info && x.gate === 2 && ['major-fail', 'bagrut-block'].includes(x.k)));
      const usedCompensations = actualEv.subjects.filter(s => s.status === 'comp' && !s.critical).length;
      const otherFailingSubject = singleImpossible && actualEv.subjects.some(s => s !== singleImpossible && ['comp', 'severe', 'fail'].includes(s.status));
      const alternativesForHint = singleImpossible ? [
        rules.allowCompensationRule && usedCompensations < rules.maxCompensations && singleImpossible.reverse.requiredFor45 <= 100 ? `קיזוז בציון ${rules.compensationMin} לפחות` : '',
        pointsRules.enabled && !otherFailingSubject && singleImpossible.reverse.max >= pointsRules.minScore ? 'קומפנסציה (פיצוי נקודות) מול מקצועות חזקים' : ''
      ].filter(Boolean) : [];
      const compensationHint = !b.noData && !b.isTrack12 && singleImpossible && !singleImpossible.critical && !additionalFailure && alternativesForHint.length
        ? `במקצוע ${singleImpossible.name} לא ניתן להגיע לעובר ${rules.passGrade} גם עם 100 ב-30%. אפשר לבדוק ${alternativesForHint.join(' או ')}, בכפוף לכללי הזכאות.`
        : '';
      let offsetExplanation = '';
      if (!b.noData && !b.isTrack12 && offset.rejected) {
        offsetExplanation = offset.failures.length > 1
          ? 'יש יותר ממקצוע אחד שנכשל בוודאות, ולכן לא ניתן להציג מעבר בקיזוז או בפיצוי.'
          : offset.failures[0].critical
            ? `המקצוע ${offset.failures[0].name} אינו מאפשר קיזוז או פיצוי לפי הכללים.`
            : `הציון ב${offset.failures[0].name} או שאר הציונים אינם עומדים בתנאים לקיזוז או לפיצוי נקודות.`;
      } else if (!b.noData && !b.isTrack12 && offset.applied) {
        const s = offset.applied;
        offsetExplanation = s.compApplied === 'points'
          ? `${s.name} עובר באמצעות פיצוי נקודות ממקצועות עוברים, לפי כללי הזכאות.`
          : `${s.name} עובר בקיזוז כי הציון שלו נמצא בטווח המותר לפי כללי הזכאות.`;
        if (simulatedForOffset) offsetExplanation += ' הבדיקה כוללת ציוני 100 מדומים.';
        if (offset.pending) offsetExplanation += ' הדבר מותנה בכך שלא ייווצרו נכשלים נוספים במקצועות שטרם דווחו.';
      }
      const review = ev.manualReview.required ? this.manualReviewLines(ev) : [];
      let simulation = '';
      if (st.whatifEntry) {
        const options = { ...finalOptions, ...st.drillSim, fullMode: true };
        const signal = SignalEngine.computeForTrainee(t.tz, options);
        const simulated = UI.buildBagrutBreakdown(t, signal.ev, { noData: noBagrutData(signal, options) });
        simulation = `<h3>סימולציית מה־אם לחניך זה</h3><p>${E(simulated.status)} · ${E(simulated.cellSummary)}</p><p>הסימולציה אינה משנה את הבדיקה שלמעלה או את חדר הבקרה.</p>`;
      }
      const position = index < 0 ? active.length + lowered.findIndex(r => r.t.tz === t.tz) + 1 : index + 1;
      const eligibility = eligible(ev);
      detail = `<header><h2>${E(t.name)} · ${E(Config.classLabel(t.classKey))}</h2>
        <p>י״ב · ${position} מתוך ${selected.length} חניכים${index < 0 ? ' · חניך שהורד למטה' : ''}</p>
        <span class="bagrut-subject-status is-${eligibility ? 'pass' : 'bad'}">${eligibility ? 'זכאי' : 'לא זכאי כרגע'}${!eligibility && !b.noData && !b.isTrack12 && offset.rejected ? ' - לא זכאי לקיזוז או קומפנסציה' : ''}${st.sim100 ? ' (סימולציה)' : ''}</span>
        <div class="bagrut-work-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="bagrutWorkStep" data-step="-1" ${index <= 0 ? 'disabled' : ''}>חניך קודם</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="bagrutWorkStep" data-step="1" ${index < 0 || index === active.length - 1 ? 'disabled' : ''}>חניך הבא</button>
        ${pinButton(t)}<button type="button" class="btn btn-primary btn-sm" data-act="openProfile" data-tz="${E(t.tz)}">פתח כרטיס חניך 360°</button></div></header>
        ${ev.manual ? '<p>קיימת הכרעה ידנית; הפרטים מציגים גם את החישוב האוטומטי.</p>' : ''}
        <div class="bagrut-work-subject-scroll"><table class="bagrut-work-subjects" data-width-group="subjects" style="width:${subjectColumns.width};min-width:100%"><colgroup>${subjectColumns.cols}</colgroup><thead><tr>${subjectColumns.headers}</tr></thead><tbody>${subjects}${majors}</tbody></table></div>
        ${b.noData || b.isTrack12 ? `<p>${E(b.cellSummary)}</p>` : `${other.length || compensationHint || offsetExplanation ? `<h3>מה עוד חוסם או חסר</h3><ul>${other.map(x => `<li>${E(x.text)}${scienceNeedsHint && x.gate === 3 && x.text.includes(science.name) ? ` ${scienceHint}` : ''}</li>`).join('')}${compensationHint ? `<li>${E(compensationHint)}</li>` : ''}${offsetExplanation ? `<li>${E(offsetExplanation)}</li>` : ''}</ul>` : ''}`}
        ${renderInternalDetails(ev, noData)}
        ${!b.noData && !b.isTrack12 && review.length ? `<h3>נדרשת בדיקת רכזת</h3><ul>${review.map(x => `<li>${E(x)}</li>`).join('')}</ul>` : ''}
        ${simulation}`;
    }
    const workSplit = loadWorkSplit();
    setHtml('bagrut-table', `<div class="bagrut-work-layout" style="--bagrut-work-split:${workSplit}%"><div class="card bagrut-work-list"><table class="grid bagrut-work-students text-right" data-width-group="list" style="width:${listColumns.width};min-width:100%"><colgroup>${listColumns.cols}</colgroup><thead><tr>${listColumns.headers}</tr></thead>
      <tbody>${workRows(active) || '<tr><td colspan="4">אין חניכים פעילים להצגה</td></tr>'}${lowered.length ? `<tr class="room-divider"><td colspan="4">חניכים שהורדו למטה (${lowered.length})</td></tr>${workRows(lowered)}` : ''}</tbody></table></div><div class="bagrut-work-splitter" role="separator" aria-orientation="vertical" aria-valuemin="${WORK_SPLIT_MIN}" aria-valuemax="${WORK_SPLIT_MAX}" aria-valuenow="${workSplit}" tabindex="0" aria-label="שינוי רוחב החלוקה בין רשימת החניכים לפרטי החניך" title="גרור לשינוי רוחב החלוקה (לחיצה כפולה לאיפוס)"></div><section class="card bagrut-work-detail" aria-label="בדיקת חניך">${detail}</section></div>`);
  },

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
    const select = $('bagrutSubjectDrillSelect'), simulation = $('bagrutSimulation');
    const localControls = $('localControls');
    const previousToolbar = localControls && localControls.querySelector(':scope > .bagrut-toolbar');
    if (previousToolbar) previousToolbar.remove();
    const pill = (id, label) => `<button type="button" data-act="bagrutScope" data-scope="${id}" aria-pressed="${info.scope === id}">${label} · חניכים (${info.counts[id]})</button>`;
    box.classList.remove('hidden');
    const cohort = gk => ` • ${E(Config.getCohortNameForGrade(gk))}`;
    const grade = this.state.filters.grade;
    box.innerHTML = `<div class="bagrut-toolbar${this.state.tab === 'bagrut' ? '' : ' hidden'}" data-bagrut-only>
      <div class="bagrut-title"><h1>זכאות לבגרות</h1><span class="bagrut-grade">${grade === 'all' ? 'כל השכבות' : `שכבת ${E(Util.gl(grade))}`}</span></div>
      <div class="bagrut-controls"><span class="bagrut-subject-slot"></span>
        <button type="button" class="btn btn-ghost btn-sm bagrut-tool" data-act="bagrutTargets" aria-pressed="${!!this.state.bagrut.targets}">${this.state.bagrut.targets ? 'חזרה לזכאות' : 'יעד 30% וייצוא'}</button>
        <span class="bagrut-simulation-slot"></span><span class="bagrut-quality-slot"></span></div></div>
      <div class="scope-bar bagrut-legacy-scope" role="group" aria-label="היקף שכבות בצפי הזכאות" hidden>
      ${pill('12', `🎓 שכבת י"ב${cohort('יב')}`)}${pill('11', `📈 שכבת י"א${cohort('יא')}`)}${pill('10', `🌱 שכבת י'${cohort('י')}`)}${pill('all', '📋 כל השכבות')}</div>`;
    if (select) box.querySelector('.bagrut-subject-slot').appendChild(select);
    if (simulation) box.querySelector('.bagrut-simulation-slot').appendChild(simulation);
    if (localControls) localControls.appendChild(box.querySelector('.bagrut-toolbar'));
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
    if (chip === 'pinned') return loadPins().has(r.t.tz);
    if (chip === 'track12') return ev.tier === 5;
    if (chip === 'exception') return ev.manual;
    if (isUnknown(signal)) return chip === 'tier0';
    if (chip === 'risk') return ev.tier !== 5 && (this.tierBased(ev) ? ev.tier === 4 : ev.paceStatus === 'pace_lag');
    if (chip === 'completion') return ev.tier !== 5 && (this.tierBased(ev) ? ev.tier === 3 : ev.paceStatus === 'pace_warning');
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
    if ($('panel-bagrut') && !$('weakness-styles')) {
      const link = document.createElement('link');
      link.id = 'weakness-styles'; link.rel = 'stylesheet'; link.href = 'css/style.css';
      document.head.appendChild(link);
    }
    const st = this.state.bagrut;
    const controls = $('localControls');
    const updateDrillControls = () => {
      const visible = st.drill !== 'all' && !st.targets && Store.hasData();
      const select = $('bagrutSubjectDrillSelect'), actions = $('bagrutActions');
      const info = actions && actions.querySelector(':scope > details:not(#bagrutSimulation)');
      if (select) select.hidden = !visible;
      if (info) info.hidden = !visible;
    };
    updateDrillControls();
    if (controls) {
      let workControls = $('bagrutWorkControls');
      if (!workControls) {
        workControls = document.createElement('div');
        workControls.id = 'bagrutWorkControls';
        workControls.setAttribute('data-bagrut-only', '');
        workControls.className = 'bagrut-work-controls';
        const clear = $('fClear');
        if (clear && clear.parentNode === controls) clear.insertAdjacentElement('afterend', workControls);
        else controls.appendChild(workControls);
      }
      workControls.classList.toggle('hidden', this.state.tab !== 'bagrut');
      const disabled = this.state.filters.grade !== 'יב' ? ' disabled' : '';
      workControls.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" data-act="exportTargets30"${disabled}>ייצוא ציוני 30% מינימליים</button>
        <label><input type="checkbox" data-chg="bagrutWorkOption" data-key="ignoreInternals" ${st.ignoreInternals ? 'checked' : ''}${disabled}> התעלם ממקצועות פנימיים</label>
        ${st.drill === 'all' && !st.targets ? `<label><input type="checkbox" data-chg="bagrutWorkOption" data-key="sim100" ${st.sim100 ? 'checked' : ''}${disabled}> הוסף ציון 100 ב-30%</label>` : ''}`;
    }
    if (st.drill === 'all' && !st.targets && !(st.overviewEntry && this.state.filters.grade !== 'יב')) {
      this.renderFreshnessBar('bagrut');
      const box = $('bagrut-scope'), select = $('bagrutSubjectDrillSelect'), simulation = $('bagrutSimulation');
      if (select && controls) controls.appendChild(select);
      if (simulation) {
        const actions = $('bagrutActions');
        if (actions) actions.appendChild(simulation);
        simulation.hidden = !st.whatifEntry;
      }
      const previous = controls && controls.querySelector(':scope > .bagrut-toolbar');
      if (previous) previous.remove();
      if (box) {
        box.classList.remove('hidden');
        box.innerHTML = `<div class="bagrut-work-title"><h1>בדיקת זכאות לסוף י״ב</h1>${st.sim100 ? '<p>מצב סימולציה פעיל: רכיבי 30% שטרם דווחו מחושבים כ-100.</p>' : ''}</div>`;
      }
      if (select) {
        select.disabled = this.state.filters.grade !== 'יב';
        select.innerHTML = '<option value="all">כל המקצועות</option>' +
          BagrutAdvisor.drillOptions().map(o => `<option value="${E(o.value)}">${E(o.label)}</option>`).join('');
      }
      const options = { ...finalOptions, ...st.drillSim };
      setHtml('bagrut-whatif', st.whatifEntry ? `<p>סימולציה לחניך הנבחר בלבד, במצב סוף י״ב.</p>${[
        ['ignoreInternals', 'התעלמות מחוסר ביחידות פנימיות'],
        ['plus5', 'תוספת 5 נקודות לציונים גבוליים'],
        ['useCurrent', 'שילוב ציונים שוטפים']
      ].map(([key, label]) => `<label class="flex items-center gap-2"><input type="checkbox" data-chg="sim" data-key="${key}" ${options[key] ? 'checked' : ''}>${label}</label>`).join('')}` : '');
      setHtml('bagrut-cohort', '');
      BagrutView.bagrutDrawerClose.call(this);
      if (this.state.filters.grade !== 'יב') {
        const kpis = $('bagrut-kpis');
        if (kpis) { kpis.innerHTML = ''; kpis.classList.add('hidden'); }
        return setHtml('bagrut-table', '<div class="card bagrut-work-detail"><p>מסך זה מיועד לבדיקת זכאות בסוף י״ב.</p><button type="button" class="btn btn-primary btn-sm" data-act="bagrutWorkGrade12">מעבר לשכבת י״ב</button></div>');
      }
      return BagrutView.renderBagrutWorklist.call(this);
    }
    const seniorDrill = st.drill !== 'all' && this.state.filters.grade === 'יב';
    const sim = seniorDrill
      ? { ...finalOptions, ...st.drillSim, ignoreInternals: !!st.ignoreInternals, fullMode: true }
      : { ...this.state.sim, ...st.drillSim };
    if (st.targets) {
      Object.assign(st, { drill: 'all', readinessClass: '', readinessFilter: 'all' });
    }
    const simulation = $('bagrutSimulation');
    if (simulation) simulation.hidden = seniorDrill;
    this.renderFreshnessBar('bagrut');
    this.syncBagrutScope();
    if (!st.targets && ['י', 'יא'].includes(this.state.filters.grade) && st.chip === 'eligible') st.chip = 'all';
    const scope = this.bagrutScopeInfo(this.dashRows());
    this.renderBagrutScope(scope);
    if (st.overviewEntry && this.state.filters.grade !== 'יב') {
      const box = $('bagrut-scope');
      if (box) box.insertAdjacentHTML('beforeend', '<p>התצוגה שומרת על החניכים שנבחרו בחדר הבקרה. חניכי י״ב נבדקים לפי סוף י״ב; הנתונים השכבתיים ממשיכים להתבסס על חדר הבקרה. <button type="button" class="btn btn-ghost btn-sm" data-act="bagrutWorkGrade12">לבדיקת זכאות י״ב</button></p>');
    }
    const scopeRows = st.targets ? scope.rows.filter(r => r.t.gradeKey === 'יב') : scope.rows;
    const rows = seniorDrill || st.whatifEntry
      ? scopeRows.map(r => ({ t: r.t, ev: BagrutEngine.evaluate(r.t.tz, sim) }))
      : scopeRows;
    const signals = signalsFor(rows, sim);
    const knownRows = rows.filter(r => !isUnknown(signals.get(r.t.tz)));
    const evalRows = knownRows.filter(r => this.tierBased(r.ev)), paceRows = knownRows.filter(r => !this.tierBased(r.ev));
    const stats = BagrutAdvisor.summarize(evalRows.map(r => r.ev));
    const list = this.bagrutList(rows, signals, st.targets ? 'all' : st.chip);
    const tierCount = [0, 0, 0, 0, 0, 0];
    evalRows.forEach(r => { tierCount[r.ev.tier]++; });
    const hasGrade12 = rows.some(r => r.t.gradeKey === 'יב'), fullMode = !!(hasGrade12 || st.targets) && !!sim.fullMode;
    const TT = BagrutEngine.TIER_TEXT[fullMode ? 'full' : 'adaptive'];

    const targetDisabled = 'לא זמין במצב יעד 30% — לחצו על חזרה לזכאות';
    const sw = (key, label) => `<label class="flex items-center gap-2 cursor-pointer"${st.targets ? ` aria-disabled="true" title="${E(targetDisabled)}"` : ''}><input type="checkbox" class="w-4 h-4" data-chg="sim" data-key="${key}" ${sim[key] ? 'checked' : ''}${st.targets ? ` disabled aria-disabled="true" title="${E(targetDisabled)}"` : ''}>${label}</label>`;
    const modeBtn = (full, label, title, off = false) => `<button type="button" data-act="bagrutMode" data-mode="${full ? 'final' : 'adaptive'}" aria-pressed="${fullMode === full}" title="${E(title)}"${off ? ' disabled aria-disabled="true"' : ''}>${label}</button>`;
    const finalBtn = hasGrade12 || st.targets ? modeBtn(true, '🎓 מצב תעודה סופית (סוף י"ב)', 'בדיקה מחמירה לשכבת י"ב בלבד: כל השאלונים והיחידות הפנימיות נדרשים; שכבות י\' ו-י"א ממשיכות להישפט לפי תקינות צבירה')
      : modeBtn(true, '🎓 מצב תעודה סופית (סוף י"ב)', 'זמין לשכבת י"ב בלבד — שכבות י\' ו-י"א נשפטות לפי תקינות צבירה', true);
    setHtml('bagrut-whatif',
      `<span class="seg flex flex-col" role="group" aria-label="מצב הערכה">${modeBtn(false, '📅 צפי מותאם לשלב בשנה', st.targets ? targetDisabled : 'נשפט לפי המבחנים שהשכבה כבר עברה; מה שטרם דווח לשכבה אינו חוסר', st.targets)}${finalBtn}</span>` +
      sw('ignoreInternals', 'התעלם מחוסר יחידות פנימיות (חנ"ג, מעורבות, השכלה כללית ומדעים)') + sw('plus5', 'תוספת +5 לגבוליים 50-54') + sw('useCurrent', 'שלב ציונים שוטפים כתחזית (תצוגה מקדימה)'));

    this.renderCohortInfo(rows, fullMode);
    const drillOpts = BagrutAdvisor.drillOptions();
    if (st.drill !== 'all' && !drillOpts.some(o => o.value === st.drill)) {
      const subject = this.subjectReadinessModel(st.drill, rows.map(r => r.t));
      if (subject.name) drillOpts.push({ value: st.drill, label: subject.name });
      else st.drill = 'all';
    }
    updateDrillControls();
    const drill = st.drill !== 'all' && Store.hasData() ? this.subjectDrillModel(this.filterByChip(rows, st.chip, signals)) : null;
    this.renderBagrutKpis(stats, tierCount, TT, paceRows, rows, drill);
    setHtml('bagrutSubjectDrillSelect',
      `<option value="all" ${st.drill === 'all' ? 'selected' : ''}>📊 מבט על – כל המקצועות</option>` +
      drillOpts.map(o => `<option value="${E(o.value)}" ${st.drill === o.value ? 'selected' : ''}>${E(o.label)}</option>`).join(''));
    const drillSelect = $('bagrutSubjectDrillSelect');
    if (drillSelect) {
      drillSelect.disabled = !!st.targets;
      drillSelect.title = st.targets ? targetDisabled : '';
    }
    if (!Store.hasData()) {
      BagrutView.bagrutDrawerClose.call(this);
      return this.noRoster([], 'bagrut-table');
    }
    const displayed = drill && drill.m ? drill.m.rows
      .filter(r => !drill.currentOn || ((!st.readinessClass || r.t.classKey === st.readinessClass) && this.readinessMatch(r, st.readinessFilter)))
      .map(r => ({ t: r.t })) : list;
    const qualitySlot = document.querySelector('.bagrut-toolbar .bagrut-quality-slot');
    if (qualitySlot) qualitySlot.innerHTML = signalSummary(displayed, signals, sim);
    if (st.targets) {
      BagrutView.bagrutDrawerClose.call(this);
      const hasBagrut = SignalEngine.prerequisitesFor('יב').hasBagrut;
      const targets = hasBagrut ? BagrutView.target30Rows.call(this, list) : [];
      const { targetSort: sort, targetDir: dir } = st;
      const values = r => ({ subject: r.subject, name: r.t.name, class: Config.classLabel(r.t.classKey), target: r.target });
      targets.sort((a, b) => {
        const x = values(a)[sort], y = values(b)[sort];
        if (sort === 'target') {
          const xNumeric = /^\d+$/.test(x), yNumeric = /^\d+$/.test(y);
          if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
        }
        return natural(x, y) * dir || natural(a.subject, b.subject) || natural(a.t.name, b.t.name) ||
          natural(Config.classLabel(a.t.classKey), Config.classLabel(b.t.classKey)) || natural(a.t.tz, b.t.tz);
      });
      const students = new Set(targets.map(r => r.t.tz)).size;
      const body = targets.map(r => `<tr><td><button type="button" class="font-bold text-indigo-700 hover:underline" data-act="openProfile" data-tz="${E(r.t.tz)}">${E(r.t.name)}</button></td>
        <td>${E(Config.classLabel(r.t.classKey))}</td><td>${E(r.subject)}</td><td>${E(r.current)}</td><td>${E(r.target)}</td><td>${E(r.note)}</td></tr>`).join('');
      const th = (key, label) => `<th aria-sort="${sort === key ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="font-semibold" data-act="bagrutTargetSort" data-key="${key}">${label}${sort === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
      return setHtml('bagrut-table', `
        <div class="card p-3 mb-3 text-sm"><div class="flex flex-wrap items-center gap-3"><strong>יעד מינימלי בציון בית-ספרי (30%)</strong>
        <span>${students} חניכים · ${targets.length} מקצועות</span>
        <button type="button" class="btn btn-primary btn-sm" data-act="exportTargets30"${targets.length ? '' : ' disabled'}>ייצוא יעד 30% (CSV/Excel)</button></div>
        <p class="text-slate-500 mt-1">שכבת י"ב בלבד, לפי הסינונים הפעילים; חישוב תעודה סופית מציונים מדווחים ללא סימולציה. יעד לקיזוז כפוף למכסה ואינו מבטיח זכאות או שימוש בו בכמה מקצועות יחד.</p></div>
        ${!hasBagrut ? '<p class="text-slate-500">לא ניתן לקבוע — חסר קובץ בגרות לשכבת י"ב</p>' :
        `<table class="grid w-full text-right"><thead><tr>${th('name', 'חניך')}${th('class', 'כיתה')}${th('subject', 'מקצוע')}<th>מצב/ציון נוכחי</th>${th('target', 'יעד מינימלי ב-30%')}<th>הערה</th></tr></thead>
        <tbody>${body || '<tr><td colspan="6" class="text-center text-slate-500 py-8">אין רכיבי 30% חסרים בסינון הנוכחי</td></tr>'}</tbody></table>`}`);
    }
    if (drill) {
      BagrutView.bagrutDrawerClose.call(this);
      return setHtml('bagrut-table', this.bagrutSubjectMatrix(drill, signals));
    }
    const legacyOverview = st.overviewEntry && this.state.filters.grade === 'all';
    const displayOptions = { ...finalOptions, ignoreInternals: !!st.ignoreInternals };
    const displaySignals = legacyOverview ? new Map(signals) : signals;
    if (legacyOverview) signalsFor(list.filter(r => r.t.gradeKey === 'יב'), displayOptions)
      .forEach((signal, tz) => displaySignals.set(tz, signal));
    const displayList = legacyOverview ? list.map(r => r.t.gradeKey === 'יב'
      ? { t: r.t, ev: displaySignals.get(r.t.tz).ev } : r) : list;
    this._bagrutLegacyList = displayList;
    this._bagrutLegacySignals = displaySignals;
    setHtml('bagrut-table', this.bagrutTable(displayList, displaySignals));
    if (st.drawerTz) renderBreakdownDrawer(this, displayList, displaySignals);
  },

  /** פס KPI מנהלים מעל הטבלה: אחוזי זכאות בקבוצה המסוננת ומונים לחיצים לסינון מהיר */
  renderBagrutKpis(stats, tierCount, TT, paceRows = [], rows = this.dashRows(), drill = null) {
    const box = $('bagrut-kpis');
    if (!box) return;
    if (!Store.hasData()) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    if (drill) { box.classList.remove('hidden'); box.innerHTML = this.subjectReadinessKpis(drill); return; }
    const active = this.state.bagrut.chip;
    const signals = signalsFor(rows, this.state.sim);
    const pct = (value, label, title, known) => `<div title="${E(title)}"><strong>${known ? `${value}%` : '—'}</strong> <span>${label}</span></div>`;
    const quick = (id, cls, label) => {
      const count = this.filterByChip(rows, id, signals).length;
      return `<button type="button" class="gstat ${cls}" data-act="bagrutChip" data-chip="${id}" aria-pressed="${active === id}" title="${E(`${label} · ${count} חניכים`)}">
        <span>${label}</span><span class="bagrut-tab-count">${count}</span></button>`;
    };
    const basis = `מחושב על ${stats.counted} חניכים עם נתוני בגרות (ללא מסלול 12 שנות לימוד)`;
    const juniorGrade = ['י', 'יא'].includes(this.state.filters.grade);
    const eligible = !juniorGrade && (stats.total > 0 || !paceRows.length) ? `<div class="bagrut-summary-metric">
      ${pct(stats.eligibilityExSpecialEd, 'צפי זכאות · ללא חנ"מ', basis, stats.counted)}
      ${pct(stats.eligibilityInclSpecialEd, 'צפי זכאות · כולל חנ"מ', basis, stats.counted)}</div>` : '';
    let pace = '';
    if (paceRows.length || juniorGrade) {
      const ps = BagrutAdvisor.summarizePace(paceRows.map(r => r.ev));
      const grades = juniorGrade ? Util.gl(this.state.filters.grade) :
        Util.GRADE_KEYS.filter(g => paceRows.some(r => r.t.gradeKey === g)).map(g => Util.gl(g)).join(', ');
      const paceBasis = `תקין לקצב או טרם החלו היבחנות, מתוך ${ps.counted} חניכים עם נתוני בגרות (שכבות ${grades}); שאלוני שכבות עליונות אינם נספרים כחוסר`;
      pace = `<div class="bagrut-summary-metric">
        ${pct(ps.pctExSpecialEd, `תקינות צבירה (${grades}) · ללא חנ"מ`, paceBasis, ps.counted)}
        ${pct(ps.pctInclSpecialEd, 'תקינות צבירה · כולל חנ"מ', paceBasis, ps.counted)}</div>`;
    }
    box.classList.remove('hidden');
    const attention = active === 'attention' && !this.state.bagrut.targets ? this.attentionModel(rows.map(r => r.t), rows) : null;
    box.innerHTML = `<div class="card bagrut-summary"><div class="bagrut-summary-values">${eligible}${pace}</div>
      ${attention ? `<div class="bagrut-attention" role="status">במעקב: ${attention.tzSet.size} חניכים · ${this.attentionBreakdownText(attention)} <button type="button" class="btn btn-ghost btn-sm" data-act="bagrutChip" data-chip="all"><span>✕ הצג הכל</span><span>${rows.length}</span></button></div>` : ''}
      ${this.state.bagrut.targets ? '' : `<div class="bagrut-tabs" role="group" aria-label="סינון חניכים לפי מצב">
        ${quick('all', 'gstat-ok', 'הכל')}
        ${quick('risk', 'gstat-bad', 'בסיכון')}
        ${quick('completion', 'gstat-amber', 'השלמה או החלטה')}
        ${juniorGrade ? '' : quick('eligible', 'gstat-ok', 'זכאים')}
        ${quick('pinned', 'gstat-violet', 'במעקב צמוד')}
        ${paceRows.length ? quick('pace:on_track', 'gstat-ok', 'תקין לקצב') + quick('pace:not_started', 'gstat-violet', 'טרם החלו') : ''}
        ${rows.some(r => r.ev.tier === 5) ? quick('track12', 'gstat-violet', '12 שנ"ל') : ''}
      </div>`}</div>`;
  },

  /** מודל אחד למקצוע בודד, משותף לפס המוכנות שב-#bagrut-kpis ולמטריצת השאלונים */
  subjectDrillModel(rows) {
    const st = this.state.bagrut, trainees = rows.map(r => r.t);
    const drillSim = this.state.bagrut.drillSim || (this.state.filters.grade === 'יב' ? finalOptions : this.state.sim);
    const currentOn = !!(drillSim.useCurrent && Store.loaded.grades);
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
      ${toggle('data-chg="sim" data-key="useCurrent"', (st.drillSim || (this.state.filters.grade === 'יב' ? finalOptions : this.state.sim)).useCurrent, 'שלב ציונים שוטפים')}
      ${toggle('data-chg="bagrutOnlyPending"', st.onlyPending, 'ניגשים בלבד')}
      ${!d.currentOn && Store.loaded.grades ? '<span class="text-xs text-slate-500">הפעל "שלב ציונים שוטפים" להצגת מוכנות לבגרות</span>' : ''}</div>`;
    const chipReset = st.chip !== 'all' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="bagrutChip" data-chip="all">✕ ביטול סינון צפי</button>' : '';
    const divider = '<span class="hidden sm:block h-8 w-px bg-slate-200" aria-hidden="true"></span>';
    let metrics = '', classes = '';
    if (d.currentOn && m && m.name) {
      const flt = (id, cls, label, n) => `<button type="button" class="gstat ${cls}" data-act="readinessFilter" data-filter="${id}" data-count="${n}" aria-pressed="${st.readinessFilter === id}">
        <span class="text-xs font-bold text-slate-700 whitespace-nowrap">${label} · חניכים</span><span class="text-sm font-extrabold px-2 py-0.5 rounded bg-slate-100">${n}</span></button>`;
      metrics = `${divider}<div class="flex items-baseline gap-2" data-readiness-summary data-avg="${r.avg == null ? '' : r.avg}" data-off-track="${r.offTrack}" data-fail="${r.fail}" data-borderline="${r.borderline}" data-no-grade="${r.noGrade}" data-total="${r.total}" title="${E(this.readinessBreakdown(r))}">
          <span class="text-2xl font-extrabold leading-none text-slate-900">${this.readinessAverage(r.avg)}</span><span class="text-xs font-semibold text-slate-600">ממוצע שוטף · ${r.offTrackPct}% לא בכיוון מתוך ${r.assessed} חניכים${r.unreported ? ` (+ ${r.unreported} חניכים טרם דווחו)` : ''}</span></div>${divider}
        <div class="flex flex-wrap items-center gap-2" role="group" aria-label="סינון מהיר לפי מוכנות">
          ${flt('offTrack', 'gstat-bad', 'לא בכיוון', r.offTrack)}
          ${flt('fail', 'gstat-bad', `נכשלים (&lt;${r.pass})`, r.fail)}
          ${flt('borderline', 'gstat-amber', `גבוליים (${r.pass}–64)`, r.borderline)}
          ${r.noGrade > 0 ? flt('noGrade', 'gstat-violet', 'ללא ציון', r.noGrade) : ''}</div>`;
      if (r.classes.length > 1) classes = `<div class="w-full flex flex-wrap gap-2" aria-label="השוואת מוכנות לפי כיתות">${r.classes.map(c => `<button type="button" class="rounded-lg border px-2.5 py-1.5 text-right text-xs ${st.readinessClass === c.key ? 'bg-amber-100 border-amber-500' : c.unreportedOnly ? 'bg-slate-100 text-slate-400' : 'bg-slate-50'}" data-act="bagrutReadinessClass" data-class="${E(c.key)}" data-off-track="${c.offTrackCount}" data-total="${c.total}" data-unreported-only="${c.unreportedOnly}" aria-pressed="${st.readinessClass === c.key}">
        <span class="block font-bold">${E(Config.classLabel(c.key))} · ${c.unreportedOnly ? (c.graded ? 'דיווח חלקי' : 'טרם דווח') : `${c.offTrackPct}% לא בכיוון (${c.offTrackCount}/${c.assessed} חניכים)`}</span>
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

  bagrutList(rows, signals, chip = this.state.bagrut.chip) {
    const { sort, dir } = this.state.bagrut;
    const severity = ev => ev.tier === 5 ? -1 : this.tierBased(ev) ? ev.tier :
      ({ pace_lag: 4, pace_warning: 3, on_track: 1, not_started: 0, no_data: 0 })[ev.paceStatus] ?? 0;
    const val = r => ({ name: r.t.name, class: r.t.classKey, grade: Util.ord(r.t.gradeKey), track: this.trackOf(r.t), tier: severity(r.ev), tz: r.t.tz, diag: r.ev.diagnostic })[sort];
    const pins = loadPins();
    return this.filterByChip(rows, chip, signals).sort((a, b) => {
      const x = val(a), y = val(b);
      return (pins.has(b.t.tz) - pins.has(a.t.tz)) || ((typeof x === 'number' ? x - y : natural(x, y)) || natural(a.t.name, b.t.name)) * dir;
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
      `<tr class="room-divider"><td colspan="${cols}">כיתה <bdi dir="rtl">${E(Config.classLabel(key))}</bdi> (${members.length} חניכים)</td></tr>${members.map(render).join('')}`
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
    const showClass = this.state.filters.cls === 'all';
    const majorLabel = 'מגמה 5 יח"ל';
    const tip = text => `data-act="mxPop" data-tip="${E(text)}" tabindex="0" role="button"`;
    const matrixCache = new Map();
    const matrixRows = new Map();
    const forecastCell = (t, value) => ({
      text: `שוטף ${Math.round(value)}`,
      state: Config.withRulesForGrade(t.gradeKey, () => SignalEngine.isPassingScore(value)) ? 'ok' : 'bad'
    });
    const addForecast = (cell, t, value, hasReported, points, blocked) => {
      const forecast = forecastCell(t, value);
      if (hasReported || (blocked && forecast.state !== 'bad')) {
        if (!blocked && points != null && cell.state === 'neutral') {
          cell.text = `${points} נק׳`;
          cell.state = 'partial';
        }
        cell.forecastSecondary = forecast.text;
      } else {
        cell.text = forecast.text;
        cell.state = forecast.state;
        cell.forecastOnly = true;
      }
      cell.detail += ` | תחזית מציון שוטף: ${Util.fmt(value, 1)}`;
      cell.ariaLabel = `${cell.label}: ${cell.text}${cell.forecastSecondary ? ` · ${forecast.text}` : ''} · תחזית מציון שוטף`;
      return cell;
    };
    const majorPoints = (t, cand) => {
      const key = `${t.gradeKey}:${cand.id}`;
      if (!matrixCache.has(key)) {
        const trainees = list.filter(r => r.t.gradeKey === t.gradeKey).map(r => r.t);
        const matrix = BagrutAdvisor.subjectMatrix(`major:${cand.id}`, trainees);
        matrixCache.set(key, new Map(matrix ? matrix.rows.map(r => [r.t.tz, r]) : []));
      }
      const row = matrixCache.get(key).get(t.tz);
      return row && row.doneW > 0 && row.remainingW > 0 ? row.accumulated : null;
    };
    const coreCell = (t, ev, id, label) => {
      const s = ev.subjects.find(x => x.id === id), c = this.subjectDisplayCell(ev, id);
      if (!s || !c) return { id, label, text: '—', state: 'neutral', plain: true };
      const blocked = ev.tier !== 5 && (this.tierBased(ev)
        ? ev.blockers.some(b => b.gate === 1 && !b.info && b.k !== 'units' && b.text.includes(s.name))
        : ev.paceInfo.blockedSubjects.includes(s.name));
      const numeric = s.comps.filter(comp => comp.state === 'num');
      const weight = s.comps.reduce((sum, comp) => sum + comp.weight, 0);
      const points = numeric.length && weight ? Math.round(numeric.reduce((sum, comp) => sum + (comp.reportedNum ?? comp.num) * comp.weight, 0) / weight) : null;
      const partial = s.incomplete || s.partial;
      let state = 'neutral', text = s.group || s.learning ? 'לומד' : '—';
      if (blocked) { state = 'bad'; text = 'חסם'; }
      else if (partial && points != null) { state = 'partial'; text = `${points} נק׳`; }
      else if ((s.status === 'pass' || s.compApplied) && s.source === 'bagrut' && !s.forecast && !s.comps.some(comp => comp.magenForecast)) {
        state = 'ok'; text = s.compApplied ? 'עבר בקיזוז' : 'עבר';
      } else if (s.exempt) { state = 'partial'; text = 'פטור'; }
      const detail = `${c.tip}${partial && points != null ? ` | נצברו ${points} נקודות מציונים מדווחים` : ''}`;
      const cell = { id, label, state, text, detail, ariaLabel: `${label}: ${text}` };
      const usesCurrent = sim.useCurrent && !s.exempt && Number.isFinite(s.current) &&
        (s.source === 'current' || s.filled.length > 0 || s.comps.some(comp => comp.magenForecast));
      const hasReported = s.comps.some(comp => comp.state === 'num' || comp.state === 'pass' || comp.failed || comp.blocked);
      return usesCurrent ? addForecast(cell, t, s.current, hasReported, points, blocked) : cell;
    };
    const majorCell = (t, ev) => {
      const c = this.majorDisplayCell(ev);
      const electives = ev.major.cands.filter(x => !x.coreId);
      const cand = electives.find(x => x.name === c.name || x.name.split('/')[0].trim() === c.name);
      const blocked = ev.tier !== 5 && ev.blockers.some(b => b.gate === 2 && !b.info &&
        (b.k === 'major-none' || (cand && b.text.includes(cand.name))));
      let state = 'neutral', text = cand && cand.enrolled ? 'לומד' : '—';
      const points = cand && !cand.complete && cand.bagrut != null ? majorPoints(t, cand) : null;
      if (blocked) { state = 'bad'; text = 'חסם'; }
      else if (points != null) { state = 'partial'; text = `${points} נק׳`; }
      else if (cand && cand.status === 'pass' && cand.complete && cand.source === 'bagrut' && !cand.forecast) { state = 'ok'; text = 'עבר'; }
      else if (cand && cand.exempt) { state = 'partial'; text = 'פטור'; }
      const more = Math.max(0, electives.length - 1);
      const detail = `${c.tip}${points != null ? ` | נצברו ${points} נקודות מציונים מדווחים` : ''}`;
      const cell = { id: 'major', label: majorLabel, state, text, detail, ariaLabel: `מגמה: ${text}`, more };
      const usesCurrent = sim.useCurrent && cand && !cand.exempt && Number.isFinite(cand.current) &&
        (cand.source === 'current' || (cand.bagrut != null && cand.missing.length > 0 && cand.grade != null));
      const hasReported = cand && (cand.bagrut != null || cand.bagrutPass || cand.failed || cand.blocked);
      return usesCurrent ? addForecast(cell, t, cand.current, hasReported, points, blocked) : cell;
    };
    const badge = (text, state, forecast = false) => `<span class="bagrut-cell bagrut-cell-${state}${state === 'bad' ? ' score-alert' : ''}${forecast ? ' bagrut-cell-forecast' : ''}">${E(text)}</span>`;
    const renderCell = cell => cell.noData ? '<td class="text-slate-400" title="לא ניתן לקבוע ללא נתוני בגרות לשכבה">—</td>' :
      cell.plain ? '<td>—</td>' :
      `<td class="mx-cell" ${tip(cell.detail)} aria-label="${E(cell.ariaLabel)}">${badge(cell.text, cell.state, cell.forecastOnly)}${cell.more ? ` <span class="bagrut-more">+${cell.more}</span>` : ''}</td>`;
    const status = (ev, signal) => {
      if (ev.tier === 5) return '<span class="bagrut-status bagrut-status-neutral">מסלול 12 שנות לימוד</span>';
      if (isUnknown(signal)) return UI.overallBadge('unknown');
      const text = ev.manualReview.required ? 'נדרשת החלטת רכזת' : this.tierBased(ev) ? ev.tierText : ev.paceText;
      const kind = this.tierBased(ev) ? (ev.tier === 4 ? 'bad' : ev.tier === 3 ? 'partial' : ev.tier === 0 ? 'neutral' : 'ok') :
        (ev.paceStatus === 'pace_lag' ? 'bad' : ev.paceStatus === 'pace_warning' ? 'partial' : ev.paceStatus === 'on_track' ? 'ok' : 'neutral');
      return `<span class="bagrut-status bagrut-status-${kind}" title="${E(ev.diagnostic)}">${E(text)}</span>`;
    };
    const pins = loadPins();
    const cols = 3 + (showClass ? 1 : 0) + BAGRUT_CORE.length + 1;
    const renderRow = ({ t, ev }) => {
      const signal = signals.get(t.tz);
      const options = t.gradeKey === 'יב' && this.state.bagrut.overviewEntry && this.state.filters.grade === 'all'
        ? finalOptions : sim;
      const unknown = noBagrutData(signal, options);
      const cells = unknown
        ? [...BAGRUT_CORE.map(([id, label]) => ({ id, label, text: '—', state: 'neutral', noData: true })), { id: 'major', label: majorLabel, text: '—', state: 'neutral', noData: true }]
        : [...BAGRUT_CORE.map(([id, label]) => coreCell(t, ev, id, label)), majorCell(t, ev)];
      matrixRows.set(t.tz, cells);
      const breakdown = UI.buildBagrutBreakdown(t, ev, { noData: unknown });
      return `<tr class="${pins.has(t.tz) ? 'bagrut-pinned-row' : ''}${this.state.bagrut.drawerTz === t.tz ? ' bg-drawer-row-active' : ''}" data-act="bagrutDrawerOpen" data-tz="${E(t.tz)}" tabindex="0" aria-label="${E(`פירוט זכאות: ${t.name}`)}">
        <td><div class="bagrut-student"><button type="button" class="bagrut-pin" data-act="bagrutPin" data-tz="${E(t.tz)}" aria-pressed="${pins.has(t.tz)}" aria-label="${pins.has(t.tz) ? 'הסר ממעקב צמוד' : 'הוסף למעקב צמוד'}: ${E(t.name)}" title="${pins.has(t.tz) ? 'הסר ממעקב צמוד' : 'הוסף למעקב צמוד'}">${pins.has(t.tz) ? '★' : '☆'}</button>
        <button type="button" class="bagrut-name" data-act="openProfile" data-tz="${E(t.tz)}" title="ת.ז ${E(t.tz)}">${E(t.name)}</button></div></td>
        ${showClass ? `<td>${E(Config.classLabel(t.classKey))}</td>` : ''}
        <td>${status(ev, signal)}</td><td class="bagrut-required bg-drawer-required" tabindex="0" data-breakdown-lines="${E(JSON.stringify(breakdown.tooltipLines))}"><span>${E(breakdown.cellSummary)}</span></td>
        ${cells.map(renderCell).join('')}</tr>`;
    };
    const pinnedRows = list.filter(r => pins.has(r.t.tz));
    const body = (pinnedRows.length ? `<tr class="room-divider"><td colspan="${cols}">📌 נעוצים (${pinnedRows.length} חניכים)</td></tr>${pinnedRows.map(renderRow).join('')}` : '') +
      list.filter(r => !pins.has(r.t.tz)).map(renderRow).join('');
    this._bagrutMatrixRows = matrixRows;
    const coreHead = ([id, l]) => `<th><button type="button" class="font-semibold hover:underline" data-act="bagrutDrill" data-sel="core:${id}" title="מטריצת שאלונים – ${E(l)}">${l}</button></th>`;
    const sortButton = (key, label) => `<button type="button" class="btn btn-ghost btn-sm" data-act="bagrutSort" data-key="${key}" aria-pressed="${sort === key}">${label}${sort === key ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button>`;
    return `<div class="bagrut-sort" role="group" aria-label="מיון חניכים"><span>מיון לפי:</span>${sortButton('tier', 'חומרת סיכון')}${sortButton('class', 'כיתה')}${sortButton('name', 'שם')}</div>
      <table class="grid mx bagrut-grid w-full text-center"><thead><tr><th>חניך</th>${showClass ? '<th>כיתה</th>' : ''}<th>סטטוס זכאות / צבירה</th><th>מה נדרש</th>${BAGRUT_CORE.map(coreHead).join('')}<th>${E(majorLabel)}</th></tr></thead>
      <tbody>${body || `<tr><td colspan="${cols}" class="text-center text-slate-400 py-8">אין שורות להצגה</td></tr>`}</tbody></table>
      <div class="bagrut-legend"><span><i class="bagrut-cell-ok"></i> עבר</span><span><i class="bagrut-cell-bad"></i> חסם פעיל</span><span><i class="bagrut-cell-partial"></i> נקודות שנצברו</span><span><i class="bagrut-cell-neutral"></i> לומד / אין נתון</span>${sim.useCurrent ? '<span><span class="bagrut-cell bagrut-cell-ok bagrut-cell-forecast">שוטף 85</span> תחזית</span>' : ''}</div>`;
  },

  /** חלון מידע צף (ריחוף / לחיצה / מקלדת) לפירוט תא בגיליון השליטה */
  showMxPop(el, pin) {
    const pop = $('mxPop');
    if (!pop || !el || !el.dataset.tip) return;
    describeMxCell(this._mxTrigger, false);
    const [head, ...lines] = el.dataset.tip.split(' | ');
    pop.innerHTML = `<div class="h">${E(head)}</div>${lines.map(l => `<div>${E(l)}</div>`).join('')}`;
    pop.style.pointerEvents = pin ? 'auto' : 'none';
    pop.tabIndex = pin ? 0 : -1;
    pop.classList.remove('hidden');
    const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - 8));
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 6;
    top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
    this._mxTrigger = el;
    describeMxCell(el, true);
    this._mxPinned = pin ? el : null;
  },

  hideMxPop() {
    const pop = $('mxPop');
    if (pop) pop.classList.add('hidden');
    describeMxCell(this._mxTrigger, false);
    this._mxTrigger = null;
    this._mxPinned = null;
  },
  };
})();
