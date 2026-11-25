/* =====================================================================
   bagrutFacts.js – שכבת העובדות של מנוע הבגרות: קריאה טהורה ודטרמיניסטית של המציאות
   (מצבת, קובצי בגרות / קבוצות / סדין וכללי המחזור) ללא שום החלטת מדיניות.

   כאן אין tier, אין blockers, אין paceStatus ואין diagnostic – רק עובדות:
   תזמון רכיבים מול השכבה, ציונים ורמות יח"ל, שיבוצים, יחידות נצברות,
   וגילוי אובייקטיבי של שאלונים זרים / חשד למצב חריג.

   נצרך ע"י מנועי המדיניות (bagrutPolicies.js) דרך BagrutEngine (המעטפת).
   ===================================================================== */

const BagrutFacts = (() => {
  const DEFAULT_OPTS = { ignoreInternals: false, plus5: false, useCurrent: false, fullMode: false };

  /* סף דיווח שכבתי: רכיב ליבה (שער 1) נחשב "נבחן בשכבה" כשלפחות 35% מהאוכלוסייה הרלוונטית כבר קיבלו בו ציון.
     למגמות (שער 2) הסף נמוך יותר (15%) ונמדד מתוך הלומדים את המגמה הספציפית */
  const COHORT_MIN_PCT = 35;
  const COHORT_MAJOR_PCT = 15;

  /* שאלוני עולים / התאמות שמסמנים חשד למצב חריג, בנוסף לרשימה שבכללים */
  const IMMIGRANT_CODES = ['5384', '585580', '581580'];

  /* שאלונים מוכרים שאינם חלק מדרישות הזכאות לבגרות (חינוך תעבורתי): אינם סמל זר ואינם דורשים החלטת רכזת */
  const NON_BAGRUT_CODES = new Set(['700181']);
  const NON_BAGRUT_SUBJECT = /חינוך תעבורתי|תעבורה|זה["״]ב/;
  const isNonBagrut = a => NON_BAGRUT_CODES.has(Util.normQuestionnaireCode(a.code)) || NON_BAGRUT_SUBJECT.test(String(a.subject || ''));

  /** דרגת שכבה מספרית (10 / 11 / 12) מכל כתיבה: י' / י / י"א / יא / י"ב / 12. שכבה חסרה או לא מוכרת נחשבת י"ב */
  function gradeRank(g) {
    const k = Util.normGrade(g);
    return k ? Util.ord(k) : 12;
  }

  const activeOnly = list => (list || []).filter(c => c.enabled !== false);

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
   * בשכבה קודמת תמיד; בשכבה הנוכחית במצב תעודה סופית או לאחר שהשכבה נבחנה בו.
   */
  function resolveTiming({ ord, rank, strict, cohTaken, hasAttempt }) {
    const has = !!hasAttempt;
    const pastGrade = ord < rank;
    const due = has || (ord <= rank && (!!strict || pastGrade || !!cohTaken));
    return {
      ord, rank, hasAttempt: has, future: ord > rank && !has, expDue: ord <= rank || has, due,
      pending: !due, pendingCohort: ord === rank && !has && !strict && !cohTaken, missing: due && !has
    };
  }

  /**
   * שם קנוני לתזמון עובדתי של רכיב:
   *   past_grade        – מיועד לשכבה קודמת, עם ניסיון או בלעדיו;
   *   current_tested    – רכיב נדרש בשכבה הנוכחית, או ניסיון מוקדם בשכבה עתידית;
   *   current_upcoming  – מיועד לשכבה הנוכחית אך עדיין אינו נדרש ("בתהליך השנה");
   *   future_grade      – שכבת היעד מאוחרת משכבת החניך וטרם דווח בו דבר.
   */
  function timingClass(t) {
    if (t.ord > t.rank && !t.hasAttempt) return 'future_grade';
    if (t.ord < t.rank) return 'past_grade';
    if (t.hasAttempt) return 'current_tested';
    return t.due ? 'current_tested' : 'current_upcoming';
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
   * ציון בחינה ללא ציון הגשה (מגן): בתחזית משוטף משלימים את המגן מהציון השוטף, לפי משקל המגן של השאלון במחזור.
   */
  function resolveComp(tz, comp, ctx, siblings, cur, scope) {
    const b = bestResult(tz, comp.codes);
    const code = codeOfComp(comp, b);
    const ord = compOrd(comp, b);
    const internal = isInternalComp(comp, siblings || [comp]);
    const coh = cohortOf(ctx.gradeKey, comp.codes, scope);
    /* צפי מותאם: רק רכיב של השכבה הנוכחית שטרם נבחנה בו נשאר "בתהליך השנה". */
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
        const mw = Config.magenWeight(b.code || (comp.codes && comp.codes[0]), ctx.rules) / 100;
        return { ...base, state: 'num', num: Math.round(cur * mw + b.num * (1 - mw)), reportedNum: b.num, magenForecast: true };
      }
      return { ...base, state: 'num', num: b.num };
    }
    if (b && b.kind === 'pass') return { ...base, state: b.exempt ? 'exempt' : 'pass' };
    return { ...base, state: 'missing', failed: !!(b && b.kind === 'fail'), blocked: !!(b && b.block) };
  }

  /**
   * ציון שוטף למקצוע (ממוצע משוקלל מהסדין). אירוע בודד בציון 0 הוא כנראה בוחן שהוחמץ ולא ציון המקצוע:
   * הוא אינו נחשב לתחזית ומוצג כאזהרה בלבד. עם כמה אירועים מוערכים – הממוצע שלהם קובע.
   */
  function currentInfo(tz, keywords) {
    const e = Store.activeCurrentOf(tz).find(x => x.avg != null && Util.matchKeywords(x.subject, keywords));
    if (!e) return { value: null, warn: '', events: 0 };
    const graded = (e.events || []).filter(ev => ev.score != null);
    if (graded.length === 1 && graded[0].score === 0) {
      return { value: null, warn: `אירוע בודד בציון 0 (${graded[0].eventName || 'בוחן'}) – נחשב כבוחן שהוחמץ ולא ככישלון במקצוע`, events: 1 };
    }
    const zeros = graded.filter(ev => ev.score === 0).length;
    return { value: e.avg, warn: zeros ? `${zeros} אירועים בציון 0 בסדין (ייתכן בוחנים שהוחמצו)` : '', events: graded.length };
  }

  /** האם נטענו קבוצות כלשהן במקצוע (לפי מילות מפתח) בשכבה של החניך – רק אז ניתן לטעון ל"חסר שיבוץ" */
  function groupsLoadedFor(keywords, gradeKey, minUnits) {
    return Store.groupsLoaded(keywords, gradeKey, minUnits);
  }

  /* שני מקצועות מדעיים מורחבים (פיזיקה, ביולוגיה, כימיה, מדעי המחשב) פוטרים ממבוא למדעים */
  const SCIENCE_IDS = ['physics', 'biology', 'chemistry', 'cs'];
  function scienceMajorCount(rules, majorCands) {
    const isScience = id => { const m = rules.majors.find(x => x.id === id); return !!(m && (m.science ?? SCIENCE_IDS.includes(id))); };
    return (majorCands || []).filter(c => isScience(c.id)).length;
  }

  /** יחידות לימוד נצברות מול צפויות, מתוך תוצאות המקצועות והמגמות (עובדה טהורה בנתוני הקלט) */
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

  /** סמלי שאלון עולים / התאמות: הרשימה הקבועה + הרשימה שבכללי הפרופיל (מקור יחיד לזיהוי חשד לחריג ולסמלים זרים) */
  const immigrantCodeSet = rules => new Set([...IMMIGRANT_CODES, ...(((rules && rules.exceptionDetection) || {}).immigrantCodes || [])].map(String));
  const immigrantReason = code => `שאלון עולים / מותאם (${code})`;

  /** רכיבי מקצוע עובדתיים בלבד (ללא שיפוט סטטוס) – שווה-ערך ל-res.comps שמחשב מנוע המדיניות ב-evalSubject */
  function subjectComps(tz, subj, ctx) {
    const { level, comps } = componentsOf(tz, subj);
    const cur = currentInfo(tz, subj.keywords).value;
    const scope = levelScope(subj, level);
    return { comps: comps.map(c => resolveComp(tz, c, ctx, comps, cur, scope)) };
  }

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
    if (hit) reasons.push(immigrantReason(hit.code));

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
      const subs = subjects || rules.coreSubjects.filter(s => s.enabled !== false).map(s => subjectComps(tz, s, c));
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
   * שאלונים שאינם חלק מדרישות הזכאות (חינוך תעבורתי, 700181) אינם נחשבים זרים.
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
      if (expected.has(code) || isNonBagrut(a)) return;
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

  /** חתימת מבנה המקצוע: רכיבים, סמלי שאלון ומשקלים – זהה בין שני מחזורים אינו מצדיק הערה מייעצת */
  function subjectSignature(tz, subj, rules) {
    return Config.withRules(rules, () => {
      const { comps } = componentsOf(tz, subj);
      return comps.map(c => (c.codes || []).map(String).sort().join('/') + ':' + Number(c.weight)).join('|');
    });
  }

  /**
   * הערה מייעצת בלבד: מקצוע ליבה שהחניך נכשל / חסר בו לפי מחזור שכבתו, אך ציוניו בפועל עומדים בדרישות לפי מחזור אחר
   * (ציון >= ציון עובר וכל שאלוני המקצוע במחזור האחר קיימים). אינה משנה את סטטוס הזכאות – ההכרעה נשארת למרכזת.
   */
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

  /** הקשר עובדתי להערכה: כללי המחזור, דרגת השכבה ודגלי הקלט (מצב תעודה סופית / צפי מותאם, סימולטור) */
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

  /**
   * ריכוז עובדות החניך לשימוש משותף של כל מנועי המדיניות (bagrutPolicies.js):
   * הקשר עובדתי, ההכרעה הידנית הרשומה, ומאחזרי גילוי אובייקטיבי בהקשר החניך.
   * המאחזרים עצלניים כדי לשמר אחד-לאחד את סדר ותנאי החישוב של המנוע המקורי.
   * חייב להיקרא בתוך Config.withRulesForGrade של שכבת החניך (באחריות BagrutEngine).
   */
  function buildStudentFacts(tz, t, opts) {
    const ctx = buildCtx(t, opts);
    return {
      tz, trainee: t, opts, ctx,
      /* עובדות רישום */
      exception: Config.getException(tz),
      bagrutLoaded: Store.loaded.bagrut,
      /* גילוי אובייקטיבי בהקשר החניך */
      foreignCodes: () => detectForeignCodes(tz, ctx),
      potentialException: subjects => detectPotentialException(tz, ctx, subjects),
      advisoryHints: subjects => advisoryHints(tz, ctx, subjects),
      countUnits: (subjects, major) => countUnits(subjects, major)
    };
  }

  return {
    DEFAULT_OPTS, COHORT_MIN_PCT, COHORT_MAJOR_PCT,
    activeOnly, validRank, gradeRank, codeOfComp, compOrd, resolveTiming, timingClass,
    cohortOf, levelScope, enrolledInMajor, activeCohortQuestionnaires,
    detectLevel, componentsOf, isInternalComp, bestResult, resolveComp, currentInfo,
    groupsLoadedFor, scienceMajorCount, countUnits, immigrantCodeSet, immigrantReason, isNonBagrut,
    detectPotentialException, detectForeignCodes, subjectSignature, advisoryHints, passesUnder,
    buildCtx, buildStudentFacts
  };
})();
