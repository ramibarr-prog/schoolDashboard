/* =====================================================================
   bagrutPolicies.js – מנועי המדיניות של הזכאות: מקבלים עובדות (BagrutFacts)
   ומחזירים החלטת מדיניות מלאה (tier, blockers, paceStatus, diagnostic וכו').

   שני מנועים נפרדים עם נקודות כניסה נקיות:
     evalFinalDiploma(facts)  – חוקת "מצב תעודה סופית" (fullMode: true): כל השאלונים
                                נדרשים, מקצוע חלקי הוא חוסר, ומינימום 21 יח"ל נאכף.
     evalAdaptivePace(facts)  – "צפי מותאם לשלב בשנה" (fullMode: false): שיפוט רק על
                                רכיבים שמועדם הגיע ונבחנו בשכבה; רכיב pending אינו חסם,
                                אין חסם 21 יח"ל, ונכשל שוטף הוא התראה רכה (watch).
     evalTechDiploma(facts)   – שקע עתידי לתעודה הטכנולוגית (עדיין לא ממומש).

   שלושת השערים, חוק הקיזוז, פיצוי הנקודות, המחשבון ההפוך ותקינות הצבירה הם
   helpers משותפים: הם שופטים אך ורק לפי עובדות התזמון שנבנו למצב הנבחר
   (ctx.strict / ctx.adaptive נקבעים פעם אחת בבניית העובדות, לא בתוך נקודות הכניסה).

   המעטפת (bagrutEngine.js) מנתבת בין המנועים, מפעילה decorators ושומרת על ה-API.
   ===================================================================== */

