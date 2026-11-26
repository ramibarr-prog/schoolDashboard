(function () {
  'use strict';

  const REASONS = Object.freeze({
    invalidId: 'ת"ז חסרה או לא תקינה',
    skipped: 'שורה דולגה — פרטי השורה אינם זמינים בדוח המפענח',
    missingGroup: 'קבוצה ללא מזהה תקין',
    missingCode: 'שאלון ללא סמל תקין',
    missingClass: 'שכבה או כיתת אם חסרה או לא תקינה',
    junior: 'חניך משכבה שאינה נכללת במצבת התיכון',
    duplicate: 'רשומה כפולה אוחדה במצבת',
    outside: 'חניך אינו במצבת',
    subject: 'קבוצה ללא מקצוע ממופה',
    questionnaire: 'שאלון לא מוכר / דורש בדיקה',
    enrollment: 'ציון בסדין ללא שיבוץ לקבוצה'
  });
  let records = [], sequence = 0, batches = 0;
  const typeNames = { masterRoster: 'מצבת', groupsData: 'קבוצות', sadinData: 'סדין', bagrutData: 'בגרות' };
  const grades = row => Util.normGrade(row.gradeKey || row.grade || '');
  const rosterGrade = (row, roster) => (roster.get(row.tz) || {}).grade || grades(row);

  function knownCodes(rules) {
    const codes = new Set();
    const add = list => (list || []).forEach(code => codes.add(String(code)));
    rules.coreSubjects.forEach(subject => {
      const lists = subject.variableUnits ? Object.values(subject.levels || {}) : [subject.components || []];
      lists.forEach(list => list.forEach(component => add(component.codes)));
    });
    rules.majors.forEach(subject => add(subject.codes));
    rules.internals.forEach(subject => add(subject.codes));
    add((rules.exceptionDetection || {}).immigrantCodes);
    return codes;
  }

  function inferredReason(type, row, mapping) {
    const value = key => mapping[key] ? row[mapping[key]] : '';
    const id = Parser.normalizeTz(value('tz'));
    if (!id) {
      const withGroup = type === 'groups' && mapping.groupId
        ? { ...row, [mapping.groupId]: '123456' } : row;
      if (type !== 'groups' || Parser.normalize(type, [withGroup], mapping).skipped)
        return REASONS.invalidId;
    }
    if (type === 'groups') return REASONS.missingGroup;
    if (type === 'bagrut') return REASONS.missingCode;
    return REASONS.skipped;
  }

  async function skippedRows(file, result, fileType) {
    const count = Number(result.skipped) || 0, found = [];
    let warning = '';
    if (count && file && typeof file.arrayBuffer === 'function' && (result.mapping || fileType === 'masterRoster')) {
      const previousWarningCount = Util.idWarn.sci;
      try {
        const table = await Parser.readFile(file);
        const roster = fileType === 'masterRoster';
        const mapping = roster ? Parser.autoMap('roster', table.headers, table.rows) : result.mapping;
        if ((!roster || (result.sheets || []).includes(table.sheetName)) && mapping && mapping.tz) {
          for (const row of table.rows) {
            if (found.length >= count) break;
            const missing = roster ? !Parser.normalizeTz(row[mapping.tz])
              : Parser.normalize(result.type, [row], mapping).skipped > 0;
            if (!missing) continue;
            const reason = roster ? REASONS.invalidId : inferredReason(result.type, row, mapping);
            found.push({ entityType: 'row', reason, key: '', label: table.sheetName, raw: row,
              gradeScope: mapping.grade ? Util.normGrade(row[mapping.grade]) : '' });
          }
        }
      } catch (error) {
        warning = `לא ניתן לקרוא מחדש את פרטי השורות שדולגו: ${error.message}`;
      } finally {
        Util.idWarn.sci = previousWarningCount;
      }
    }
    while (found.length < count) found.push({ entityType: 'row', reason: REASONS.skipped, key: '', label: '', raw: null, gradeScope: '' });
    return { found, warning };
  }

  async function recordImport(fileType, file, result, options = {}) {
    if (!typeNames[fileType]) throw new Error('סוג קובץ לא מוכר להסגר: ' + fileType);
    const roster = Config.rosterMap(), hidden = Config.hiddenIds(), ignored = Config.ignoredIds();
    const rows = result.rows || [], scopes = options.grades || [];
    const { found, warning } = await skippedRows(file, result, fileType);
    const drafts = found;
    const add = (row, entityType, reason, key, label) => drafts.push({
      entityType, reason, key: String(key || ''), label: String(label || ''),
      gradeScope: rosterGrade(row, roster), raw: row
    });

    const ignoredCount = fileType === 'masterRoster' ? (result.ignoredIds || []).length : Number(result.ignored) || 0;
    for (let i = 0; i < ignoredCount; i++) {
      const id = fileType === 'masterRoster' ? result.ignoredIds[i] : '';
      drafts.push({ entityType: 'row', reason: REASONS.junior, key: id, label: '', gradeScope: '', raw: null });
    }
    for (let i = 0; i < (Number(result.duplicates) || 0); i++)
      drafts.push({ entityType: 'row', reason: REASONS.duplicate, key: '', label: '', gradeScope: '', raw: null });

    const groups = Config.getRows('groupsData');
    const groupGrades = new Set(groups.filter(r => !r.isTeacher).map(r => rosterGrade(r, roster)).filter(Boolean));
    const membership = new Set(groups.filter(r => !r.isTeacher && r.tz && r.groupId).map(r => `${r.tz}|${r.groupId}`));
    const subjects = new Map();
    groups.forEach(r => {
      const name = r.groupName || '';
      const subject = Parser.parseGroupString(name).subject;
      if (subject) subjects.set(String(r.groupId), subject);
    });
    const codeCache = new Map();
    const codesFor = grade => {
      const key = grade || '*';
      if (!codeCache.has(key)) {
        const profiles = grade ? [Config.rulesForGrade(grade)] : Object.values(Config.getCohortProfiles()).map(p => p.rules);
        codeCache.set(key, new Set(profiles.flatMap(rules => [...knownCodes(rules)])));
      }
      return codeCache.get(key);
    };

    rows.forEach(row => {
      const grade = rosterGrade(row, roster);
      if (fileType !== 'masterRoster' && Config.getRosterEntry() && row.tz && !row.isTeacher && !roster.has(row.tz) && !hidden.has(row.tz) && !ignored.has(row.tz))
        add(row, 'trainee', REASONS.outside, row.tz, row.name || `${row.firstName || ''} ${row.lastName || ''}`.trim());
      if (fileType === 'groupsData' && row.groupId && !subjects.has(String(row.groupId)))
        add(row, 'group', REASONS.subject, row.groupId, row.groupName);
      if (fileType === 'bagrutData' && row.code && !codesFor(grade).has(String(row.code)))
        add(row, 'questionnaire', REASONS.questionnaire, row.code, row.subject);
      if (fileType === 'sadinData' && !row.groupId)
        add(row, 'group', REASONS.missingGroup, '', row.subject);
      if (fileType === 'sadinData' && roster.has(row.tz) && groupGrades.has(grade) && row.groupId && !membership.has(`${row.tz}|${row.groupId}`))
        add(row, 'enrollment', REASONS.enrollment, `${row.tz}|${row.groupId}`, row.subject);
    });

    const fileName = file && file.name ? file.name : '';
    const batchId = `batch-${++batches}`;
    if (options.replaceAll) records = records.filter(r => r.fileType !== fileType);
    else if (!options.append) {
      const replaced = new Set(scopes);
      const incoming = new Set(rows.map(r => `${r.tz || ''}|${r.code || ''}|${r.moedCode || r.moed || ''}`));
      records = records.filter(r => {
        if (r.fileType !== fileType) return true;
        if (fileType === 'bagrutData' && r.raw && r.raw.code)
          return !incoming.has(`${r.raw.tz || ''}|${r.raw.code || ''}|${r.raw.moedCode || r.raw.moed || ''}`);
        if (r.fileName === fileName && fileName && (!scopes.length || !r.gradeScope || replaced.has(r.gradeScope))) return false;
        if ((fileType === 'groupsData' || fileType === 'sadinData' || fileType === 'masterRoster') && replaced.has(r.gradeScope)) return false;
        return true;
      });
    }
    const added = drafts.map(d => ({ id: `q-${++sequence}`, batchId, fileType, fileName,
      gradeScope: d.gradeScope, entityType: d.entityType, reason: d.reason,
      key: d.key, label: d.label, raw: d.raw }));
    records.push(...added);
    return { batchId, records: added, warning };
  }

  function recordFailure(fileType, file, error) {
    if (!typeNames[fileType]) throw new Error('סוג קובץ לא מוכר להסגר: ' + fileType);
    const item = {
      id: `q-${++sequence}`, batchId: `batch-${++batches}`, fileType,
      fileName: file && file.name ? file.name : '', gradeScope: '', entityType: 'file',
      reason: 'קריאת הקובץ נכשלה', key: '', label: error.message || String(error), raw: null
    };
    records.push(item);
    return item;
  }

  function clear(options = {}) {
    records = records.filter(r => {
      if (options.fileType && r.fileType !== options.fileType) return true;
      if (options.gradeScope && r.gradeScope !== options.gradeScope) return true;
      return false;
    });
  }

  function list() { return records.slice(); }

  function summarize(items = records) {
    const reasons = new Map(), gradeScopes = new Map();
    items.forEach(item => {
      reasons.set(item.reason, (reasons.get(item.reason) || 0) + 1);
      const grade = item.gradeScope || 'לא ידועה';
      gradeScopes.set(grade, (gradeScopes.get(grade) || 0) + 1);
    });
    return { total: items.length, reasons: [...reasons], gradeScopes: [...gradeScopes] };
  }

  function auditConsistency(app = window.App) {
    const issues = [], summary = { total: 0, counts: {}, overview: 0, placement: 0 };
    const issue = (code, message, details) => issues.push({ code, severity: 'warning', message, details });
    if (!app || typeof app.overviewModel !== 'function' || typeof app.filterByChip !== 'function') {
      issue('app-unavailable', 'לא ניתן לבדוק עקביות ללא מודלי התצוגות של האפליקציה.', '');
      return { ok: false, issues, summary };
    }
    try {
      const model = app.overviewModel(), sim = app.state.sim;
      const all = SignalEngine.computeAll(sim);
      const signals = new Map(model.rows.map(({ t }) => [t.tz, all.byTz.get(t.tz)]));
      const counts = { ok: 0, watch: 0, risk: 0, unknown: 0, twelve: 0 };
      summary.total = model.list.length;
      summary.overview = model.rows.length;
      model.list.forEach(t => {
        const signal = signals.get(t.tz);
        if (!signal || !Object.prototype.hasOwnProperty.call(counts, signal.overall)) {
          issue('invalid-status', 'חסר סטטוס תקין לחניך.', t.tz);
          return;
        }
        counts[signal.overall]++;
        const prereqs = SignalEngine.prerequisitesFor(t.gradeKey);
        const flags = signal.pedagogical;
        const missingBagrut = !signal.ev.manual && !prereqs.hasBagrut && !(sim.useCurrent && prereqs.hasSadin);
        const unknown = flags.some(f => f.id === 'bagrut.unknown');
        if (missingBagrut !== unknown || (!prereqs.hasGroups && flags.some(f => f.family === 'placement' && f.severity !== 'unknown'))) {
          issue('prerequisite-conflict', 'סטטוס פעיל סותר נתונים חסרים לשכבה.', t.tz);
        }
        if (unknown && ['tier4', 'tier3', 'eligible', 'pace:pace_lag', 'pace:pace_warning', 'pace:on_track'].some(chip =>
          app.filterByChip([{ t, ev: app.getEval(t.tz) }], chip, signals).length))
          issue('unknown-active', 'חניך ללא נתוני בגרות מופיע בפילוח פעיל.', t.tz);
      });
      summary.counts = counts;
      const globalTotal = ['ok', 'watch', 'risk', 'unknown', 'twelve'].reduce((n, key) => n + all.counts[key], 0);
      if (Object.values(counts).reduce((a, b) => a + b, 0) !== model.list.length || model.rows.length !== model.list.length ||
          globalTotal !== all.counts.total || all.counts.total !== all.list.length)
        issue('status-total', 'סכום סטטוסי החניכים אינו תואם לאוכלוסייה.', { counts, total: model.list.length, rows: model.rows.length });

      model.rows.forEach(row => {
        const ev = app.getEval(row.t.tz);
        if (!ev || ['tier', 'paceStatus', 'atRisk', 'manual'].some(key => row.ev[key] !== ev[key]))
          issue('bagrut-status', 'מצב הבגרות בחדר הבקרה שונה ממסך הבגרות.', row.t.tz);
      });
      const benchmarkEvals = model.bench.rows.map(row => app.getEval(row.t.tz));
      const expectedStats = model.bench.pace
        ? BagrutAdvisor.summarizePace(benchmarkEvals) : BagrutAdvisor.summarize(benchmarkEvals);
      const mismatchedStats = Object.keys(expectedStats).filter(key => model.stats[key] !== expectedStats[key]);
      if (mismatchedStats.length)
        issue('overview-stats', 'מדדי הבגרות בחדר הבקרה אינם תואמים לנתוני מסך הבגרות.', mismatchedStats);
      const chips = ['eligible', 'tier3', 'tier4', 'tier5', 'tier0', 'pace:on_track', 'pace:not_started', 'pace:pace_warning', 'pace:pace_lag'];
      chips.forEach(chip => {
        const expected = model.rows.filter(row => {
          const signal = signals.get(row.t.tz), ev = row.ev;
          if (!signal) return false;
          if (signal.pedagogical.some(f => f.id === 'bagrut.unknown')) return chip === 'tier0';
          if (chip === 'eligible') return app.tierBased(ev) && (ev.tier === 1 || ev.tier === 2);
          if (chip.startsWith('tier')) return app.tierBased(ev) && ev.tier === Number(chip.slice(4));
          return !app.tierBased(ev) && ev.paceStatus === chip.slice(5);
        }).map(row => row.t.tz).sort();
        const actual = app.filterByChip(model.rows, chip, signals).map(row => row.t.tz).sort();
        if (JSON.stringify(expected) !== JSON.stringify(actual))
          issue('bagrut-filter', 'פילוח סטטוס הבגרות אינו תואם לחדר הבקרה.', { chip, expected, actual });
      });
      const overviewAttention = model.att.tzSet;
      const bagrutAttention = new Set(app.filterByChip(model.rows, 'attention', signals).map(row => row.t.tz));
      const delta = [...new Set([...overviewAttention, ...bagrutAttention])].filter(tz => overviewAttention.has(tz) !== bagrutAttention.has(tz));
      if (delta.length) issue('attention-count', 'פילוח המעקב בבגרות אינו תואם לחדר הבקרה.', delta);
      const placement = app.placementAnomaliesModel(model.list);
      summary.placement = model.anomaliesModel.total;
      const keys = rows => rows.map(r => `${r.tz}|${r.category}|${r.kind}|${r.subject}`).sort();
      if (JSON.stringify(keys(model.anomaliesModel.rows)) !== JSON.stringify(keys(placement.rows)) ||
          model.anomaliesModel.studentsCount !== placement.studentsCount || model.anomaliesModel.total !== placement.total)
        issue('placement-count', 'חריגי השיבוץ בקבוצות אינם תואמים לחדר הבקרה.',
          { overview: model.anomaliesModel.total, groups: placement.total });
    } catch (error) {
      issue('audit-error', 'בדיקת העקביות לא הושלמה.', error.message);
    }
    return { ok: issues.length === 0, issues, summary };
  }

  window.ImportQuarantine = Object.freeze({ REASONS, recordImport, recordFailure, clear, list, summarize, auditConsistency });
})();
