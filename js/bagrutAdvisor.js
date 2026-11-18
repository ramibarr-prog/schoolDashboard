/* =====================================================================
   bagrutAdvisor.js – שכבת התצוגה והסיכום של צפי הזכאות לבגרות:
   תאי הגיליון הוויזואלי (מקצוע / מגמה / פנימיות), מיקוד פדגוגי, מדדי KPI מצטברים
   ומטריצת שאלונים למקצוע בודד.

   תלות חד-כיוונית: המודול נשען על BagrutEngine (נטען לפניו) ומוסיף לתוצאת ההערכה
   את שדות התצוגה דרך BagrutEngine.registerDecorator. המנוע עצמו אינו מכיר את המודול.
   ===================================================================== */

const BagrutAdvisor = (() => {
  const { activeOnly, detectLevel, enrolledInMajor, levelScope, reverseNeed, codeOfComp, compOrd, gradeRank, resolveTiming, cohortOf, COHORT_MAJOR_PCT } = BagrutEngine;

  const trackOf = tz => {
    const t = Store.trainees.get(tz);
    return Config.trackFor(tz, t && t.track, t && t.classKey);
  };

  /* ---------- תאי הגיליון הוויזואלי: טקסט, תת-כיתוב, צבע ופירוט לחלון המידע ---------- */
  const CELL_CLS = {
    pass: 'bg-emerald-50 text-emerald-800 font-bold', sky: 'bg-sky-50 text-sky-800', amber: 'bg-amber-50 text-amber-800 font-bold',
    rose: 'bg-rose-50 text-rose-700 font-bold', neutral: 'text-slate-400 text-xs', future: 'text-xs'
  };
  const INTERNAL_ICON = { social: '🤝', pe: '🏃', science: '🔬', general: '📚', traffic: '🚦' };
  const fv = v => (v == null || v === '' ? '—' : String(v));

  /** הניסיון עם הציון הגבוה ביותר מבין סמלי הרכיב (לפירוט מגן / בחינה / סופי) */
  function bestAttempt(tz, codes) {
    let best = null;
    Store.attemptsOf(tz).forEach(a => {
      if (!codes.includes(String(a.code))) return;
      const n = a.cls && a.cls.kind === 'num' ? a.cls.num : -1;
      if (!best || n > best.n) best = { a, n };
    });
    return best && best.a;
  }

  function compTip(tz, c) {
    const a = bestAttempt(tz, c.codes.map(String));
    const head = `שאלון ${a ? a.code : (c.code || c.codes[0])}${c.weight ? ` (${c.weight}%)` : ''}`;
    if (a) return `${head}: מגן ${fv(a.submission)}, בחינה ${fv(a.exam)}, סופי ${fv(a.final)}${a.moed ? ` · ${a.moed}` : ''}`;
    return `${head}: ${c.state === 'missing' && !c.due ? 'טרם דווח לשכבה' : 'לא ניגש / חסר'}`;
  }

  function subjectCell(tz, s, ctx) {
    const rules = ctx.rules, pass = rules.passGrade, rev = s.reverse;
    const nums = s.comps.filter(c => c.state === 'num');
    const wSum = nums.reduce((a, c) => a + c.weight, 0);
    const ext = wSum ? Math.round(nums.reduce((a, c) => a + c.num * c.weight, 0) / wSum) : null;
    const score = s.adj != null ? Math.round(s.adj) : null;
    const hasNum = nums.length > 0;
    let cls = CELL_CLS.neutral, text = '—', sub = '', state = 'pending';
    const set = (c, t, sb, st) => { cls = CELL_CLS[c]; text = t; sub = sb || ''; state = st; };

    if (s.enrolled === false) set('rose', '—', 'ללא שיבוץ', 'noenroll');
    else if (s.comps.some(c => c.failed || c.blocked)) set('rose', 'לא עבר', 'כישלון מדווח בשאלון', 'fail');
    else if (s.noShow && !hasNum) set('rose', 'לא ניגש', '', 'noshow');
    else if (s.learning && !hasNum) set('amber', 'לומד', 'טרם נבחן', 'learning');
    else if (s.status === 'pending' || s.status === 'nodata') {
      const future = s.comps.length > 0 && s.comps.every(c => c.future);
      if (future) {
        const next = Util.GRADE_KEYS.find(k => Util.ord(k) === Math.min(...s.comps.map(c => c.targetRank)));
        set('future', s.group ? 'לומד' : `עתידי ל${Util.gl(next)}`, '', 'future');
      } else set('neutral', s.group ? 'לומד' : '—', ctx.useCurrent && s.current != null ? `שוטף ${Math.round(s.current)}` : '', 'pending');
    } else if (s.status === 'pass') {
      const cur = s.source === 'current';
      set('pass', s.allPass ? 'עבר' : String(score), s.partial && s.partial.donePct ? `(${s.partial.donePct}%)` : cur ? '(שוטף)' : '', 'pass');
    } else if (ctx.adaptive && s.variableUnits && s.learning && hasNum && ext >= pass && !s.unresolved.some(c => c.failed || c.blocked)) {
      set('pass', String(ext), 'לומד השנה; ממתין לשאלון נוסף', 'pass');
    } else if (s.status === 'await' || (s.status === 'missing' && hasNum)) {
      if (rev && rev.level === 'red') set('rose', String(ext), `גם 100 ב-${rev.pct}% לא מספיק`, 'lost');
      else if (rev) set('sky', String(ext), `צריך ${reverseNeed(rev)}`, 'reverse');
      else if (s.status === 'await') set('sky', String(ext), 'ממתין לשאלון נוסף', 'await');
      else set('rose', String(ext), 'חסר שאלון', 'missing');
    } else if (s.status === 'missing') set('rose', 'חסר', 'שאלון חסר', 'missing');
    else if (s.status === 'comp') {
      const fromCur = s.source === 'current' ? ' (שוטף)' : '';
      s.critical ? set('rose', String(score), 'ללא קיזוז' + fromCur, 'fail') : set('amber', String(score), 'קיזוז' + fromCur, 'comp');
    } else {
      const pts = ctx.compensation && ctx.compensation.type === 'points' && ctx.compensation.subject === s.name;
      pts ? set('amber', String(score), 'פיצוי נקודות', 'comp') : set('rose', String(score), s.source === 'current' ? '(שוטף נמוך)' : 'נכשל', 'fail');
    }

    const tip = [`${s.name}${s.variableUnits && s.units ? ` · ${s.units} יח"ל` : ''}`, ...s.comps.map(c => compTip(tz, c))];
    if (sub) tip.push(`מצב: ${sub}`);
    if (rev) tip.push(rev.text);
    tip.push(s.group ? `קבוצה: ${s.group.subject} [${s.group.groupId}]${s.group.teacher ? ` · ${s.group.teacher}` : ''}` : 'קבוצה: לא משובץ');
    tip.push(`ציון שוטף: ${s.current != null ? Math.round(s.current) : '—'}${s.source === 'current' ? ' (משמש כתחזית)' : ''}`);
    if (s.currentWarn) tip.push(s.currentWarn);
    return { id: s.id, name: s.name, units: s.variableUnits ? s.units : null, text, sub, cls, state, tip: tip.join(' | ') };
  }

  /**
   * עמודת "מגמה 5 יח"ל": אך ורק מגמות בחירה אמיתיות (לא מתמטיקה / אנגלית, שיש להן עמודות משלהן).
   * עדיפות: מגמה עם ציון עובר, אחר כך לומד, אחר כך נכשל / חסר. מגמה נוספת מוזכרת בתת-הכיתוב ובחלון הפירוט.
   */
  function majorCell(tz, major, blockers, ctx) {
    const rank = { pass: 0, pending: 1, fail: 2, missing: 3, nodata: 4 };
    const electives = major.cands.filter(c => !c.coreId).sort((a, b) => (rank[a.status] ?? 5) - (rank[b.status] ?? 5));
    const short = c => c.name.split('/')[0].trim();
    if (!electives.length) {
      const none = blockers.some(b => b.k === 'major-none');
      const viaCore = major.chosen && major.chosen.coreId ? ` | מקצוע מורחב מתקיים דרך ${major.chosen.name}` : '';
      return { name: '', text: none ? 'ללא מגמה' : '—', sub: '', cls: none ? CELL_CLS.rose : CELL_CLS.neutral, state: none ? 'none' : 'pending', tip: `מגמה 5 יח"ל: לא נמצא שיבוץ או ציון למגמת בחירה${viaCore}` };
    }
    const cand = electives[0], others = electives.slice(1);
    const name = short(cand);
    const score = cand.adj != null ? String(Math.round(cand.adj)) : '';
    let cls, text, state;
    if (cand.status === 'pass') { cls = CELL_CLS.pass; text = score || 'עבר'; state = 'pass'; }
    else if (cand.status === 'pending') { cls = CELL_CLS.neutral; text = 'לומד'; state = 'pending'; }
    else if (cand.status === 'fail') { cls = CELL_CLS.rose; text = score; state = 'fail'; }
    else { cls = CELL_CLS.amber; text = 'חסר'; state = 'missing'; }
    const tip = [`מגמה 5 יח"ל: ${cand.name}`];
    if (cand.bagrut != null) tip.push(`ציון בגרות: ${Math.round(cand.bagrut)}`);
    if (cand.missing && cand.missing.length) tip.push(`שאלון חסר: ${cand.missing.join(', ')}`);
    if (cand.blocked) tip.push(`חסם בגרות (שאלון ${cand.blocked})`);
    tip.push(`ציון שוטף: ${cand.current != null ? Math.round(cand.current) : '—'}`);
    others.forEach(o => tip.push(`מגמה נוספת: ${o.name} – ${({ pass: 'עברה', pending: 'לומד', fail: 'נכשלה', missing: 'חסר שאלון', nodata: 'אין נתון' })[o.status] || ''}${o.adj != null ? ` (${Math.round(o.adj)})` : ''}`));
    const sub = [name, others.length ? `+ ${others.map(short).join(', ')}` : '', cand.source === 'current' && cand.status !== 'pending' ? '(שוטף)' : ''].filter(Boolean).join(' ');
    return { name, text, sub, cls, state, tip: tip.join(' | ') };
  }

  function internalCells(internals) {
    return internals.map(i => {
      let state = 'pending', title = 'טרם נדרש בשכבה';
      if (i.explicitFail) { state = 'miss'; title = 'לא עבר'; }
      else if (i.done) { state = 'ok'; title = 'עומד'; }
      else if (i.exempt) { state = 'na'; title = 'פטור (שני מקצועות מדעיים מורחבים)'; }
      else if (i.ignored) { state = 'na'; title = 'הוזנח בסימולציה'; }
      else if (i.required) { state = i.inGroup ? 'learning' : 'miss'; title = i.inGroup ? 'חסר ציון (לומד השנה)' : 'חסר'; }
      return { id: i.id, name: i.name, icon: INTERNAL_ICON[i.id] || '▫️', state, tip: `${i.name}: ${title}` };
    });
  }

  /** מיקוד פדגוגי: רק כשלים ממשיים, שאלונים שנבחנו בשכבה וחסרים, ויעדי "מחשבון הפוך" */
  function focusItems(blockers, reverse) {
    const items = blockers.filter(b => !b.info && b.k !== 'reverse30' && b.k !== 'reverse-pending')
      .sort((a, b) => (b.hard ? 1 : 0) - (a.hard ? 1 : 0))
      .map(b => ({ text: (b.miss && !/^לא ניגש/.test(b.text) ? 'חסר ' : '') + b.text, hard: !!b.hard }));
    reverse.filter(r => r.level !== 'info').forEach(r => items.push(r.level === 'red'
      ? { text: `${r.subject}: גם 100 ב-${r.pct}% לא מספיק – מועד ב'`, hard: true }
      : { text: `🎯 ${r.subject}: צריך ${reverseNeed(r)}`, hard: false, target: true }));
    return items;
  }

  /** שדות התצוגה שנוספים לתוצאת BagrutEngine.evaluate: תאי גיליון, תאי מגמה / פנימיות ומיקוד פדגוגי */
  function decorate(ev, env) {
    const { tz, ctx, juniorPace } = env;
    const cells = {};
    ev.subjects.forEach(s => { cells[s.id] = subjectCell(tz, s, ctx); });
    const focus = juniorPace ? [...ev.paceInfo.focus, ...focusItems([], ev.reverse)] : focusItems(ev.blockers, ev.reverse);
    return { cells, majorCell: majorCell(tz, ev.major, ev.blockers, ctx), internalCells: internalCells(ev.internals), focus };
  }
  BagrutEngine.registerDecorator(decorate);

  /** מדדי KPI מצטברים לרשימת הערכות */
  function summarize(evals) {
    const special = Config.SPECIAL_ED;
    const counted = evals.filter(e => e.tier !== 5 && e.tier !== 0);
    const ok = e => e.tier >= 1 && e.tier <= 2;
    const noSp = counted.filter(e => trackOf(e.tz) !== special);
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    return {
      total: evals.length,
      noBagrut: evals.filter(e => e.tier === 0).length,
      counted: counted.length,
      specialEd: evals.filter(e => trackOf(e.tz) === special).length,
      eligibilityExSpecialEd: pct(noSp.filter(ok).length, noSp.length),
      eligibilityInclSpecialEd: pct(counted.filter(ok).length, counted.length),
      singleBlocker: evals.filter(e => e.singleBlocker).length,
      exceptions: evals.filter(e => e.manual).length,
      savable: evals.filter(e => e.savable).length,
      potentialExceptions: evals.filter(e => !e.manual && e.isPotentialException).length,
      manualReview: evals.filter(e => e.manualReview && e.manualReview.required).length
    };
  }

  const FOREIGN_REASON = { immigrant: 'שאלון עולים / מותאם', 'other-level': 'רמת יח"ל אחרת', 'other-cohort': 'שאלון ממחזור אחר', 'unlisted-code': 'סמל שאינו מוגדר בפרופיל' };

  /** שורות פירוט לסימון "נדרשת בדיקה ידנית": סמל השאלון, המקצוע, הסיבה והציון (מערך ריק כשאין סימון) */
  function manualReviewLines(ev) {
    const mr = ev && ev.manualReview;
    if (!mr || !mr.required) return [];
    return mr.foreignCodes.map(f => {
      const where = [f.subject, f.level ? `${f.level} יח"ל` : '', f.cohort].filter(Boolean).join(' · ');
      const score = f.grade != null ? `ציון ${Math.round(f.grade)}` : f.status === 'pass' ? 'עובר' : f.status === 'fail' ? 'לא עבר' : 'ללא ציון';
      return `שאלון ${f.code}${where ? ` (${where})` : ''}: ${FOREIGN_REASON[f.reason] || f.reason} · ${score}`;
    });
  }

  /** תקינות צבירה מצטברת: י' / י"א לפי paceStatus; חניכי י"ב (אם נכללו) לפי צפי הזכאות הרגיל */
  function summarizePace(evals) {
    const special = Config.SPECIAL_ED;
    const counted = evals.filter(e => e.tier !== 5 && e.paceStatus !== 'no_data' && e.paceStatus !== 'twelve_years');
    const ok = e => e.paceStatus === 'on_track' || e.paceStatus === 'not_started' || e.paceStatus === 'eligible';
    const noSp = counted.filter(e => trackOf(e.tz) !== special);
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const count = (...st) => counted.filter(e => st.includes(e.paceStatus)).length;
    return {
      total: evals.length,
      counted: counted.length,
      onTrack: count('on_track', 'eligible'),
      notStarted: count('not_started'),
      warning: count('pace_warning', 'nearly'),
      lag: count('pace_lag', 'blocked'),
      pctInclSpecialEd: pct(counted.filter(ok).length, counted.length),
      pctExSpecialEd: pct(noSp.filter(ok).length, noSp.length)
    };
  }

  /* ---------- מטריצת שאלונים למקצוע בודד ---------- */
  /** אפשרויות הבחירה: [{ value: 'core:english:3' | 'core:history' | 'major:cs', label }] */
  function drillOptions() {
    const rules = Config.rules(), out = [];
    activeOnly(rules.coreSubjects).forEach(s => {
      if (s.variableUnits) {
        out.push({ value: `core:${s.id}`, label: `${s.name} – כל הרמות` });
        Object.keys(s.levels || {}).sort().forEach(lv => out.push({ value: `core:${s.id}:${lv}`, label: `${s.name} ${lv} יח'` }));
      }
    });
    ['hebrew', 'history', 'civics', 'tanach', 'literature'].forEach(id => {
      const s = activeOnly(rules.coreSubjects).find(x => x.id === id);
      if (s) out.push({ value: `core:${id}`, label: `${s.name} (${s.units || 2} יח')` });
    });
    activeOnly(rules.majors).filter(m => m.id !== 'english').forEach(m => out.push({ value: `major:${m.id}`, label: `${m.name} (מגמה 5 יח')` }));
    return out;
  }

  /**
   * מחזיר { name, questionnaires, rows } עבור בחירה מ-drillOptions; trainees = רשימת חניכים לאחר סינון גלובלי.
   * העמודות נקבעות לפי כללי המחזור של השכבה (כשהרשימה מכילה שכבה אחת), ואחרת לפי מחזור י"ב.
   */
  function subjectMatrix(sel, trainees) {
    const grades = [...new Set(trainees.map(t => t.gradeKey))];
    return Config.withRulesForGrade(grades.length === 1 ? grades[0] : 'יב', () => subjectMatrixOf(sel, trainees));
  }

  function subjectMatrixOf(sel, trainees) {
    const rules = Config.rules(), pass = Number(rules.passGrade) || 55;
    const [kind, id, lv] = String(sel).split(':');
    const hasCodes = (tz, lists) => lists.some(codes => Store.attemptsOf(tz).some(a => codes.map(String).includes(String(a.code))));
    let subj, major, name, defs;
    if (kind === 'major') {
      major = activeOnly(rules.majors).find(m => m.id === id);
      if (!major) return null;
      name = `${major.name} (מגמה 5 יח')`;
    } else {
      subj = activeOnly(rules.coreSubjects).find(s => s.id === id);
      if (!subj) return null;
      name = subj.variableUnits ? (lv ? `${subj.name} ${lv} יח'` : `${subj.name} – כל הרמות`) : `${subj.name} (${subj.units || 2} יח')`;
    }
    const compsOf = (levelKey) => activeOnly(subj.variableUnits ? subj.levels[levelKey] : subj.components);
    const levels = subj && subj.variableUnits ? (lv ? [lv] : Object.keys(subj.levels || {}).sort()) : [''];
    const colMap = new Map();
    const addCol = (codes, weight, expectedGrade) => {
      const key = codes.join(',');
      const c = colMap.get(key) || { key, codes, code: codes[0], weights: new Set(), names: [] };
      c.weights.add(Number(weight) || 0);
      if (expectedGrade && !c.expectedGrade) c.expectedGrade = expectedGrade;
      codes.forEach(cd => { const q = rules.questionnaires[String(cd)]; if (q && q.name && !c.names.includes(`${cd} ${q.name}`)) c.names.push(`${cd} ${q.name}`); });
      colMap.set(key, c);
    };
    if (major) {
      const parts = major.codeMode === 'any' ? [major.codes] : major.codes.map(c => [c]);
      defs = parts.map(codes => ({ codes, weight: Number(major.weights && major.weights[codes[0]]) || 100 / parts.length, expectedGrade: major.expectedGrade }));
      defs.forEach(d => addCol(d.codes, d.weight, d.expectedGrade));
    } else levels.forEach(l => compsOf(l).forEach(c => addCol(c.codes, c.weight, c.expectedGrade)));
    const questionnaires = [...colMap.values()].map(c => ({ ...c, code: codeOfComp(c), weightText: [...c.weights].sort((a, b) => b - a).join('/') }));

    const rows = [];
    trainees.forEach(t => {
      const tz = t.tz;
      let level = '', comps, scope = null, group;
      if (major) {
        const enrolled = enrolledInMajor(tz, major, 5);
        if (!enrolled && !hasCodes(tz, [major.codes])) return;
        comps = defs;
        scope = { key: `major:${major.id}`, min: Number(rules.cohortMajorMinPct) || COHORT_MAJOR_PCT, test: x => enrolledInMajor(x, major, 5) };
        group = Store.groupsOf(tz).find(g => !g.reinforcement && Util.matchKeywords(g.subject, major.keywords));
      } else {
        group = Store.groupsOf(tz).find(g => !g.reinforcement && Util.matchKeywords(g.subject, subj.keywords));
        if (subj.variableUnits) {
          level = String(detectLevel(tz, subj));
          if (lv && level !== String(lv)) return;
          if (!group && !hasCodes(tz, Object.values(subj.levels).flatMap(l => activeOnly(l).map(c => c.codes)))) return;
          if (!subj.levels[level]) return;
          scope = levelScope(subj, level);
        } else level = String(subj.units || 2);
        comps = compsOf(subj.variableUnits ? level : '');
      }
      let acc = 0, doneW = 0, totalW = 0, complete = true, anyPass = false;
      const cells = {};
      comps.forEach(c => {
        const w = Number(c.weight) || 0;
        totalW += w;
        const b = Store.bagrutBest(tz, c.codes);
        const key = c.codes.join(',');
        if (b && b.kind === 'num') { cells[key] = { state: 'num', num: b.num }; acc += b.num * w / 100; doneW += w; }
        else if (b && b.kind === 'pass') { cells[key] = { state: 'pass' }; complete = false; anyPass = true; }
        else {
          complete = false;
          const timing = resolveTiming({
            ord: compOrd(c, b), rank: gradeRank(t.gradeKey), strict: false,
            cohTaken: cohortOf(t.gradeKey, c.codes, scope).taken, hasAttempt: !!(b && b.kind !== 'none')
          });
          if (b && b.kind === 'fail') cells[key] = { state: 'fail' };
          /* שאלון שמועדו בשכבה גבוהה משל החניך וטרם דווח לו ציון: עתידי, לא חסר */
          else if (timing.future) cells[key] = { state: 'future', target: timing.ord };
          else cells[key] = { state: timing.due ? 'missed' : 'pending' };
        }
      });
      const accumulated = Math.round(acc);
      const remainingW = totalW - doneW;
      const finalScore = complete && totalW > 0 ? Math.round(acc * 100 / totalW) : null;
      const partialAvg = doneW ? Math.round(acc * 100 / doneW) : null;
      const need = Math.max(0, Math.ceil(pass - acc));
      rows.push({ t, level, teacher: group && group.teacher, groupId: group && group.groupId, cells, accumulated, doneW, totalW, remainingW, finalScore, partialAvg, need, anyPass, pass });
    });
    return { name, questionnaires, rows, pass };
  }

  return { drillOptions, subjectMatrix, summarize, summarizePace, manualReviewLines, subjectCell, majorCell, internalCells, focusItems, compTip };
})();
