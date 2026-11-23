(function () {
  'use strict';

  const styles = {
    ok: 'tier-1', watch: 'tier-3', risk: 'tier-4',
    unknown: 'bg-slate-100 text-slate-600', info: 'bg-sky-100 text-sky-800'
  };
  const definitions = [
    ['bagrut.eligible', 'ok', 'זכאות / צבירה תקינה', ['bagrut']],
    ['bagrut.watch', 'watch', 'נדרש מעקב בבגרויות', ['bagrut']],
    ['bagrut.risk', 'risk', 'סיכון בבגרויות', ['bagrut']],
    ['bagrut.twelve', 'info', 'מסלול 12 שנות לימוד', []],
    ['bagrut.unknown', 'unknown', 'לא ניתן לקבוע מצב בגרויות', ['bagrut']],
    ['bagrut.noshow', 'risk', 'לא ניגש לבחינה', ['bagrut']],
    ['bagrut.missing_enroll', 'risk', 'חסר שיבוץ לבגרות', ['bagrut', 'groups']],
    ['placement.missing_core', 'risk', 'היעדר מקצוע ליבה', ['groups']],
    ['placement.duplicate', 'watch', 'כפילות קבוצות', ['groups']],
    ['placement.wrong_grade', 'watch', 'חריג שכבה בקבוצה', ['groups']],
    ['placement.no_major', 'watch', 'ללא שיבוץ מגמה', ['groups']],
    ['placement.unknown', 'unknown', 'לא ניתן לקבוע — חסר קובץ קבוצות לשכבה', ['groups']],
    ['sadin.fail', 'risk', 'נכשל בציון שוטף', ['sadin']],
    ['sadin.borderline', 'watch', 'ציון שוטף גבולי', ['sadin']],
    ['sadin.missed_event', 'watch', 'אירוע הערכה שהוחמץ', ['sadin']],
    ['sadin.unknown', 'unknown', 'לא ניתן לקבוע — חסר סדין לשכבה', ['sadin']],
    ['data.manual_review', 'info', 'נדרשת בדיקת נתונים', ['bagrut']],
    ['data.sadin_not_enrolled', 'info', 'ציון בסדין ללא שיבוץ לקבוצה', ['groups', 'sadin']],
    ['data.not_in_roster', 'info', 'חניך אינו במצבת', []]
  ];
  const CATALOG = Object.freeze(Object.fromEntries(definitions.map(([id, severity, label, requires]) => [
    id, Object.freeze({ id, family: id.split('.')[0], severity, label, badgeClass: styles[severity], requires: Object.freeze(requires) })
  ])));

  let cachedKey = null, cachedResult = null, sequence = 0;
  const flag = (id, detail = '') => {
    const { family, severity, label } = CATALOG[id];
    return { id, family, severity, label, detail };
  };
  const groupByTz = rows => {
    const result = new Map();
    rows.forEach(row => {
      if (!result.has(row.tz)) result.set(row.tz, []);
      result.get(row.tz).push(row);
    });
    return result;
  };
  const gradeOf = row => {
    const t = Store.trainees.get(row.tz);
    return t ? t.gradeKey : Util.normGrade(row.gradeKey || row.grade || '');
  };
  const gradesFor = (type, loaded) => {
    const result = new Set();
    if (loaded) Store.raw[type].forEach(row => {
      const grade = gradeOf(row);
      if (grade) result.add(grade);
    });
    return result;
  };
  const prerequisiteSets = () => ({
    bagrut: gradesFor('bagrut', Store.loaded.bagrut),
    groups: gradesFor('groups', Store.loaded.groups),
    sadin: gradesFor('grades', Store.loaded.grades)
  });
  const prereqsFrom = (gradeKey, sets) => ({
    hasBagrut: sets.bagrut.has(gradeKey),
    hasGroups: sets.groups.has(gradeKey),
    hasSadin: sets.sadin.has(gradeKey)
  });
  function prerequisitesFor(gradeKey) {
    return prereqsFrom(Util.normGrade(gradeKey), prerequisiteSets());
  }
  function isPassingScore(score, opts = {}) {
    if (score == null || (typeof score === 'string' && !score.trim())) return false;
    const n = Number(score), pass = Number(Config.rules().passGrade);
    if (!Number.isFinite(n) || !Number.isFinite(pass)) return false;
    return (opts.social === true && n >= 2 && n <= 4) || n >= pass;
  }
  const useCurrent = opts => !!(opts.useCurrent !== undefined ? opts.useCurrent : opts.useCurrentGradesAsForecast);

  function bagrutStatus(ev, gradeKey) {
    if (ev.manual || gradeKey === 'יב') {
      let tier = ev.tier;
      if (!ev.manual && ev.manualReview && ev.manualReview.required && ev.autoTier < tier) tier = ev.autoTier;
      if (!ev.manual && ev.manualReview && ev.manualReview.required &&
          ev.blockers.every(b => b.info || b.k === 'exempt-review')) tier = 1;
      return tier === 5 ? 'twelve' : tier === 4 ? 'risk' : tier === 3 ? 'watch' : tier === 1 || tier === 2 ? 'ok' : 'unknown';
    }
    if (ev.manualReview && ev.manualReview.required && ev.paceInfo) {
      const pace = ev.paceInfo;
      const issues = pace.failedActualCount + pace.missingDueList.length;
      return issues > 1 ? 'risk' : issues === 1 ? 'watch' : 'ok';
    }
    return ({ on_track: 'ok', not_started: 'ok', pace_warning: 'watch', pace_lag: 'risk',
      eligible: 'ok', nearly: 'watch', blocked: 'risk', twelve_years: 'twelve' })[ev.paceStatus] || 'unknown';
  }
  function buildContext(roster) {
    const sets = prerequisiteSets();
    const anomalies = Store.loaded.groups ? GroupAnalyzer.placementAnomalies(roster).rows : [];
    const sadin = Store.loaded.grades ? GroupAnalyzer.sadinSheet(roster) : [];
    return { sets, anomalies: groupByTz(anomalies), sadin: new Map(sadin.map(row => [row.t.tz, row])) };
  }
  function compute(tz, opts, context) {
    const t = Store.trainees.get(tz);
    if (!t) return {
      tz, gradeKey: '', classKey: '', overall: 'unknown', pedagogical: [flag('bagrut.unknown')],
      dataQuality: [flag('data.not_in_roster')], prereqs: { hasBagrut: false, hasGroups: false, hasSadin: false }, ev: null
    };
    const prereqs = prereqsFrom(t.gradeKey, context.sets);
    const pedagogical = [], dataQuality = [], ev = BagrutEngine.evaluate(tz, opts);
    if (!ev) throw new Error('BagrutEngine did not evaluate a roster student: ' + tz);
    const bagrutUnknown = !ev.manual && !prereqs.hasBagrut && (!useCurrent(opts) || !prereqs.hasSadin);
    const status = bagrutUnknown ? 'unknown' : bagrutStatus(ev, t.gradeKey);
    const statusDetail = bagrutUnknown ? 'לא נטענו נתוני בגרות לשכבה' : (ev.tierText || '');
    pedagogical.push(flag('bagrut.' + ({ ok: 'eligible', watch: 'watch', risk: 'risk', unknown: 'unknown', twelve: 'twelve' })[status], statusDetail));
    if (!ev.manual && !bagrutUnknown) {
      if (prereqs.hasBagrut) ev.blockers.filter(b => b.k === 'noshow').forEach(b => pedagogical.push(flag('bagrut.noshow', b.text)));
      if (prereqs.hasGroups) ev.blockers.filter(b => b.k === 'enroll').forEach(b => pedagogical.push(flag('bagrut.missing_enroll', b.text)));
    }
    if (ev.manualReview && (ev.manualReview.required || ev.manualReview.foreignCodes.length)) {
      const details = [...ev.manualReview.reasons, ...ev.manualReview.foreignCodes.map(c => `שאלון ${c.code}`)];
      dataQuality.push(flag('data.manual_review', details.join(' · ')));
    }
    if (!prereqs.hasGroups) pedagogical.push(flag('placement.unknown'));
    else (context.anomalies.get(tz) || []).forEach(row => {
      const id = { none: 'placement.missing_core', dup: 'placement.duplicate', grade: 'placement.wrong_grade', nomajor: 'placement.no_major' }[row.kind];
      if (id) pedagogical.push(flag(id, row.subject));
    });
    if (!prereqs.hasSadin) pedagogical.push(flag('sadin.unknown'));
    else {
      const sheet = context.sadin.get(tz);
      if (sheet) Config.withRulesForGrade(t.gradeKey, () => {
        const rules = Config.rules(), borderline = Number(rules.borderlineMin), pass = Number(rules.passGrade);
        sheet.subjects.forEach(subject => {
          if (subject.avg == null) return;
          const social = Util.norm(subject.name) === Util.norm('מעורבות חברתית');
          if (!isPassingScore(subject.avg, { social })) {
            const detail = `${subject.name}: ${Util.fmt(subject.avg, 1)}`;
            pedagogical.push(flag('sadin.fail', detail));
            if (Number.isFinite(borderline) && Number.isFinite(pass) && subject.avg >= borderline && subject.avg < pass)
              pedagogical.push(flag('sadin.borderline', detail));
          }
        });
        if (sheet.missed) pedagogical.push(flag('sadin.missed_event', String(sheet.missed)));
      });
      if (prereqs.hasGroups) {
        const ids = new Set(Store.groupsOf(tz).filter(g => g.inFile).map(g => String(g.groupId)));
        Store.currentOf(tz).forEach(entry => {
          if (entry.groupId && !ids.has(String(entry.groupId)))
            dataQuality.push(flag('data.sadin_not_enrolled', `${entry.subject || ''} [${entry.groupId}]`));
        });
      }
    }
    const overall = status === 'twelve' ? 'twelve' : bagrutUnknown ? 'unknown' :
      pedagogical.some(f => f.severity === 'risk') ? 'risk' :
        pedagogical.some(f => f.severity === 'watch') ? 'watch' :
          pedagogical.some(f => f.severity === 'unknown') ? 'unknown' : 'ok';
    return { tz, gradeKey: t.gradeKey, classKey: t.classKey, overall, pedagogical, dataQuality, prereqs, ev };
  }
  function computeForTrainee(tz, opts = {}) {
    const t = Store.trainees.get(tz);
    return compute(tz, opts, buildContext(t ? [t] : []));
  }
  function computeAll(opts = {}) {
    const roster = Store.traineeList();
    const groups = [...Store.groups.values()].map(g => ({ ...g, members: [...g.members], gradeMembers: [...g.gradeMembers] }));
    const current = [...Store._current.entries()], bagrut = [...Store._bagrut.entries()].map(([tz, entries]) => [tz, [...entries.entries()]]);
    const key = JSON.stringify([Store.loaded, Store.raw, roster, groups, current, bagrut, Store.missed, Config.data, Config._rulesOverride, opts]);
    if (cachedKey === key && cachedResult) return cachedResult;
    const context = buildContext(roster), list = roster.map(t => compute(t.tz, opts, context));
    const counts = { total: list.length, ok: 0, watch: 0, risk: 0, unknown: 0, twelve: 0, dataQuality: 0 };
    list.forEach(result => {
      counts[result.overall]++;
      if (result.dataQuality.length) counts.dataQuality++;
    });
    cachedKey = key;
    cachedResult = { version: ++sequence, byTz: new Map(list.map(result => [result.tz, result])), list, counts };
    return cachedResult;
  }
  function invalidate() { cachedKey = null; cachedResult = null; }
  window.SignalEngine = Object.freeze({ CATALOG, prerequisitesFor, isPassingScore, computeForTrainee, computeAll, invalidate });
})();
