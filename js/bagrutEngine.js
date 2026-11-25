/* =====================================================================
   bagrutEngine.js – מעטפת / נתב דק של מנוע הזכאות, בשלוש שכבות:

     1. BagrutFacts    (js/bagrutFacts.js)    – שכבת עובדות טהורה: תזמון, ציונים, רמות,
                                                יחידות, גילוי שאלונים זרים וחשד לחריג.
     2. BagrutPolicies (js/bagrutPolicies.js) – מנועי מדיניות: evalFinalDiploma (תעודה סופית),
                                                evalAdaptivePace (צפי מותאם לשלב בשנה),
                                                evalTechDiploma (שקע עתידי).
     3. BagrutEngine   (קובץ זה)              – ניתוב, decorators ושמירת ה-API הציבורי.

   זרימת evaluate: normalizeOpts ← BagrutFacts.buildStudentFacts ← ניתוב לפי fullMode
   למנוע המדיניות המתאים (ההכרעה הידנית של הרכזת מוחלת בתוך הרכבת ההחלטה במנוע
   המדיניות, מאותן עובדות) ← החלת decorators של שכבת התצוגה ← אותו אובייקט ev בדיוק.

   שכבת התצוגה והסיכום (תאי גיליון, מיקוד, KPI, מטריצת שאלונים) נשארת ב-bagrutAdvisor.js.
   ===================================================================== */

const BagrutEngine = (() => {
  /* הגנה מפני טעינה חסרה: המעטפת אינה שמישה בלי שתי השכבות שתחתיה */
  if (typeof BagrutFacts === 'undefined' || typeof BagrutPolicies === 'undefined') {
    throw new Error('bagrutEngine.js: BagrutFacts ו/או BagrutPolicies לא נטענו – יש לכלול את js/bagrutFacts.js ואת js/bagrutPolicies.js לפני js/bagrutEngine.js (בדוק את סדר תגיות ה-script)');
  }

  const DEFAULT_OPTS = BagrutFacts.DEFAULT_OPTS;

  /** מקבל גם את שמות הדגלים בסימולטור כפי שהם בממשק וגם את השמות החלופיים */
  function normalizeOpts(o) {
    const s = o || {};
    const pick = (a, b) => (s[a] !== undefined ? s[a] : s[b]);
    return {
      ignoreInternals: !!pick('ignoreInternals', 'ignoreInternal'),
      plus5: !!pick('plus5', 'boostBorderlinePlus5'),
      useCurrent: !!pick('useCurrent', 'useCurrentGradesAsForecast'),
      fullMode: !!s.fullMode,
      sim100: !!s.sim100
    };
  }

  /* הרחבות תצוגה משלימות את תוצאת ההערכה; המנוע אינו תלוי בהן ופועל גם בלעדיהן */
  const decorators = [];
  function registerDecorator(fn) { if (!decorators.includes(fn)) decorators.push(fn); }

  /* ---------- הערכה מלאה לחניך (לפי כללי המחזור המשויך לשכבתו) ---------- */
  function evaluate(tz, userOpts) {
    const t = Store.trainees.get(tz);
    if (!t) return null;
    return Config.withRulesForGrade(t.gradeKey, () => {
      const opts = normalizeOpts(userOpts);
      const facts = BagrutFacts.buildStudentFacts(tz, t, opts);
      const { ev, ctx, juniorPace } = opts.fullMode
        ? BagrutPolicies.evalFinalDiploma(facts)
        : BagrutPolicies.evalAdaptivePace(facts);
      decorators.forEach(fn => Object.assign(ev, fn(ev, { tz, ctx, juniorPace })));
      return ev;
    });
  }

  return {
    DEFAULT_OPTS,
    TIER_TEXT: BagrutPolicies.TIER_TEXT, OVERRIDE: BagrutPolicies.OVERRIDE,
    COHORT_MIN_PCT: BagrutFacts.COHORT_MIN_PCT, COHORT_MAJOR_PCT: BagrutFacts.COHORT_MAJOR_PCT,
    PACE_TIER: BagrutPolicies.PACE_TIER,
    gradeRank: BagrutFacts.gradeRank, paceText: BagrutPolicies.paceText,
    isInternalComp: BagrutFacts.isInternalComp, codeOfComp: BagrutFacts.codeOfComp, compOrd: BagrutFacts.compOrd,
    resolveTiming: BagrutFacts.resolveTiming, passesUnder: BagrutFacts.passesUnder,
    evaluate,
    detectPotentialException: BagrutFacts.detectPotentialException, detectForeignCodes: BagrutFacts.detectForeignCodes,
    activeCohortQuestionnaires: BagrutFacts.activeCohortQuestionnaires, cohortOf: BagrutFacts.cohortOf,
    /* משותפים לשכבת התצוגה */
    activeOnly: BagrutFacts.activeOnly, detectLevel: BagrutFacts.detectLevel, enrolledInMajor: BagrutFacts.enrolledInMajor,
    levelScope: BagrutFacts.levelScope, reverseNeed: BagrutPolicies.reverseNeed, registerDecorator
  };
})();