const BagrutPolicies = (() => {
  if (typeof BagrutFacts === 'undefined') {
    throw new Error('bagrutPolicies.js: BagrutFacts לא נטען – יש לכלול את js/bagrutFacts.js לפני js/bagrutPolicies.js');
  }
  const {
    activeOnly, componentsOf, currentInfo, resolveComp, levelScope, bestResult, resolveTiming,
    compOrd, cohortOf, enrolledInMajor, groupsLoadedFor, scienceMajorCount, immigrantReason
  } = BagrutFacts;

  const TIER_TEXT = {
    full: { 1: 'זכאי מלא', 2: 'צפוי לזכאות', 3: 'בסיכון / במרחק נגיעה', 4: 'לא זכאי', 5: 'מסלול 12 שנות לימוד' },
    ontrack: { 1: 'מסלול תקין', 2: 'כמעט תקין', 3: 'בסיכון / במרחק נגיעה', 4: 'מסלול לא תקין', 5: 'מסלול 12 שנות לימוד' },
    /* צפי מותאם לשלב בשנה: נשפט לפי מה שהשכבה כבר עברה */
    adaptive: { 1: 'צפוי לזכאות', 2: 'זכאי (קיזוז/גבולי)', 3: 'במרחק נגיעה', 4: 'בסיכון / חסמים', 5: 'מסלול 12 שנות לימוד' }
  };

  /* הכרעה ידנית: צפי וכותרת לכל סטטוס (מקור יחיד: Config.OVERRIDE_STATUSES) */
  const OVERRIDE = Object.fromEntries(Config.OVERRIDE_STATUSES.map(s => [s.value, { tier: s.tier, label: s.short }]));
  const OVERRIDE_BY_LABEL = Object.fromEntries(Object.entries(OVERRIDE).map(([k, v]) => [v.label, k]));
  const overrideKey = s => (OVERRIDE[s] ? s : OVERRIDE_BY_LABEL[s] || 'atrisk');

  const NO_BAGRUT_TEXT = 'טרם נטען קובץ בגרויות';
  const GATE_KEY = { 1: 'core', 2: 'major', 3: 'internal' };

  /* סטטוס תקינות צבירה לשכבות י' / י"א (לשכבת י"ב נגזר מצפי הזכאות המלא) */
  const PACE_TEXT = { on_track: '✓ תקין לקצב שכבה', pace_warning: 'חסם צבירה יחיד', pace_lag: 'בפיגור צבירה', not_started: 'טרם החלו היבחנות', no_data: NO_BAGRUT_TEXT };
  const paceText = (status, gradeKey) => (status === 'on_track' ? `✓ תקין לקצב ${Util.gl(gradeKey)}` : PACE_TEXT[status] || '');
  /* דרגת צפי מקבילה לצורך מיון בלבד */
  const PACE_TIER = { on_track: 1, not_started: 1, pace_warning: 3, pace_lag: 4, no_data: 0 };
  const SENIOR_STATUS = { 0: 'no_data', 1: 'eligible', 2: 'eligible', 3: 'nearly', 4: 'blocked', 5: 'twelve_years' };

  const rnd = n => (n == null ? '—' : String(Math.round(n)));

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
    r.compensationAvailable = true;
    if (r.level === 'red') {
      r.requiresCompensation = true;
      r.level = 'amber';
      r.text = `🎯 חסר ${r.pct}% — עובר ${rules.passGrade} אינו אפשרי (מקסימום ${r.max}), אך עם קיזוז מספיק ${r.requiredFor45} ב-${r.pct}%`;
    } else {
      r.text += ` (או ${r.requiredFor45} עם קיזוז)`;
    }
  }

  /* ---------- הערכת מקצוע חובה בודד: ממוצע משוקלל, עם תחזית משוטף כשמופעל ---------- */
  function evalSubject(tz, subj, ctx) {
    const rules = ctx.rules;
    const { level, comps } = componentsOf(tz, subj);
    const ci = currentInfo(tz, subj.keywords);
    const cur = ci.value;
    const res = {
      id: subj.id, name: subj.name, units: level, variableUnits: !!subj.variableUnits,
      critical: subj.id === 'hebrew' || !!subj.critical || (rules.compensationExcludedSubjects || []).includes(subj.name),
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
        if (ctx.useCurrent && cur != null && !r.failed && !r.blocked && !(ctx.strict && r.incompleteAttempt)) { sum += cur * r.weight; w += r.weight; res.filled.push(r); }
        else res.unresolved.push(r);
      } else res.pending.push(r);
    });

    const totalW = res.comps.reduce((a, c) => a + c.weight, 0);
    const reported = res.comps.filter(c => c.state === 'num');
    const reportedWeight = reported.reduce((a, c) => a + c.weight, 0);
    res.reportedScore = reportedWeight ? reported.reduce((a, c) => a + (c.reportedNum ?? c.num) * c.weight, 0) / reportedWeight : null;
    res.reportedPct = totalW ? Math.round(reportedWeight / totalW * 100) : 0;
    /* מצב תעודה סופית: כל רכיב שהגיע מועדו נדרש. צפי מותאם: רק רכיב שהשכבה כבר נבחנה בו והחניך החמיץ;
       רכיב שטרם דווח לשכבה אינו חוסר, והמקצוע נשפט לפי החלק שכבר דווח (partial) */
    const missingDue = ctx.strict ? res.unresolved.concat(res.pending.filter(c => c.targetRank <= ctx.rank)) : res.unresolved;
    res.incomplete = ctx.mode === 'full' && (reported.length > 0 || nPass > 0 || res.comps.some(c => c.incompleteAttempt)) && missingDue.length > 0 && !res.exempt;
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
    if (v != null && ctx.plus5 && Math.round(v) >= rules.borderlineMin && Math.round(v) < rules.passGrade) { v += rules.borderlineBonus; res.boosted = true; }
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

  /* ---------- שער 1: מקצועות ליבה + חוק קיזוז ---------- */
  function gate1(tz, ctx, B, notes) {
    const rules = ctx.rules;
    const active = rules.coreSubjects.filter(s => s.enabled !== false);
    const subjects = active.map(s => evalSubject(tz, s, ctx));
    const comps = [];
    const full = ctx.mode === 'full';

    const compUsed = subjects.filter(s => s.status === 'comp' && !s.critical).length;
    const needsComp = s => s.reverse && s.reverse.level === 'red' && !s.critical && s.reverse.requiredFor45 <= 100;
    const reserved = subjects.filter(needsComp).length;
    subjects.forEach(s => addCompensationTip(s, ctx, compUsed + reserved - (needsComp(s) ? 1 : 0)));

    subjects.forEach((s, i) => {
      const firstBlocker = B.length;
      if (s.exempt) B.push({ gate: 1, k: 'exempt-review', hard: true, text: `פטור במקצוע חובה (${s.name}) — דורש החלטת רכזת` });
      /* הערה: "מקצוע חלקי" במצב תעודה סופית מבוטא דרך s.incomplete + חסם questionnaire קשה לכל רכיב חסר
         (וחסם units). חסם 'partial-missing' נפרד שהיה כאן דרש רכיב pending שמועדו הגיע – סתירה להגדרת
         pending בכל המצבים – והוסר בפיצול השכבות כ-dead code, ללא שינוי תוצאה. */
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
        if (s.critical) B.push({ gate: 1, k: 'critical', hard: !soft, watch: soft, grade: s.adj, text: `${s.name} ${rnd(s.adj)} – נדרש ${rules.passGrade} ללא קומפנסציה` });
        else B.push({ gate: 1, k: 'severe', hard: !soft, watch: soft, grade: s.adj, subject: s.id, text: `${s.source === 'current' ? 'נכשל שוטף ב' : 'נכשל ב'}${s.name} (${rnd(s.adj)})` });
      } else if (s.status === 'comp') {
        if (s.critical) B.push({ gate: 1, k: 'critical', hard: true, grade: s.adj, text: `${s.name} ${rnd(s.adj)} – נדרש ${rules.passGrade} ללא קיזוז` });
        else if (!rules.allowCompensationRule) B.push({ gate: 1, k: 'fail', hard: true, grade: s.adj, text: `${s.name} ${rnd(s.adj)} – חוק הקיזוז כבוי` });
        else comps.push(s);
      }
      B.slice(firstBlocker).forEach(b => { b.unitSubject = s.id; });
    });

    /* חוק הקיזוז (45–54): מקצוע בודד בטווח, למעט עברית ומעורבות חברתית, מזכה ללא סכום נקודות. הנמוך ביותר מקוזז ראשון */
    comps.sort((a, b) => a.adj - b.adj);
    comps.forEach((s, i) => {
      if (i < rules.maxCompensations) {
        s.compApplied = 'range';
        notes.push(`קיזוז 45–54: ${s.name} ${rnd(s.adj)}`);
        ctx.compensation = { type: 'range', subject: s.name, grade: s.adj };
      }
      else B.push({ gate: 1, k: 'comp-over', hard: true, grade: s.adj, unitSubject: s.id, text: `${s.name} ${rnd(s.adj)} – מעבר למכסת הקיזוז` });
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
      const mScope = { key: `major:${m.id}`, min: Number(rules.cohortMajorMinPct) || BagrutFacts.COHORT_MAJOR_PCT, test: t => enrolledInMajor(t, m, requiredUnits) };
      /* חלק = קבוצת סמלי שאלון חלופיים (מספיק אחד). ב-codeMode 'any' כל סמלי המגמה הם חלק אחד; אחרת כל סמל הוא חלק נפרד.
         משקל כל חלק נקבע ב-m.weights (קוד ראשון ← משקל) ובברירת מחדל שווה */
      const parts = (m.codeMode === 'any' ? [m.codes] : m.codes.map(code => [code])).map(codes => {
        const w = Number(m.weights && m.weights[codes[0]]);
        const found = codes.map(code => bestResult(tz, [code]));
        const nums = found.filter(b => b && b.kind === 'num').map(b => b.num);
        const hasPartAttempt = found.some(b => b && (b.kind !== 'none' || b.incomplete));
        const timing = resolveTiming({
          ord: compOrd({ codes, expectedGrade: m.expectedGrade }, Store.bagrutBest(tz, codes)), rank: ctx.rank, strict: ctx.strict,
          cohTaken: cohortOf(ctx.gradeKey, codes, mScope).taken, hasAttempt: hasPartAttempt
        });
        return {
          codes, w: w > 0 ? w : 1, nums, num: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
          pass: found.some(b => b && b.kind === 'pass' && !b.exempt),
          exempt: !nums.length && found.some(b => b && b.exempt) && !found.some(b => b && b.kind === 'pass' && !b.exempt),
          fail: found.some(b => b && b.kind === 'fail'), block: found.some(b => b && b.block), incomplete: found.some(b => b && b.incomplete), due: timing.due
        };
      });
      const nums = parts.filter(p => p.num != null);
      const passes = parts.filter(p => p.num == null && p.pass);
      const exempt = parts.some(p => p.exempt);
      const blocked = parts.find(p => p.block && p.num == null && !p.pass);
      const missing = parts.filter(p => p.num == null && !p.pass && !p.exempt && p.due);
      if (!enrolled && !nums.length && !passes.length && !exempt && !parts.some(p => p.incomplete)) return;
      const sumW = list => list.reduce((a, p) => a + p.w, 0);
      const cur = enrolled ? currentInfo(tz, m.keywords).value : null;
      const groups = Store.groupsOf(tz).filter(g => !g.reinforcement && Util.matchKeywords(g.subject, m.keywords));
      const group = groups.find(g => Number(g.units) >= requiredUnits);
      const belowThreshold = groups.length && !groups.some(g => !g.units || Number(g.units) >= requiredUnits);
      const c = { id: m.id, unitSubjectId: m.coreId || m.id, name: m.name,
        units: belowThreshold ? Math.max(...groups.map(g => Number(g.units))) : Number(m.units) || (group && Number(group.units)) || requiredUnits,
        complete: parts.every(p => p.num != null || p.pass), exempt,
        enrolled, bagrut: null, bagrutPass: passes.length > 0, failed: parts.some(p => p.fail && p.num == null && !p.pass), current: cur, grade: null, source: 'none', status: 'nodata', forecast: false, missing: missing.map(p => p.codes.join('/')), blocked: blocked ? blocked.codes[0] : '' };
      if (nums.length) {
        const numSum = nums.reduce((a, p) => a + p.num * p.w, 0);
        c.bagrut = numSum / sumW(nums);
        if (!missing.length) { c.grade = c.bagrut; c.source = 'bagrut'; }
        else if (ctx.useCurrent && cur != null && !(ctx.strict && missing.some(p => p.incomplete))) { c.grade = (numSum + cur * sumW(missing)) / (sumW(nums) + sumW(missing)); c.source = 'bagrut'; c.forecast = full; }
        else c.status = 'missing';
      } else if (passes.length) {
        c.source = 'bagrut';
        c.status = missing.length ? 'missing' : 'pass';
      } else if (ctx.strict && missing.some(p => p.incomplete)) c.status = 'missing';
      else if (cur != null && (ctx.useCurrent || !full)) { c.grade = cur; c.source = 'current'; c.forecast = full; }
      if (c.grade != null) {
        let v = c.grade;
        if (ctx.plus5 && Math.round(v) >= rules.borderlineMin && Math.round(v) < rules.passGrade) v += rules.borderlineBonus;
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

    const eligible = cands.filter(c => Number(c.units) >= requiredUnits);
    const ok = eligible.find(c => c.status === 'pass') || eligible.find(c => c.status === 'pending');
    if (ok) return { cands, chosen: ok };

    const blockedCand = eligible.find(c => c.blocked);
    const failing = eligible.find(c => c.status === 'fail');
    if (blockedCand) B.push({ gate: 2, k: 'bagrut-block', hard: true, unitSubject: blockedCand.coreId || blockedCand.unitSubjectId || blockedCand.id, text: `חסם בגרות – מגמה ${blockedCand.name} (שאלון ${blockedCand.blocked})` });
    else if (failing) {
      const soft = failing.source === 'current' && ctx.adaptive;
      B.push({ gate: 2, k: 'major-fail', hard: !soft, watch: soft, grade: failing.adj, unitSubject: failing.coreId || failing.unitSubjectId || failing.id, text: `מגמה ${failing.name} ${failing.source === 'current' ? 'שוטף ' : ''}(${rnd(failing.adj)})` });
    }
    else if (eligible.some(c => c.exempt)) { /* הפטור כבר מסומן להכרעת רכזת */ }
    else if (eligible.length) {
      const first = eligible.find(c => c.missing.length) || eligible[0];
      B.push({ gate: 2, k: 'major-missing', hard: full && (ctx.strict || !first.enrolled), miss: true, unitSubject: first.coreId || first.unitSubjectId || first.id, text: first.missing.length ? `שאלון ${first.missing.join('/')} במגמה ${first.name}` : `ציון מגמה (${first.name})` });
    }
    else if (!full && !Store.groups.size) { /* אין קבוצות בכלל – אין על מה לקבוע חוסר שיבוץ */ }
    else if (!full && !rules.majors.some(m => m.enabled !== false && groupsLoadedFor(m.keywords, ctx.gradeKey, requiredUnits))) { /* לא נטענו קבוצות מגמה בשכבה */ }
    else B.push({ gate: 2, k: 'major-none', hard: true, text: full ? 'חסר מקצוע מורחב 5 יח"ל' : 'חסר שיבוץ למגמה 5 יח"ל' });
    return { cands, chosen: null };
  }

  /* ---------- שער 3: יחידות פנימיות (ציון מספרי או "בוצע" / "עמד בדרישות" / "עבודה עיונית") ---------- */
  function gate3(tz, ctx, B, majorCands) {
    const rules = ctx.rules;
    const full = ctx.mode === 'full';
    const scienceMajors = scienceMajorCount(rules, majorCands, ctx.adaptive);
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
      notes.push(`קומפנסציה (חוזר מנכ"ל): ${s.name} ${rnd(s.adj)} מול ${best.a.name} ${best.a.grade} + ${best.b.name} ${best.b.grade} = ${best.sum} (נדרש ${best.req})`);
      ctx.compensation = { type: 'points', subject: s.name, grade: s.adj, sum: best.sum, required: best.req };
    } else {
      blocker.text += best ? ` – סכום הנקודות ${best.sum} נמוך מהנדרש לקומפנסציה (${best.req})` : ' – אין שני מקצועות של 3 יח"ל ומעלה שעברו לקומפנסציה';
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
        const has = !c.incompleteAttempt && (c.state === 'num' || c.state === 'pass' || c.state === 'exempt' || !!c.failed || !!c.blocked);
        const score = has && c.state === 'num' ? (c.reportedNum ?? c.num) : null;
        items.push({
          subject: s.name, code: c.code || c.codes[0], has, score,
          review: c.state === 'exempt', failed: !!c.failed || !!c.blocked || (score != null && score < pass),
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

  /** המקצוע ברמה שנבחרה הושלם ועבר בפועל: כל רכיביו דווחו בבגרות, ללא פטור, תחזית או קיזוז */
  const passedClean = s => !!s && s.status === 'pass' && s.source === 'bagrut' && !s.forecast && !s.compApplied &&
    s.comps.length > 0 && s.comps.every(c => !c.incompleteAttempt && (c.state === 'num' || c.state === 'pass'));

  /* ---------- ליבה משותפת: הרצת שלושת השערים על עובדות החניך ---------- */
  function runGates(facts) {
    const { tz, ctx } = facts;
    const B = [], notes = [];
    const subjects = gate1(tz, ctx, B, notes);
    const major = gate2(tz, ctx, B, subjects);
    applyPointsCompensation(B, subjects, major, ctx, notes);
    const requiredUnits = (ctx.rules.gates && ctx.rules.gates.major && ctx.rules.gates.major.requiredUnits) || 5;
    const internals = gate3(tz, ctx, B, major.cands.filter(c => Number(c.units) >= requiredUnits));
    const units = facts.countUnits(subjects, major);
    return { B, notes, subjects, major, internals, units };
  }

  /* ---------- הרכבת החלטת המדיניות: סיווג, הכרעה ידנית, בדיקת רכזת, תקינות צבירה ואבחון ---------- */
  function decide(facts, state, tierTexts) {
    const { tz, ctx, opts } = facts, t = facts.trainee, rules = ctx.rules;
    const { B, notes, subjects, major, internals, units } = state;

    /* שער שכובה בכללים אינו מייצר חסמים */
    const gateOn = g => !(rules.gates && rules.gates[GATE_KEY[g]] && rules.gates[GATE_KEY[g]].enabled === false);
    const blockers = B.filter(b => b.k === 'units' || b.k === 'exempt-review' || gateOn(b.gate));
    /* בודקים אם פתרון החסמים הקיימים משלים 21 יחידות, בלי לזקוף יחידות של תחזיות או מקצועות אחרים. */
    const recoverable = new Set(blockers.some(b => b.k === 'units')
      ? blockers.filter(b => b.hard && b.unitSubject && b.k !== 'exempt-review').map(b => b.unitSubject) : []);
    const recoveredUnits = recoverable.size ? facts.countUnits(
      subjects.map(s => recoverable.has(s.id) ? { ...s, status: 'pass', exempt: false, forecast: false, source: 'bagrut', comps: s.comps.map(c => ({ ...c, state: 'num', incompleteAttempt: false })) } : s),
      { ...major, cands: major.cands.map(c => recoverable.has(c.coreId || c.unitSubjectId || c.id) ? { ...c, status: 'pass', complete: true, exempt: false, forecast: false, source: 'bagrut' } : c) }
    ).totalUnits : units.totalUnits;
    const derivedUnits = recoveredUnits >= 21;
    const classificationBlockers = blockers.filter(b => b.k !== 'units' || !derivedUnits);

    const usedForecast = ctx.mode === 'full' && (subjects.some(s => s.forecast) || (major.chosen && major.chosen.forecast));
    const real = blockers.filter(b => !b.info);
    const autoTier = classify(classificationBlockers, !!ctx.compensation);
    const label = Util.gl(t.gradeKey);
    const autoDiag = diagnostic(autoTier, ctx.mode, label, blockers, notes, usedForecast, ctx.adaptive);

    const potential = facts.potentialException(subjects);
    const ex = facts.exception;
    const manual = !!ex.isException;
    const ov = OVERRIDE[overrideKey(ex.overrideStatus)];
    /* אין קובץ בגרויות ואין תחזית משוטף: מצב ניטרלי במקום סימון כולם כנכשלים */
    const noBagrut = !manual && !facts.bagrutLoaded && !opts.useCurrent;

    /* גם חניך שעבר את השערים נדרש לבדיקה אם דווחו לו פטורים או סמלים שאינם ממופים למסלול.
       סמל ברמת יח"ל אחרת הוא לידיעה בלבד כשהמקצוע ברמה שנבחרה הושלם ועבר (החלפת רמה נקייה). */
    const foreignCodes = !manual && !noBagrut ? facts.foreignCodes().map(f =>
      (f.reason === 'other-level' && passedClean(subjects.find(s => s.id === f.subjectId)) ? { ...f, informational: true } : f)) : [];
    const reviewCodes = foreignCodes.filter(f => !f.informational);
    const reviewReasons = !manual && !noBagrut ? B.filter(b => b.k === 'exempt-review').map(b => b.text) : [];
    const reviewRequired = reviewCodes.length > 0 || reviewReasons.length > 0;
    /* ממתין להחלטת רכזת: אינו נספר כזכאי (דרגות 1–2) לפני הכרעה ידנית */
    const reviewHold = reviewRequired && autoTier <= 2;
    const tier = manual ? ov.tier : noBagrut ? 0 : reviewHold ? 3 : autoTier;


    /* מחשבון הפוך: פעולות נדרשות ב-30% החסר. "ניתן להציל" = אין חסם קשה מלבד ה-30% החסר, ושום מקצוע אינו אבוד גם עם 100 */
    const reverse = gateOn(1) ? subjects.filter(s => s.reverse).map(s => s.reverse) : [];
    const compUsed = subjects.filter(s => s.status === 'comp' && !s.critical).length;
    const savable = !manual && !reviewHold && tier >= 3 && reverse.length > 0 && reverse.every(r => r.level !== 'red') &&
      compUsed + reverse.filter(r => r.requiresCompensation).length <= rules.maxCompensations &&
      classificationBlockers.filter(b => b.hard).every(b => b.inner);

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

    /* סיבות חשד שאינן כבר מפורטות בבדיקת הרכזת (שאלון עולים שזוהה גם כסמל זר מפורט שם): התצוגה מציגה "חשד לחריג" לצד "נדרשת החלטת רכזת" רק בגינן */
    const suspectExtra = potential.reasons.filter(r => !reviewCodes.some(f => f.reason === 'immigrant' && r === immigrantReason(f.code)));
    potential.reasons.push(...reviewReasons, ...reviewCodes.map(f => `שאלון ${f.code} אינו ממופה למסלול — דורש החלטת רכזת`));
    potential.isPotentialException = potential.reasons.length > 0;
    potential.reason = potential.reasons.join(' · ');
    const juniorPace = !paceInfo.isSenior && !manual && !noBagrut;
    const atRisk = juniorPace ? paceInfo.failedActualCount > 0 || paceInfo.missingDueList.length > 0 || paceInfo.reviewCount > 0 : tier === 4;

    const ev = {
      tz, mode: ctx.mode, adaptive: ctx.adaptive, tier, autoTier, manual, exception: ex, ...units,
      rank: ctx.rank, paceInfo, paceStatus, paceText: paceText(paceStatus, t.gradeKey), atRisk,
      cohortId: Config.getCohortIdForGrade(t.gradeKey), cohortName: Config.getCohortNameForGrade(t.gradeKey),
      advisoryHints: noBagrut ? [] : facts.advisoryHints(subjects),
      overrideStatus: manual ? overrideKey(ex.overrideStatus) : '', exceptionReason: manual ? ex.reason : '',
      isPotentialException: potential.isPotentialException, potentialExceptionReason: potential.reason, suspect: potential.reasons, suspectExtra,
      manualReview: { required: reviewRequired, foreignCodes, reasons: reviewReasons },
      tierText: manual ? ov.label : noBagrut ? NO_BAGRUT_TEXT : reviewHold ? `${tierTexts[autoTier]} — ממתין להחלטת רכזת` : tierTexts[tier],
      gates: { 1: gateStatus(1), 2: gateStatus(2), 3: gateStatus(3) },
      subjects, major, internals, blockers, notes, usedForecast, reverse, savable, compensation: real.length ? null : (ctx.compensation || null),
      reverseText: reverse.map(r => `${r.subject}: ${r.text}`).join(' | '),
      singleBlocker: juniorPace ? paceStatus === 'pace_warning' : !manual && !noBagrut && classificationBlockers.filter(b => !b.info).length === 1,
      diagnostic: manual
        ? `⚡ ${ov.label}${ex.reason ? ` – ${ex.reason}` : ''} | חישוב אוטומטי: ${autoDiag}`
        : noBagrut ? NO_BAGRUT_TEXT : reviewHold ? `🔎 ממתין להחלטת רכזת | חישוב אוטומטי: ${autoDiag}` : autoDiag
    };
    return { ev, ctx, juniorPace };
  }

  /**
   * מצב תעודה סופית (fullMode: true): כל השאלונים שמועדם הגיע נדרשים, מקצוע חלקי הוא חוסר,
   * ומינימום 21 יח"ל נצברות נאכף. מחזיר { ev, ctx, juniorPace } להפעלת decorators במעטפת.
   */
  function evalFinalDiploma(facts) {
    if (!facts || !facts.ctx || !facts.ctx.strict) throw new Error('BagrutPolicies.evalFinalDiploma: נדרשות עובדות שנבנו במצב תעודה סופית (fullMode: true)');
    const state = runGates(facts);
    /* חוקת תעודה סופית בלבד: מינימום 21 יח"ל (בצפי המותאם יחידות שטרם נבחנו אינן חסם) */
    if (state.units.totalUnits < 21) {
      state.B.push({ gate: 1, k: 'units', hard: true, text: `חסרות יח"ל לזכאות: ${state.units.totalUnits} מתוך 21` });
    }
    /* במצב תעודה סופית mode הוא תמיד 'full', ולכן טקסטי הצפי הם של תעודה מלאה */
    return decide(facts, state, TIER_TEXT.full);
  }

  /**
   * צפי מותאם לשלב בשנה (fullMode: false): י"ב אמצע שנה + קצב צבירה לשכבות י'/י"א.
   * שיפוט רק על רכיבים שנבחנו בשכבה (unresolved); רכיב pending אינו חסם, אין חסם 21 יח"ל,
   * ונכשל שוטף הוא התראה רכה. מחזיר { ev, ctx, juniorPace } להפעלת decorators במעטפת.
   */
  function evalAdaptivePace(facts) {
    if (!facts || !facts.ctx || facts.ctx.strict) throw new Error('BagrutPolicies.evalAdaptivePace: נדרשות עובדות שנבנו בצפי מותאם לשלב בשנה (fullMode: false)');
    const state = runGates(facts);
    return decide(facts, state, TIER_TEXT.adaptive);
  }

  /**
   * שקע עתידי: מנוע זכאות לתעודה טכנולוגית (מסלולי הנדסאים / טכנאים – שאלוני מה"ט וכו').
   * עדיין לא ממומש ואינו משתתף בניתוב של BagrutEngine.evaluate; קיים כדי שהוספת המסלול
   * לא תדרוש שינוי מבני נוסף: יקבל facts ויחזיר החלטת מדיניות באותו מבנה ev.
   */
  function evalTechDiploma() {
    return { implemented: false };
  }

  return { evalFinalDiploma, evalAdaptivePace, evalTechDiploma, TIER_TEXT, OVERRIDE, PACE_TIER, paceText, reverseNeed };
})();
