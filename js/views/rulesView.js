(function () {
  'use strict';
  const E = UI.esc;
  const $ = id => document.getElementById(id);
  const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };
  const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const setVal = (id, value) => { const el = $(id); if (el) el.value = value; };
  const setChecked = (id, value) => { const el = $(id); if (el) el.checked = !!value; };
  const on = (id, event, fn) => { const el = $(id); if (el) el.addEventListener(event, fn); };
  const natural = (a, b) => String(a).localeCompare(String(b), 'he', { numeric: true });

  window.RulesView = {
  applyRule(res) {
    if (res && res.ok === false) { this.toast(res.error || 'השינוי נדחה', 'error'); this.renderRulesDrawer(); }
  },

  /** שיוך שכבות למחזורי לימוד + בורר המחזור הנערך עם כפתורי העתקה והוספה */
  renderCohortUi() {
    const cohorts = Object.values(Config.getCohortProfiles()), map = Config.getGradeCohortMap();
    const active = Config.getActiveCohortId();
    const GRADES = [['12', 'יב'], ['11', 'יא'], ['10', 'י']];
    setHtml('cohortAssign', `<div class="cohort-card">
      <div class="flex flex-wrap items-baseline gap-x-3"><span class="font-bold text-[#355747]">שיוך שכבות למחזורי לימוד</span>
        <span class="text-xs text-slate-500">כל חניך נבדק לפי כללי הבגרות של המחזור המשויך לשכבתו</span></div>
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 mt-2">${GRADES.map(([n, key]) => `
        <label class="flex items-center gap-2 text-sm font-semibold text-[#355747]">שכבת ${E(Util.gl(key))}:
          <select class="inp" data-chg="gradeCohort" data-grade="${n}" aria-label="${E(`מחזור לשכבת ${Util.gl(key)}`)}">${cohorts.map(c => `<option value="${E(c.id)}" ${map[n] === c.id ? 'selected' : ''}>${E(c.name)}</option>`).join('')}</select></label>`).join('')}
      </div></div>`);
    const gradesOf = id => GRADES.filter(([n]) => map[n] === id).map(([, key]) => `שכבת ${Util.gl(key)}`).join(', ');
    setHtml('cohortBar', `<div class="flex flex-wrap items-center justify-between gap-2">
      <div><div class="text-xs font-semibold text-[#75977D] mb-1">בחירת מחזור לעריכת חוקי בגרות ושאלונים</div>
        <div class="flex flex-wrap gap-1.5" role="tablist" aria-label="מחזורים">${cohorts.map(c => {
          const g = gradesOf(c.id);
          return `<button type="button" role="tab" class="chip cohort-tab" data-act="cohortEdit" data-id="${E(c.id)}" aria-selected="${c.id === active}" aria-pressed="${c.id === active}">${E(c.name)}${g ? ` <span class="text-[11px] opacity-80">[${E(g)}]</span>` : ''}</button>`;
        }).join('')}</div></div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-ghost btn-sm" data-act="cohortCopy">📋 העתק חוקים ממחזור אחר...</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="cohortAdd">➕ הוסף מחזור חדש</button>
      </div></div>`);
  },

  cohortName(id) { const c = Config.getCohortProfiles()[id]; return c ? c.name : ''; },

  renderRulesDrawer() {
    this.renderCohortUi();
    const r = Config.rules();
    const warnings = Config.rulesWarnings(r);
    setHtml('rulesWarnings', warnings.map(w => `<div>${E(w)}</div>`).join(''));
    setChecked('ruleCompEnabled', r.allowCompensationRule !== false);
    setChecked('ruleCompPoints', Config.pointsCompensation().enabled);
    setVal('ruleCompMin', r.compensationMin);
    setVal('ruleCompMax', r.compensationMax);
    setVal('ruleCompCount', r.maxCompensations);
    setVal('ruleCompExcluded', (r.compensationExcludedSubjects || []).join(', '));
    setVal('ruleParamPass', r.passGrade);
    setVal('ruleParamBorderline', r.borderlineMin);
    setVal('ruleParamBonus', r.borderlineBonus);
    setVal('ruleParamMagen', Config.magenWeight());

    const gates = r.gates || {};
    setHtml('rulesGates', ['core', 'major', 'internal'].map(g => `
      <label class="flex items-center gap-2"><input type="checkbox" class="w-4 h-4" data-chg="gateToggle" data-gate="${g}" ${gates[g] && gates[g].enabled === false ? '' : 'checked'}>${E(g === 'internal' ? 'מקצועות פנימיים' : (gates[g] && gates[g].label) || g)}</label>`).join('') +
      `<label class="flex items-center gap-2 text-xs">יח"ל מינימום במגמה<input type="number" min="1" max="5" class="inp w-16" data-chg="gateUnits" value="${(gates.major && gates.major.requiredUnits) || 5}"></label>`);

    const attrs = (kind, id, level, i) => `data-kind="${kind}" data-id="${E(id)}" data-level="${E(level)}" data-i="${i}"`;
    const GRADE_OPTS = ['י', 'יא', 'יב'];
    const compRow = (s, level, c, i) => {
      const q = r.questionnaires[c.codes[0]];
      const grade = c.expectedGrade || (q ? q.expectedGrade : 'יב');
      const comps = (s.variableUnits ? (s.levels || {})[level] : s.components) || [c];
      const magen = BagrutFacts.isInternalComp(c, comps) ? ''
        : `<label class="flex items-center gap-1 whitespace-nowrap">מגן<input type="number" min="0" max="100" class="inp w-14" placeholder="${Config.magenWeight()}" value="${c.magenWeight ?? ''}" title="משקל ציון הגשה/מגן לשאלון (ריק = ברירת מחדל של המחזור)" data-chg="compMagen" ${attrs('core', s.id, level, i)}>%</label>`;
      return `<div class="q-row ${c.enabled === false ? 'opacity-50' : ''}">
        <input type="checkbox" class="w-4 h-4" aria-label="פעיל" data-chg="compEnabled" ${attrs('core', s.id, level, i)} ${c.enabled === false ? '' : 'checked'}>
        <input type="text" class="inp q-codes" dir="ltr" aria-label="סמלי שאלון" value="${E(c.codes.join(', '))}" data-chg="compCodes" ${attrs('core', s.id, level, i)}>
        <label class="flex items-center gap-1 whitespace-nowrap">משקל<input type="number" min="0" max="100" class="inp q-weight" value="${c.weight}" data-chg="compWeight" ${attrs('core', s.id, level, i)}>%</label>
        ${magen}
        <select class="inp q-grade" aria-label="נדרש עד שכבה" title="נדרש עד שכבה" data-chg="compGrade" ${attrs('core', s.id, level, i)}>${GRADE_OPTS.map(g => `<option value="${g}" ${grade === g ? 'selected' : ''}>${Util.gl(g)}</option>`).join('')}</select>
        <input type="text" class="inp q-name" aria-label="שם השאלון" placeholder="שם השאלון" title="שם השאלון בקטלוג" value="${E(q ? q.name : '')}" data-chg="qName" data-code="${E(c.codes[0])}">
        <button type="button" class="btn btn-danger btn-sm" aria-label="הסרת שאלון" data-act="compRemove" ${attrs('core', s.id, level, i)}>✕</button></div>`;
    };
    const compBlock = (s, level, label, comps) => {
      const sum = comps.filter(c => c.enabled !== false).reduce((a, c) => a + (Number(c.weight) || 0), 0);
      return `<div class="mt-1">${label ? `<div class="text-xs font-medium text-slate-600">${E(label)}</div>` : ''}
        ${comps.map((c, i) => compRow(s, level, c, i)).join('')}
        <div class="flex items-center gap-2 text-xs mt-1"><button type="button" class="btn btn-ghost btn-sm" data-act="compAdd" ${attrs('core', s.id, level, '')}>+ שאלון</button>
          <span class="${comps.length && Math.round(sum) !== 100 ? 'text-amber-700 font-medium' : 'text-slate-400'}">סה"כ ${Math.round(sum)}%</span></div></div>`;
    };
    /* שאלונים בקטלוג שאין להם שימוש בשום מקצוע, יחידה או מגמה: ניתנים להסרה */
    const used = new Set([
      ...r.coreSubjects.flatMap(s => (s.variableUnits ? Object.values(s.levels || {}) : [s.components || []]).flat().flatMap(c => c.codes || [])),
      ...r.internals.flatMap(i => i.codes || []), ...r.majors.flatMap(m => m.codes || [])
    ].map(String));
    const orphans = Object.keys(r.questionnaires || {}).filter(code => !used.has(code));
    const orphanHtml = orphans.length ? `<div class="border border-dashed border-slate-300 rounded-lg p-2 bg-white text-xs">
      <div class="font-medium text-slate-600 mb-1">שאלונים בקטלוג ללא שימוש</div>
      ${orphans.map(code => `<div class="flex items-center gap-2 py-0.5"><span class="tz-col">${E(code)}</span><span class="text-slate-500 truncate">${E(r.questionnaires[code].name || '')}</span>
        <button type="button" class="btn btn-danger btn-sm mr-auto" aria-label="הסרת שאלון ${E(code)} מהקטלוג" data-act="qRemove" data-code="${E(code)}">הסרה</button></div>`).join('')}</div>` : '';
    setHtml('rulesCore', r.coreSubjects.map(s => `
      <div class="border border-slate-200 rounded-lg p-2 bg-white ${s.enabled === false ? 'opacity-60' : ''}">
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-2 font-medium"><input type="checkbox" class="w-4 h-4" data-chg="ruleToggle" data-kind="core" data-id="${E(s.id)}" ${s.enabled === false ? '' : 'checked'}>${E(s.name)}</label>
          <span class="text-xs text-slate-400">${s.variableUnits ? 'יח"ל משתנה' : `${s.units} יח"ל`}</span>
          <button type="button" class="btn btn-danger btn-sm mr-auto" data-act="ruleRemove" data-kind="core" data-id="${E(s.id)}">הסרה</button>
        </div>
        ${s.variableUnits ? Object.keys(s.levels || {}).sort().map(l => compBlock(s, l, `${l} יח"ל`, s.levels[l])).join('') : compBlock(s, '', '', s.components || [])}
      </div>`).join('') + orphanHtml);

    setHtml('rulesMajor', r.majors.map(m => `
      <div class="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg p-2 bg-white text-sm ${m.enabled === false ? 'opacity-60' : ''}">
        <label class="flex items-center gap-2 font-medium min-w-[180px]"><input type="checkbox" class="w-4 h-4" data-chg="ruleToggle" data-kind="major" data-id="${E(m.id)}" ${m.enabled === false ? '' : 'checked'}>${E(m.name)}</label>
        <label class="flex items-center gap-1 text-xs">סמלים<input type="text" class="inp w-40" value="${E(m.codes.join(', '))}" data-chg="clauseCodes" data-kind="major" data-id="${E(m.id)}"></label>
        <label class="flex items-center gap-1 text-xs">נדרש עד שכבה
          <select class="inp" data-chg="clauseGrade" data-kind="major" data-id="${E(m.id)}">${GRADE_OPTS.map(g => `<option value="${g}" ${m.expectedGrade === g ? 'selected' : ''}>${Util.gl(g)}</option>`).join('')}</select></label>
        <label class="flex items-center gap-1 text-xs">מילות מפתח<input type="text" class="inp w-44" value="${E((m.keywords || []).join(', '))}" data-chg="clauseKeywords" data-kind="major" data-id="${E(m.id)}"></label>
        <button type="button" class="btn btn-danger btn-sm mr-auto" data-act="ruleRemove" data-kind="major" data-id="${E(m.id)}">הסרה</button></div>`).join(''));

    setHtml('rulesInternal', r.internals.map(it => `
      <div class="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg p-2 bg-white text-sm ${it.enabled === false ? 'opacity-60' : ''}">
        <label class="flex items-center gap-2 font-medium min-w-[160px]"><input type="checkbox" class="w-4 h-4" data-chg="ruleToggle" data-kind="internal" data-id="${E(it.id)}" ${it.enabled === false ? '' : 'checked'}>${E(it.name)}</label>
        <label class="flex items-center gap-1 text-xs">סמלים<input type="text" class="inp w-32" value="${E(it.codes.join(', '))}" data-chg="clauseCodes" data-kind="internal" data-id="${E(it.id)}"></label>
        <label class="flex items-center gap-1 text-xs">נדרש עד שכבה
          <select class="inp" data-chg="internalGrade" data-id="${E(it.id)}">${['י', 'יא', 'יב'].map(g => `<option value="${g}" ${it.expectedGrade === g ? 'selected' : ''}>${Util.gl(g)}</option>`).join('')}</select></label>
        <button type="button" class="btn btn-danger btn-sm mr-auto" data-act="ruleRemove" data-kind="internal" data-id="${E(it.id)}">הסרה</button></div>`).join(''));

    const plan = [];
    r.coreSubjects.filter(s => s.enabled !== false).forEach(s => {
      const lists = s.variableUnits ? Object.entries(s.levels || {}) : [['', s.components || []]];
      lists.forEach(([level, comps]) => comps.forEach((c, i) => {
        if (c.enabled !== false) plan.push({ c, label: s.name + (level ? ` ${level} יח"ל` : '') + ` · ${c.weight}%`, handler: 'compGrade', attrs: attrs('core', s.id, level, i) });
      }));
    });
    ['major', 'internal'].forEach(kind => {
      const list = kind === 'major' ? r.majors : r.internals;
      list.filter(c => c.enabled !== false).forEach(c => plan.push({
        c, label: `${c.name} · ${kind === 'major' ? 'מגמה' : 'פנימי'}`, handler: 'clauseGrade', attrs: `data-kind="${kind}" data-id="${E(c.id)}"`
      }));
    });
    setHtml('rulesPlan', GRADE_OPTS.map(g => {
      const rows = plan.filter(row => BagrutFacts.compOrd(row.c) === Util.ord(g));
      return `<section class="border border-slate-200 rounded-lg p-3 bg-white">
        <h3 class="font-semibold mb-2">שכבת ${Util.gl(g)}</h3>
        ${rows.length ? rows.map(row => `<div class="flex flex-wrap items-center gap-2 py-1 text-sm">
          <span>${E(row.label)}</span><span class="tz-col text-xs text-slate-500" dir="ltr">${E((row.c.codes || []).join(', '))}</span>
          <select class="inp mr-auto" aria-label="${E(`נדרש עד שכבה: ${row.label}`)}" data-chg="${row.handler}" ${row.attrs}>${GRADE_OPTS.map(opt => `<option value="${opt}" ${opt === g ? 'selected' : ''}>${Util.gl(opt)}</option>`).join('')}</select>
        </div>`).join('') : '<p class="text-xs text-slate-400">אין רכיבים לשכבה זו</p>'}</section>`;
    }).join(''));

    const RULE_TABS = [['core', 'שער 1 – מקצועות ליבה'], ['major', 'שער 2 – מגמות'], ['internal', 'מקצועות פנימיים'], ['params', 'חוק קיזוז ופרמטרים'], ['plan', 'תוכנית היבחנות']];
    const tab = RULE_TABS.some(x => x[0] === this.state.rulesTab) ? this.state.rulesTab : 'core';
    setHtml('rulesTabs', RULE_TABS.map(([id, label]) => `<button type="button" role="tab" class="chip" data-act="rulesTab" data-sub="${id}" aria-selected="${tab === id}" aria-pressed="${tab === id}">${label}</button>`).join(''));
    document.querySelectorAll('[data-rules-pane]').forEach(p => { p.hidden = p.dataset.rulesPane !== tab; });
  },

  ruleAdd(kind) {
    const split = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
    const gradeOpts = ['י', 'יא', 'יב'].map(g => ({ value: g, label: Util.gl(g) }));
    if (kind === 'core') {
      this.formModal('הוספת מקצוע ליבה', [
        { key: 'name', label: 'שם המקצוע' }, { key: 'units', label: 'יח"ל', type: 'number', value: 2 },
        { key: 'keywords', label: 'מילות מפתח לזיהוי קבוצה (מופרדות בפסיקים)' },
        { key: 'code', label: 'סמל שאלון ראשון (אופציונלי)' }, { key: 'weight', label: 'משקל השאלון (%)', type: 'number', value: 100 },
        { key: 'grade', label: 'נדרש עד שכבה', type: 'select', value: 'יב', options: gradeOpts }
      ], v => Config.addClause('core', {
        name: v.name.trim(), units: Number(v.units) || 2, keywords: split(v.keywords).length ? split(v.keywords) : [v.name.trim()],
        components: v.code.trim() ? [{ codes: split(v.code), weight: Number(v.weight), expectedGrade: v.grade, enabled: true }] : []
      }));
    } else if (kind === 'major') {
      this.formModal('הוספת מגמה', [
        { key: 'name', label: 'שם המגמה' }, { key: 'keywords', label: 'מילות מפתח לזיהוי קבוצה (מופרדות בפסיקים)' },
        { key: 'codes', label: 'סמלי שאלון (מופרדים בפסיקים)' },
        { key: 'grade', label: 'נדרש עד שכבה', type: 'select', value: 'יב', options: gradeOpts }
      ], v => Config.addClause('major', { name: v.name.trim(), keywords: split(v.keywords).length ? split(v.keywords) : [v.name.trim()], codes: split(v.codes), expectedGrade: v.grade }));
    } else {
      this.formModal('הוספת יחידה פנימית', [
        { key: 'name', label: 'שם היחידה' }, { key: 'codes', label: 'סמלי שאלון (מופרדים בפסיקים)' },
        { key: 'grade', label: 'נדרש עד שכבה', type: 'select', value: 'יב', options: gradeOpts }
      ], v => Config.addClause('internal', { name: v.name.trim(), codes: split(v.codes), expectedGrade: v.grade }));
    }
  },

  /** עדכון רכיב שאלון (קודים / משקל / פעיל) מתוך שורת העורך */
  patchComp(el, patch) {
    const { kind, id, level } = el.dataset, i = +el.dataset.i;
    const s = Config.rules().coreSubjects.find(x => x.id === id);
    const c = s && (s.variableUnits ? s.levels[level] : s.components)[i];
    if (c) this.applyRule(Config.upsertComponent(kind, id, level, i, { ...c, ...patch }));
  },

  renderSettingsNav() {
    const view = ['roster', 'overrides', 'rules', 'system'].includes(this.state.settingsView) ? this.state.settingsView : 'roster';
    this.state.settingsView = view;
    document.querySelectorAll('[data-settings-pane]').forEach(p => { p.hidden = p.dataset.settingsPane !== view; });
    document.querySelectorAll('#settingsTabs [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    const badge = (id, n, title) => { const el = $(id); if (el) { el.classList.toggle('hidden', !n); el.textContent = n; el.title = title; } };
    const overrides = Object.keys(Config.getRosterOverrides()).length;
    badge('setBadgeOverrides', overrides, `${overrides} דריסות שיוך פעילות`);
    const unmapped = this.unrecognizedCodes().length;
    badge('setBadgeRules', unmapped, `${unmapped} שאלונים שטרם שויכו`);
  },

  renderSettingsPanel() {
    this.renderFreshnessBar('roster');
    const roster = Config.getRoster();
    let html;
    if (!roster.length) {
      html = '<div class="text-slate-500">טרם נטענה מצבת. אפשר לטעון קובץ אקסל.</div>';
    } else {
      const byClass = new Map();
      roster.forEach(r => byClass.set(r.homeroom, (byClass.get(r.homeroom) || 0) + 1));
      const classes = [...byClass.keys()].sort((a, b) => Util.ord(Util.parseClass('', a).gradeKey) - Util.ord(Util.parseClass('', b).gradeKey) || natural(a, b));
      const rep = this.rosterReport;
      html = `<div class="font-medium mb-1">${roster.length} חניכים פעילים · ${classes.length} כיתות אם</div>
        <div class="flex flex-wrap gap-1 mb-2">${classes.map(c => `<button type="button" class="class-pill" data-act="classRoster" data-class="${E(c)}" title="הצגת חניכי הכיתה ושיוך מהיר" aria-haspopup="dialog">${E(Config.classLabel(c))}: ${byClass.get(c)}</button>`).join('')}</div>
        ${rep ? `<div class="text-xs text-slate-500">נקלטו ${rep.sheets.length} גיליונות${rep.skipped ? ` · ${rep.skipped} שורות דולגו` : ''}${rep.duplicates ? ` · ${rep.duplicates} כפילויות אוחדו` : ''}${rep.ignored ? ` · ${rep.ignored} חניכי ז'-ט' לא נקלטו` : ''}</div>
          ${rep.warnings.map(w => `<div class="text-xs text-amber-700 mt-1">${E(w)}</div>`).join('')}` : ''}
        <div class="flex gap-2 mt-3"><button type="button" class="btn btn-danger btn-sm" data-act="deleteRoster">מחיקת המצבת</button></div>`;
    }
    setHtml('rosterSummary', html);

    const rawRows = Config.getRosterEntry() ? Config.getRosterEntry().data : [];
    const counts = new Map();
    rawRows.forEach(r => counts.set(r.homeroom, (counts.get(r.homeroom) || 0) + 1));
    const classes = [...counts.keys()].sort((a, b) => Util.ord(Util.parseClass('', a).gradeKey) - Util.ord(Util.parseClass('', b).gradeKey) || natural(a, b));
    const classRow = c => `
      <label class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 p-2 text-sm cursor-pointer">
        <span><strong>${E(Config.classLabel(c))}</strong> <span class="text-xs text-slate-600">(${counts.get(c)} חניכים)</span></span>
        <span class="flex items-center gap-1 text-xs font-bold whitespace-nowrap">
          <input type="checkbox" class="w-4 h-4" data-chg="specialEd" data-class="${E(c)}" ${Config.isSpecialEdClass(c) ? 'checked' : ''}>כיתת חנ"מ</span>
      </label>`;
    setHtml('nicknames', classes.length
      ? classes.map(classRow).join('')
      : '<div class="text-sm text-slate-400 md:col-span-3">הכיתות יוצגו לאחר טעינת המצבת.</div>');
    setText('configSummary', `${Object.keys(Config.data.traineeExceptions).length} רשומות חריג/מסלול שמורות · ${Object.keys(Config.getRosterOverrides()).length} דריסות שיוך`);
    this.renderRosterOverrides();
    this.renderDataTools();
    this.renderCloudCard();
    this.renderCalibration();
    this.renderRulesDrawer();
    this.renderSettingsNav();
    RulesView.renderQuarantineReports.call(this);
  },

  renderQuarantineReports() {
    const pane = document.querySelector('[data-settings-pane="system"]');
    if (!pane) return;
    let host = $('quarantineReports');
    if (!host) {
      host = document.createElement('section');
      host.id = 'quarantineReports';
      host.className = 'card p-4 space-y-3 xl:col-span-2';
      pane.appendChild(host);
    }
    const quarantine = window.ImportQuarantine;
    if (!quarantine) {
      host.innerHTML = '<div class="text-slate-600">דוח הסגר הקליטה אינו זמין.</div>';
      return;
    }
    const items = quarantine.list(), summary = quarantine.summarize(items);
    const audit = quarantine.auditConsistency(this);
    const breakdown = values => values.map(([label, count]) => `${E(label)}: ${count}`).join(' · ');
    const rows = items.slice(-100).reverse().map(item => `<tr>
      <td>${E(item.fileName || item.fileType)}</td><td>${E(item.gradeScope ? Util.gl(item.gradeScope) : 'לא ידועה')}</td>
      <td>${E(item.reason)}</td><td>${E(item.key || '—')}</td><td>${E(item.label || '—')}</td></tr>`).join('');
    const details = value => typeof value === 'string' ? value : JSON.stringify(value);
    host.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold">דוח הסגר קליטה</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-act="quarantineClear" ${items.length ? '' : 'disabled'}>נקה דוח הסגר</button></div>
      <p class="text-xs text-slate-500">הממצאים הם תמונת מצב בזמן הקליטה בלבד, נשמרים בזיכרון ונמחקים ברענון הדף. הם אינם משנים את הנתונים שנקלטו.</p>
      <div class="text-sm">${summary.total ? `${summary.total} פריטים · ${breakdown(summary.reasons)}` : 'אין פריטים בהסגר.'}</div>
      ${summary.total ? `<div class="text-xs text-slate-600">לפי שכבה: ${breakdown(summary.gradeScopes)}</div>
        <div class="tbl-wrap"><table class="grid w-full text-sm"><thead><tr><th>קובץ</th><th>שכבה</th><th>סיבה</th><th>מזהה</th><th>פירוט</th></tr></thead><tbody>${rows}</tbody></table></div>
        ${items.length > 100 ? '<p class="text-xs text-slate-500">מוצגים 100 הפריטים האחרונים.</p>' : ''}
        <p class="text-xs text-slate-500">כאשר המפענח מחזיר רק מספר שורות שדולגו, פרטי השורות מוצגים כלא זמינים.</p>` : ''}
      <div class="border-t border-slate-200 pt-3">
        <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold">דוח עקביות מערכת</h3>
          <button type="button" class="btn btn-ghost btn-sm" data-act="quarantineAudit">בדוק שוב</button></div>
        ${audit.ok ? `<p class="text-sm text-emerald-700">לא נמצאו סתירות במדדים שנבדקו (${audit.summary.total} חניכים באוכלוסיית הייחוס).</p>`
          : `<p class="text-sm text-amber-800">נמצאו ${audit.issues.length} בעיות או בדיקות שלא הושלמו:</p>
            <ul class="text-sm text-amber-800">${audit.issues.map(issue => `<li>${E(issue.message)} ${E(details(issue.details))}</li>`).join('')}</ul>`}
      </div>`;
  },

  quarantineClear() {
    if (!window.ImportQuarantine || !this.confirmAction('לנקות את דוח הסגר הקליטה שבזיכרון? הנתונים שנקלטו לא יימחקו.')) return;
    window.ImportQuarantine.clear();
    RulesView.renderQuarantineReports.call(this);
  },

  quarantineAudit() { RulesView.renderQuarantineReports.call(this); },

  /* ---------- דריסת שיוך שכבה וכיתת אם ---------- */
  rawLabel(r) { return r.added ? '— (לא במצבת)' : `${r.rawHomeroom}${r.rawClassName ? ` • ${r.rawClassName}` : ''}`; },
  effLabel(r) { return `${r.homeroom}${r.className ? ` • ${r.className}` : ''}`; },

  /** כל החניכים שאפשר לדרוס: המצבת (כולל מוסתרים) + ת.ז מקובצי המשוב שאינן במצבת */
  ovCandidates() {
    const out = Config.getRosterAll().map(r => ({ tz: r.tz, name: `${r.firstName} ${r.lastName}`.trim() || r.tz, rec: r }));
    const known = new Set(out.map(c => c.tz));
    GroupAnalyzer.unmatchedIds().forEach(u => { if (!known.has(u.tz)) out.push({ tz: u.tz, name: u.name || u.tz, rec: null }); });
    return out;
  },

  ovSearchResults() {
    const input = $('overrideTraineeSearch'), results = $('ovResults');
    const q = this.ovTz ? '' : Util.norm(input.value).toLocaleLowerCase();
    const matches = (this._ovCands || []).filter(c => Util.norm(c.name).toLocaleLowerCase().includes(q) || c.tz.toLocaleLowerCase().includes(q));
    results.innerHTML = matches.map(c => `<button type="button" class="block w-full text-right px-3 py-2 border-b border-slate-100 hover:bg-indigo-50 focus:bg-indigo-50" data-act="ovPick" data-tz="${E(c.tz)}">
      <span class="font-bold">${E(c.name)}</span> <span class="font-mono text-xs">${E(c.tz)}</span>
      <span class="block text-xs text-slate-700">כיתה נוכחית במצבת: ${E(c.rec ? this.effLabel(c.rec) : 'לא במצבת')}${c.rec && c.rec.hidden ? ' · מוסתר' : ''}</span></button>`).join('') ||
      '<div class="p-3 text-sm text-slate-700">לא נמצא חניך מתאים</div>';
    results.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  },

  ovCloseResults() {
    $('ovResults').classList.add('hidden');
    $('overrideTraineeSearch').setAttribute('aria-expanded', 'false');
  },

  ovSetHomeroom(value) {
    const select = $('ovHomeroom'), other = $('ovOtherHomeroom');
    const known = [...select.options].some(o => o.value === value && value !== 'other');
    select.value = known ? value : 'other';
    other.value = known ? '' : value;
    other.classList.toggle('hidden', select.value !== 'other');
  },

  ovSyncGrade(value) {
    const grade = Util.parseClass('', value).gradeKey;
    if (Util.GRADE_KEYS.includes(grade)) setVal('ovGrade', grade);
  },

  ovSyncDefaultTrack(home) {
    const c = (this._ovCands || []).find(x => x.tz === this.ovTz);
    const o = Config.getRosterOverrides()[this.ovTz];
    if (!c || !c.rec || this.ovTrackEdited || (o && o.track)) return;
    const base = c.rec.rawTrack || c.rec.track;
    setVal('ovTrack', Config.defaultTrack(base, home || c.rec.rawHomeroom || c.rec.homeroom));
  },

  renderRosterOverrides() {
    if (!$('ovTable')) return;
    this._ovCands = this.ovCandidates();
    const entry = Config.getRosterEntry();
    const classes = [...new Set((entry ? entry.data : []).map(r => r.homeroom))].sort(natural);
    setHtml('ovHomeroom', '<option value="">ללא שינוי</option>' + Util.GRADE_KEYS.map(g => {
      const rooms = classes.filter(c => Util.parseClass('', c).gradeKey === g);
      return rooms.length ? `<optgroup label="שכבה ${E(Util.gl(g))}">${rooms.map(c => `<option value="${E(c)}">${E(Config.classLabel(c))}</option>`).join('')}</optgroup>` : '';
    }).join('') + '<option value="other">אחר (הקלד כיתה חדשה)...</option>');
    const track = $('ovTrack');
    if (track && track.options.length < 2) track.innerHTML += Config.TRACKS.map(t => `<option value="${E(t)}">${E(t)}</option>`).join('');

    const byTz = new Map(Config.getRosterAll().map(r => [r.tz, r]));
    const ovs = Object.values(Config.getRosterOverrides()).sort((a, b) => b.updatedAt - a.updatedAt);
    setText('ovCount', `(${ovs.length})`);
    setText('ovClearAll', `🧹 בטל את כל הדריסות (${ovs.length})`);
    $('ovClearAll').disabled = !ovs.length;
    const rows = ovs.map(o => {
      const r = byTz.get(o.tz);
      const name = r ? `${r.firstName} ${r.lastName}`.trim() : (o.name || o.tz);
      const eff = o.homeroom && r ? this.effLabel(r) : (o.homeroom || 'ללא שינוי');
      const status = [o.hidden ? '🚫 עזב / לא פעיל' : '', o.track ? `מסלול: ${o.track}` : '', o.note].filter(Boolean).map(E).join(' · ') || '—';
      return `<tr class="${o.hidden ? 'opacity-60' : ''}"><td class="tz-col text-right">${E(o.tz)}</td><td class="text-right font-medium">${E(name)}</td>
        <td class="text-right whitespace-nowrap">${E(r ? this.rawLabel(r) : '— (לא במצבת)')}</td><td class="text-right whitespace-nowrap">${E(eff)}</td>
        <td class="text-right">${status}</td>
        <td class="text-right"><button type="button" class="btn btn-ghost btn-sm" data-act="ovRemove" data-tz="${E(o.tz)}">בטל דריסה</button></td></tr>`;
    }).join('');
    setHtml('ovTable', `<table class="grid w-full"><thead><tr><th class="tz-col text-right">ת.ז</th><th class="text-right">שם חניך</th><th class="text-right">שיוך מקורי בקובץ</th><th class="text-right">שיוך דורס פעיל</th><th class="text-right">סטטוס / מסלול</th><th class="text-right">פעולה</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="text-center text-slate-400 py-6">אין דריסות פעילות</td></tr>'}</tbody></table>`);
    this.ovSelect(this.ovTz);
  },

  /** בחירת חניך בטופס: מציג את השיוך המקורי ומטעין דריסה קיימת */
  ovSelect(tz) {
    const search = $('overrideTraineeSearch');
    if (!search) return;
    const c = (this._ovCands || []).find(x => x.tz === tz);
    this.ovTz = c ? tz : '';
    const info = $('ovInfo'), nameWrap = $('ovNameWrap');
    ['rounded-lg', 'border', 'border-indigo-300', 'bg-indigo-50', 'text-indigo-900', 'px-3', 'py-2', 'font-semibold'].forEach(cls => info.classList.toggle(cls, !!c));
    if (nameWrap) nameWrap.classList.add('hidden');
    if (!c) {
      info.textContent = 'בחרו חניך כדי לראות את השיוך המקורי בקובץ.';
      ['ovGrade', 'ovHomeroom', 'ovOtherHomeroom', 'ovTrack', 'ovNote', 'ovName'].forEach(id => setVal(id, ''));
      $('ovOtherHomeroom').classList.add('hidden');
      setChecked('ovHidden', false);
      return;
    }
    const o = Config.getRosterOverrides()[tz];
    this.ovTrackEdited = false;
    search.value = `${c.name} • ${c.tz}`;
    if (c && c.rec && !c.rec.added) {
      info.textContent = `נבחר: ${c.name} (מקור בקובץ: ${this.rawLabel(c.rec)})${o && o.hidden ? ' · מוסתר כרגע' : ''}`;
    } else {
      info.textContent = `נבחר: ${c.name} (מקור בקובץ: לא במצבת) – יש להזין שכבה וכיתת אם כדי להוסיף אותו.`;
      if (nameWrap) nameWrap.classList.remove('hidden');
      setVal('ovName', (o && o.name) || (c && c.name) || '');
    }
    setVal('ovGrade', c.rec ? c.rec.grade : '');
    this.ovSetHomeroom(c.rec ? c.rec.homeroom : '');
    setVal('ovTrack', c.rec ? ((o && o.track) || Config.defaultTrack(c.rec.rawTrack || c.rec.track, c.rec.homeroom)) : '');
    setChecked('ovHidden', o && o.hidden);
    setVal('ovNote', (o && o.note) || '');
  },

  /** חלון שיוך מהיר: חניכי כיתת אם אחת, עם שינוי כיתה / מסלול מיידי */
  openClassRoster(classKey) {
    const members = Config.getRoster().filter(r => r.homeroom === classKey)
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'he'));
    const prev = document.querySelector('#modal-root [data-act="modalBackdrop"]');
    const scroll = prev ? prev.scrollTop : 0;
    if (!members.length) return this.closeModal();
    const classes = [...new Set(Config.getRoster().map(r => r.homeroom))].sort(natural);
    const homeOptions = current => Util.GRADE_KEYS.map(g => {
      const rooms = classes.filter(c => Util.parseClass('', c).gradeKey === g);
      return rooms.length ? `<optgroup label="שכבה ${E(Util.gl(g))}">${rooms.map(c => `<option value="${E(c)}" ${c === current ? 'selected' : ''}>${E(Config.classLabel(c))}</option>`).join('')}</optgroup>` : '';
    }).join('') + '<option value="other">אחר (הקלד כיתה חדשה)...</option>';
    const rows = members.map(r => {
      const name = `${r.firstName} ${r.lastName}`.trim() || r.tz;
      const track = Config.trackFor(r.tz, r.track, r.homeroom);
      return `<tr><td class="tz-col">${E(r.tz)}</td><td class="font-medium">${E(name)}${this.overrideBadge(r.tz)}</td>
        <td><select class="flat-sel" data-chg="classTrack" data-tz="${E(r.tz)}" data-class="${E(classKey)}" aria-label="${E(`מסלול של ${name}`)}">${Config.TRACKS.map(t => `<option value="${E(t)}" ${t === track ? 'selected' : ''}>${E(t)}</option>`).join('')}</select></td>
        <td><select class="flat-sel" data-chg="classMove" data-tz="${E(r.tz)}" data-class="${E(classKey)}" aria-label="${E(`כיתת אם של ${name}`)}">${homeOptions(r.homeroom)}</select></td></tr>`;
    }).join('');
    this.openModal(`
      <div class="flex items-center justify-between gap-2 mb-1"><h3 class="text-lg font-semibold">כיתה <bdi dir="rtl">${E(Config.classLabel(classKey))}</bdi> · ${members.length} חניכים</h3>
        <button type="button" class="btn btn-sm bg-slate-100 text-slate-800 hover:bg-indigo-100" data-act="closeModal">סגירה</button></div>
      <p class="text-xs text-slate-500 mb-3">שינוי כיתה או מסלול נשמר מיד כדריסה (קובץ המצבת אינו משתנה)       וניתן לביטול בטבלת הדריסות.</p>
      <div class="max-h-[60vh] overflow-auto rounded-lg"><table class="grid flat-tbl w-full"><thead><tr><th class="tz-col">ת.ז</th><th>שם חניך</th><th>מסלול</th><th>כיתת אם</th></tr></thead><tbody>${rows}</tbody></table></div>`, true);
    const dialog = document.querySelector('#modal-root [role="dialog"]');
    if (dialog) dialog.classList.add('flat-modal');
    const backdrop = document.querySelector('#modal-root [data-act="modalBackdrop"]');
    if (backdrop) backdrop.scrollTop = scroll;
  },

  /** שמירת שינוי שיוך מהחלון המהיר ורענון הרשימה (חניך שעבר כיתה נעלם מהרשימה) */
  classRosterApply(tz, classKey, patch, message) {
    const res = Config.setRosterOverride(tz, patch);
    if (res.ok === false) this.toast(res.error || 'שמירת השינוי נכשלה', 'error');
    else { this.toast(message, 'ok'); this.afterDataChange(); }
    this.openClassRoster(classKey);
  },

  afterClassSettingChange() {
    this.syncFilters();
    this.invalidateAll();
  },

  /* ==================================================================
     סנכרון ענן
     ================================================================== */
  renderSync() {
    const el = $('syncStatus');
    if (!el) return;
    const s = this.cloudService().status, url = this.cloudService().url();
    const conflict = $('cloudConflict');
    if (conflict) conflict.hidden = s.kind !== 'conflict';
    let t;
    if (!url) t = '💾 נתונים מקומיים (ללא סנכרון ענן)';
    else if (!this.cloudService().configured() && s.kind !== 'conflict') t = '☁️ נדרשת התחברות עם Google · הנתונים נשמרו מקומית';
    else if (s.text) t = s.text;
    else if (this.cloudService().hasUnpublished()) t = '☁️ מסנכרן...';
    else t = (s.updatedAt || this.cloudService().meta().syncedAt) ? '☁️ מסונכרן' : '☁️ טרם סונכרן';
    el.textContent = t;
    el.title = s.kind === 'error' ? s.error || t : '';
    setText('ovSyncPill', t);
  },

  renderCloudCard() {
    const body = $('cloudBody');
    if (!body) return;
    const cloud = this.cloudService();
    body.innerHTML = `
      <p class="text-xs text-slate-500">הסנכרון דורש כתובת שרת, התחברות אישית עם Google וקוד בית-ספר להצפנה. יש להשתמש באותו קוד בכל מחשבי הצוות.</p>
      ${cloud._onboarding ? '<p class="text-xs text-amber-700">כדי להצטרף יש להתחבר עם Google ולהזין ולשמור את קוד ההצפנה של בית הספר.</p>' : ''}
      <div class="grid md:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1">כתובת Web App של Google Apps Script
          <input id="cloudUrl" class="inp" dir="ltr" placeholder="https://script.google.com/macros/s/…/exec" value="${E(cloud.url())}"></label>
        <label class="flex flex-col gap-1">Google Client ID
          <input id="cloudClientId" class="inp" dir="ltr" value="${E(cloud.clientId())}"></label>
        <label class="flex flex-col gap-1">קוד בית-ספר (חובה להצפנה בענן)
          <input id="cloudPass" type="password" class="inp" autocomplete="off" value="${E(cloud.passcode())}"></label>
      </div>
      <div id="cloudGoogleAuth"></div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary btn-sm" data-act="cloudSave">שמירת הגדרות</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="cloudPull">⬇️ משיכה מהענן</button>
        <button type="button" class="btn btn-primary btn-sm" data-act="cloudSync">☁️ סנכרן לענן כעת</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="cloudJoinLink">העתקת קישור הצטרפות לצוות</button>
      </div>`;
    this.renderCloudAuth();
  },

  renderCloudAuth() {
    const container = $('cloudGoogleAuth');
    if (!container) return;
    const cloud = this.cloudService(), identity = cloud.identity();
    container.innerHTML = `<div class="flex flex-wrap items-center gap-2">
      <span>${identity ? `מחובר עם Google: ${E(identity.email)}` : 'נדרשת התחברות עם Google כדי לסנכרן'}</span>
      ${identity ? '<button type="button" class="btn btn-ghost btn-sm" data-act="cloudGoogleSignOut">התנתקות מחשבון Google</button>' : '<div id="googleSignIn"></div>'}</div>
      ${!identity && !(window.google && window.google.accounts && window.google.accounts.id) ? '<p class="text-xs text-slate-500">כפתור Google יופיע כשהשירות יהיה זמין; ניתן להמשיך לעבוד מקומית.</p>' : ''}`;
    if (!identity) cloud.renderGoogleButton($('googleSignIn'));
  },

  /** מחילה תמונת מצב חדשה על כל התצוגות */
  async cloudRefresh(fn) {
    try {
      const r = await fn();
      this.rosterReport = null;
      if (r === 'applied') this.afterDataChange();
      this.renderSync();
      this.renderCloudCard();
      return r;
    } catch (e) { this.renderSync(); this.toast(e.message || 'הפעולה נכשלה', 'error'); return null; }
  },

  /* ==================================================================
     כיול סמלי שאלונים
     ================================================================== */
  calibModel() {
    const r = Config.rules(), cat = r.questionnaires || {}, rows = [];
    const ordOf = name => { const i = this.CALIB_ORDER.findIndex(n => Util.norm(name).includes(Util.norm(n))); return i < 0 ? 50 : i; };
    const nameOf = code => (cat[code] && cat[code].name) || '';
    const subjects = [...r.coreSubjects].sort((a, b) => ordOf(a.name) - ordOf(b.name));
    subjects.forEach(s => {
      const lists = s.variableUnits ? Object.entries(s.levels || {}).sort((a, b) => a[0] - b[0]).map(([l, comps]) => [l, comps]) : [['', s.components || []]];
      lists.forEach(([level, comps]) => {
        const group = `${s.name}${s.variableUnits ? ` ${level} יח'` : ` (${s.units || 2} יח')`}`;
        comps.forEach((c, ci) => {
          const internal = BagrutEngine.isInternalComp(c, comps);
          (c.codes || []).forEach((code, k) => rows.push({
            code: String(code), name: nameOf(code) || c.label || '', group, order: ordOf(s.name),
            kind: internal ? `הערכה פנימית ${Number(c.weight) || 0}%` : 'בחינה חיצונית', weight: Number(c.weight) || 0,
            sub: k > 0 ? String(c.codes[0]) : '', off: c.enabled === false || s.enabled === false,
            loc: { t: 'core', id: s.id, level, ci }, targetKey: `core:${s.id}:${level}`, internal
          }));
        });
      });
    });
    r.majors.forEach(m => m.codes.forEach(code => rows.push({
      code: String(code), name: nameOf(code) || m.name, group: 'מגמות 5 יח\'', order: 60, kind: 'בחינה חיצונית',
      weight: m.weights && m.weights[code] != null ? Number(m.weights[code]) : null, sub: '', off: m.enabled === false,
      loc: { t: 'major', id: m.id }, targetKey: `major:${m.id}`
    })));
    r.internals.forEach(i => i.codes.forEach(code => rows.push({
      code: String(code), name: nameOf(code) || i.name, group: 'יחידות פנימיות', order: 70, kind: 'הערכה פנימית', weight: null, sub: '', off: i.enabled === false,
      loc: { t: 'internal', id: i.id }, targetKey: `internal:${i.id}`
    })));
    ((r.exceptionDetection && r.exceptionDetection.immigrantCodes) || []).forEach(code => rows.push({
      code: String(code), name: nameOf(code) || 'שאלון עולים / מותאם', group: 'שאלוני עולים / מותאם', order: 80, kind: 'בחינה חיצונית', weight: null,
      sub: 'שאלון רגיל', off: false, loc: { t: 'immigrant' }, targetKey: 'immigrant'
    }));
    return rows;
  },

  /** קודי שאלון בקובץ הבגרויות שאינם משויכים לשום מקצוע / מגמה / יחידה / שאלון עולים */
  unrecognizedCodes(rows = this.calibModel()) {
    const known = new Set(rows.map(r => r.code));
    const found = new Map();
    Config.getRows('bagrutData').forEach(r => {
      const code = String(r.code ?? '').trim();
      if (!code || code === 'פנימי' || known.has(code)) return;
      const f = found.get(code) || { code, count: 0, subject: '' };
      f.count++; if (!f.subject && r.subject) f.subject = String(r.subject);
      found.set(code, f);
    });
    return [...found.values()].sort((a, b) => b.count - a.count);
  },

  renderCalibration() {
    const host = $('qCalib');
    if (!host) return;
    const rows = this.calibModel();
    this._calibRows = rows;
    const unk = this.unrecognizedCodes(rows);
    this._calibUnk = unk;
    const banner = unk.length ? `<div class="rounded-lg border border-amber-400 bg-amber-50 p-3" role="alert">
      <div class="font-semibold text-amber-900">זוהו ${unk.length} שאלונים בקובץ הבגרויות שטרם שויכו למקצוע</div>
      <div class="flex flex-wrap gap-2 mt-2">${unk.map((u, i) => `<span class="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-1 text-xs">
        <span class="font-mono font-bold">${E(u.code)}</span><span class="text-slate-500">${E(u.subject)} · ${u.count} רשומות</span>
        <button type="button" class="btn btn-primary btn-sm" data-act="calibAssign" data-i="${i}">+ שייך כעת</button></span>`).join('')}</div></div>` : '';
    setHtml('qUnmapped', banner);
    let last = null;
    const body = rows.map((r, i) => {
      const head = r.group !== last ? `<tr class="bg-slate-100"><td colspan="7" class="font-bold text-slate-700 py-1">${E(r.group)}</td></tr>` : '';
      last = r.group;
      return `${head}<tr class="${r.off ? 'opacity-50' : ''}">
        <td class="font-mono font-bold">${E(r.code)}</td><td>${E(r.name || '—')}</td><td>${E(r.group)}</td><td>${E(r.kind)}</td>
        <td>${r.weight == null ? '—' : `${r.weight}%`}</td><td>${r.sub ? `<span class="badge fresh-slate border">תחליף ל-${E(r.sub)}</span>` : '—'}</td>
        <td class="whitespace-nowrap"><button type="button" class="btn btn-ghost btn-sm" data-act="calibEdit" data-i="${i}" title="עריכה">✏️</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="calibDelete" data-i="${i}" title="מחיקה">🗑️</button></td></tr>`;
    }).join('');
    host.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2"><p class="text-xs text-slate-500">שינוי נשמר מיד, מחשב מחדש את זכאות הבגרות ומסומן לפרסום לצוות.</p>
        <button type="button" class="btn btn-primary btn-sm" data-act="calibAdd">+ הוספת סמל שאלון</button></div>
      <div class="tbl-wrap" style="max-height:480px"><table class="w-full text-sm">
        <thead><tr><th>סמל שאלון</th><th>שם שאלון</th><th>מקצוע ורמה</th><th>רכיב</th><th>משקל (%)</th><th>תחליף לשאלון (עולים/מותאם)</th><th>פעולות</th></tr></thead>
        <tbody>${body}</tbody></table></div>`;
  },

  /** טופס הוספה / עריכה. row = שורה קיימת לעריכה, preset = ערכים התחלתיים להוספה */
  openCalibModal(row, preset = {}) {
    const r = Config.rules();
    const targets = [];
    [...r.coreSubjects].forEach(s => {
      if (s.variableUnits) Object.keys(s.levels || {}).sort().forEach(l => targets.push({ v: `core:${s.id}:${l}`, l: `${s.name} ${l} יח'` }));
      else targets.push({ v: `core:${s.id}:`, l: `${s.name} (${s.units || 2} יח')` });
    });
    r.majors.forEach(m => targets.push({ v: `major:${m.id}`, l: `מגמה: ${m.name}` }));
    r.internals.forEach(i => targets.push({ v: `internal:${i.id}`, l: `יחידה פנימית: ${i.name}` }));
    targets.push({ v: 'immigrant', l: 'שאלון עולים / מותאם' });
    const subs = this.calibModel().filter(x => x.loc.t === 'core' && !x.sub);
    const cur = row ? { code: row.code, name: row.name, target: row.targetKey, weight: row.weight, internal: row.internal ? '1' : '', sub: row.sub ? `${row.loc.id}|${row.loc.level}|${row.loc.ci}` : '' }
      : { code: preset.code || '', name: preset.name || '', target: targets[0].v, weight: 100, internal: '', sub: '' };
    const sel = (key, opts, val) => `<select class="inp" data-f="${key}">${opts.map(o => `<option value="${E(o.v)}" ${o.v === val ? 'selected' : ''}>${E(o.l)}</option>`).join('')}</select>`;
    this.formCtx = { onSubmit: values => this.calibSave(values, row) };
    this.openModal(`
      <h3 class="text-lg font-semibold mb-3">${row ? `עריכת שאלון ${E(row.code)}` : 'הוספת סמל שאלון'}</h3>
      <div class="grid gap-3 text-sm">
        <label class="flex flex-col gap-1">סמל שאלון<input class="inp font-mono" data-f="code" value="${E(cur.code)}" ${row ? 'readonly' : ''}></label>
        <label class="flex flex-col gap-1">שם שאלון<input class="inp" data-f="name" value="${E(cur.name)}"></label>
        <label class="flex flex-col gap-1">מקצוע ורמה${sel('target', targets, cur.target)}</label>
        <label class="flex flex-col gap-1">תחליף לשאלון (עולים / מותאם) – אם נבחר, גובר על המקצוע שלמעלה${sel('sub', [{ v: '', l: '— שאלון עצמאי (לא תחליף) —' }, ...subs.map(s => ({ v: `${s.loc.id}|${s.loc.level}|${s.loc.ci}`, l: `${s.code} · ${s.group}` }))], cur.sub)}</label>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">משקל (%)<input class="inp" type="number" min="0" max="100" data-f="weight" value="${cur.weight ?? ''}"></label>
          <label class="flex flex-col gap-1">רכיב${sel('internal', [{ v: '', l: 'בחינה חיצונית' }, { v: '1', l: 'הערכה פנימית (בית-ספרי)' }], cur.internal)}</label>
        </div>
        <p class="text-xs text-slate-500">משקל ורכיב חלים על שאלונים בליבה; מגמות, יחידות פנימיות ושאלוני עולים נקבעים לפי הקבוצה.</p>
      </div>
      <div id="formErr" class="text-sm text-red-600 mt-2" role="alert"></div>
      <div class="flex gap-2 mt-4"><button type="button" class="btn btn-primary" data-act="formSubmit">שמירה</button><button type="button" class="btn btn-ghost" data-act="closeModal">ביטול</button></div>`);
  },

  calibDetach(r, code) {
    const strip = list => { for (let i = list.length - 1; i >= 0; i--) { list[i].codes = (list[i].codes || []).filter(c => String(c) !== code); if (!list[i].codes.length) list.splice(i, 1); } };
    r.coreSubjects.forEach(s => { if (s.variableUnits) Object.values(s.levels || {}).forEach(strip); else strip(s.components || (s.components = [])); });
    r.majors.forEach(m => { m.codes = m.codes.filter(c => String(c) !== code); if (m.weights) delete m.weights[code]; });
    r.internals.forEach(i => { i.codes = i.codes.filter(c => String(c) !== code); });
    if (r.exceptionDetection && r.exceptionDetection.immigrantCodes) r.exceptionDetection.immigrantCodes = r.exceptionDetection.immigrantCodes.filter(c => String(c) !== code);
  },

  calibSave(v, row) {
    const code = String(v.code || '').trim(), name = String(v.name || '').trim();
    if (!code) return { ok: false, error: 'יש להזין סמל שאלון' };
    if (!/^[\w\u0590-\u05FF-]+$/.test(code)) return { ok: false, error: 'סמל שאלון יכול להכיל אותיות, ספרות ומקף בלבד' };
    const weight = Number(v.weight);
    const isCore = v.target.startsWith('core:') || v.sub;
    if (isCore && !(weight >= 0 && weight <= 100)) return { ok: false, error: 'משקל חייב להיות בין 0 ל-100' };
    if (!row && this.calibModel().some(x => x.code === code)) return { ok: false, error: `הסמל ${code} כבר קיים בטבלה – ערכו אותו במקום להוסיף` };
    const res = Config.updateRules(r => {
      const sameSpot = row && row.targetKey === v.target && !!row.sub === !!v.sub;
      const findList = (id, level) => {
        const s = r.coreSubjects.find(x => x.id === id);
        if (!s) throw new Error('מקצוע לא נמצא');
        return s.variableUnits ? (s.levels[level] || (s.levels[level] = [])) : (s.components || (s.components = []));
      };
      if (sameSpot && row.loc.t === 'core') {
        const comp = findList(row.loc.id, row.loc.level)[row.loc.ci];
        if (comp) { comp.weight = weight; comp.internal = !!v.internal; }
      } else {
        if (row) this.calibDetach(r, row.code);
        if (v.sub) {
          const [id, level, ci] = v.sub.split('|');
          const comp = findList(id, level)[Number(ci)];
          if (!comp) throw new Error('השאלון הראשי לא נמצא');
          comp.codes.push(code);
        } else if (v.target.startsWith('core:')) {
          const [, id, level] = v.target.split(':');
          const comp = { enabled: true, codes: [code], weight };
          if (v.internal) comp.internal = true;
          findList(id, level).push(comp);
        } else if (v.target.startsWith('major:')) {
          const m = r.majors.find(x => x.id === v.target.slice(6));
          m.codes.push(code);
        } else if (v.target.startsWith('internal:')) {
          r.internals.find(x => x.id === v.target.slice(9)).codes.push(code);
        } else {
          r.exceptionDetection = r.exceptionDetection || {};
          r.exceptionDetection.immigrantCodes = [...(r.exceptionDetection.immigrantCodes || []), code];
        }
      }
      r.questionnaires = r.questionnaires || {};
      const old = r.questionnaires[code] || {};
      r.questionnaires[code] = { ...old, name: name || old.name || '', expectedGrade: old.expectedGrade || 'יב' };
    });
    if (res.ok === false) return res;
    this.afterRulesEdit(res);
    return { ok: true };
  },

  afterRulesEdit(res) {
    this.toast(res.warnings && res.warnings.length ? `נשמר. ${res.warnings[0]}` : 'השאלון נשמר והזכאות חושבה מחדש', res.warnings && res.warnings.length ? 'warn' : 'ok');
    this.dirty.add('settings');
    this.schedule(() => { this.invalidateAll(); this.renderCalibration(); });
  },

  async cloudSave() {
    try {
      this.cloudService().saveSettings({ url: $('cloudUrl').value, clientId: $('cloudClientId').value, passcode: $('cloudPass').value });
      this.renderSync();
      this.toast('הגדרות הענן נשמרו', 'ok');
      if (this.cloudService().configured()) await this.cloudRefresh(() => this.cloudService().pullCloudState());
    } catch (e) { this.toast(`שמירת הגדרות הענן נכשלה: ${e.message}`, 'error'); }
  },
  async cloudPull() {
    if (!this.cloudService().url()) return this.toast('לא הוגדרה כתובת סנכרון ענן', 'warn');
    if (this.cloudService().hasUnpublished() && !this.confirmAction('יש שינויים שלא סונכרנו. משיכה מהענן תדרוס אותם. להמשיך?')) return;
    const r = await this.cloudRefresh(() => this.cloudService().pullCloudState({ force: true }));
    if (r === 'kept-local') this.toast('בוצעו שינויים בזמן המשיכה; הם נשמרו. יש לפתור את ההתנגשות לפני סנכרון.', 'warn');
    else if (r) this.toast(r === 'applied' ? 'הנתונים נטענו מהענן' : 'אין עדיין נתונים בענן', r === 'applied' ? 'ok' : 'info');
  },
  async cloudSync() {
    try {
      this.cloudService().saveSettings({ url: $('cloudUrl').value, clientId: $('cloudClientId').value, passcode: $('cloudPass').value });
      if (!this.cloudService().url()) return this.toast('יש להגדיר כתובת סנכרון ענן בהגדרות', 'warn');
      const r = await this.cloudRefresh(() => this.cloudService().pullCloudState());
      if (!r || r === 'kept-local') return;
      const pushed = await this.cloudService().pushCloudState();
      if (pushed === 'kept-local') return;
      this.toast('הנתונים סונכרנו לענן', 'ok');
    } catch (e) { this.toast(`הסנכרון נכשל: ${e.message}`, 'error'); }
    this.renderSync();
  },
  async cloudForcePush() {
    if (!this.confirmAction('דחיפה כפויה תחליף את נתוני הענן בנתונים המקומיים ותשפיע על כל הצוות. מומלץ לייצא גיבוי מקומי קודם. להמשיך?')) return;
    const r = await this.cloudRefresh(() => this.cloudService().pushCloudState({ force: true }));
    if (r && r !== 'kept-local') this.toast('הנתונים המקומיים נשלחו לענן', 'ok');
  },
  async cloudJoinLink() {
    try {
      this.cloudService().saveSettings({ url: $('cloudUrl').value, clientId: $('cloudClientId').value, passcode: $('cloudPass').value });
      await navigator.clipboard.writeText(this.cloudService().teamJoinLink());
      this.toast('קישור ההצטרפות הועתק. יש לשתף רק בערוץ פרטי עם הצוות.', 'ok');
    } catch (e) { this.toast(`העתקת הקישור נכשלה: ${e.message}`, 'error'); }
  },
  async backupExport() {
    try { await this.cloudService().exportBackup(); }
    catch (e) { this.toast(`ייצוא הגיבוי נכשל: ${e.message}`, 'error'); }
  },
  cloudGoogleSignOut() {
    this.cloudService().signOutGoogle();
    this.renderSync();
    this.renderCloudCard();
  },
  async cloudWipeLocal() {
    if (!this.confirmAction('פעולה זו מנתקת את המחשב הזה בלבד ומוחקת ממנו את הנתונים ואת קוד הגישה, כדי שמשתמשים אחרים במחשב המשותף לא יוכלו לראות פרטי תלמידים.\n\nהנתונים של בית הספר בענן לא יימחקו ויישארו שמורים.\n\nשינויים שעדיין לא נשמרו בענן יאבדו, והדף ייטען מחדש. להמשיך?')) return;
    try { await this.cloudService().wipeLocalSession(); }
    catch (e) { this.toast(`מחיקת הנתונים המקומיים נכשלה: ${e.message}. הסנכרון נשאר חסום; יש לנסות למחוק שוב.`, 'error'); }
  },
  calibAdd() { this.openCalibModal(null); },
  calibAssign(el) { const u = this._calibUnk[Number(el.dataset.i)]; if (u) this.openCalibModal(null, { code: u.code, name: u.subject }); },
  calibEdit(el) { const r = this._calibRows[Number(el.dataset.i)]; if (r) this.openCalibModal(r); },
  calibDelete(el) {
    const row = this._calibRows[Number(el.dataset.i)];
    if (!row || !this.confirmAction(`למחוק את הסמל ${row.code} מ-${row.group}?`)) return;
    const res = Config.updateRules(r => {
      this.calibDetach(r, row.code);
      if (r.questionnaires) delete r.questionnaires[row.code];
    });
    if (res.ok === false) return this.toast(res.error, 'error');
    this.afterRulesEdit(res);
  },
  settingsView(el) { this.state.settingsView = el.dataset.view; this.renderSettingsNav(); },
  ovPick(el) { this.ovSelect(el.dataset.tz); this.ovCloseResults(); },
  ovSave() {
    const tz = this.ovTz;
    if (!tz) return this.toast('יש לבחור חניך מהרשימה', 'warn');
    const home = $('ovHomeroom').value === 'other' ? $('ovOtherHomeroom').value.trim() : $('ovHomeroom').value;
    if ($('ovHomeroom').value === 'other' && !home) return this.toast('יש להזין כיתת אם חדשה', 'warn');
    const res = Config.setRosterOverride(tz, {
      grade: $('ovGrade').value, homeroom: home, track: $('ovTrack').value,
      hidden: $('ovHidden').checked, note: $('ovNote').value, name: $('ovName').value
    });
    if (res.ok === false) return this.toast(res.error || 'שמירת הדריסה נכשלה', 'error');
    ['overrideTraineeSearch', 'ovGrade', 'ovHomeroom', 'ovOtherHomeroom', 'ovTrack', 'ovNote', 'ovName'].forEach(id => setVal(id, ''));
    $('ovOtherHomeroom').classList.add('hidden');
    setChecked('ovHidden', false);
    this.ovTz = '';
    this.toast(res.removed ? 'הדריסה זהה לשיוך שבקובץ ולכן לא נשמרה' : 'הדריסה נשמרה והופעלה בכל הפאנלים', res.removed ? 'info' : 'ok');
    this.afterDataChange();
  },
  classRoster(el) { this.openClassRoster(el.dataset.class); },
  ovRemove(el) {
    const res = Config.removeRosterOverride(el.dataset.tz);
    if (res.ok === false) return this.toast(res.error || 'ביטול הדריסה נכשל', 'error');
    this.toast('הדריסה בוטלה – חזר השיוך שבקובץ', 'ok');
    this.afterDataChange();
  },
  ovClearAll() {
    const count = Object.keys(Config.getRosterOverrides()).length;
    if (!count || !this.confirmAction(`לבטל את כל ${count} דריסות השיוך הפעילות?`)) return;
    const res = Config.clearRosterOverrides();
    if (res.ok === false) return this.toast(res.error || 'ביטול הדריסות נכשל', 'error');
    this.toast('כל הדריסות בוטלו – חזרו השיוכים שבקובץ', 'ok');
    this.afterDataChange();
  },
  rulesTab(el) { this.state.rulesTab = el.dataset.sub; this.renderRulesDrawer(); },
  cohortEdit(el) {
    Config.setActiveCohort(el.dataset.id);
    ['settings'].forEach(t => this.dirty.add(t));
    this.renderTab('settings');
  },
  cohortCopy() {
    const to = Config.getActiveCohortId();
    const others = Object.values(Config.getCohortProfiles()).filter(c => c.id !== to);
    if (!others.length) return this.toast('אין מחזור אחר להעתיק ממנו', 'warn');
    this.formModal(`העתקת חוקים אל ${this.cohortName(to)}`, [
      { key: 'from', label: 'העתק חוקים ממחזור', type: 'select', value: others[0].id, options: others.map(c => ({ value: c.id, label: c.name })) }
    ], v => {
      if (!this.confirmAction(`כל חוקי הבגרות והשאלונים של ${this.cohortName(to)} יוחלפו בעותק של ${this.cohortName(v.from)}. להמשיך?`)) return { ok: false, error: 'ההעתקה בוטלה' };
      const res = Config.copyCohortRules(v.from, to);
      if (res.ok !== false) { Store.refresh(); SignalEngine.invalidate(); this.toast(`החוקים הועתקו מ-${this.cohortName(v.from)}`, 'ok'); }
      return res;
    }, 'העתקה');
  },
  cohortAdd() {
    const from = Config.getActiveCohortId();
    this.formModal('הוספת מחזור חדש', [
      { key: 'name', label: 'שם המחזור', placeholder: 'מחזור ח\' (תש"צ)' }
    ], v => {
      const res = Config.addCohort(v.name, from);
      if (res.ok) {
        Config.setActiveCohort(res.id);
        this.toast(`נוסף ${v.name.trim()} כעותק של ${this.cohortName(from)}. אפשר לשייך אליו שכבה בראש המסך.`, 'ok');
      }
      return res;
    }, 'הוספה');
  },
  ruleRemove(el) {
    const list = Config.rules()[{ core: 'coreSubjects', major: 'majors', internal: 'internals' }[el.dataset.kind]] || [];
    const c = list.find(x => x.id === el.dataset.id);
    if (c && this.confirmAction(`להסיר את "${c.name}" מכללי הזכאות?`)) this.applyRule(Config.removeClause(el.dataset.kind, el.dataset.id));
  },
  compAdd(el) {
    const { kind, id, level } = el.dataset;
    this.formModal('הוספת שאלון', [
      { key: 'codes', label: 'סמלי שאלון (חלופיים, מופרדים בפסיקים)' },
      { key: 'weight', label: 'משקל (%)', type: 'number', value: 0 },
      { key: 'label', label: 'תיאור (אופציונלי)' }
    ], v => Config.upsertComponent(kind, id, level, null, { codes: v.codes.split(',').map(x => x.trim()).filter(Boolean), weight: Number(v.weight), label: v.label.trim() }));
  },
  compRemove(el) { this.applyRule(Config.removeComponent(el.dataset.kind, el.dataset.id, el.dataset.level, +el.dataset.i)); },
  qRemove(el) { this.applyRule(Config.removeQuestionnaire(el.dataset.code)); },
  deleteRoster() {
    if (!this.confirmAction('למחוק את מצבת החניכים? כל הפאנלים יתרוקנו עד לטעינת מצבת חדשה.')) return;
    Config.clearRoster();
    Config.setRosterCleared(true);
    this.rosterReport = null;
    this.afterDataChange();
  },
  gradeCohort(el) {
    const res = Config.setGradeCohort(el.dataset.grade, el.value);
    if (res.ok === false) this.toast(res.error, 'error');
    else this.toast(`שכבת ${Util.gl(Util.GRADE_KEYS.find(k => String(Util.ord(k)) === el.dataset.grade))} נבדקת כעת לפי ${this.cohortName(el.value)}`, 'ok');
    this.renderRulesDrawer();
  },
  compEnabled(el) { this.patchComp(el, { enabled: el.checked }); },
  compCodes(el) { this.patchComp(el, { codes: el.value.split(',').map(x => x.trim()).filter(Boolean) }); },
  compWeight(el) { this.patchComp(el, { weight: Number(el.value) }); },
  compGrade(el) { this.patchComp(el, { expectedGrade: el.value }); this.renderRulesDrawer(); },
  /* ריק = מחיקת הדריסה וירושת ברירת המחדל של המחזור; ציונים נגזרים מחושבים מחדש מיד */
  compMagen(el) {
    const v = el.value.trim(), n = Number(v);
    if (v !== '' && !(isFinite(n) && n >= 0 && n <= 100)) { this.toast('משקל המגן חייב להיות בין 0 ל-100', 'error'); this.renderRulesDrawer(); return; }
    this.patchComp(el, { magenWeight: v === '' ? null : n });
    Store.refresh();
    SignalEngine.invalidate();
    this.renderRulesDrawer();
  },
  ruleToggle(el) { this.applyRule(Config.toggleClause(el.dataset.kind, el.dataset.id)); },
  clauseCodes(el) { this.applyRule(Config.setClauseCodes(el.dataset.kind, el.dataset.id, el.value)); },
  clauseKeywords(el) { this.applyRule(Config.patchClause(el.dataset.kind, el.dataset.id, { keywords: el.value.split(',').map(x => x.trim()).filter(Boolean) })); },
  internalGrade(el) { this.applyRule(Config.patchClause('internal', el.dataset.id, { expectedGrade: el.value })); },
  clauseGrade(el) { this.applyRule(Config.patchClause(el.dataset.kind, el.dataset.id, { expectedGrade: el.value })); this.renderRulesDrawer(); },
  gateToggle(el) { this.applyRule(Config.setGateEnabled(el.dataset.gate, el.checked)); },
  gateUnits(el) { this.applyRule(Config.updateRules(r => { r.gates.major.requiredUnits = Math.max(1, Math.min(5, Number(el.value) || 5)); })); },
  qName(el) { this.applyRule(Config.setQuestionnaire(el.dataset.code, { name: el.value.trim() })); },
  qGrade(el) {
    let res;
    el.dataset.code.split(',').filter(Boolean).forEach(code => { res = Config.setQuestionnaire(code, { expectedGrade: el.value }); });
    this.applyRule(res);
  },
  specialEd(el) {
    const res = Config.setSpecialEdClass(el.dataset.class, el.checked);
    if (res.ok === false) { this.afterClassSettingChange(); return this.toast(res.error || 'שמירת ההגדרה נכשלה', 'error'); }
    this.afterClassSettingChange();
    this.toast(el.checked ? `כיתה ${el.dataset.class}: חניכיה במסלול חנ"מ` : `כיתה ${el.dataset.class}: הוסרה ממסלול חנ"מ`, 'ok');
  },
  classMove(el) {
    let home = el.value;
    if (home === 'other') home = (this.promptAction('הקלידו כיתת אם חדשה (למשל יא3)') || '').trim();
    if (!home) return this.openClassRoster(el.dataset.class);
    const patch = { grade: Util.parseClass('', home).gradeKey, homeroom: home };
    this.classRosterApply(el.dataset.tz, el.dataset.class, patch, `החניך הועבר לכיתה ${home}`);
  },
  classTrack(el) {
    this.classRosterApply(el.dataset.tz, el.dataset.class, { track: el.value }, `המסלול עודכן: ${el.value}`);
  },
  renderDataTools(DATASETS) {
    const sadinGrades = new Map(), roster = Config.rosterMap();
    Config.getRows('sadinData').forEach(r => {
      const grade = r.gradeKey || (roster.get(r.tz) || {}).grade;
      if (!Util.GRADE_KEYS.includes(grade)) return;
      if (!sadinGrades.has(grade)) sadinGrades.set(grade, new Set());
      if (r.tz) sadinGrades.get(grade).add(r.tz);
    });
    const card = key => {
      const loaded = !!Config.getDataset(key);
      const perGrade = key === 'sadinData'
        ? Util.GRADE_KEYS.filter(g => sadinGrades.has(g)).map(g =>
          `<button type="button" class="btn btn-ghost btn-sm w-full justify-between" data-act="clearSadinGrade" data-grade="${E(g)}" title="הסרת שורות סדין של שכבה ${E(Util.gl(g))}">הסרת שכבה ${E(Util.gl(g))} (${sadinGrades.get(g).size}) ×</button>`).join('')
        : '';
      return `<div class="rounded-lg border border-slate-300 bg-slate-50 p-3 space-y-2">
        <div class="text-sm font-bold">${E(DATASETS[key].title)}</div>
        <div data-fresh-bar="${key}" role="status"></div>
        <div class="flex flex-col gap-1.5">
          <button type="button" class="btn btn-primary btn-sm w-full justify-between" data-upload="${key}" title="טעינת קובץ ${E(DATASETS[key].title)}">📂 טעינת קובץ</button>
          <button type="button" class="btn btn-ghost btn-sm w-full justify-between" data-act="remap" data-key="${key}" title="מיפוי ידני מחדש של עמודות הקובץ">🔧 מיפוי עמודות</button>
          ${perGrade}
          <button type="button" class="btn btn-danger btn-sm w-full justify-between" data-act="clearPanel" data-key="${key}" ${loaded ? '' : 'disabled'}>🧹 נקה את כל הנתונים</button>
        </div></div>`;
    };
    setHtml('dataTools', Object.keys(DATASETS).map(card).join(''));
    Object.keys(DATASETS).forEach(key => {
      document.querySelectorAll(`#dataTools [data-fresh-bar="${key}"]`).forEach(el => { el.innerHTML = this.freshBarHtml(key); });
    });
  },

  async clearPanel(el, DATASETS) {
    const key = el.dataset.key, ds = DATASETS[key];
    if (!ds || !this.confirmAction(`למחוק את כל נתוני "${ds.title}" (כל השכבות)? המצבת וההגדרות יישמרו.`)) return;
    try { await Config.clearDataset(key); }
    catch (err) { return this.toast(`מחיקת הנתונים נכשלה: ${err.message}`, 'error'); }
    this.afterDataChange();
    this.toast(`נתוני "${ds.title}" נוקו`, 'ok');
  },
  async clearSadinGrade(el) {
    const grade = el.dataset.grade;
    if (!this.confirmAction(`למחוק את שורות הסדין של שכבה ${Util.gl(grade)}? שורות ללא שכבה מזוהה יישארו.`)) return;
    try {
      const res = await Config.clearSadinGrade(grade);
      if (!res.ok) return this.toast(res.error, 'error');
      this.afterDataChange();
      this.toast(`נתוני סדין של שכבה ${Util.gl(grade)} הוסרו`, 'ok');
    } catch (err) { this.toast(`מחיקת הנתונים נכשלה: ${err.message}`, 'error'); }
  },
  remap(el) { this.remapColumns(el.dataset.key); },
  bindRulesEvents() {
    const num = (id, fn) => on(id, 'change', e => (e.target.value === '' ? this.renderRulesDrawer() : this.applyRule(fn(Number(e.target.value)))));
    on('ruleCompEnabled', 'change', e => this.applyRule(Config.setCompensation({ enabled: e.target.checked })));
    on('ruleCompPoints', 'change', e => this.applyRule(Config.setCompensation({ pointsEnabled: e.target.checked })));
    num('ruleCompMin', v => Config.setCompensation({ min: v }));
    num('ruleCompMax', v => Config.setCompensation({ max: v }));
    num('ruleCompCount', v => Config.setCompensation({ maxCount: v }));
    on('ruleCompExcluded', 'change', e => this.applyRule(Config.setCompensation({ excludedSubjects: e.target.value.split(',') })));
    num('ruleParamPass', v => Config.setRuleParam('passGrade', v));
    num('ruleParamBorderline', v => Config.setRuleParam('borderlineMin', v));
    num('ruleParamBonus', v => Config.setRuleParam('borderlineBonus', v));
    num('ruleParamMagen', v => {
      const res = Config.setRuleParam('magenWeight', v);
      Store.refresh();
      SignalEngine.invalidate();
      return res;
    });
    on('rulesReset', 'click', () => {
      if (!this.confirmAction(`לשחזר את כללי הזכאות והמשקלים של ${this.cohortName(Config.getActiveCohortId())} לברירת המחדל?`)) return;
      const res = Config.resetRules();
      Store.refresh();
      SignalEngine.invalidate();
      this.applyRule(res);
    });

    on('overrideTraineeSearch', 'focus', () => this.ovSearchResults());
    on('overrideTraineeSearch', 'input', () => { this.ovSelect(''); this.ovSearchResults(); });
    on('overrideTraineeSearch', 'keydown', e => {
      if (e.key === 'ArrowDown') {
        const first = $('ovResults').querySelector('button');
        if (first) { e.preventDefault(); first.focus(); }
      } else if (e.key === 'Enter' && !$('ovResults').classList.contains('hidden')) {
        const first = $('ovResults').querySelector('button');
        e.preventDefault();
        if (first) first.click();
      } else if (e.key === 'Escape') this.ovCloseResults();
    });
    on('ovSearchWrap', 'focusout', e => {
      if (!e.currentTarget.contains(e.relatedTarget)) this.ovCloseResults();
    });
    on('ovResults', 'keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        $('overrideTraineeSearch').focus();
        this.ovCloseResults();
      }
    });
    on('ovHomeroom', 'change', e => {
      $('ovOtherHomeroom').classList.toggle('hidden', e.target.value !== 'other');
      if (e.target.value === '') setVal('ovGrade', '');
      else if (e.target.value === 'other') this.ovSyncGrade($('ovOtherHomeroom').value);
      else this.ovSyncGrade(e.target.value);
      this.ovSyncDefaultTrack(e.target.value === 'other' ? $('ovOtherHomeroom').value : e.target.value);
    });
    on('ovOtherHomeroom', 'input', e => { this.ovSyncGrade(e.target.value); this.ovSyncDefaultTrack(e.target.value); });
    on('ovTrack', 'change', () => { this.ovTrackEdited = true; });
    on('ovForm', 'submit', e => { e.preventDefault(); this.acts.ovSave.call(this); });
    on('btnClearData', 'click', async () => {
      if (!this.confirmAction('למחוק את קובצי הבגרות, הקבוצות והציונים השוטפים? המצבת וההגדרות יישמרו.')) return;
      try {
        await Config.clearAllData();
        this.afterDataChange();
        this.toast('קובצי המשנה נוקו', 'ok');
      } catch (err) {
        this.afterDataChange();
        this.toast(`מחיקת הנתונים נכשלה: ${err.message}`, 'error');
      }
    });
    on('btnResetConfig', 'click', () => {
      if (!this.confirmAction('האיפוס ימחק את כל כללי הזכאות, החריגים, הכינויים, פרופילי המיפוי ודריסות שיוך (rosterOverrides). המצבת תישאר. המחיקות יסונכרנו גם לענן אם הוגדר וישפיעו על כל הצוות. להמשיך?')) return;
      Config.reset({ silent: true });
      this.afterDataChange();
      this.toast('ההגדרות אופסו', 'ok');
    });

  },

  };
})();
