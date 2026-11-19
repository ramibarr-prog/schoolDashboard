/* =====================================================================
   bagrutEngine.js – מנוע "3 השערים" לזכאות בגרות / תקינות מסלול:
   חוק הקיזוז, סימולטור "מה אם", זיהוי חשד למצב חריג, הכרעה ידנית של המרכזת,
   וייצור אבחון "מה חסר" + צפי (1–5).
   שכבת התצוגה והסיכום (תאי גיליון, מיקוד, KPI, מטריצת שאלונים) נמצאת ב-bagrutAdvisor.js.

   מקורות: המצבת העליונה (Store.trainees), כללי הזכאות (Config.rules()),
   חריגים לפי ת.ז (Config.getException) וקובצי המשנה (Store).
   ===================================================================== */

const BagrutEngine = (() => {
  const DEFAULT_OPTS = { ignoreInternals: false, plus5: false, useCurrent: false, fullMode: false };

  const TIER_TEXT = {
    full: { 1: 'זכאי מלא', 2: 'צפוי לזכאות', 3: 'בסיכון / במרחק נגיעה', 4: 'לא זכאי', 5: 'מסלול 12 שנות לימוד' },
    ontrack: { 1: 'מסלול תקין', 2: 'כמעט תקין', 3: 'בסיכון / במרחק נגיעה', 4: 'מסלול לא תקין', 5: 'מסלול 12 שנות לימוד' },
    /* צפי מותאם לשלב בשנה: נשפט לפי מה שהשכבה כבר עברה */
    adaptive: { 1: 'צפוי לזכאות', 2: 'זכאי (קיזוז/גבולי)', 3: 'במרחק נגיעה', 4: 'בסיכון / חסמים', 5: 'מסלול 12 שנות לימוד' }
  };

  /* סף דיווח שכבתי: רכיב ליבה (שער 1) נחשב "נבחן בשכבה" כשלפחות 35% מהאוכלוסייה הרלוונטית כבר קיבלו בו ציון.
     למגמות (שער 2) הסף נמוך יותר (15%) ונמדד מתוך הלומדים את המגמה הספציפית */
  const COHORT_MIN_PCT = 35;
  const COHORT_MAJOR_PCT = 15;

  /* שאלוני עולים / התאמות שמסמנים חשד למצב חריג, בנוסף לרשימה שבכללים */
  const IMMIGRANT_CODES = ['5384', '585580', '581580'];

  /* הכרעה ידנית: צפי וכותרת לכל סטטוס (מקור יחיד: Config.OVERRIDE_STATUSES) */
  const OVERRIDE = Object.fromEntries(Config.OVERRIDE_STATUSES.map(s => [s.value, { tier: s.tier, label: s.short }]));
  const OVERRIDE_BY_LABEL = Object.fromEntries(Object.entries(OVERRIDE).map(([k, v]) => [v.label, k]));
  const overrideKey = s => (OVERRIDE[s] ? s : OVERRIDE_BY_LABEL[s] || 'atrisk');

  const NO_BAGRUT_TEXT = 'טרם נטען קובץ בגרויות';
  const GATE_KEY = { 1: 'core', 2: 'major', 3: 'internal' };

  /** דרגת שכבה מספרית (10 / 11 / 12) מכל כתיבה: י' / י / י"א / יא / י"ב / 12. שכבה חסרה או לא מוכרת נחשבת י"ב */
  function gradeRank(g) {
    const k = Util.normGrade(g);
    return k ? Util.ord(k) : 12;
  }

  /* סטטוס תקינות צבירה לשכבות י' / י"א (לשכבת י"ב נגזר מצפי הזכאות המלא) */
  const PACE_TEXT = { on_track: '✓ תקין לקצב שכבה', pace_warning: 'חסם צבירה יחיד', pace_lag: 'בפיגור צבירה', not_started: 'טרם החלו היבחנות', no_data: NO_BAGRUT_TEXT };
  const paceText = (status, gradeKey) => (status === 'on_track' ? `✓ תקין לקצב ${Util.gl(gradeKey)}` : PACE_TEXT[status] || '');
  /* דרגת צפי מקבילה לצורך מיון בלבד */
  const PACE_TIER = { on_track: 1, not_started: 1, pace_warning: 3, pace_lag: 4, no_data: 0 };
  const SENIOR_STATUS = { 0: 'no_data', 1: 'eligible', 2: 'eligible', 3: 'nearly', 4: 'blocked', 5: 'twelve_years' };

  const rnd = n => (n == null ? '—' : String(Math.round(n)));
  const activeOnly = list => (list || []).filter(c => c.enabled !== false);

  /* הרחבות תצוגה משלימות את תוצאת ההערכה; המנוע אינו תלוי בהן ופועל גם בלעדיהן */
  const decorators = [];
  function registerDecorator(fn) { if (!decorators.includes(fn)) decorators.push(fn); }

  /* ---------- שכבת יעד וסמל מייצג של רכיב (מקור יחיד לכל הצרכנים) ---------- */
  const validRank = g => { const n = Util.ord(Util.normGrade(g)); return n >= 10 ? n : 0; };

  /** הסמל המייצג של הרכב: סמל הניסיון הטוב ביותר שדווח, ובהיעדרו הסמל הראשון */
  function codeOfComp(comp, b) {
    if (b && b.kind !== 'none' && b.code) return Util.normQuestionnaireCode(b.code);
    return Util.normQuestionnaireCode(comp && comp.codes && comp.codes[0]);
  }

  /**
   * שכבת היעד המספרית (10 / 11 / 12) של רכיב, לפי סדר עדיפות:
   * 1. expectedGrade מפורש ברכיב; 2. שכבת הסמל של הניסיון שדווח; 3. הקטלוג לכל סמלי הרכיב (עדיפות לסמלים מאומתים,
   * ובמקרה של פער – השכבה המאוחרת); 4. י"ב.
   */
  function compOrd(comp, b) {
    const explicit = validRank(comp && comp.expectedGrade);
    if (explicit) return explicit;
    const cat = Config.rules().questionnaires || {};
    if (b && b.kind !== 'none' && b.code) {
      const r = validRank((cat[Util.normQuestionnaireCode(b.code)] || {}).expectedGrade);
      if (r) return r;
    }
    const entries = ((comp && comp.codes) || []).map(code => cat[Util.normQuestionnaireCode(code)]).filter(q => q && validRank(q.expectedGrade));
    const verified = entries.filter(q => !q.unverifiedGrade);
    const ranks = (verified.length ? verified : entries).map(q => validRank(q.expectedGrade));
    return ranks.length ? Math.max(...ranks) : 12;
  }

  /**
   * תזמון רכיב מול שכבת החניך – אותה הגדרה בשער 1, בשער 2, בתקינות הצבירה ובמטריצת השאלונים.
   * עתידי: שכבת היעד גבוהה משל החניך וטרם דווח בו כלום. נדרש: דווח בו משהו (גם כישלון / חסם), או שהגיע מועדו
   * ובמצב תעודה סופית, או שהשכבה כבר נבחנה בו (סף הדיווח השכבתי).
   */
  function resolveTiming({ ord, rank, strict, cohTaken, hasAttempt }) {
    const has = !!hasAttempt;
    const due = has || (ord <= rank && (!!strict || !!cohTaken));
    return {
      ord, hasAttempt: has, future: ord > rank && !has, expDue: ord <= rank || has, due,
      pending: !due, pendingCohort: ord <= rank && !has && !strict && !cohTaken, missing: due && !has
    };
  }

  /**
   * מידע שכבתי על רכיב (קבוצת סמלי שאלון חלופיים): כמה מהאוכלוסייה הרלוונטית בשכבה כבר קיבלו בו ציון.
   * scope מצמצם את האוכלוסייה (רמת יח"ל באנגלית/מתמטיקה, או לומדי מגמה מסוימת) ויכול לקבוע סף משלו.
   * takenByCohort = הכיסוי הגיע לסף; אחרת pendingCohort ("טרם דווח לשכבה / בתהליך").
   */
  function cohortOf(gradeKey, codes, scope) {
    const key = `${gradeKey}|${scope ? scope.key : ''}|${codes.join(',')}`;
    let e = Store._cohortCache.get(key);
    if (!e) {
      let total = 0, have = 0;
      Store.trainees.forEach(t => {
        if (t.gradeKey !== gradeKey || (scope && !scope.test(t.tz))) return;
        total++;
        const b = Store.bagrutBest(t.tz, codes);
        if (b && b.kind !== 'none') have++;
      });
      e = { total, have };
      Store._cohortCache.set(key, e);
    }
    const pct = e.total ? (e.have / e.total) * 100 : 0;
    const min = scope && scope.min != null ? scope.min : (Number(Config.rules().cohortMinPct) || COHORT_MIN_PCT);
    return { ...e, pct, min, taken: e.total > 0 && pct >= min };
  }

  const levelScope = (subj, level) => (subj.variableUnits ? { key: `${subj.id}@${level}`, test: tz => String(detectLevel(tz, subj)) === String(level) } : null);

  function enrolledInMajor(tz, m, requiredUnits) {
    const traineeMajor = Util.norm((Store.trainees.get(tz) || {}).majorName || '');
    const byName = !!traineeMajor && (m.majorNames || []).some(n => { const k = Util.norm(n); return k && traineeMajor.includes(k); });
    return byName || Store.groupsOf(tz).some(g => !g.reinforcement && Util.matchKeywords(g.subject, m.keywords) && !(g.units && +g.units < requiredUnits));
  }

  /** כל הרכיבים הידועים בכללים (ליבה/פנימיות) והאם נבחנו בשכבה: activeCohortQuestionnaires לשכבה */
  function activeCohortQuestionnaires(gradeKey) {
    return Config.withRulesForGrade(gradeKey, () => activeCohortQuestionnairesOf(gradeKey));
  }

  function activeCohortQuestionnairesOf(gradeKey) {
    const rules = Config.rules(), out = [];
    const add = (subject, label, codes, weight, scope, comp) => {
      if (!codes || !codes.length) return;
      const c = cohortOf(gradeKey, codes, scope);
      const rank = compOrd(comp || { codes });
      out.push({ subject, label, codes, weight, variable: !!scope, pct: Math.round(c.pct), have: c.have, total: c.total, takenByCohort: c.taken, pendingCohort: !c.taken,
        expectedGrade: Util.GRADE_KEYS.find(k => Util.ord(k) === rank) || 'יב' });
    };
    activeOnly(rules.coreSubjects).forEach(s => {
      const lists = s.variableUnits ? Object.entries(s.levels || {}).map(([lv, list]) => [lv, list]) : [['', s.components]];
      lists.forEach(([lv, list]) => activeOnly(list).forEach(c => add(s.name + (lv ? ` ${lv} יח"ל` : ''), `${c.weight}%`, c.codes, Number(c.weight) || 0, levelScope(s, lv), c)));
    });
    activeOnly(rules.internals).forEach(i => add(i.name, 'פנימי', i.codes, 0, null, i));
    return out;
  }

  /** מקבל גם את שמות הדגלים בסימולטור כפי שהם בממשק וגם את השמות החלופיים */
  function normalizeOpts(o) {
    const s = o || {};
    const pick = (a, b) => (s[a] !== undefined ? s[a] : s[b]);
    return {
      ignoreInternals: !!pick('ignoreInternals', 'ignoreInternal'),
      plus5: !!pick('plus5', 'boostBorderlinePlus5'),
      useCurrent: !!pick('useCurrent', 'useCurrentGradesAsForecast'),
      fullMode: !!s.fullMode
    };
  }

  /* ---------- רכיבי מקצוע ורמת יח"ל ---------- */
  function detectLevel(tz, subj) {
    const levels = Object.keys(subj.levels || {}).sort();
    if (!levels.length) return null;
    const g = Store.groupsOf(tz).find(x => !x.reinforcement && Util.matchKeywords(x.subject, subj.keywords) && x.units && subj.levels[x.units]);
    if (g) return g.units;
    let best = null, bestScore = 0;
    levels.forEach(l => {
      const comps = activeOnly(subj.levels[l]);
      const matched = comps.filter(c => {
        const best = Store.bagrutBest(tz, c.codes);
        return best && best.kind !== 'none';
      }).length;
      const score = comps.length ? (matched / comps.length) * 100 + matched : 0;
      if (score > bestScore || (score > 0 && score === bestScore && l === String(subj.defaultLevel))) { best = l; bestScore = score; }
    });
    return best || subj.defaultLevel || levels[0];
  }

  function componentsOf(tz, subj) {
    if (subj.variableUnits) {
      const level = detectLevel(tz, subj);
      return { level, comps: activeOnly(subj.levels && subj.levels[level]) };
    }
    return { level: subj.units, comps: activeOnly(subj.components) };
  }

  /** רכיב בית-ספרי (30%/20%), לפי סדר עדיפות: internal מפורש (true / false) ← תווית הרכיב ← שמות השאלונים בקטלוג ← משקל נמוך מול רכיב חיצוני גדול ממנו */
  function isInternalComp(comp, siblings) {
    if (comp.internal === true) return true;
    if (comp.internal === false) return false;
    const re = /בית[\s\-־]?ספרי|פנימי/;
    if (re.test(comp.label || '')) return true;
    const cat = Config.rules().questionnaires || {};
    if ((comp.codes || []).some(code => { const q = cat[Util.normQuestionnaireCode(code)]; return !!q && re.test(q.name || ''); })) return true;
    const list = siblings || [], weights = list.map(c => Number(c.weight) || 0), w = Number(comp.weight);
    return list.length > 1 && w > 0 && w <= 30 && w < Math.max(...weights);
  }

  /* Store שומר "עבר" בלי דגל פטור; גם קבצים שנשמרו לפני הוספת הדגל מזוהים לפי הטקסט המקורי. */
  function bestResult(tz, codes) {
    const best = Store.bagrutBest(tz, codes);
    if (!best || best.kind !== 'pass') return best;
    const set = new Set(codes.map(Util.normQuestionnaireCode));
    const passes = Store.attemptsOf(tz).filter(a => set.has(Util.normQuestionnaireCode(a.code)) && a.cls.kind === 'pass');
    const exempt = passes.length > 0 && passes.every(a => a.cls.exempt || Parser.classify(a.shown || a.final || a.scoreRaw).exempt);
    return { ...best, exempt };
  }

  /**
   * ציון הרכיב הגבוה ביותר מבין כל הניסיונות ושאלונים חלופיים (Store.bagrutBest).
   * ציון בחינה ללא ציון הגשה (מגן): בתחזית משוטף משלימים את המגן מהציון השוטף (50%/50%).
   */
  function resolveComp(tz, comp, ctx, siblings, cur, scope) {
    const b = bestResult(tz, comp.codes);
    const code = codeOfComp(comp, b);
    const ord = compOrd(comp, b);
    const internal = isInternalComp(comp, siblings || [comp]);
    const coh = cohortOf(ctx.gradeKey, comp.codes, scope);
    /* צפי מותאם: רכיב שהשכבה טרם נבחנה בו אינו חוסר ("בתהליך השנה"); מצב תעודה סופית דורש הכול */
    const timing = resolveTiming({ ord, rank: ctx.rank, strict: ctx.strict, cohTaken: coh.taken, hasAttempt: !!(b && b.kind !== 'none') });
    const base = {
      codes: comp.codes, code, weight: Number(comp.weight) || 0, targetRank: ord,
      due: timing.due, pending: timing.pending, pendingCohort: timing.pendingCohort, future: timing.future, hasAttempt: timing.hasAttempt,
      takenByCohort: coh.taken, cohortPct: Math.round(coh.pct), internal
    };
    if (b && b.kind === 'num') {
      const examOnly = ctx.useCurrent && cur != null && Store.attemptsOf(tz).find(a =>
        a.code === b.code && a.partial === 'exam' && a.cls.kind === 'num' && a.cls.num === b.num);
      if (examOnly) {
        const mw = Config.magenWeight() / 100;
        return { ...base, state: 'num', num: Math.round(cur * mw + b.num * (1 - mw)), reportedNum: b.num, magenForecast: true };
      }
      return { ...base, state: 'num', num: b.num };
    }
    if (b && b.kind === 'pass') return { ...base, state: b.exempt ? 'exempt' : 'pass' };
    return { ...base, state: 'missing', failed: !!(b && b.kind === 'fail'), blocked: !!(b && b.block) };
  }

  /**
   * "מחשבון הפוך": כשיש רכיב מספרי ורכיב חסר, מחשב את הציון המינימלי
   * הנדרש ברכיב החסר כדי שציון המקצוע יעמוד בסף (ציון עובר פחות חצי, כלומר 54.5):
   *   required = ceil((54.5 - externalScore × W_ext) / W_int)
   */
  function reverseCalc(res, ctx) {
    const missing = res.unresolved.concat(res.pending);
    if (!missing.length || !missing.every(u => !u.failed && !u.blocked)) return null;
    const resolved = res.comps.filter(c => c.state === 'num');
    if (!resolved.length || resolved.length + missing.length !== res.comps.length) return null;
    const pass = ctx.rules.passGrade;
    const total = res.comps.reduce((a, c) => a + (Number(c.weight) || 0), 0);
    const wExtAbs = resolved.reduce((a, c) => a + c.weight, 0);
    const wIntAbs = missing.reduce((a, c) => a + c.weight, 0);
    if (!total || !wExtAbs || !wIntAbs) return null;

    const externalScore = resolved.reduce((a, c) => a + c.num * c.weight, 0) / wExtAbs;
    const wExt = wExtAbs / total, wInt = wIntAbs / total;
    const requiredFor = floor => Math.ceil(+((floor - 0.5 - externalScore * wExt) / wInt).toFixed(6));
    const required30 = requiredFor(pass);
    const requiredFor45 = Math.max(1, requiredFor(ctx.rules.compensationMin));
    const max = Math.round(externalScore * wExt + 100 * wInt);
    const pct = Math.round(wInt * 100);
    let level, text;
    if (required30 <= pass) {
      level = 'info';
      text = `🎯 חסר ${pct}% — נדרש ציון חיובי (מינימום ${Math.max(1, required30)}) ב-${pct}% לעובר ${pass}`;
    } else if (required30 <= 100) {
      level = 'amber';
      text = `🎯 חסר ${pct}% — חייב לפחות ${required30} ב-${pct}%       כדי לעבור מקצוע (${pass})`;
    } else {
      level = 'red';
            text = `קריטי: גם 100 ב-${pct}% לא יספיק (מקסימום ${max}) — חייב מועד ב' בבחינה`;
    }
    return { subject: res.name, level, text, required30, requiredFor45, compMin: ctx.rules.compensationMin, pct, max, externalScore, wExt, wInt, internalCodes: missing.map(u => u.code), pendingCohort: !res.unresolved.length };
  }

  /**
   * הציון הנדרש ברכיב הפנימי כטקסט "X ב-Y%". כשעובר ב-55 אינו אפשרי (required30 > 100) וההצלה היא בקיזוז (רמה amber),
   * מוצג הציון לקיזוז ולא required30 הבלתי אפשרי.
   */
  function reverseNeed(r) {
    return r.required30 > 100 && r.level === 'amber' ? `${r.requiredFor45} ב-${r.pct}% (לקיזוז ${r.compMin})` : `${r.required30} ב-${r.pct}%`;
  }

  /** מוסיף למחשבון ההפוך את אפשרות הקיזוז, כשהמקצוע ניתן לקיזוז ומכסת הקיזוז של החניך לא מוצתה */
  function addCompensationTip(s, ctx, compUsed) {
    const r = s.reverse, rules = ctx.rules;
    if (!r || s.critical || !rules.allowCompensationRule || compUsed >= rules.maxCompensations) return;
    if (r.requiredFor45 > 100 || (r.level !== 'red' && r.requiredFor45 >= Math.max(1, r.required30))) return;
    if (r.level === 'red') {
      r.level = 'amber';
      r.text = `🎯 חסר ${r.pct}% — עובר ${rules.passGrade} אינו אפשרי (מקסימום ${r.max}), אך עם קיזוז מספיק ${r.requiredFor45} ב-${r.pct}%`;
    } else {
      r.text += ` (או ${r.requiredFor45} עם קיזוז)`;
    }
  }

  /**
   * ציון שוטף למקצוע (ממוצע משוקלל מהסדין). אירוע בודד בציון 0 הוא כנראה בוחן שהוחמץ ולא ציון המקצוע:
   * הוא אינו נחשב לתחזית ומוצג כאזהרה בלבד. עם כמה אירועים מוערכים – הממוצע שלהם קובע.
   */
  function currentInfo(tz, keywords) {
    const e = Store.currentOf(tz).find(x => x.avg != null && Util.matchKeywords(x.subject, keywords));
    if (!e) return { value: null, warn: '', events: 0 };
    const graded = (e.events || []).filter(ev => ev.score != null);
    if (graded.length === 1 && graded[0].score === 0) {
      return { value: null, warn: `אירוע בודד בציון 0 (${graded[0].eventName || 'בוחן'}) – נחשב כבוחן שהוחמץ ולא ככישלון במקצוע`, events: 1 };
    }
    const zeros = graded.filter(ev => ev.score === 0).length;
    return { value: e.avg, warn: zeros ? `${zeros} אירועים בציון 0 בסדין (ייתכן בוחנים שהוחמצו)` : '', events: graded.length };
  }

  /* ---------- הערכת מקצוע חובה בודד: ממוצע משוקלל, עם תחזית משוטף כשמופעל ---------- */
  function evalSubject(tz, subj, ctx) {
    const rules = ctx.rules;
    const { level, comps } = componentsOf(tz, subj);
    const ci = currentInfo(tz, subj.keywords);
    const cur = ci.value;
    const res = {
      id: subj.id, name: subj.name, units: level, variableUnits: !!subj.variableUnits,
      critical: !!subj.critical || (rules.compensationExcludedSubjects || []).includes(subj.name),
      comps: [], current: cur, currentWarn: ci.warn, final: null, adj: null, source: 'none', allPass: false,
      boosted: false, forecast: false, unresolved: [], pending: [], filled: [], enrolled: null, status: 'nodata',
      partial: null, incomplete: false, earnedScore: null, missingPct: 0, exempt: false, group: null, learning: false, noShow: false
    };
    const grp = Store.groupsOf(tz).find(g => !g.reinforcement && Util.matchKeywords(g.subject, subj.keywords));
    if (grp) res.group = { groupId: grp.groupId, subject: grp.subject, teacher: grp.teacher };
    const scope = levelScope(subj, level);
    let sum = 0, w = 0, nPass = 0;
    comps.forEach(c => {
      const r = resolveComp(tz, c, ctx, comps, cur, scope);
      res.comps.push(r);
      if (r.state === 'num') { sum += r.num * r.weight; w += r.weight; }
      else if (r.state === 'pass') nPass++;
      else if (r.state === 'exempt') res.exempt = true;
      else if (r.due) {
        /* כישלון או חסם שדווחו בפועל אינם מתמלאים בציון שוטף */
        if (ctx.useCurrent && cur != null && !r.failed && !r.blocked) { sum += cur * r.weight; w += r.weight; res.filled.push(r); }
        else res.unresolved.push(r);
      } else res.pending.push(r);
    });

    const totalW = res.comps.reduce((a, c) => a + c.weight, 0);
    const reported = res.comps.filter(c => c.state === 'num');
    const reportedWeight = reported.reduce((a, c) => a + c.weight, 0);
    res.reportedScore = reportedWeight ? reported.reduce((a, c) => a + (c.reportedNum ?? c.num) * c.weight, 0) / reportedWeight : null;
    res.reportedPct = totalW ? Math.round(reportedWeight / totalW * 100) : 0;
    const missingDue = res.unresolved.concat(res.pending.filter(c => c.targetRank <= ctx.rank));
    res.incomplete = ctx.mode === 'full' && (reported.length > 0 || nPass > 0) && missingDue.length > 0 && !res.exempt;
    if (res.incomplete && totalW > 0) {
      res.earnedScore = reported.length ? Math.round(sum / totalW) : null;
      res.missingPct = Math.round(missingDue.reduce((a, c) => a + c.weight, 0) / totalW * 100);
    }
    const hasPending = !res.unresolved.length && res.pending.length > 0;
    if (res.unresolved.length) res.final = null;
    else if (w > 0) {
      res.final = sum / w; res.source = res.filled.length ? 'current' : 'bagrut';
      if (hasPending) res.partial = { donePct: totalW ? Math.round((w / totalW) * 100) : 0 };
    }
    else if (nPass > 0) { res.allPass = true; res.source = 'bagrut'; if (hasPending) res.partial = { donePct: 0 }; }
    else if (ctx.useCurrent && cur != null) { res.final = cur; res.source = 'current'; }
    res.forecast = ctx.mode === 'full' && (res.source === 'current' || res.comps.some(c => c.magenForecast));
    res.reverse = reverseCalc(res, ctx);

    let v = res.final;
    if (v != null && ctx.plus5 && v >= rules.borderlineMin && v < rules.passGrade) { v += rules.borderlineBonus; res.boosted = true; }
    res.adj = v;
    /* ציון סופי מעוגל: 44.5–54.5 קיזוז, 4.5–44.5 ציון נמוך (פיצוי נקודות), ומ-54.5 עובר */
    const rv = v == null ? null : Math.round(v);
    const pc = Config.pointsCompensation();
    if (res.exempt) res.status = 'exempt';
    else if (res.unresolved.length) res.status = 'missing';
    else if (res.incomplete) res.status = 'await';
    else if (res.partial && res.final != null && res.source === 'bagrut') {
      /* חלק מהרכיבים טרם דווח: שופטים לפי מה שהושלם. ציון חלקי מ-54.5 מספיק; אחרת "ממתין", או נכשל כשגם 100 ברכיב החסר לא יציל */
      const maxPossible = totalW ? (sum + 100 * res.pending.reduce((a, c) => a + c.weight, 0)) / totalW : 100;
      if (rv >= rules.passGrade) res.status = 'pass';
      else if (!res.reverse && Math.round(maxPossible) < rules.compensationMin) res.status = 'fail';
      else res.status = 'await';
    }
    else if (v == null) res.status = res.allPass ? 'pass' : (res.pending.length ? 'pending' : 'nodata');
    else if (rv >= rules.passGrade) res.status = 'pass';
    else if (rv >= rules.compensationMin && rv <= (rules.compensationMax ?? rules.passGrade - 1)) res.status = 'comp';
    else if (pc.enabled && rv >= pc.minScore && rv < rules.compensationMin) res.status = 'severe';
    else res.status = 'fail';
    return res;
  }

  /** האם נטענו קבוצות כלשהן במקצוע (לפי מילות מפתח) בשכבה של החניך – רק אז ניתן לטעון ל"חסר שיבוץ" */
  function groupsLoadedFor(keywords, gradeKey, minUnits) {
    return Store.groupsLoaded(keywords, gradeKey, minUnits);
  }

  /* ---------- שער 1: מקצועות ליבה + חוק קיזוז ---------- */
  function gate1(tz, ctx, B, notes) {
    const rules = ctx.rules;
    const active = rules.coreSubjects.filter(s => s.enabled !== false);
    const subjects = active.map(s => evalSubject(tz, s, ctx));
    const comps = [];
    const full = ctx.mode === 'full';

    const compUsed = subjects.filter(s => s.status === 'comp' && !s.critical).length;
    subjects.forEach(s => addCompensationTip(s, ctx, compUsed));

    subjects.forEach((s, i) => {
      if (s.exempt) B.push({ gate: 1, k: 'exempt-review', hard: true, text: `פטור במקצוע חובה (${s.name}) — דורש החלטת רכזת` });
      if (s.incomplete && !s.unresolved.length) {
        B.push({ gate: 1, k: 'partial-missing', hard: true, miss: true, inner: s.pending.every(c => c.internal),
          text: `${s.missingPct}% ב${s.name}${s.earnedScore != null ? ` (${s.earnedScore} נצברו)` : ''}` });
      }
      if (!full && ctx.hasGroups && groupsLoadedFor(active[i].keywords, ctx.gradeKey)) {
        s.enrolled = Store.groupsOf(tz).some(g => !g.reinforcement && Util.matchKeywords(g.subject, active[i].keywords));
        if (!s.enrolled) { B.push({ gate: 1, k: 'enroll', hard: true, text: `חסר שיבוץ לקבוצת ${s.name}` }); return; }
      }
      const redReverse = !!(s.reverse && s.reverse.level === 'red');
      const hasExternal = s.comps.some(c => c.state === 'num' || c.state === 'pass');
      s.unresolved.forEach(c => {
        if (c.blocked) { B.push({ gate: 1, k: 'bagrut-block', hard: true, text: `חסם בגרות – ${s.name} (שאלון ${c.code})` }); return; }
        /* מחשבון הפוך אדום מייצר חסם קשה אחד משלו, ולכן לא מוסיפים גם חסם "שאלון חסר" על אותו רכיב */
        if (redReverse && c.internal) return;
        /* השכבה כבר נבחנה ברכיב והחניך ללא ציון: לומד השנה (התראה רכה), או "לא ניגש!" / שאלון חסר (חסם) */
        if (!ctx.strict && Store.loaded.groups && s.group) {
          if (!s.learning) B.push({ gate: 1, k: 'learning', hard: false, info: true, text: `${s.name}: לומד השנה (טרם נבחן)` });
          s.learning = true;
          return;
        }
        if (!ctx.strict && !(c.internal && hasExternal)) {
          if (!s.noShow) B.push({ gate: 1, k: 'noshow', hard: full, miss: true, text: `לא ניגש ${s.name} (שאלון ${c.code})` });
          s.noShow = true;
          return;
        }
        B.push({ gate: 1, k: 'questionnaire', hard: full, miss: true, inner: !!(s.reverse && c.internal), text: `שאלון ${c.code} ב${s.name}` });
      });
      if (redReverse) B.push({ gate: 1, k: 'reverse30', hard: true, text: `${s.name}: ${s.reverse.text}` });
      else if (s.reverse && s.reverse.level === 'amber' && (s.status === 'await' || (s.status === 'missing' && s.learning))) {
        B.push({ gate: 1, k: 'reverse-pending', hard: false, watch: true, inner: true, text: `${s.name}: נדרש ${reverseNeed(s.reverse)}` });
      }
      /* תחזית משוטף היא תצוגה מקדימה בלבד: אינה מורידה צפי ואינה נחשבת חוסר */
      if (!full) s.filled.forEach(c => B.push({ gate: 1, k: 'questionnaire', hard: false, info: true, miss: true, text: `שאלון ${c.code} ב${s.name}` }));

      /* ציון שוטף הוא תצוגה מקדימה בלבד בצפי המותאם: נכשל שוטף הוא התראה רכה ולא חסם */
      const soft = s.source === 'current' && ctx.adaptive;
      if (s.status === 'nodata') {
        /* שכבות י'/י"א: מקצוע ללא שאלון שמועד הגשתו הגיע וללא ציון שוטף אינו חוסר */
        if (full || s.comps.some(c => c.due)) B.push({ gate: 1, k: 'nodata', hard: full, miss: true, text: `ציון ${s.name}` });
      } else if (s.status === 'fail') {
        B.push({ gate: 1, k: 'fail', hard: !soft, watch: soft, grade: s.adj, text: `${s.source === 'current' ? 'נכשל שוטף ב' : 'נכשל ב'}${s.name} (${rnd(s.adj)})` });
      } else if (s.status === 'severe') {
        /* ציון 5–44: חסם קשה, אלא אם פיצוי הנקודות מתקיים (נבדק ב-applyPointsCompensation אחרי שער 2) */
        if (s.critical) B.push({ gate: 1, k: 'critical', hard: !soft, watch: soft, grade: s.adj, text: `${s.name} ${rnd(s.adj)} – נדרש ${rules.passGrade} ללא פיצוי` });
        else B.push({ gate: 1, k: 'severe', hard: !soft, watch: soft, grade: s.adj, subject: s.id, text: `${s.source === 'current' ? 'נכשל שוטף ב' : 'נכשל ב'}${s.name} (${rnd(s.adj)})` });
      } else if (s.status === 'comp') {
        if (s.critical) B.push({ gate: 1, k: 'critical', hard: true, grade: s.adj, text: `${s.name} ${rnd(s.adj)} – נדרש ${rules.passGrade} ללא קיזוז` });
        else if (!rules.allowCompensationRule) B.push({ gate: 1, k: 'fail', hard: true, grade: s.adj, text: `${s.name} ${rnd(s.adj)} – חוק הקיזוז כבוי` });
        else comps.push(s);
      }
    });

    /* חוק הקיזוז (45–54): מקצוע בודד בטווח, למעט עברית ומעורבות חברתית, מזכה ללא סכום נקודות. הנמוך ביותר מקוזז ראשון */
    comps.sort((a, b) => a.adj - b.adj);
    comps.forEach((s, i) => {
      if (i < rules.maxCompensations) {
        s.compApplied = 'range';
        notes.push(`קיזוז 45–54: ${s.name} ${rnd(s.adj)}`);
        ctx.compensation = { type: 'range', subject: s.name, grade: s.adj };
      }
      else B.push({ gate: 1, k: 'comp-over', hard: true, grade: s.adj, text: `${s.name} ${rnd(s.adj)} – מעבר למכסת הקיזוז` });
    });
    subjects.forEach(s => { if (s.comps.some(c => c.magenForecast)) notes.push(`מגן ב${s.name}: תחזית משוטף`); });
    subjects.forEach(s => { if (s.boosted && s.status !== 'fail') notes.push(`${s.name}: +${rules.borderlineBonus} בסימולציה`); });
    return subjects;
  }

  /* ---------- שער 2: מקצוע מורחב 5 יח"ל (שכבות י'/י"א: שיבוץ; י"ב: ציון עובר) ---------- */
  function gate2(tz, ctx, B, subjects) {
    const rules = ctx.rules;
    const full = ctx.mode === 'full';
    const requiredUnits = (rules.gates && rules.gates.major && rules.gates.major.requiredUnits) || 5;
    const cands = [];

    /* אנגלית 5 יח"ל נספרת ליחידות ולנקודות הפיצוי, אך אינה מגמה: מגמה היא מקצוע מורחב שאינו אנגלית */
    rules.majors.filter(m => m.enabled !== false && m.id !== 'english').forEach(m => {
      const enrolled = enrolledInMajor(tz, m, requiredUnits);
      /* סף הדיווח של מגמה (15%) נמדד מתוך הלומדים אותה בשכבה, לא מכלל השכבה */
      const mScope = { key: `major:${m.id}`, min: Number(rules.cohortMajorMinPct) || COHORT_MAJOR_PCT, test: t => enrolledInMajor(t, m, requiredUnits) };
      /* חלק = קבוצת סמלי שאלון חלופיים (מספיק אחד). ב-codeMode 'any' כל סמלי המגמה הם חלק אחד; אחרת כל סמל הוא חלק נפרד.
         משקל כל חלק נקבע ב-m.weights (קוד ראשון ← משקל) ובברירת מחדל שווה */
      const parts = (m.codeMode === 'any' ? [m.codes] : m.codes.map(code => [code])).map(codes => {
        const w = Number(m.weights && m.weights[codes[0]]);
        const found = codes.map(code => bestResult(tz, [code]));
        const nums = found.filter(b => b && b.kind === 'num').map(b => b.num);
        const hasPartAttempt = found.some(b => b && b.kind !== 'none');
        const timing = resolveTiming({
          ord: compOrd({ codes, expectedGrade: m.expectedGrade }, Store.bagrutBest(tz, codes)), rank: ctx.rank, strict: ctx.strict,
          cohTaken: cohortOf(ctx.gradeKey, codes, mScope).taken, hasAttempt: hasPartAttempt
        });
        return {
          codes, w: w > 0 ? w : 1, nums, num: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
          pass: found.some(b => b && b.kind === 'pass' && !b.exempt),
          exempt: !nums.length && found.some(b => b && b.exempt) && !found.some(b => b && b.kind === 'pass' && !b.exempt),
          fail: found.some(b => b && b.kind === 'fail'), block: found.some(b => b && b.block), due: timing.due
        };
      });
      const nums = parts.filter(p => p.num != null);
      const passes = parts.filter(p => p.num == null && p.pass);
      const exempt = parts.some(p => p.exempt);
      const blocked = parts.find(p => p.block && p.num == null && !p.pass);
      const missing = parts.filter(p => p.num == null && !p.pass && !p.exempt && p.due);
      if (!enrolled && !nums.length && !passes.length && !exempt) return;
      const sumW = list => list.reduce((a, p) => a + p.w, 0);
      const cur = enrolled ? currentInfo(tz, m.keywords).value : null;
      const group = Store.groupsOf(tz).find(g => !g.reinforcement && Util.matchKeywords(g.subject, m.keywords) && Number(g.units));
      const c = { id: m.id, unitSubjectId: m.coreId || m.id, name: m.name,
        units: Number(m.units) || (group && Number(group.units)) || requiredUnits, complete: parts.every(p => p.num != null || p.pass), exempt,
        enrolled, bagrut: null, bagrutPass: passes.length > 0, failed: parts.some(p => p.fail && p.num == null && !p.pass), current: cur, grade: null, source: 'none', status: 'nodata', forecast: false, missing: missing.map(p => p.codes.join('/')), blocked: blocked ? blocked.codes[0] : '' };
      if (nums.length) {
        const numSum = nums.reduce((a, p) => a + p.num * p.w, 0);
        c.bagrut = numSum / sumW(nums);
        if (!missing.length) { c.grade = c.bagrut; c.source = 'bagrut'; }
        else if (ctx.useCurrent && cur != null) { c.grade = (numSum + cur * sumW(missing)) / (sumW(nums) + sumW(missing)); c.source = 'bagrut'; c.forecast = full; }
        else c.status = 'missing';
      } else if (passes.length) {
        c.source = 'bagrut';
        c.status = missing.length ? 'missing' : 'pass';
      } else if (cur != null && (ctx.useCurrent || !full)) { c.grade = cur; c.source = 'current'; c.forecast = full; }
      if (c.grade != null) {
        let v = c.grade;
        if (ctx.plus5 && v >= rules.borderlineMin && v < rules.passGrade) v += rules.borderlineBonus;
        c.adj = v;
        c.status = Math.round(v) >= rules.passGrade ? 'pass' : 'fail';
      }
      if (exempt) {
        c.status = 'exempt';
        B.push({ gate: 2, k: 'exempt-review', hard: true, text: `פטור במגמה (${m.name}) — דורש החלטת רכזת` });
      }
      /* רשום למגמה ועדיין אין ציון שנדרש כעת: "לומד" (לא חסם) */
      if ((!full || ctx.adaptive) && c.status === 'nodata' && enrolled) c.status = 'pending';
      cands.push(c);
    });

    /* מתמטיקה ברמת 5 יח"ל (מקצוע ליבה) נחשבת מקצוע מורחב; אנגלית לעולם לא */
    (subjects || []).forEach(s => {
      const def = rules.coreSubjects.find(x => x.id === s.id);
      if (!def || s.id === 'english' || def.majorEligible !== true) return;
      if (!(Number(s.units) >= requiredUnits) || !['pass', 'comp', 'severe', 'fail'].includes(s.status)) return;
      cands.push({
        id: `core-${s.id}`, coreId: s.id, name: `${s.name} ${s.units} יח"ל`, units: Number(s.units), enrolled: true, bagrut: s.final, current: s.current,
        grade: s.adj, adj: s.adj, source: s.source, status: s.status === 'pass' ? 'pass' : 'fail', forecast: s.forecast, missing: [], blocked: ''
      });
    });

    const ok = cands.find(c => c.status === 'pass') || cands.find(c => c.status === 'pending');
    if (ok) return { cands, chosen: ok };

    const blockedCand = cands.find(c => c.blocked);
    const failing = cands.find(c => c.status === 'fail');
    if (blockedCand) B.push({ gate: 2, k: 'bagrut-block', hard: true, text: `חסם בגרות – מגמה ${blockedCand.name} (שאלון ${blockedCand.blocked})` });
    else if (failing) {
      const soft = failing.source === 'current' && ctx.adaptive;
      B.push({ gate: 2, k: 'major-fail', hard: !soft, watch: soft, grade: failing.adj, text: `מגמה ${failing.name} ${failing.source === 'current' ? 'שוטף ' : ''}(${rnd(failing.adj)})` });
    }
    else if (cands.some(c => c.exempt)) { /* הפטור כבר מסומן להכרעת רכזת */ }
    else if (cands.length) {
      const first = cands.find(c => c.missing.length) || cands[0];
      B.push({ gate: 2, k: 'major-missing', hard: full && (ctx.strict || !first.enrolled), miss: true, text: first.missing.length ? `שאלון ${first.missing.join('/')} במגמה ${first.name}` : `ציון מגמה (${first.name})` });
    }
    else if (!full && !Store.groups.size) { /* אין קבוצות בכלל – אין על מה לקבוע חוסר שיבוץ */ }
    else if (!full && !rules.majors.some(m => m.enabled !== false && groupsLoadedFor(m.keywords, ctx.gradeKey, requiredUnits))) { /* לא נטענו קבוצות מגמה בשכבה */ }
    else B.push({ gate: 2, k: 'major-none', hard: true, text: full ? 'חסר מקצוע מורחב 5 יח"ל' : 'חסר שיבוץ למגמה 5 יח"ל' });
    return { cands, chosen: null };
  }

  /* שני מקצועות מדעיים מורחבים (פיזיקה, ביולוגיה, כימיה, מדעי המחשב) פוטרים ממבוא למדעים */
  const SCIENCE_IDS = ['physics', 'biology', 'chemistry', 'cs'];
  function scienceMajorCount(rules, majorCands) {
    const isScience = id => { const m = rules.majors.find(x => x.id === id); return !!(m && (m.science ?? SCIENCE_IDS.includes(id))); };
    return (majorCands || []).filter(c => isScience(c.id)).length;
  }

  /* ---------- שער 3: יחידות פנימיות (ציון מספרי או "בוצע" / "עמד בדרישות" / "עבודה עיונית") ---------- */
  function gate3(tz, ctx, B, majorCands) {
    const rules = ctx.rules;
    const full = ctx.mode === 'full';
    const scienceMajors = scienceMajorCount(rules, majorCands);
    return rules.internals.filter(it => it.enabled !== false).map(it => {
      const b = bestResult(tz, it.codes);
      const ord = Util.ord(it.expectedGrade) || 12;
      const expDue = full ? ord <= ctx.ord : ord < ctx.ord;
      /* צפי מותאם: יחידה פנימית שהשכבה טרם קיבלה בה ציונים (מתחת לסף הדיווח) אינה חוסר – "בתהליך השנה" */
      const required = expDue && (ctx.strict || cohortOf(ctx.gradeKey, it.codes).taken);
      /* מעורבות חברתית מדווחת בסולם 1–4: 1 (או 0) לא עבר, 2–4 עבר; ציון 0–100 נשפט לפי ציון עובר */
      const social = it.scale === '1-4' || it.id === 'social';
      const done = !!b && (b.kind === 'pass' || (b.kind === 'num' && ((social && b.num >= 2 && b.num <= 4) || b.num >= rules.passGrade)));
      const explicitFail = !!b && (b.kind === 'fail' || (social && b.kind === 'num' && (b.num === 1 || b.num === 0)));
      const res = { id: it.id, name: it.name, required, pending: !required && !done, done, explicitFail, value: b ? (b.kind === 'num' ? b.num : b.kind) : null, ignored: false, exempt: !!(b && b.exempt),
        inGroup: !!(it.groupKeywords && it.groupKeywords.length && Store.groupsOf(tz).some(g => Util.matchKeywords(g.subject, it.groupKeywords))) };
      if (!required || done) return res;
      if ((it.exemptWithScienceMajors ?? it.id === 'science') && scienceMajors >= 2) { res.exempt = true; return res; }
      /* המתג בסימולטור מתעלם מכל יחידות שער 3, ללא תלות בהגדרה פרטנית */
      if (ctx.ignoreInternals) { res.ignored = true; return res; }
      /* יחידה פנימית שמועדה הגיע וחסרה היא חסם קשה (גם במצב המותאם, אלא אם החניך לומד אותה השנה) */
      if (b && b.block) B.push({ gate: 3, k: 'bagrut-block', hard: true, text: `חסם נכשל במקצועות פנימיים – ${it.name}` });
      else B.push({ gate: 3, k: 'internal', hard: ctx.strict || !res.inGroup, miss: true, inGroup: res.inGroup, text: `${explicitFail ? 'חסם נכשל' : 'חסם חסר'} במקצועות פנימיים – ${it.name}${res.inGroup ? ' (בלימוד)' : ''}` });
      return res;
    });
  }

  /**
   * חוזר מנכ"ל – פיצוי נקודות: חניך עם מקצוע אחד בלבד בציון 5–44 (לא עברית) זכאי אם יש לו שני מקצועות עוברים
   * של 3 יח"ל ומעלה שסכום ציוניהם עומד בסקאלה לפי סכום היחידות שלהם (טבלה ב-Config.pointsCompensation().table).
   * רץ אחרי שער 2, כי המגמה שנבחרה נכללת ברשימת המקצועות המשתתפים. מסיר את חסם "ציון נמוך" כשהפיצוי מתקיים.
   */
  function applyPointsCompensation(B, subjects, major, ctx, notes) {
    const idx = B.findIndex(b => b.k === 'severe');
    if (idx < 0) return;
    const failing = subjects.filter(s => ['comp', 'severe', 'fail'].includes(s.status));
    if (failing.length !== 1 || B.some(b => b.k === 'major-fail')) return;
    const pc = Config.pointsCompensation();
    const pool = subjects.filter(s => s.status === 'pass' && s.adj != null && Number(s.units) >= pc.minUnits)
      .map(s => ({ name: s.name, units: Number(s.units), grade: Math.round(s.adj) }));
    const chosen = major.chosen;
    if (chosen && chosen.adj != null && !chosen.coreId) pool.push({ name: chosen.name, units: 5, grade: Math.round(chosen.adj) });

    const unitKeys = Object.keys(pc.table).map(Number);
    let best = null;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const units = pool[i].units + pool[j].units;
        const req = pc.table[Math.min(Math.max(units, Math.min(...unitKeys)), Math.max(...unitKeys))];
        const sum = pool[i].grade + pool[j].grade;
        if (!best || sum - req > best.sum - best.req) best = { a: pool[i], b: pool[j], sum, req };
      }
    }
    const blocker = B[idx], s = failing[0];
    if (best && best.sum >= best.req) {
      B.splice(idx, 1);
      s.compApplied = 'points';
      notes.push(`פיצוי נקודות חוזר מנכ"ל: ${s.name} ${rnd(s.adj)} מפוצה ב-${best.a.name} ${best.a.grade} + ${best.b.name} ${best.b.grade} = ${best.sum} (נדרש ${best.req})`);
      ctx.compensation = { type: 'points', subject: s.name, grade: s.adj, sum: best.sum, required: best.req };
    } else {
      blocker.text += best ? ` – סכום הנקודות ${best.sum} נמוך מהנדרש ${best.req}` : ' – אין שני מקצועות של 3 יח"ל ומעלה שעברו לפיצוי נקודות';
    }
  }

  /**
   * תקינות צבירה לשכבה: שאלוני מקצועות הליבה (שער 1) של החניך, מול השכבה שבה הם אמורים להיבחן. יחידות פנימיות (שער 3) אינן נכללות.
   * שאלון "מועדו הגיע" (isDueForGrade) אם שכבת היעד שלו <= שכבת החניך, או שכבר דווח לחניך ציון בו.
   * שאלון עתידי (isFutureForGrade) – שכבת היעד גבוהה משל החניך וטרם דווח בו ציון.
   * "פעיל לקצב" = מועדו הגיע וגם נבחן בפועל: דווח לו ציון, מועדו בשכבה קודמת, מצב תעודה סופית,
   * או שהשכבה שלו כבר קיבלה בו ציונים (סף הדיווח השכבתי) – כך שאלון שהשכבה טרם נבחנה בו אינו חוסר.
   */
  function computePace(tz, ctx, subjects, gateOn) {
    const rules = ctx.rules, pass = rules.passGrade, rank = ctx.rank;
    const items = [];
    if (gateOn(1)) {
      subjects.forEach(s => s.comps.forEach(c => {
        const has = c.state === 'num' || c.state === 'pass' || c.state === 'exempt' || !!c.failed || !!c.blocked;
        const score = c.state === 'num' ? (c.reportedNum ?? c.num) : null;
        items.push({
          subject: s.name, code: c.code || c.codes[0], has, score,
          review: c.state === 'exempt', failed: !!c.failed || !!c.blocked || (c.state === 'num' && score < pass),
          due: !!c.due, future: !!c.future, active: !!c.due, missing: !!c.due && !has
        });
      }));
    }
    /* יחידות פנימיות (שער 3) אינן נכללות בתקינות צבירה: הן מדווחות רק בסוף י"ב ונבדקות אך ורק בזכאות הסופית,
       בלי קשר לשכבה הצפויה שנרשמה לשאלון שלהן בהגדרות */
    const active = items.filter(it => it.active);
    const failed = items.filter(it => it.failed);
    const missing = items.filter(it => it.missing);
    const review = items.filter(it => it.review);
    const label = it => `${it.subject} (שאלון ${it.code})`;
    return {
      isSenior: rank >= 12, rank,
      dueCount: active.length,
      passedDueCount: active.filter(it => it.has && !it.failed && !it.review).length,
      failedActualCount: failed.length,
      reviewCount: review.length,
      missingDueList: missing.map(it => ({ subject: it.subject, code: it.code, label: label(it) })),
      futureCount: items.filter(it => it.future).length,
      failedList: failed.map(it => ({ subject: it.subject, code: it.code, label: label(it), score: it.score })),
      focus: [
        ...review.map(it => ({ text: `פטור ב${it.subject} (שאלון ${it.code}) — דורש החלטת רכזת`, hard: true })),
        ...failed.map(it => ({ text: `נכשל ב${it.subject} (שאלון ${it.code}${it.score != null ? ` · ${Math.round(it.score)}` : ''})`, hard: true })),
        ...missing.map(it => ({ text: `חסר שאלון ${it.code} ב${it.subject}`, hard: false }))
      ],
      /* חוסמים לפי מקצוע: כשלים בפועל ושאלונים חסרים שמועדם הגיע – שאלונים עתידיים אינם נספרים */
      blockedSubjects: [...new Set([...failed, ...missing, ...review].map(it => it.subject))],
      subjects: [...new Set(items.map(it => it.subject))]
    };
  }

  function paceStatusOf(pi, tier, noBagrut) {
    if (noBagrut) return 'no_data';
    if (pi.isSenior) return SENIOR_STATUS[tier] || 'no_data';
    if (pi.dueCount === 0 && pi.failedActualCount === 0) return 'not_started';
    const blocks = pi.failedActualCount + pi.missingDueList.length + pi.reviewCount;
    if (blocks === 0) return 'on_track';
    return blocks === 1 ? 'pace_warning' : 'pace_lag';
  }

  /* ---------- סיווג וטקסט אבחוני ---------- */
  function classify(B, hasComp) {
    const hard = B.filter(b => b.hard), minor = B.filter(b => !b.hard && !b.info);
    if (!hard.length && !minor.length && !hasComp) return 1;
    if (!hard.length && !minor.some(b => b.watch) && minor.length <= 3) return 2;
    if (!hard.length) return 3;
    const border = hard.filter(b => b.grade != null && b.grade >= 50).length;
    if (hard.length === 1 || (hard.length === 2 && border === 2)) return 3;
    return 4;
  }

  function diagnostic(tier, mode, label, B, notes, usedForecast, adaptive) {
    if (tier === 5) return 'מסלול 12 שנות לימוד / לא זכאי מראש';
    const miss = B.filter(b => b.miss).map(b => b.text);
    const other = B.filter(b => !b.miss).map(b => b.text);
    const parts = [];
    if (miss.length) parts.push('חסר: ' + miss.join(', '));
    parts.push(...other);
    if (!B.length) {
      const base = adaptive ? 'צפוי לזכאות לפי המבחנים שהתקיימו' : mode === 'full' ? (usedForecast ? 'צפוי זכאי' : 'זכאי') : 'מסלול תקין';
      let text = notes.length ? `${base} (${notes.join('; ')})` : base;
      if (usedForecast) text += ' – תחזית על בסיס ציון שוטף';
      return text;
    }
    let text = parts.join(', ');
    if (notes.length) text += ` | ${notes.join('; ')}`;
    return mode === 'ontrack' ? `שכבה ${label}: ${text}` : text;
  }

  function buildCtx(t, opts) {
    const rules = Config.rules();
    const mode = t.gradeKey === 'יב' || opts.fullMode ? 'full' : 'ontrack';
    const rank = gradeRank(t.gradeKey);
    return {
      mode, rules, ord: rank, rank, gradeKey: t.gradeKey, useCurrent: opts.useCurrent,
      plus5: opts.plus5, ignoreInternals: opts.ignoreInternals, hasGroups: Store.loaded.groups || Store.loaded.grades,
      /* fullMode = "מצב תעודה סופית": כל השאלונים נדרשים; אחרת צפי מותאם לשלב בשנה לפי מה שהשכבה כבר נבחנה בו */
      strict: !!opts.fullMode, adaptive: !opts.fullMode
    };
  }

  /** סמלי שאלון עולים / התאמות: הרשימה הקבועה + הרשימה שבכללי הפרופיל (מקור יחיד לזיהוי חשד לחריג ולסמלים זרים) */
  const immigrantCodeSet = rules => new Set([...IMMIGRANT_CODES, ...(((rules && rules.exceptionDetection) || {}).immigrantCodes || [])].map(String));

  /**
   * חשד למצב חריג: שאלוני עולים (5384 / 585580 / 581580 ועוד מהכללים), רמות יח"ל מעורבות
   * באנגלית/מתמטיקה, או ציון חיצוני ללא רכיב הערכה בית-ספרי (עד 30%).
   * מקבל אובייקט חניך או ת.ז. מחזיר { isPotentialException, reason, reasons }.
   */
  function detectPotentialException(trainee, ctx, subjects) {
    const tz = typeof trainee === 'string' ? Util.normId(trainee) : trainee && trainee.tz;
    const t = Store.trainees.get(tz);
    if (!t) return { isPotentialException: false, reason: '', reasons: [] };
    const rules = Config.rules();
    const det = rules.exceptionDetection || {};
    const reasons = [];

    const codes = immigrantCodeSet(rules);
    const hit = Store.attemptsOf(tz).find(a => codes.has(String(a.code)));
    if (hit) reasons.push(`שאלון עולים / מותאם (${hit.code})`);

    if (det.flagMixedLevels !== false) {
      rules.coreSubjects.filter(s => s.enabled !== false && s.variableUnits).forEach(s => {
        const lv = Object.keys(s.levels || {});
        const hits = lv.filter(l => {
          const others = new Set(lv.filter(x => x !== l).flatMap(x => (s.levels[x] || []).flatMap(c => c.codes)));
          const unique = (s.levels[l] || []).flatMap(c => c.codes).filter(code => !others.has(code));
          return unique.some(code => Store.bagrutBest(tz, [code]));
        });
        if (hits.length > 1) reasons.push(`רמות יח"ל מעורבות ב${s.name} (${hits.join('/')})`);
      });
    }

    if (det.flagMissingInternal !== false) {
      const c = ctx || buildCtx(t, DEFAULT_OPTS);
      const subs = subjects || rules.coreSubjects.filter(s => s.enabled !== false).map(s => evalSubject(tz, s, c));
      subs.forEach(s => {
        const external = s.comps.some(x => x.state === 'num');
        const missingInternal = s.comps.some(x => x.state === 'missing' && x.due && x.weight <= 30);
        if (external && missingInternal) reasons.push(`ציון חיצוני ללא רכיב בית-ספרי ב${s.name}`);
      });
    }
    return { isPotentialException: reasons.length > 0, reason: reasons.join(' · '), reasons };
  }

  /**
   * סמלי שאלון זרים: ניסיונות בגרות שדווחו לחניך ואינם מוגדרים בפרופיל השכבה שלו ברמת היח"ל שלו.
   * סיבות: immigrant (שאלון עולים / מותאם), other-level (סמל של רמת יח"ל אחרת באותו מקצוע),
   * other-cohort (סמל שמוגדר רק בפרופיל של מחזור אחר), unlisted-code (סמל שאינו מוכר בכללים או בקטלוג).
   * פונקציה טהורה: קוראת בלבד, אינה משנה את הצפי.
   */
  function detectForeignCodes(tz, ctx) {
    const attempts = Store.attemptsOf(tz);
    if (!attempts.length) return [];
    const rules = ctx.rules;
    const codesOf = list => activeOnly(list).flatMap(c => (c.codes || []).map(String));
    const core = activeOnly(rules.coreSubjects);
    const expected = new Set();
    const otherLevel = new Map();
    core.forEach(s => {
      if (!s.variableUnits) { codesOf(s.components).forEach(c => expected.add(c)); return; }
      const own = String(detectLevel(tz, s));
      codesOf(s.levels && s.levels[own]).forEach(c => expected.add(c));
      Object.keys(s.levels || {}).filter(l => l !== own).forEach(l => codesOf(s.levels[l]).forEach(c => {
        const e = otherLevel.get(c) || { s, levels: [] };
        e.levels.push(l);
        otherLevel.set(c, e);
      }));
    });
    activeOnly(rules.majors).forEach(m => (m.codes || []).forEach(c => expected.add(String(c))));
    activeOnly(rules.internals).forEach(i => (i.codes || []).forEach(c => expected.add(String(c))));

    const ownCohort = Config.getCohortIdForGrade(ctx.gradeKey);
    const otherCohort = new Map();
    Object.values(Config.getCohortProfiles()).filter(p => p.id !== ownCohort).forEach(p => {
      const add = (codes, item) => codes.forEach(c => { if (!otherCohort.has(c)) otherCohort.set(c, { subjectId: item.id, subject: item.name, cohort: p.name }); });
      activeOnly(p.rules.coreSubjects).forEach(s => [...(s.components || []), ...Object.values(s.levels || {}).flat()].forEach(c => add((c.codes || []).map(String), s)));
      activeOnly(p.rules.majors).forEach(m => add((m.codes || []).map(String), m));
      activeOnly(p.rules.internals).forEach(i => add((i.codes || []).map(String), i));
    });
    const immigrant = immigrantCodeSet(rules);

    const found = new Map();
    attempts.forEach(a => {
      const code = String(a.code);
      if (expected.has(code)) return;
      const bySubject = core.find(s => Util.matchKeywords(a.subject, s.keywords));
      let hit = null;
      if (immigrant.has(code)) hit = { reason: 'immigrant', subjectId: bySubject ? bySubject.id : '', subject: bySubject ? bySubject.name : '' };
      else if (otherLevel.has(code)) { const e = otherLevel.get(code); hit = { reason: 'other-level', subjectId: e.s.id, subject: e.s.name, level: e.levels.join('/') }; }
      else if (otherCohort.has(code)) { const e = otherCohort.get(code); hit = { reason: 'other-cohort', subjectId: e.subjectId, subject: e.subject, cohort: e.cohort }; }
      else if (!(rules.questionnaires || {})[code]) hit = { reason: 'unlisted-code', subjectId: bySubject ? bySubject.id : '', subject: bySubject ? bySubject.name : a.subject || '' };
      if (!hit) return;
      const kind = (a.cls && a.cls.kind) || 'none', num = kind === 'num' ? a.cls.num : null;
      const prev = found.get(code);
      if (!prev) found.set(code, { code, ...hit, grade: num, status: kind, moed: a.moed || '' });
      else if (num != null && (prev.grade == null || num > prev.grade)) Object.assign(prev, { grade: num, status: kind, moed: a.moed || '' });
    });
    return [...found.values()].sort((x, y) => x.code.localeCompare(y.code));
  }

  /**
   * הערה מייעצת בלבד: מקצוע ליבה שהחניך נכשל / חסר בו לפי מחזור שכבתו, אך ציוניו בפועל עומדים בדרישות לפי מחזור אחר
   * (ציון >= ציון עובר וכל שאלוני המקצוע במחזור האחר קיימים). אינה משנה את סטטוס הזכאות – ההכרעה נשארת למרכזת.
   */
  /** חתימת מבנה המקצוע: רכיבים, סמלי שאלון ומשקלים – זהה בין שני מחזורים אינו מצדיק הערה מייעצת */
  function subjectSignature(tz, subj, rules) {
    return Config.withRules(rules, () => {
      const { comps } = componentsOf(tz, subj);
      return comps.map(c => (c.codes || []).map(String).sort().join('/') + ':' + Number(c.weight)).join('|');
    });
  }

  function advisoryHints(tz, ctx, subjects) {
    const own = Config.getCohortIdForGrade(ctx.gradeKey);
    const weak = subjects.filter(s => ['fail', 'severe', 'missing', 'await'].includes(s.status));
    const out = [];
    weak.forEach(s => Object.values(Config.getCohortProfiles()).forEach(p => {
      if (p.id === own) return;
      const subj = (p.rules.coreSubjects || []).find(x => x.id === s.id && x.enabled !== false);
      if (!subj) return;
      const ownSubj = (ctx.rules.coreSubjects || []).find(x => x.id === s.id);
      if (ownSubj && subjectSignature(tz, ownSubj, ctx.rules) === subjectSignature(tz, subj, p.rules)) return;
      if (!passesUnder(tz, subj, p.rules)) return;
      out.push({ subject: s.name, subjectId: s.id, cohortId: p.id, cohortName: p.name, text: `לבדיקה: עומד בדרישות ${s.name} לפי ${p.name}` });
    }));
    return out;
  }

  /**
   * האם המקצוע עומד בדרישות לפי כללי מחזור אחר. מחמיר: כל רכיב חייב ציון / "עובר" תקף, בלי ניסיון כושל או חסם;
   * רכיב מספרי דורש משקל חיובי; רכיב "עובר" דורש משקל תקין (משקל 0 מותר רק ברכיב פנימי או במקצוע בן רכיב יחיד).
   */
  function passesUnder(tz, subj, rules) {
    return Config.withRules(rules, () => {
      const { comps } = componentsOf(tz, subj);
      if (!comps.length) return false;
      let numSum = 0, numW = 0, nPass = 0;
      for (const c of comps) {
        const b = bestResult(tz, c.codes), weight = Number(c.weight);
        if (!b || b.kind === 'none' || b.block || b.kind === 'fail' || b.exempt) return false;
        if (b.kind === 'num') {
          if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(b.num)) return false;
          numSum += b.num * weight; numW += weight;
        } else if (b.kind === 'pass') {
          if (!Number.isFinite(weight) || weight < 0) return false;
          if (weight === 0 && !isInternalComp(c, comps) && comps.length > 1) return false;
          nPass++;
        } else return false;
      }
      if (numW > 0) return Math.round(numSum / numW) >= (Number(rules.passGrade) || 55);
      return nPass === comps.length;
    });
  }

  /* ---------- הערכה מלאה לחניך (לפי כללי המחזור המשויך לשכבתו) ---------- */
  function evaluate(tz, userOpts) {
    const t = Store.trainees.get(tz);
    if (!t) return null;
    return Config.withRulesForGrade(t.gradeKey, () => evaluateWithRules(tz, t, userOpts));
  }

  /** המקצוע ברמה שנבחרה הושלם ועבר בפועל: כל רכיביו דווחו בבגרות, ללא פטור, תחזית או קיזוז */
  const passedClean = s => !!s && s.status === 'pass' && s.source === 'bagrut' && !s.forecast && !s.compApplied &&
    s.comps.length > 0 && s.comps.every(c => c.state === 'num' || c.state === 'pass');

  function countUnits(subjects, major) {
    const earned = new Map(), expected = new Map();
    subjects.forEach(s => {
      const units = Number(s.units) || 0;
      expected.set(s.id, units);
      if ((s.status === 'pass' || s.compApplied) && !s.exempt && !s.forecast && s.source === 'bagrut' &&
          s.comps.length && s.comps.every(c => c.state === 'num' || c.state === 'pass')) earned.set(s.id, units);
    });
    major.cands.forEach(c => {
      const id = c.coreId || c.unitSubjectId || c.id, units = Number(c.units) || 0;
      expected.set(id, Math.max(expected.get(id) || 0, units));
      if (c.status === 'pass' && c.complete && !c.exempt && !c.forecast && c.source === 'bagrut') {
        earned.set(id, Math.max(earned.get(id) || 0, units));
      }
    });
    const sum = map => [...map.values()].reduce((a, b) => a + b, 0);
    return { totalUnits: sum(earned), expectedUnits: sum(expected) };
  }

  function evaluateWithRules(tz, t, userOpts) {
    const opts = normalizeOpts(userOpts);
    const ctx = buildCtx(t, opts);
    const rules = ctx.rules;
    const B = [], notes = [];
    const subjects = gate1(tz, ctx, B, notes);
    const major = gate2(tz, ctx, B, subjects);
    applyPointsCompensation(B, subjects, major, ctx, notes);
    const internals = gate3(tz, ctx, B, major.cands);
    const units = countUnits(subjects, major);
    if (ctx.mode === 'full' && units.totalUnits < 21) {
      B.push({ gate: 1, k: 'units', hard: true, text: `חסרות יח"ל לזכאות: ${units.totalUnits} מתוך 21` });
    }

    /* שער שכובה בכללים אינו מייצר חסמים */
    const gateOn = g => !(rules.gates && rules.gates[GATE_KEY[g]] && rules.gates[GATE_KEY[g]].enabled === false);
    const blockers = B.filter(b => b.k === 'units' || b.k === 'exempt-review' || gateOn(b.gate));

    const usedForecast = ctx.mode === 'full' && (subjects.some(s => s.forecast) || (major.chosen && major.chosen.forecast));
    const real = blockers.filter(b => !b.info);
    const autoTier = classify(blockers, !!ctx.compensation);
    const label = Util.gl(t.gradeKey);
    const autoDiag = diagnostic(autoTier, ctx.mode, label, blockers, notes, usedForecast, ctx.adaptive);

    const potential = detectPotentialException(tz, ctx, subjects);
    const ex = Config.getException(tz);
    const manual = !!ex.isException;
    const ov = OVERRIDE[overrideKey(ex.overrideStatus)];
    /* אין קובץ בגרויות ואין תחזית משוטף: מצב ניטרלי במקום סימון כולם כנכשלים */
    const noBagrut = !manual && !Store.loaded.bagrut && !opts.useCurrent;

    /* גם חניך שעבר את השערים נדרש לבדיקה אם דווחו לו פטורים או סמלים שאינם ממופים למסלול.
       סמל ברמת יח"ל אחרת הוא לידיעה בלבד כשהמקצוע ברמה שנבחרה הושלם ועבר (החלפת רמה נקייה). */
    const foreignCodes = !manual && !noBagrut ? detectForeignCodes(tz, ctx).map(f =>
      (f.reason === 'other-level' && passedClean(subjects.find(s => s.id === f.subjectId)) ? { ...f, informational: true } : f)) : [];
    const reviewCodes = foreignCodes.filter(f => !f.informational);
    const reviewReasons = !manual && !noBagrut ? B.filter(b => b.k === 'exempt-review').map(b => b.text) : [];
    const reviewRequired = reviewCodes.length > 0 || reviewReasons.length > 0;
    /* ממתין להחלטת רכזת: אינו נספר כזכאי (דרגות 1–2) לפני הכרעה ידנית */
    const reviewHold = reviewRequired && autoTier <= 2;
    const tier = manual ? ov.tier : noBagrut ? 0 : reviewHold ? 3 : autoTier;


    /* מחשבון הפוך: פעולות נדרשות ב-30% החסר. "ניתן להציל" = אין חסם קשה מלבד ה-30% החסר, ושום מקצוע אינו אבוד גם עם 100 */
    const reverse = gateOn(1) ? subjects.filter(s => s.reverse).map(s => s.reverse) : [];
    const savable = !manual && !reviewHold && tier >= 3 && reverse.length > 0 && reverse.every(r => r.level !== 'red') &&
      blockers.filter(b => b.hard).every(b => b.inner);

    const gateStatus = g => {
      if (!gateOn(g)) return 'off';
      if (noBagrut) return 'nodata';
      const list = real.filter(b => b.gate === g);
      return !list.length ? 'pass' : list.some(b => b.hard) ? 'fail' : 'partial';
    };

    /* שכבות י' / י"א נשפטות לפי קצב הצבירה לשכבה ולא לפי זכאות מלאה; י"ב – לפי הצפי המלא */
    const paceInfo = computePace(tz, ctx, subjects, gateOn);
    /* ללא נתוני בגרות כל השאלונים "חסרים", ולכן אין מה לשפוט */
    if (noBagrut) Object.assign(paceInfo, { dueCount: 0, passedDueCount: 0, failedActualCount: 0, reviewCount: 0, missingDueList: [], failedList: [], focus: [], blockedSubjects: [] });
    const paceStatus = paceStatusOf(paceInfo, tier, noBagrut);
    paceInfo.paceStatus = paceStatus;

    potential.reasons.push(...reviewReasons, ...reviewCodes.map(f => `שאלון ${f.code} אינו ממופה למסלול — דורש החלטת רכזת`));
    potential.isPotentialException = potential.reasons.length > 0;
    potential.reason = potential.reasons.join(' · ');
    const juniorPace = !paceInfo.isSenior && !manual && !noBagrut;
    const atRisk = juniorPace ? paceInfo.failedActualCount > 0 || paceInfo.missingDueList.length > 0 || paceInfo.reviewCount > 0 : tier === 4;
    const tierTexts = ctx.adaptive ? TIER_TEXT.adaptive : TIER_TEXT[ctx.mode];

    const ev = {
      tz, mode: ctx.mode, adaptive: ctx.adaptive, tier, autoTier, manual, exception: ex, ...units,
      rank: ctx.rank, paceInfo, paceStatus, paceText: paceText(paceStatus, t.gradeKey), atRisk,
      cohortId: Config.getCohortIdForGrade(t.gradeKey), cohortName: Config.getCohortNameForGrade(t.gradeKey),
      advisoryHints: noBagrut ? [] : advisoryHints(tz, ctx, subjects),
      overrideStatus: manual ? overrideKey(ex.overrideStatus) : '', exceptionReason: manual ? ex.reason : '',
      isPotentialException: potential.isPotentialException, potentialExceptionReason: potential.reason, suspect: potential.reasons,
      manualReview: { required: reviewRequired, foreignCodes, reasons: reviewReasons },
      tierText: manual ? ov.label : noBagrut ? NO_BAGRUT_TEXT : reviewHold ? `${tierTexts[autoTier]} — ממתין להחלטת רכזת` : tierTexts[tier],
      gates: { 1: gateStatus(1), 2: gateStatus(2), 3: gateStatus(3) },
      subjects, major, internals, blockers, notes, usedForecast, reverse, savable, compensation: real.length ? null : (ctx.compensation || null),
      reverseText: reverse.map(r => `${r.subject}: ${r.text}`).join(' | '),
      singleBlocker: juniorPace ? paceStatus === 'pace_warning' : !manual && !noBagrut && real.length === 1,
      diagnostic: manual
        ? `⚡ ${ov.label}${ex.reason ? ` – ${ex.reason}` : ''} | חישוב אוטומטי: ${autoDiag}`
        : noBagrut ? NO_BAGRUT_TEXT : reviewHold ? `🔎 ממתין להחלטת רכזת | חישוב אוטומטי: ${autoDiag}` : autoDiag
    };
    decorators.forEach(fn => Object.assign(ev, fn(ev, { tz, ctx, juniorPace })));
    return ev;
  }

  return {
    DEFAULT_OPTS, TIER_TEXT, OVERRIDE, COHORT_MIN_PCT, COHORT_MAJOR_PCT, PACE_TIER, gradeRank, paceText, isInternalComp, codeOfComp, compOrd, resolveTiming, passesUnder,
    evaluate, detectPotentialException, detectForeignCodes, activeCohortQuestionnaires, cohortOf,
    /* משותפים לשכבת התצוגה */
    activeOnly, detectLevel, enrolledInMajor, levelScope, reverseNeed, registerDecorator
  };
})();
