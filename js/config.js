/* =====================================================================
   config.js – כלי עזר כלליים + שכבת שמירה (localStorage):
   מצבת חניכים עליונה, קובצי משנה עם חותמת עדכניות, כללי זכאות
   וחריגים לפי ת.ז.
   ===================================================================== */

const Util = {
  /* המערכת מיועדת לתיכון (י-יב). שכבות ז-ט מוכרות רק כדי לסנן אותן החוצה */
  GRADE_KEYS: ['י', 'יא', 'יב'],
  JUNIOR_KEYS: ['ז', 'ח', 'ט'],
  GRADE_LABEL: { 'ז': "ז'", 'ח': "ח'", 'ט': "ט'", 'י': "י'", 'יא': 'י"א', 'יב': 'י"ב' },
  ORD: { 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'יא': 11, 'יב': 12 },

  isJunior(key) { return Util.JUNIOR_KEYS.includes(key); },
  gl(key) { return Util.GRADE_LABEL[key] || key || '—'; },
  ord(key) { return Util.ORD[key] || 0; },

  stripQuotes(s) { return String(s ?? '').replace(/["'״׳”“’‘`]/g, ''); },
  norm(s) { return Util.stripQuotes(s).replace(/\s+/g, ' ').trim(); },

  normQuestionnaireCode(value) {
    const code = String(value ?? '').trim();
    return /^\d+$/.test(code) ? code.replace(/^0+(?=\d)/, '') : code;
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  uid(prefix = 'id') { return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; },

  matchKeywords(text, keywords) {
    const t = Util.norm(text);
    if (!t) return false;
    return (keywords || []).some(k => { const n = Util.norm(k); return n && t.includes(n); });
  },

  /** מזהה שכבה מנורמל: ח / ט / י / יא / יב (או מחרוזת ריקה) */
  normGrade(v) {
    const s = Util.stripQuotes(v).replace(/שכבה|כיתה|\s|\./g, '');
    if (!s) return '';
    if (/^(?:12|יב)\d*$/.test(s)) return 'יב';
    if (/^(?:11|יא)\d*$/.test(s)) return 'יא';
    if (/^(?:10|י)\d*$/.test(s)) return 'י';
    if (/^(?:9|ט)\d*$/.test(s)) return 'ט';
    if (/^(?:8|ח)\d*$/.test(s)) return 'ח';
    if (/^(?:7|ז)\d*$/.test(s)) return 'ז';
    return '';
  },

  /** מפרק שכבה + כיתה גולמיים ל- {gradeKey, num, classKey} – לדוגמה יב4 */
  parseClass(gradeRaw, classRaw) {
    const c = Util.stripQuotes(classRaw).replace(/\s+/g, '');
    let gk = Util.normGrade(gradeRaw), num = '';
    const m = c.match(/^(י[אב]?|ט|ח|ז)[-\/]?(\d+)$/);
    if (m) { gk = Util.normGrade(m[1]); num = m[2]; }
    else {
      const d = c.match(/(\d+)$/);
      num = d ? d[1] : '';
      if (!gk && /^[א-ת]/.test(c)) gk = Util.normGrade(c);
    }
    return { gradeKey: gk, num, classKey: gk && num ? gk + num : '' };
  },

  /**
   * מזהה חניך: ספרות בלבד מרופדות באפסים עד 9 ספרות. מזהה עם אותיות לטיניות (דרכון) נשמר אלפאנומרי ללא ריפוד,
   * כך שאינו מתנגש במזהה מספרי. כתב מדעי מ-CSV (1.23457E+08) אינו ניתן לשחזור: מוחזר ריק והאזהרה נספרת ב-Util.idWarn.
   */
  idWarn: { sci: 0 },
  normId(v) {
    if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? String(v).padStart(9, '0') : '';
    let s = String(v ?? '').trim();
    if (!s) return '';
    if (/^\d(?:\.\d+)?e\+?\d+$/i.test(s)) { Util.idWarn.sci++; return ''; }
    s = s.replace(/^(\d+)\.0+$/, '$1');
    if (/[A-Za-z]/.test(s)) return s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const d = s.replace(/\D/g, '');
    return d ? d.padStart(9, '0') : '';
  },

  /**
   * ציון מספרי בטווח 0..100 (ערך מחוץ לטווח אינו ציון תקין ומוחזר כ-null). מקבל גם "85%" ו-"85 - טוב מאוד", אך לא "9 - לא עבר" (טקסט שלילי נשאר ערך מילולי).
   */
  parseScore(v) {
    const inRange = n => (n >= 0 && n <= 100 ? n : null);
    if (typeof v === 'number') return isFinite(v) ? inRange(v) : null;
    const s = String(v ?? '').trim().replace(',', '.');
    if (/^-?\d+(\.\d+)?$/.test(s)) return inRange(parseFloat(s));
    const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:%|(?:%?\s*[-–:]\s*(.+)))$/);
    if (!m) return null;
    return m[2] && /לא|חסם|נכשל|ח\.?\s?ד/.test(m[2]) ? null : inRange(parseFloat(m[1]));
  },

  /** מחזיר תאריך בפורמט YYYY-MM-DD (או מחרוזת ריקה). תומך ב-Date, מספר סידורי של Excel, dd/mm/yyyy ו-ISO */
  parseDate(v) {
    if (v === '' || v == null) return '';
    const iso = d => (isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10));
    if (v instanceof Date) return iso(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) return iso(new Date(Math.round((v - 25569) * 86400000)));
      return '';
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return iso(new Date(Date.UTC(y, +m[2] - 1, +m[1])));
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  },

  /** מסלול מנורמל: רגילה / אתגר / מב"ר / חנ"מ */
  normTrack(v) {
    const s = Util.stripQuotes(v).replace(/[\s\-]/g, '');
    if (s === 'אתגר') return 'אתגר';
    if (s === 'מבר') return 'מב"ר';
    if (s === 'חנמ') return 'חנ"מ';
    return 'רגילה';
  },

  clone(o) { return JSON.parse(JSON.stringify(o)); },

  fmt(n, d = 0) { return n == null || isNaN(n) ? '—' : Number(n).toFixed(d).replace(/\.0+$/, ''); },
  pct(a, b) { return b ? Math.round((a / b) * 100) : 0; },

  formatDateTime(ts) {
    return new Date(ts).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  formatDate(ts) {
    return new Date(ts).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
};

/* =====================================================================
   כללי זכאות ברירת מחדל.
   שערים: 1 – מקצועות ליבה · 2 – מגמה 5 יח"ל · 3 – יחידות פנימיות.
   סמלי השאלונים והמשקלים ניתנים לעריכה במגירת "כללי זכאות ומשקלים".
   ===================================================================== */
/** כתובת ברירת המחדל של Web App בענן (נדרסת ע"י הגדרות ← סנכרון ענן) */
const DEFAULT_CLOUD_URL = '';
const DEFAULT_GOOGLE_CLIENT_ID = '567539420558-c7ciqfeis5vr320bjhsh47o2af0ltntb.apps.googleusercontent.com';

/** גרסת קטלוג ברירות המחדל: שמורה בכללים כדי לזהות קטלוג ישן ולהציע "שחזור ברירות מחדל" */
const RULES_VERSION = 5;

/* מחזורי לימוד ברירת מחדל ושיוך שכבות אליהם (מפתח השכבה: 12 / 11 / 10) */
const COHORT_SEED = [
  { id: 'mahzor_5', name: "מחזור ה' (תשפ\"ז)", grade: '12' },
  { id: 'mahzor_6', name: "מחזור ו' (תשפ\"ח)", grade: '11' },
  { id: 'mahzor_7', name: "מחזור ז' (תשפ\"ט)", grade: '10' }
];
function defaultGradeCohortMap() {
  return Object.fromEntries(COHORT_SEED.map(c => [c.grade, c.id]));
}
/** שלושת המחזורים ההתחלתיים, כל אחד עם עותק עמוק של אותו תבנית כללים */
function defaultCohortProfiles(rules) {
  return Object.fromEntries(COHORT_SEED.map(c => [c.id, { id: c.id, name: c.name, rules: Util.clone(rules) }]));
}

function defaultBagrutRules() {
  const q = (name, expectedGrade) => ({ name, expectedGrade });
  const on = list => list.map(c => ({ enabled: true, ...c }));
  return {
    version: RULES_VERSION,
    passGrade: 55,
    compensationMin: 45,
    compensationMax: 54,
    maxCompensations: 1,
    allowCompensationRule: true,
    compensationExcludedSubjects: ['עברית', 'מעורבות חברתית'],
    /* חוזר מנכ"ל: מקצוע אחד בציון 5–44 (לא עברית) מפוצה בשני מקצועות של 3+ יח"ל שסכום ציוניהם עומד בסקאלה לפי סכום היחידות */
    pointsCompensation: { enabled: true, minScore: 5, minUnits: 3, table: { 6: 150, 7: 148, 8: 146, 9: 144, 10: 140 } },
    borderlineMin: 50,
    borderlineBonus: 5,
    /* חוברת משרד החינוך: מגן 30% כברירת מחדל מחזורית; מתמטיקה ופיזיקה מגדירות 50% פר רכיב / שאלון */
    magenWeight: 30,
    gates: {
      core: { enabled: true, label: 'שער 1 – מקצועות ליבה' },
      major: { enabled: true, label: 'שער 2 – מגמה 5 יח"ל', requiredUnits: 5 },
      internal: { enabled: true, label: 'מקצועות פנימיים סטטוטוריים' }
    },
    coreSubjects: [
      { id: 'history', name: 'היסטוריה', units: 2, keywords: ['היסטוריה'], enabled: true,
        components: on([{ codes: ['22283', '29283'], weight: 30, expectedGrade: 'יב' }, { codes: ['22261', '22264'], weight: 70, expectedGrade: 'יב' }]) },
      { id: 'civics', name: 'אזרחות', units: 2, keywords: ['אזרחות'], enabled: true,
        components: on([{ codes: ['34263', '34283', '34273', '34221', '34224'], weight: 30, expectedGrade: 'יב' }, { codes: ['34271', '34274', '34281', '34284', '34225'], weight: 70, expectedGrade: 'יב' }]) },
      { id: 'literature', name: 'ספרות', units: 2, keywords: ['ספרות'], enabled: true,
        components: on([{ codes: ['8283'], weight: 30, expectedGrade: 'יב' }, { codes: ['8281', '8284'], weight: 70, expectedGrade: 'יב' }]) },
      { id: 'tanach', name: 'תנ"ך', units: 2, keywords: ['תנך', 'תנ"ך', 'מקרא'], enabled: true,
        components: on([{ codes: ['1263', '2383'], weight: 30, expectedGrade: 'יב' }, { codes: ['1264', '1261'], weight: 70, expectedGrade: 'יב' }]) },
      { id: 'hebrew', name: 'עברית', units: 2, keywords: ['עברית', 'הבעה', 'לשון'], enabled: true,
        components: on([{ codes: ['11283'], weight: 30, expectedGrade: 'יב' }, { codes: ['11281', '11241', '11247', '11267', '11284'], weight: 70, expectedGrade: 'יב' }]) },
      { id: 'english', name: 'אנגלית', variableUnits: true, defaultLevel: '4', keywords: ['אנגלית'], enabled: true,
        components: [],
        levels: {
          '3': on([{ codes: ['16381'], weight: 27, expectedGrade: 'י', internal: false }, { codes: ['16382'], weight: 27, expectedGrade: 'יא', internal: false },
            { codes: ['16383', '16384'], weight: 26, expectedGrade: 'יב', internal: true }, { codes: ['16387', '16385'], weight: 20, expectedGrade: 'יב', internal: false }]),
          '4': on([{ codes: ['16382'], weight: 27, expectedGrade: 'יא', internal: false }, { codes: ['16471', '16481'], weight: 27, expectedGrade: 'יב', internal: false },
            { codes: ['16483', '16484'], weight: 26, expectedGrade: 'יב', internal: true }, { codes: ['16486', '16487', '16485'], weight: 20, expectedGrade: 'יב', internal: false }]),
          '5': on([{ codes: ['16471', '16481'], weight: 27, expectedGrade: 'יא', internal: false }, { codes: ['16582'], weight: 27, expectedGrade: 'יב', internal: false },
            { codes: ['16583', '16584'], weight: 26, expectedGrade: 'יב', internal: true }, { codes: ['16586', '16587', '16585'], weight: 20, expectedGrade: 'יב', internal: false }])
        } },
      { id: 'math', name: 'מתמטיקה', variableUnits: true, majorEligible: false, defaultLevel: '4', keywords: ['מתמטיקה', 'חשבון'], enabled: true,
        components: [],
        levels: {
          '3': on([{ codes: ['35173', '35183', '35172'], weight: 25, expectedGrade: 'יב', internal: true }, { codes: ['35371', '35381'], weight: 35, expectedGrade: 'יא', magenWeight: 50 }, { codes: ['35372', '35380', '35382'], weight: 40, expectedGrade: 'יב', magenWeight: 50 }]),
          '4': on([{ codes: ['35471', '35481'], weight: 65, expectedGrade: 'יא', magenWeight: 50 }, { codes: ['35472', '35482'], weight: 35, expectedGrade: 'יב', magenWeight: 50 }]),
          '5': on([{ codes: ['35571', '35581'], weight: 60, expectedGrade: 'יא', magenWeight: 50 }, { codes: ['35572', '35582'], weight: 40, expectedGrade: 'יב', magenWeight: 50 }])
        } }
    ],
    /* מגמות: codeMode 'any' = מספיק שאלון אחד מהרשימה (חלופות); majorNames = שמות המגמה בעמודת "מגמה" של קובץ קבוצות הלימוד */
    majors: on([
      { id: 'cs', name: 'מדעי המחשב / הנדסת תוכנה', science: true, codeMode: 'any', keywords: ['מדעי המחשב', 'הנדסת תוכנה', 'מחשבים'], majorNames: ['מדעי המחשב', 'הנדסת תוכנה'], codes: ['899371', '899271'] },
      { id: 'robotics', name: 'מכטרוניקה / בקרת מכונות / רובוטיקה', codeMode: 'any', keywords: ['מכטרוניקה', 'רובוטיקה', 'בקרת מכונות', 'בקרה'], majorNames: ['מכטרוניקה', 'רובוטיקה', 'בקרת מכונות'], codes: ['819387', '805589', '841381'] },
      { id: 'business', name: 'ניהול עסקי / מינהל וכלכלה', codeMode: 'any', keywords: ['ניהול עסקי', 'מינהל וכלכלה', 'מנהל וכלכלה'], majorNames: ['ניהול עסקי', 'מינהל וכלכלה', 'מנהל וכלכלה'], codes: ['839381', '58381'] },
      { id: 'physics', name: 'פיזיקה', science: true, codeMode: 'any', keywords: ['פיזיקה'], majorNames: ['פיזיקה'], codes: ['36361', '36381'] },
      { id: 'biology', name: 'ביולוגיה', science: true, codeMode: 'any', keywords: ['ביולוגיה'], majorNames: ['ביולוגיה'], codes: ['43351', '43379', '43279', '43331'] },
      { id: 'chemistry', name: 'כימיה', science: true, codeMode: 'any', keywords: ['כימיה'], majorNames: ['כימיה'], codes: ['37371', '37381'] },
      { id: 'art', name: 'אמנות חזותית / שימושית', codeMode: 'any', keywords: ['אומנות', 'אמנות'], majorNames: ['אמנות חזותית', 'אמנות שימושית', 'אומנות חזותית'], codes: ['816183', '74381'] },
      { id: 'russian', name: 'רוסית', codeMode: 'any', keywords: ['רוסית'], majorNames: ['רוסית'], codes: ['585282'] },
      { id: 'oral', name: 'תושבע"פ', codeMode: 'any', keywords: ['תושבעפ', 'תושב"ע', 'תורה שבעל פה'], majorNames: ['תושבע"פ', 'תורה שבעל פה'], codes: ['5316', '5283', '5383'] },
      { id: 'geography', name: 'גיאוגרפיה', codeMode: 'any', keywords: ['גיאוגרפיה'], majorNames: ['גיאוגרפיה'], codes: ['23371', '23381'] },
      { id: 'philosophy', name: 'פילוסופיה', codeMode: 'any', keywords: ['פילוסופיה'], majorNames: ['פילוסופיה'], codes: ['76371', '76381'] },
      { id: 'music', name: 'מוזיקה', codeMode: 'any', keywords: ['מוזיקה', 'מוסיקה'], majorNames: ['מוזיקה', 'מוסיקה', 'אומנות המוסיקה והמחול'], codes: ['65371', '65381'] },
      { id: 'pe', name: 'חנ"ג מוגבר', codeMode: 'any', keywords: ['חנג מוגבר', 'חינוך גופני מוגבר', 'חנג מורחב'], majorNames: ['חינוך גופני'], codes: ['41371', '41381'] },
      { id: 'portuguese', name: 'פורטוגזית', codeMode: 'any', keywords: ['פורטוגזית'], majorNames: ['פורטוגזית'], codes: ['18371', '18381'] }
    ]),
    /* groupKeywords: שם קבוצת הלימוד המקבילה ביחידה (חניך המשובץ אליה נחשב "בלימוד", גם כשהציון טרם הוזן) */
    internals: on([
      { id: 'social', name: 'מעורבות חברתית', codes: ['86083'], expectedGrade: 'י' },
      { id: 'pe', name: 'חנ"ג פנימי', codes: ['41083'], expectedGrade: 'יא', groupKeywords: ['חינוך גופני'] },
      { id: 'science', name: 'מבוא למדעים', codes: ['43183', '704183'], expectedGrade: 'י', exemptWithScienceMajors: true, groupKeywords: ['מבוא למדעים', 'מדעים'] },
      { id: 'general', name: 'השכלה כללית', codes: ['82083', '84073', '84083'], expectedGrade: 'יב', groupKeywords: ['מגדר'] }
    ]),
    questionnaires: (() => {
      const cat = {};
      const qs = (codes, name, expectedGrade, magenWeight) => codes.forEach(c => { cat[c] = { ...q(name, expectedGrade), ...(magenWeight != null ? { magenWeight } : {}) }; });
      qs(['22283', '29283'], 'היסטוריה – ציון בית-ספרי', 'יב'); qs(['22261', '22264'], 'היסטוריה – בחינה', 'יב');
      qs(['34263', '34283', '34273', '34221', '34224'], 'אזרחות – הערכה חלופית בית-ספרית (30%)', 'יב');
      qs(['34271', '34274', '34281', '34284', '34225'], 'אזרחות – בחינה חיצונית (70%)', 'יב');
      qs(['8283'], 'ספרות – ציון בית-ספרי', 'יב'); qs(['8281', '8284'], 'ספרות – בחינה', 'יב');
      qs(['1263', '2383'], 'תנ"ך – ציון בית-ספרי', 'יב'); qs(['1264', '1261'], 'תנ"ך – בחינה', 'יב');
      qs(['11283'], 'עברית – ציון בית-ספרי', 'יב'); qs(['11281', '11241', '11247', '11267', '11284'], 'עברית – בחינה', 'יב');
      qs(['16381'], 'אנגלית 3 יח"ל – שאלון א', 'י'); qs(['16382'], 'אנגלית – שאלון ב', 'יא');
      qs(['16471', '16481'], 'אנגלית 4/5 יח"ל – בחינה בכתב', 'יב');
      qs(['16582'], 'אנגלית 5 יח"ל – בחינה בכתב', 'יב');
      qs(['16383', '16384'], 'אנגלית 3 יח"ל – תלקיט פנימי (26%)', 'יב');
      qs(['16387', '16385'], 'אנגלית 3 יח"ל – בחינה חיצונית בעל פה (20%)', 'יב');
      qs(['16483', '16484'], 'אנגלית 4 יח"ל – תלקיט פנימי (26%)', 'יב');
      qs(['16486', '16487', '16485'], 'אנגלית 4 יח"ל – בחינה חיצונית בעל פה (20%)', 'יב');
      qs(['16583', '16584'], 'אנגלית 5 יח"ל – תלקיט פנימי (26%)', 'יב');
      qs(['16586', '16587', '16585'], 'אנגלית 5 יח"ל – בחינה חיצונית בעל פה (20%)', 'יב');
      qs(['35173', '35183', '35172'], 'מתמטיקה 3 יח"ל – הערכה חלופית בית-ספרית (25%)', 'יב'); qs(['35371', '35381'], 'מתמטיקה 3 יח"ל – שאלון א', 'יא', 50);
      qs(['35372', '35380', '35382'], 'מתמטיקה 3 יח"ל – שאלון ב', 'יב', 50);
      qs(['35471', '35481'], 'מתמטיקה 4 יח"ל – שאלון א', 'יא', 50); qs(['35472', '35482'], 'מתמטיקה 4 יח"ל – שאלון ב', 'יב', 50);
      qs(['35571', '35581'], 'מתמטיקה 5 יח"ל – שאלון א', 'יא', 50); qs(['35572', '35582'], 'מתמטיקה 5 יח"ל – שאלון ב', 'יב', 50);
      qs(['36361', '36381'], 'פיזיקה 5 יח"ל – בחינה חיצונית', 'יב', 50);
      return cat;
    })(),
    exceptionDetection: {
      immigrantCodes: ['5384'],
      flagMixedLevels: true,
      flagMissingInternal: true
    }
  };
}

/* סמלי שאלון שנטענו במפורש לקטלוג ברירת המחדל: שכבת היעד שלהם מאומתת. כל סמל אחר שנוסף לרכיב ללא שכבה מפורשת מקבל י"ב כברירת מחדל לא מאומתת */
const KNOWN_VERIFIED_CODES = new Set(Object.keys(defaultBagrutRules().questionnaires));

/* =====================================================================
   מנהל הגדרות ונתונים
   ===================================================================== */
const Config = {
  TRACKS: ['רגילה', 'אתגר', 'מב"ר', 'חנ"מ'],
  SPECIAL_ED: 'חנ"מ',
  /* מקור יחיד להכרעה ידנית: label – בחירה בטופס, short – תווית בטבלה, tier – הצפי שנקבע */
  OVERRIDE_STATUSES: [
    { value: 'eligible', label: 'זכאי - אישור חריג', short: 'זכאי - חריג', tier: 1 },
    { value: 'atrisk', label: 'בסיכון - חריג', short: 'בסיכון - חריג', tier: 3 },
    { value: 'noteligible', label: 'לא זכאי - חריג', short: 'לא זכאי - חריג', tier: 4 },
    { value: 'twelve', label: 'מסלול 12 שנות לימוד', short: 'מסלול 12 שנות לימוד', tier: 5 }
  ],
  DATASET_KEYS: ['groupsData', 'sadinData', 'bagrutData'],
  FRESH_DAYS: 3,
  STALE_DAYS: 10,
  /* כתובת הענן מוגדרת רק בהגדרות המקומיות, ולא בקוד הציבורי */
  CLOUD_SYNC_URL: DEFAULT_CLOUD_URL,
  GOOGLE_CLIENT_ID: DEFAULT_GOOGLE_CLIENT_ID,
  KEYS: {
    config: 'sd.config.v2',
    masterRoster: 'sd.masterRoster.v2',
    groupsData: 'sd.groupsData.v2',
    sadinData: 'sd.sadinData.v2',
    bagrutData: 'sd.bagrutData.v2',
    rosterCleared: 'sd.rosterClearedByUser.v1',
    ignoredIds: 'sd.ignoredIds.v1'
  },

  data: null,
  rev: 0,
  _sessionClosing: false,
  _cache: {},
  _staleDismissed: {},

  /* ---------- אחסון בטוח ---------- */
  _read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  _write(key, value) {
    if (this._sessionClosing) return { ok: false, error: 'ההפעלה המקומית נסגרת; לא ניתן לשמור נתונים.' };
    try { localStorage.setItem(key, JSON.stringify(value)); return { ok: true }; }
    catch (e) {
      const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
      return { ok: false, error: quota ? 'נפח האחסון בדפדפן מלא. יש לנקות נתונים ישנים או לטעון קובץ קטן יותר.' : `שמירה נכשלה: ${e.message}` };
    }
  },
  emit(name, detail) { this.rev++; window.dispatchEvent(new CustomEvent(`sd:${name}`, { detail })); },
  requireEdit() {
    if (!window.App || window.App.requireEdit()) return null;
    return { ok: false, error: 'העריכה בוטלה. יש להתחבר ולסנכרן לפני ביצוע שינויים.' };
  },

  /* ---------- טעינה ושמירה ---------- */
  defaults() {
    return {
      version: 2, classNicknames: {}, specialEdClasses: {}, mappingProfiles: {},
      cohortProfiles: defaultCohortProfiles(defaultBagrutRules()), gradeCohortMap: defaultGradeCohortMap(),
      traineeExceptions: {}, rosterOverrides: {}, rosterMismatchDismissed: {}
    };
  },

  /**
   * מנרמל מחזורי כללים ושיוך שכבות. תאימות לאחור: הגדרות ישנות (כללים בודדים ב-bagrutRules) הופכות לעותק בכל המחזורים;
   * מחזור פגום נזרק, ושכבה ששויכה למחזור שאינו קיים חוזרת לברירת המחדל שלה.
   */
  normalizeCohorts(profiles, map, legacyRules) {
    const out = {};
    const list = Array.isArray(profiles) ? profiles : profiles && typeof profiles === 'object' ? Object.values(profiles) : [];
    list.forEach(p => {
      if (!p || typeof p !== 'object' || !p.id || this.validateRules(p.rules)) return;
      const id = String(p.id);
      this._backfillExpectedGrades(p.rules);
      out[id] = { id, name: String(p.name || '').trim() || id, rules: p.rules };
    });
    if (!Object.keys(out).length) {
      Object.assign(out, defaultCohortProfiles(legacyRules && !this.validateRules(legacyRules) ? legacyRules : defaultBagrutRules()));
    }
    const fallback = defaultGradeCohortMap(), ids = Object.keys(out), result = {};
    ['12', '11', '10'].forEach(g => {
      const want = map && typeof map === 'object' ? map[g] : '';
      result[g] = out[want] ? want : out[fallback[g]] ? fallback[g] : ids[0];
    });
    return { profiles: out, map: result };
  },

  load() {
    const stored = this._read(this.KEYS.config);
    const d = this.defaults();
    if (stored && typeof stored === 'object') {
      d.classNicknames = stored.classNicknames && typeof stored.classNicknames === 'object' ? stored.classNicknames : {};
      d.specialEdClasses = stored.specialEdClasses && typeof stored.specialEdClasses === 'object' ? stored.specialEdClasses : {};
      d.mappingProfiles = stored.mappingProfiles && typeof stored.mappingProfiles === 'object' ? stored.mappingProfiles : {};
      d.traineeExceptions = stored.traineeExceptions && typeof stored.traineeExceptions === 'object' ? stored.traineeExceptions : {};
      d.rosterOverrides = stored.rosterOverrides && typeof stored.rosterOverrides === 'object' ? stored.rosterOverrides : {};
      d.rosterMismatchDismissed = stored.rosterMismatchDismissed && typeof stored.rosterMismatchDismissed === 'object' ? stored.rosterMismatchDismissed : {};
      const cohorts = this.normalizeCohorts(stored.cohortProfiles, stored.gradeCohortMap, stored.bagrutRules);
      d.cohortProfiles = cohorts.profiles;
      d.gradeCohortMap = cohorts.map;
    }
    this.data = d;
    this._activeCohort = d.gradeCohortMap['12'];
    this._rulesOverride = null;
    this._syncQuestionnaires();
    this._cache = {};
    this._ignoredCache = null;
    this._invalidateRoster();
    this.scrubRoster();
    this.rev++;
    return this;
  },

  save({ localOnly = false } = {}) {
    const denied = this.requireEdit(); if (denied) return denied;
    this.rev++;
    const result = this._write(this.KEYS.config, this.data);
    if (result.ok) this.emit('config-changed', localOnly ? { localOnly: true } : undefined);
    return result;
  },

  reset(opts = {}) {
    const denied = this.requireEdit(); if (denied) return denied;
    this.data = this.defaults();
    this._activeCohort = this.data.gradeCohortMap['12'];
    this._invalidateRoster();
    this._syncQuestionnaires();
    this.save();
    this.setRosterCleared(false);
    /* איפוס מלא: גם רשימת ההתעלמות המצטברת מחניכי חטיבה מתאפסת */
    this._ignoredCache = new Set();
    try { localStorage.removeItem(this.KEYS.ignoredIds); } catch (e) { /* noop */ }
    const e = this.getRosterEntry();
    if (e) { e.ignoredIds = []; this._write(this.KEYS.masterRoster, e); }
    if (opts.silent) return;
    this.emit('rules-changed');
    this.emit('exceptions-changed');
  },

  /** המשתמש מחק את המצבת במכוון: לא טוענים נתוני דמו אוטומטית עד לטעינת מצבת חדשה או איפוס */
  isRosterCleared() { return localStorage.getItem(this.KEYS.rosterCleared) === '1'; },
  setRosterCleared(v) {
    const denied = this.requireEdit(); if (denied) return denied;
    try { if (v) localStorage.setItem(this.KEYS.rosterCleared, '1'); else localStorage.removeItem(this.KEYS.rosterCleared); } catch (e) { /* noop */ }
  },

  /* ---------- מצבת חניכים עליונה (מקור אמת) ---------- */
  normalizeRosterRows(rows) {
    const out = [], seen = new Map(), ignored = new Set();
    let skipped = 0, duplicates = 0;
    (rows || []).forEach(r => {
      const tz = Util.normId(r.tz);
      const grade = Util.normGrade(r.grade);
      const parsed = Util.parseClass(grade, r.homeroom);
      const gradeKey = grade || parsed.gradeKey;
      /* חניכי ז-ט אינם נשמרים כחניכים; ה-ת.ז שלהם נשמרת רק כדי להתעלם מהם בקובצי המשנה */
      if (tz && Util.isJunior(gradeKey)) { ignored.add(tz); return; }
      const homeroom = parsed.classKey || (gradeKey && r.homeroom ? gradeKey + Util.stripQuotes(r.homeroom).replace(/\s+/g, '') : '');
      if (!tz || !gradeKey || !homeroom) { skipped++; return; }
      if (seen.has(tz)) { duplicates++; return; }
      const rec = {
        tz, firstName: String(r.firstName ?? '').trim(), lastName: String(r.lastName ?? '').trim(),
        grade: gradeKey, homeroom, track: Util.normTrack(r.track), className: String(r.className ?? '').trim()
      };
      seen.set(tz, rec);
      out.push(rec);
    });
    return { rows: out, skipped, duplicates, ignoredIds: [...ignored].filter(tz => !seen.has(tz)) };
  },

  rosterDiff(rows) {
    const incoming = this.normalizeRosterRows(rows).rows;
    const current = this.getRosterEntry()?.data || [];
    const oldById = new Map(current.map(r => [r.tz, r]));
    const newById = new Map(incoming.map(r => [r.tz, r]));
    const grades = Util.GRADE_KEYS.map(grade => ({
      grade,
      current: current.filter(r => r.grade === grade).length,
      incoming: incoming.filter(r => r.grade === grade).length
    }));
    return {
      incoming, grades,
      added: incoming.filter(r => !oldById.has(r.tz)).length,
      removed: current.filter(r => !newById.has(r.tz)).length,
      changed: incoming.filter(r => {
        const old = oldById.get(r.tz);
        return old && (old.grade !== r.grade || old.homeroom !== r.homeroom);
      }).length,
      missingGrades: grades.filter(g => g.current && !g.incoming).map(g => g.grade)
    };
  },

  mergeRosterGrades(rows) {
    const incoming = this.normalizeRosterRows(rows).rows;
    if (!incoming.length) return [];
    const grades = new Set(incoming.map(r => r.grade)), ids = new Set(incoming.map(r => r.tz));
    const preserved = (this.getRosterEntry()?.data || []).filter(r => !grades.has(r.grade) && !ids.has(r.tz));
    return [...preserved, ...incoming];
  },

  setRoster(rows, fileName, extraIgnoredIds = []) {
    const denied = this.requireEdit(); if (denied) return denied;
    const norm = this.normalizeRosterRows(rows);
    if (!norm.rows.length) return { ok: false, error: 'לא נמצאו חניכים תקינים במצבת (נדרשים ת.ז, שכבה וכיתת אם בשכבות י-יב).' };
    const ignoredIds = this._mergeIgnored([...norm.ignoredIds, ...extraIgnoredIds], norm.rows);
    const entry = { data: norm.rows, ignoredIds, fileName: fileName || '', uploadedAt: Date.now() };
    const res = this._write(this.KEYS.masterRoster, entry);
    if (!res.ok) return res;
    this._cache.masterRoster = entry;
    this.setRosterCleared(false);
    this.emit('roster-changed');
    return { ok: true, count: norm.rows.length, skipped: norm.skipped, duplicates: norm.duplicates, ignored: ignoredIds.length };
  },

  /**
   * רשימת ההתעלמות מחניכי ז-ט מצטברת: מצבת תיכון בלבד שתיטען בהמשך לא תשכח חניכי חטיבה שנצפו בעבר,
   * ולכן קובצי 6-שנתיים לא יציפו התראות "לא במצבת". היא מתאפסת רק באיפוס מלא (reset).
   * ת.ז שהופיעה כעת במצבת כחניך תיכון מוסרת מהרשימה.
   */
  _mergeIgnored(newIds, rosterRows) {
    const inRoster = new Set(rosterRows.map(r => r.tz));
    const merged = new Set([...this._storedIgnored(), ...newIds]);
    inRoster.forEach(tz => merged.delete(tz));
    this._ignoredCache = merged;
    this._write(this.KEYS.ignoredIds, [...merged]);
    return [...merged];
  },
  _storedIgnored() {
    if (!this._ignoredCache) {
      const v = this._read(this.KEYS.ignoredIds);
      this._ignoredCache = new Set(Array.isArray(v) ? v : []);
    }
    return this._ignoredCache;
  },

  getRosterEntry() {
    if (!this._cache.masterRoster) {
      const e = this._read(this.KEYS.masterRoster);
      this._cache.masterRoster = e && Array.isArray(e.data) ? e : null;
    }
    return this._cache.masterRoster;
  },
  /**
   * מצבת עם דריסות שיוך מונחות מעל הנתונים הגולמיים (הקובץ שנטען לא משתנה לעולם).
   * כל רשומה כוללת rawGrade / rawHomeroom / rawTrack / rawClassName מהקובץ, override (אם יש) ו-hidden.
   * חניך שאינו בקובץ אך קיבל דריסה עם שכבה וכיתה נוסף כרשומה עם added: true.
   * מוחזרים גם חניכים מוסתרים (hidden) – לרשימת הניהול בלבד.
   */
  getRosterAll() {
    const e = this.getRosterEntry();
    if (!e) return [];
    if (this._rosterAll && this._rosterAll.src === e.data) return this._rosterAll.rows;
    const ov = this.data.rosterOverrides || {};
    const raw = e.data.filter(r => !Util.isJunior(r.grade));
    const classNames = {};
    raw.forEach(r => { if (r.className && !classNames[r.homeroom]) classNames[r.homeroom] = r.className; });
    const inRaw = new Set();
    const rows = raw.map(r => {
      inRaw.add(r.tz);
      const o = ov[r.tz] || null;
      const rec = { ...r, rawGrade: r.grade, rawHomeroom: r.homeroom, rawTrack: r.track, rawClassName: r.className, override: o, hidden: false };
      if (o) {
        if (o.homeroom) {
          rec.homeroom = o.homeroom;
          rec.grade = o.grade || Util.parseClass('', o.homeroom).gradeKey || rec.grade;
          if (o.homeroom !== r.homeroom) rec.className = classNames[o.homeroom] || '';
        } else if (o.grade) rec.grade = o.grade;
        if (o.track) rec.track = o.track;
        rec.hidden = !!o.hidden;
      }
      return rec;
    });
    Object.values(ov).forEach(o => {
      if (inRaw.has(o.tz) || !o.grade || !o.homeroom) return;
      rows.push({
        tz: o.tz, firstName: o.name || o.tz, lastName: '', grade: o.grade, homeroom: o.homeroom, track: o.track || 'רגילה',
        className: classNames[o.homeroom] || '', rawGrade: '', rawHomeroom: '', rawTrack: '', rawClassName: '', override: o, hidden: !!o.hidden, added: true
      });
    });
    this._rosterAll = { src: e.data, rows };
    return rows;
  },
  /** חניכים פעילים בלבד: ללא ז-ט וללא מוסתרים, עם הדריסות מוחלות */
  getRoster() {
    const e = this.getRosterEntry();
    if (!e) return [];
    if (!this._rosterView || this._rosterView.src !== e.data) this._rosterView = { src: e.data, rows: this.getRosterAll().filter(r => !r.hidden) };
    return this._rosterView.rows;
  },
  /** ת.ז של חניכים שהוסתרו ידנית (עזב / לא פעיל): אינם "לא במצבת", והנתונים שלהם נשמרים לשחזור */
  hiddenIds() {
    return new Set(Object.values(this.data.rosterOverrides || {}).filter(o => o.hidden).map(o => o.tz));
  },
  _invalidateRoster() { this._rosterView = null; this._rosterAll = null; },

  /* ---------- דריסת שיוך שכבה וכיתת אם ---------- */
  getRosterOverrides() { return this.data.rosterOverrides || {}; },

  /**
   * יוצר / מעדכן דריסה לחניך. patch: { grade, homeroom, track, hidden, note, name }. ערך ריק = ללא שינוי לשדה.
   * דריסה שזהה למקור (או ריקה לגמרי) נמחקת. חניך שאינו בקובץ המצבת דורש שכבה וכיתה (ושם).
   */
  setRosterOverride(tz, patch) {
    const denied = this.requireEdit(); if (denied) return denied;
    const c = this._composeOverride(tz, patch);
    if (!c.ok) return c;
    const { id, entry, empty } = c;
    const previous = this.data.rosterOverrides[id], dismissed = this.data.rosterMismatchDismissed[id];
    if (empty) delete this.data.rosterOverrides[id]; else this.data.rosterOverrides[id] = entry;
    delete this.data.rosterMismatchDismissed[id];
    this._invalidateRoster();
    const res = this.save();
    if (res.ok === false) {
      if (previous) this.data.rosterOverrides[id] = previous; else delete this.data.rosterOverrides[id];
      if (dismissed !== undefined) this.data.rosterMismatchDismissed[id] = dismissed;
      this._invalidateRoster();
      return res;
    }
    this.emit('roster-changed');
    return { ok: true, removed: empty };
  },

  /**
   * עדכון קבוצתי של דריסות בשמירה אחת: items = [{ tz, patch }]. פריט לא תקין מדולג ונספר ב-failed (עם הודעת השגיאה הראשונה),
   * וכישלון שמירה מחזיר את כל הדריסות למצבן הקודם.
   */
  setRosterOverridesBatch(items) {
    const denied = this.requireEdit(); if (denied) return denied;
    const prevOv = this.data.rosterOverrides, prevDismissed = this.data.rosterMismatchDismissed;
    this.data.rosterOverrides = { ...prevOv };
    this.data.rosterMismatchDismissed = { ...prevDismissed };
    let applied = 0, failed = 0, error = '';
    items.forEach(({ tz, patch }) => {
      const c = this._composeOverride(tz, patch);
      if (!c.ok) { failed++; error = error || c.error; return; }
      if (c.empty) delete this.data.rosterOverrides[c.id]; else this.data.rosterOverrides[c.id] = c.entry;
      delete this.data.rosterMismatchDismissed[c.id];
      applied++;
      this._invalidateRoster();
    });
    if (!applied) {
      this.data.rosterOverrides = prevOv; this.data.rosterMismatchDismissed = prevDismissed;
      this._invalidateRoster();
      return { ok: true, applied, failed, error };
    }
    const res = this.save();
    if (res.ok === false) {
      this.data.rosterOverrides = prevOv; this.data.rosterMismatchDismissed = prevDismissed;
      this._invalidateRoster();
      return res;
    }
    this.emit('roster-changed');
    return { ok: true, applied, failed, error };
  },

  _composeOverride(tz, patch) {
    const id = Util.normId(tz);
    if (!id) return { ok: false, error: 'ת.ז לא תקינה' };
    const rawRow = (this.getRosterEntry() ? this.getRosterEntry().data : []).find(r => r.tz === id && !Util.isJunior(r.grade)) || null;
    const next = { ...(this.data.rosterOverrides[id] || {}), ...patch };
    let grade = next.grade || '', homeroom = String(next.homeroom || '').trim();
    if (grade && !Util.GRADE_KEYS.includes(grade)) return { ok: false, error: 'שכבה לא תקינה (י / י"א / י"ב)' };
    if (homeroom) {
      const p = Util.parseClass(grade, homeroom);
      if (!p.classKey) return { ok: false, error: 'כיתת אם לא תקינה. יש להזין למשל יא3' };
      if (grade && p.gradeKey !== grade) return { ok: false, error: `כיתת האם ${p.classKey} אינה בשכבה שנבחרה` };
      if (!Util.GRADE_KEYS.includes(p.gradeKey)) return { ok: false, error: 'הכיתה חייבת להיות בשכבות י-יב' };
      grade = p.gradeKey; homeroom = p.classKey;
    } else if (grade && (!rawRow || grade !== rawRow.grade)) {
      return { ok: false, error: 'בשינוי שכבה יש להזין גם כיתת אם חדשה' };
    } else grade = '';
    if (rawRow && grade === rawRow.grade && homeroom === rawRow.homeroom) { grade = ''; homeroom = ''; }
    if (!rawRow && !(grade && homeroom) && !next.hidden) return { ok: false, error: 'חניך שאינו במצבת דורש שכבה וכיתת אם' };
    let track = next.track && this.TRACKS.includes(next.track) ? next.track : '';
    if (next.track && !track) return { ok: false, error: 'מסלול לא תקין' };
    if (rawRow && track === this.defaultTrack(rawRow.track, homeroom || rawRow.homeroom)) track = '';
    const entry = { tz: id, grade, homeroom, track, hidden: !!next.hidden, note: String(next.note || '').trim().slice(0, 200), updatedAt: Date.now() };
    if (!rawRow) entry.name = String(next.name || '').trim();
    const empty = !entry.grade && !entry.homeroom && !entry.track && !entry.hidden && !entry.note;
    return { ok: true, id, entry, empty };
  },
  removeRosterOverride(tz) {
    const denied = this.requireEdit(); if (denied) return denied;
    const id = Util.normId(tz);
    const previous = this.data.rosterOverrides[id];
    delete this.data.rosterOverrides[id];
    this._invalidateRoster();
    const res = this.save();
    if (res.ok === false) {
      if (previous) this.data.rosterOverrides[id] = previous;
      this._invalidateRoster();
      return res;
    }
    this.emit('roster-changed');
    return res;
  },
  clearRosterOverrides() {
    const denied = this.requireEdit(); if (denied) return denied;
    const previous = this.data.rosterOverrides;
    this.data.rosterOverrides = {};
    this._invalidateRoster();
    const res = this.save();
    if (res.ok === false) { this.data.rosterOverrides = previous; this._invalidateRoster(); }
    return res;
  },
  /** "השאר לפי מצבת": הסתירה לא תוצג שוב, אלא אם השיוך במשוב ישתנה (החתימה שונה) */
  dismissRosterMismatch(tz, signature) {
    const denied = this.requireEdit(); if (denied) return denied;
    this.data.rosterMismatchDismissed[Util.normId(tz)] = signature;
    return this.save();
  },

  /**
   * סתירות שיוך: חניכים פעילים שהשכבה / כיתת האם שלהם בקובץ הקבוצות או בקובץ הבגרות
   * שונות מהשיוך הפעיל במצבת (אחרי דריסות). דריסה שאימצה את שיוך המשוב פותרת את הסתירה.
   * מוחזר: [{ tz, name, grade, homeroom, rawGrade, rawHomeroom, sources: [{ source, grade, homeroom }], adopt, signature }]
   */
  detectRosterMismatches() {
    const firstBy = key => {
      const m = new Map();
      this.getRows(key).forEach(r => {
        if (r.isTeacher || !r.tz || m.has(r.tz) || !Util.GRADE_KEYS.includes(r.gradeKey)) return;
        m.set(r.tz, { grade: r.gradeKey, homeroom: r.classKey || '' });
      });
      return m;
    };
    const sourcesOf = [['groups', firstBy('groupsData')], ['bagrut', firstBy('bagrutData')]];
    const out = [];
    this.getRosterAll().forEach(t => {
      if (t.hidden) return;
      const srcs = [];
      sourcesOf.forEach(([source, map]) => {
        const s = map.get(t.tz);
        if (s && (s.grade !== t.grade || (s.homeroom && s.homeroom !== t.homeroom))) srcs.push({ source, ...s });
      });
      if (!srcs.length) return;
      const signature = srcs.map(s => `${s.source}:${s.grade}:${s.homeroom}`).join('|');
      if (this.data.rosterMismatchDismissed[t.tz] === signature) return;
      const adopt = srcs.find(s => s.homeroom) || null;
      out.push({
        tz: t.tz, name: `${t.firstName} ${t.lastName}`.trim() || t.tz, grade: t.grade, homeroom: t.homeroom,
        rawGrade: t.rawGrade, rawHomeroom: t.rawHomeroom, sources: srcs, adopt, signature
      });
    });
    return out;
  },
  /** ת.ז של חניכי ז-ט שיש להתעלם מהם בכל הקובצים */
  ignoredIds() {
    const e = this.getRosterEntry();
    const set = new Set([...this._storedIgnored(), ...(e && Array.isArray(e.ignoredIds) ? e.ignoredIds : [])]);
    if (e) e.data.forEach(r => { if (Util.isJunior(r.grade)) set.add(r.tz); });
    return set;
  },
  rosterMap() { return new Map(this.getRoster().map(r => [r.tz, r])); },

  /** חניך חטיבה (ז-ט) לפי שכבה או כיתת אם, גם בנתונים שנשמרו לפני הוספת הסינון */
  isJuniorRecord(r) {
    const grade = String(r.grade ?? '').trim(), home = String(r.homeroom ?? '').trim();
    return Util.isJunior(Util.normGrade(grade)) || /^[זחט](['׳״"]|\d|\s|$)/.test(grade) || /^[זחט](['׳״"]|\d|\s|$)/.test(home);
  },

  /** מסיר חניכי ז-ט מהמצבת השמורה ורושם את ת.ז שלהם ב-ignoredIds */
  scrubRoster() {
    const e = this.getRosterEntry();
    if (!e) return 0;
    const keep = [], ignored = new Set(Array.isArray(e.ignoredIds) ? e.ignoredIds : []);
    let removed = 0;
    e.data.forEach(r => { if (this.isJuniorRecord(r)) { ignored.add(r.tz); removed++; } else keep.push(r); });
    if (!removed) return 0;
    const entry = { ...e, data: keep, ignoredIds: [...ignored] };
    if (this._write(this.KEYS.masterRoster, entry).ok) { this._cache.masterRoster = entry; this._invalidateRoster(); }
    return removed;
  },

  /**
   * מסיר שורות של חניכי ז-ט: ת.ז שהמצבת מסמנת כחטיבה, או שכבה ז-ט בשורה (כשהחניך אינו חניך תיכון במצבת).
   * בקובץ קבוצות נמחקות גם שורות המורה של קבוצה שנשארה בלי חניכי תיכון.
   */
  filterJuniorRows(type, rows) {
    const roster = this.rosterMap(), ignoredIds = this.ignoredIds();
    const isJunior = r => !r.isTeacher && !roster.has(r.tz) && (ignoredIds.has(r.tz) || Util.isJunior(r.gradeKey));
    const kept = rows.filter(r => !isJunior(r));
    if (type === 'groups') {
      const removedGroups = new Set(rows.filter(isJunior).map(r => r.groupId));
      const liveGroups = new Set(kept.filter(r => !r.isTeacher).map(r => r.groupId));
      const result = kept.filter(r => !(r.isTeacher && removedGroups.has(r.groupId) && !liveGroups.has(r.groupId)));
      return { rows: result, ignored: rows.length - result.length };
    }
    return { rows: kept, ignored: rows.length - kept.length };
  },

  /** מנקה את קובצי הקבוצות / הציונים / הבגרות השמורים משורות של חניכי ז-ט */
  async scrubDatasets(userEdit = false) {
    const types = { groupsData: 'groups', sadinData: 'grades', bagrutData: 'bagrut' };
    for (const key of this.DATASET_KEYS) {
      const e = this._cache[key];
      if (!e) continue;
      const { rows, ignored } = this.filterJuniorRows(types[key], e.data);
      if (!ignored) continue;
      const entry = { ...e, data: rows };
      const result = await this._storePut(key, entry, userEdit);
      if (result.ok) this._cache[key] = entry;
      else if (userEdit) throw new Error(result.error);
    }
  },
  clearRoster() {
    const denied = this.requireEdit(); if (denied) return denied;
    localStorage.removeItem(this.KEYS.masterRoster);
    delete this._cache.masterRoster;
    this.emit('roster-changed');
  },

  /* ---------- קובצי משנה + עדכניות (IndexedDB, עם גיבוי ל-localStorage) ---------- */
  _idb: null,
  ready: null,

  _openIdb() {
    return new Promise(resolve => {
      let settled = false;
      const finish = db => {
        if (settled) { if (db) db.close(); return; }
        settled = true;
        resolve(db);
      };
      try {
        const req = indexedDB.open('schoolDashboard', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('datasets');
        req.onsuccess = () => finish(req.result);
        req.onerror = () => finish(null);
        req.onblocked = () => finish(null);
      } catch (e) { finish(null); }
    });
  },

  _idbRun(mode, fn, userEdit = false) {
    return new Promise((resolve, reject) => {
      const tx = this._idb.transaction('datasets', mode);
      const req = fn(tx.objectStore('datasets'));
      const cancel = () => {
        if (window.App && !window.App.canEdit()) {
          try { tx.abort(); } catch (e) { if (e.name !== 'InvalidStateError') throw e; }
        }
      };
      const cleanup = () => {
        if (userEdit) ['sd:cloud-status', 'sd:cloud-signedout', 'sd:cloud-conflict'].forEach(name => window.removeEventListener(name, cancel));
      };
      if (userEdit) ['sd:cloud-status', 'sd:cloud-signedout', 'sd:cloud-conflict'].forEach(name => window.addEventListener(name, cancel));
      tx.oncomplete = () => { cleanup(); resolve(req ? req.result : undefined); };
      tx.onerror = () => { cleanup(); reject(tx.error); };
      tx.onabort = () => { cleanup(); reject(tx.error || new Error('העריכה בוטלה עקב שינוי במצב ההתחברות.')); };
    });
  },

  async _storeGet(key) {
    if (this._idb) { try { return await this._idbRun('readonly', s => s.get(key)); } catch (e) { return null; } }
    return this._read(this.KEYS[key]);
  },
  async _storePut(key, entry, userEdit = false) {
    if (this._sessionClosing) return { ok: false, error: 'ההפעלה המקומית נסגרת; לא ניתן לשמור נתונים.' };
    if (userEdit) { const denied = this.requireEdit(); if (denied) return denied; }
    if (this._idb) {
      try { await this._idbRun('readwrite', s => s.put(entry, key), userEdit); this._purgeLegacyCopy(key); return { ok: true }; }
      catch (e) { return { ok: false, error: `שמירה נכשלה: ${e && e.message ? e.message : 'שגיאת אחסון'}` }; }
    }
    return this._write(this.KEYS[key], entry);
  },
  async _storeDelete(key, userEdit = false) {
    if (userEdit) { const denied = this.requireEdit(); if (denied) throw new Error(denied.error); }
    if (this._idb) await this._idbRun('readwrite', s => s.delete(key), userEdit);
    localStorage.removeItem(this.KEYS[key]);
  },

  /** הסרת עותקים ישנים (לפני המעבר ל-IndexedDB) מ-localStorage, כדי שלא יצרכו את מכסת ה-5MB */
  _purgeLegacyCopy(key) {
    try { localStorage.removeItem(this.KEYS[key]); } catch (e) { /* noop */ }
  },

  /** טוען את קובצי המשנה השמורים לזיכרון. יש להמתין ל-Config.ready לפני קריאה ראשונה */
  async initStorage() {
    this._idb = await this._openIdb();
    for (const key of this.DATASET_KEYS) {
      let e = await this._storeGet(key);
      if (this._idb) {
        if (e) this._purgeLegacyCopy(key);
        else {
          /* מיגרציה: עותק ישן ב-localStorage עובר ל-IndexedDB ונמחק משם רק לאחר שמירה מוצלחת */
          const legacy = this._read(this.KEYS[key]);
          if (legacy && Array.isArray(legacy.data)) {
            e = legacy;
            if ((await this._storePut(key, legacy)).ok) this._purgeLegacyCopy(key);
          }
        }
      }
      this._cache[key] = e && Array.isArray(e.data) ? e : null;
    }
    await this.scrubDatasets();
    return this;
  },

  async setDataset(key, data, fileName) {
    const denied = this.requireEdit(); if (denied) return denied;
    if (!this.DATASET_KEYS.includes(key)) return { ok: false, error: `מפתח נתונים לא מוכר: ${key}` };
    if (!Array.isArray(data)) return { ok: false, error: 'פורמט נתונים לא תקין.' };
    const entry = { data, fileName: fileName || '', uploadedAt: Date.now() };
    const res = await this._storePut(key, entry, true);
    if (!res.ok) return res;
    this._cache[key] = entry;
    delete this._staleDismissed[key];
    this.emit('dataset-changed', { key });
    return { ok: true, count: data.length };
  },

  getDataset(key) { return this.DATASET_KEYS.includes(key) ? (this._cache[key] || null) : null; },

  /**
   * מיזוג מצטבר של קובץ משנה: משוב מייצא קבוצות וסדין לכל שכבה בנפרד, ולכן טעינת י"ב אינה מוחקת את י' ו-י"א.
   *  groups / sadin: מוחלפות רק שורות השכבות (וחניכים) שמופיעים בשורות החדשות; שורות שכבות אחרות נשמרות.
   *    שכבת שורה = gradeKey, ובהיעדרו שכבת החניך במצבת. כשאין שכבה כלל (קובץ שטוח ישן) – החלפה מלאה.
   *  bagrut: upsert לפי ת.ז + שאלון + מועד.
   * meta: { fileName }. מחזיר { ok, count, total, grades }.
   */
  async upsertDataset(key, newRows, meta = {}) {
    const denied = this.requireEdit(); if (denied) return denied;
    if (!this.DATASET_KEYS.includes(key)) return { ok: false, error: `מפתח נתונים לא מוכר: ${key}` };
    if (!Array.isArray(newRows)) return { ok: false, error: 'פורמט נתונים לא תקין.' };
    const roster = this.rosterMap();
    const gradeOf = r => r.gradeKey || (roster.get(r.tz) || {}).grade || '';
    const old = this.getRows(key);
    const grades = [...new Set(newRows.map(gradeOf).filter(Boolean))];
    let kept;
    if (key === 'bagrutData') {
      const keyOf = r => `${r.tz}|${r.code}|${r.moedCode || r.moed || ''}`;
      const incoming = new Set(newRows.map(keyOf));
      kept = old.filter(r => !incoming.has(keyOf(r)));
    } else if (!grades.length) {
      kept = [];
    } else {
      const scope = new Set(grades);
      const tzs = new Set(newRows.filter(r => r.tz && !r.isTeacher).map(r => r.tz));
      const teacherGroups = new Set(newRows.filter(r => r.isTeacher).map(r => r.groupId));
      kept = old.filter(r => !(scope.has(gradeOf(r)) || (r.tz && !r.isTeacher && tzs.has(r.tz)) || (r.isTeacher && teacherGroups.has(r.groupId))));
    }
    const prev = this._cache[key];
    const name = meta.fileName || '';
    const replaceAll = key !== 'bagrutData' && !grades.length;
    const prevFiles = replaceAll ? [] : ((prev && prev.files) || (prev && prev.fileName ? [{ name: prev.fileName }] : []));
    const files = [...prevFiles.filter(f => f.name !== name), ...(name ? [{ name, uploadedAt: Date.now(), grades }] : [])].slice(-12);
    const entry = {
      data: [...kept, ...newRows], uploadedAt: Date.now(), files,
      fileName: files.length > 1 ? `${files.length} קבצים` : (files[0] ? files[0].name : name)
    };
    const res = await this._storePut(key, entry, true);
    if (!res.ok) return res;
    this._cache[key] = entry;
    delete this._staleDismissed[key];
    this.emit('dataset-changed', { key });
    return { ok: true, count: newRows.length, total: entry.data.length, grades };
  },
  getRows(key) { const e = this.getDataset(key); return e ? e.data : []; },

  async clearDataset(key) {
    const denied = this.requireEdit(); if (denied) throw new Error(denied.error);
    if (!this.DATASET_KEYS.includes(key)) throw new Error('מפתח נתונים לא מוכר');
    await this._storeDelete(key, true);
    this._cache[key] = null;
    this.emit('dataset-changed', { key });
  },

  async clearSadinGrade(grade) {
    const denied = this.requireEdit(); if (denied) return denied;
    if (!Util.GRADE_KEYS.includes(grade)) return { ok: false, error: 'שכבה לא תקינה' };
    const entry = this.getDataset('sadinData');
    if (!entry) return { ok: false, error: 'לא נטען קובץ ציונים שוטפים' };
    const roster = this.rosterMap();
    const gradeOf = row => row.gradeKey || (roster.get(row.tz) || {}).grade || '';
    const data = entry.data.filter(row => gradeOf(row) !== grade);
    if (data.length === entry.data.length) return { ok: false, error: 'אין נתונים לשכבה שנבחרה' };
    if (!data.length) {
      await this.clearDataset('sadinData');
    } else {
      const files = (entry.files || []).map(f => ({
        ...f, ...(Array.isArray(f.grades) ? { grades: f.grades.filter(g => g !== grade) } : {})
      })).filter(f => !Array.isArray(f.grades) || f.grades.length);
      const next = { ...entry, data, files, fileName: files.length > 1 ? `${files.length} קבצים` : (files[0] ? files[0].name : entry.fileName) };
      const res = await this._storePut('sadinData', next, true);
      if (!res.ok) return res;
      this._cache.sadinData = next;
      this.emit('dataset-changed', { key: 'sadinData' });
    }
    return { ok: true, removed: entry.data.length - data.length };
  },

  async clearAllData() {
    const denied = this.requireEdit(); if (denied) throw new Error(denied.error);
    let changed = false;
    try {
      for (const k of this.DATASET_KEYS) { await this._storeDelete(k, true); this._cache[k] = null; changed = true; }
    } finally {
      if (changed) { this._staleDismissed = {}; this.emit('dataset-changed', { key: 'all' }); }
    }
  },

  /** 'fresh' (<3 ימים) | 'aging' (3–10) | 'stale' (>10) | 'empty' */
  getFreshnessStatus(key) {
    const e = key === 'masterRoster' ? this.getRosterEntry() : this.getDataset(key);
    if (!e || !e.uploadedAt) return 'empty';
    const days = (Date.now() - e.uploadedAt) / 86400000;
    if (days < this.FRESH_DAYS) return 'fresh';
    if (days <= this.STALE_DAYS) return 'aging';
    return 'stale';
  },

  getFreshnessInfo(key) {
    const status = this.getFreshnessStatus(key);
    const e = key === 'masterRoster' ? this.getRosterEntry() : this.getDataset(key);
    if (status === 'empty') {
      return { status, tone: 'slate', message: 'טרם נטען קובץ', primaryAction: 'טען קובץ', secondaryAction: '', fileName: '', uploadedAt: 0, ageDays: 0 };
    }
    const ageDays = Math.floor((Date.now() - e.uploadedAt) / 86400000);
    const dateTime = Util.formatDateTime(e.uploadedAt), date = Util.formatDate(e.uploadedAt);
    const base = { status, fileName: e.fileName, uploadedAt: e.uploadedAt, ageDays, dateTime, date };
    if (status === 'fresh') {
      return { ...base, tone: 'emerald', message: `מעודכן: ${dateTime} (${e.fileName})`, primaryAction: 'החלף קובץ', secondaryAction: '' };
    }
    if (status === 'aging') {
      return { ...base, tone: 'amber', message: `שים לב: הנתונים מלפני ${ageDays} ימים (${date})`, primaryAction: 'טען קובץ עדכני', secondaryAction: '' };
    }
    return {
      ...base, tone: 'red', message: `הנתונים מלפני ${ageDays} ימים (${date})`,
      primaryAction: 'טען קובץ עדכני עכשיו', secondaryAction: `המשך לצפייה בנתונים מ-${date}`
    };
  },

  dismissStale(key) { this._staleDismissed[key] = true; },
  isStaleDismissed(key) { return !!this._staleDismissed[key]; },

  /**
   * התאמת קובץ משנה מול המצבת: המצבת קובעת מי פעיל.
   * missing – חניכים במצבת שחסרים בקובץ; unknown – ת.ז בקובץ שאינן במצבת (מוחרגות מה-KPI).
   */
  reconcile(key) {
    const roster = this.rosterMap(), ignored = new Set([...this.ignoredIds(), ...this.hiddenIds()]);
    const rows = this.getRows(key);
    const inFile = new Set(), unknown = new Set();
    rows.forEach(r => {
      if (r.isTeacher) return;
      const tz = Util.normId(r.tz);
      if (!tz || ignored.has(tz)) return;
      if (roster.has(tz)) inFile.add(tz); else unknown.add(tz);
    });
    const missing = [...roster.values()].filter(t => !inFile.has(t.tz));
    return { missing, unknown: [...unknown], matched: inFile.size };
  },

  /* ---------- פרופילי מיפוי עמודות ---------- */
  getMapping(type) { return this.data.mappingProfiles[type] || null; },
  setMapping(type, mapping) {
    const denied = this.requireEdit(); if (denied) return denied;
    this.data.mappingProfiles[type] = mapping; return this.save({ localOnly: true });
  },

  /* ---------- כינויי כיתות ---------- */
  nickname(classKey) { return this.data.classNicknames[classKey] || ''; },
  setNickname(classKey, value) {
    const denied = this.requireEdit(); if (denied) return denied;
    const v = String(value ?? '').trim();
    if (v) this.data.classNicknames[classKey] = v; else delete this.data.classNicknames[classKey];
    return this.save();
  },
  /** שם כיתה מהמצבת (עמודת "שם כיתה") לפי כיתת אם */
  rosterClassNames() {
    const entry = this.getRosterEntry();
    const rows = entry ? entry.data : null;
    if (this._classNames && this._classNames.src === rows) return this._classNames.map;
    const out = {};
    (rows || []).forEach(r => { if (r.className && !out[r.homeroom]) out[r.homeroom] = r.className; });
    this._classNames = { src: rows, map: out };
    return out;
  },
  classLabel(classKey) {
    if (!classKey) return 'ללא כיתה';
    const n = this.rosterClassNames()[classKey] || this.nickname(classKey);
    return n ? `${classKey} • ${n}` : classKey;
  },

  /* ---------- כיתות חנ"מ ---------- */
  /** ברירת מחדל: כינוי או שם כיתה שמכילים "חנמ" / "מרחב" */
  autoSpecialEdClass(classKey) {
    const text = Util.stripQuotes(this.rosterClassNames()[classKey] || this.nickname(classKey));
    return /חנמ|מרחב/.test(text);
  },
  isSpecialEdClass(classKey) {
    const explicit = this.data.specialEdClasses[classKey];
    return typeof explicit === 'boolean' ? explicit : this.autoSpecialEdClass(classKey);
  },
  setSpecialEdClass(classKey, value) {
    const denied = this.requireEdit(); if (denied) return denied;
    const previous = this.data.specialEdClasses[classKey];
    if (!!value === this.autoSpecialEdClass(classKey)) delete this.data.specialEdClasses[classKey];
    else this.data.specialEdClasses[classKey] = !!value;
    const res = this.save();
    if (res.ok === false) {
      if (previous === undefined) delete this.data.specialEdClasses[classKey];
      else this.data.specialEdClasses[classKey] = previous;
    }
    return res;
  },
  /** מסלול ברירת מחדל: כיתת חנ"מ קובעת חנ"מ, אחרת המסלול מהמצבת */
  defaultTrack(rosterTrack, classKey) {
    return (classKey && this.isSpecialEdClass(classKey)) ? this.SPECIAL_ED : (rosterTrack || 'רגילה');
  },
  /** המסלול בפועל: שינוי בכרטיס גובר על דריסת מצבת, ושניהם גוברים על ברירת המחדל של הכיתה */
  trackFor(tz, rosterTrack, classKey) {
    const rosterOverride = this.getRosterOverrides()[tz];
    return this.getException(tz).trackOverride || (rosterOverride && rosterOverride.track) || this.defaultTrack(rosterTrack, classKey);
  },

  /* ---------- חריגים לפי ת.ז ---------- */
  emptyException() { return { isException: false, overrideStatus: '', reason: '', trackOverride: '', note: '' }; },

  getException(tz) {
    return { ...this.emptyException(), ...(this.data.traineeExceptions[Util.normId(tz)] || {}) };
  },
  isException(tz) { return !!this.getException(tz).isException; },

  setException(tz, patch) {
    const denied = this.requireEdit(); if (denied) return denied;
    const id = Util.normId(tz);
    if (!id) return { ok: false, error: 'ת.ז לא תקינה' };
    const next = { ...this.getException(id), ...patch };
    if (next.isException && !next.overrideStatus) next.overrideStatus = this.OVERRIDE_STATUSES[1].value;
    if (next.overrideStatus && !this.OVERRIDE_STATUSES.some(s => s.value === next.overrideStatus)) next.overrideStatus = '';
    if (next.trackOverride && !this.TRACKS.includes(next.trackOverride)) next.trackOverride = '';
    const empty = !next.isException && !next.reason && !next.trackOverride && !next.note;
    if (empty) delete this.data.traineeExceptions[id]; else this.data.traineeExceptions[id] = next;
    const res = this.save();
    /* עריכת הערה בלבד אינה משנה שום חישוב: אין צורך בהערכה מחדש של כל החניכים */
    if (!Object.keys(patch).every(k => k === 'note')) this.emit('exceptions-changed', { tz: id });
    return res;
  },
  exceptionCount() { return Object.values(this.data.traineeExceptions).filter(e => e && e.isException).length; },

  /* ---------- כללי זכאות ---------- */
  /**
   * כללי הזכאות הפעילים: בזמן הערכת חניך (withRulesForGrade) – כללי המחזור של שכבתו;
   * אחרת – המחזור הנערך כעת בהגדרות (ברירת מחדל: מחזור שכבת י"ב). כך כל הקוראים הקיימים ממשיכים לעבוד.
   */
  rules() { return this._rulesOverride || this._editProfile().rules; },

  /* ---------- מחזורי לימוד ושיוך שכבות ---------- */
  getCohortProfiles() { return this.data.cohortProfiles; },

  /** מקבל אובייקט (id ← מחזור) או מערך; מחזורים פגומים נזרקים ושיוך שכבות מתוקן בהתאם */
  saveCohortProfiles(profiles) {
    const denied = this.requireEdit(); if (denied) return denied;
    const n = this.normalizeCohorts(profiles, this.data.gradeCohortMap, null);
    const provided = Array.isArray(profiles) ? profiles : Object.values(profiles || {});
    if (!provided.length) return { ok: false, error: 'נדרש לפחות מחזור אחד' };
    this.data.cohortProfiles = n.profiles;
    this.data.gradeCohortMap = n.map;
    if (!n.profiles[this._activeCohort]) this._activeCohort = n.map['12'];
    return this._afterCohortChange();
  },

  getGradeCohortMap() { return { ...this.data.gradeCohortMap }; },

  /** מפתח שכבה מספרי ('12' / '11' / '10') מכל כתיבה: י"ב / יב / י' / 11. שכבה לא מוכרת – מחרוזת ריקה */
  gradeNum(gradeStr) {
    const k = Util.normGrade(gradeStr);
    return k && Util.ord(k) >= 10 ? String(Util.ord(k)) : '';
  },

  setGradeCohort(gradeKey, cohortId) {
    const denied = this.requireEdit(); if (denied) return denied;
    const g = this.gradeNum(gradeKey);
    if (!g) return { ok: false, error: 'שכבה לא תקינה' };
    if (!this.data.cohortProfiles[cohortId]) return { ok: false, error: 'מחזור לא קיים' };
    this.data.gradeCohortMap[g] = cohortId;
    return this._afterCohortChange();
  },

  _afterCohortChange() {
    this._syncQuestionnaires();
    const res = this.save();
    this.emit('rules-changed');
    return res;
  },

  _cohortOfGrade(gradeStr) {
    const d = this.data, map = d.gradeCohortMap;
    const id = map[this.gradeNum(gradeStr) || '12'] || map['12'];
    return d.cohortProfiles[id] || Object.values(d.cohortProfiles)[0];
  },

  /** כללי המחזור המשויך לשכבה; שכבה לא מוכרת נופלת למחזור י"ב */
  rulesForGrade(gradeStr) { return this._cohortOfGrade(gradeStr).rules; },
  getCohortNameForGrade(gradeStr) { return this._cohortOfGrade(gradeStr).name; },
  getCohortIdForGrade(gradeStr) { return this._cohortOfGrade(gradeStr).id; },

  /** מריץ פונקציה כשכל הקריאות ל-Config.rules() מחזירות את כללי המחזור של השכבה (תומך בקריאות מקוננות) */
  withRulesForGrade(gradeStr, fn) {
    const restore = this.pushRulesForGrade(gradeStr);
    try { return fn(); } finally { restore(); }
  },
  /** מריץ פונקציה כשכל הקריאות ל-Config.rules() מחזירות את אובייקט הכללים שנמסר (לבדיקה מול מחזור אחר) */
  withRules(rules, fn) {
    const prev = this._rulesOverride;
    this._rulesOverride = rules;
    try { return fn(); } finally { this._rulesOverride = prev; }
  },
  pushRulesForGrade(gradeStr) {
    const prev = this._rulesOverride;
    this._rulesOverride = this.rulesForGrade(gradeStr);
    return () => { this._rulesOverride = prev; };
  },

  /* המחזור הנערך בהגדרות (בזיכרון בלבד; אינו מסונכרן לענן) */
  _editProfile() {
    const d = this.data;
    return d.cohortProfiles[this._activeCohort] || d.cohortProfiles[d.gradeCohortMap['12']] || Object.values(d.cohortProfiles)[0];
  },
  getActiveCohortId() { return this._editProfile().id; },
  setActiveCohort(id) { if (this.data.cohortProfiles[id]) this._activeCohort = id; },

  /** מעתיק את כללי מחזור המקור אל מחזור היעד (דורס אותם) */
  copyCohortRules(fromId, toId) {
    const denied = this.requireEdit(); if (denied) return denied;
    const from = this.data.cohortProfiles[fromId], to = this.data.cohortProfiles[toId];
    if (!from || !to || fromId === toId) return { ok: false, error: 'מחזור מקור או יעד לא תקין' };
    to.rules = Util.clone(from.rules);
    return this._afterCohortChange();
  },

  /** מוסיף מחזור חדש כעותק של כללי מחזור קיים (ברירת מחדל: הנערך כעת). מחזיר { ok, id } */
  addCohort(name, fromId) {
    const denied = this.requireEdit(); if (denied) return denied;
    const label = String(name || '').trim();
    if (!label) return { ok: false, error: 'נדרש שם למחזור' };
    if (Object.values(this.data.cohortProfiles).some(c => c.name === label)) return { ok: false, error: 'כבר קיים מחזור בשם זה' };
    const from = this.data.cohortProfiles[fromId] || this._editProfile();
    const id = Util.uid('mahzor');
    this.data.cohortProfiles[id] = { id, name: label, rules: Util.clone(from.rules) };
    const res = this._afterCohortChange();
    return res.ok ? { ok: true, id } : res;
  },

  /** חוזר מנכ"ל: פיצוי נקודות למקצוע בציון 5–44. מתמזג עם ברירות המחדל, כך שכללים ישנים שנשמרו ממשיכים לעבוד */
  pointsCompensation() {
    const d = defaultBagrutRules().pointsCompensation, p = this.rules().pointsCompensation || {};
    return { ...d, ...p, table: { ...d.table, ...(p.table || {}) } };
  },

  /**
   * משקל ציון המגן (ההגשה) באחוזים בחישוב ציון שאלון מהגשה ובחינה; הבחינה מקבלת את השאר.
   * עם סמל: דריסה ברכיב ליבה פעיל המכיל אותו, אחריה דריסה בקטלוג; אחרת ברירת המחדל של המחזור (30).
   */
  magenWeight(code, rules) {
    const r = rules || this.rules();
    const valid = v => v !== undefined && v !== null && v !== '' && isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100;
    if (code != null && code !== '') {
      const norm = Util.normQuestionnaireCode(code);
      const comp = (r.coreSubjects || []).filter(s => s && s.enabled !== false)
        .flatMap(s => s.variableUnits ? Object.values(s.levels || {}).flat() : (s.components || []))
        .find(c => c && c.enabled !== false && valid(c.magenWeight) && (c.codes || []).some(x => Util.normQuestionnaireCode(x) === norm));
      if (comp) return Number(comp.magenWeight);
      const q = (r.questionnaires || {})[norm];
      if (q && valid(q.magenWeight)) return Number(q.magenWeight);
    }
    return valid(r.magenWeight) ? Number(r.magenWeight) : 30;
  },

  /** ערך ריק מסיר את הדריסה (undefined); אחרת מספר 0..100 */
  _normMagen(v) {
    if (v === undefined || v === null || String(v).trim() === '') return undefined;
    const n = Number(v);
    if (!isFinite(n) || n < 0 || n > 100) throw new Error('משקל המגן חייב להיות בין 0 ל-100');
    return n;
  },

  /** דריסת מגן משותפת לרכיבי הליבה ולרשומות הקטלוג של אותם סמלים, במחזור הנערך בלבד */
  _syncMagenWeight(r, codes, value) {
    const affected = new Set((codes || []).map(Util.normQuestionnaireCode));
    const items = r.coreSubjects.flatMap(s => s.variableUnits ? Object.values(s.levels || {}).flat() : (s.components || []));
    const apply = obj => { if (value === undefined) delete obj.magenWeight; else obj.magenWeight = value; };
    let size;
    do {
      size = affected.size;
      items.forEach(item => {
        if (!(item.codes || []).some(code => affected.has(Util.normQuestionnaireCode(code)))) return;
        apply(item);
        item.codes.forEach(code => affected.add(Util.normQuestionnaireCode(code)));
      });
    } while (affected.size !== size);
    affected.forEach(code => { if (r.questionnaires && r.questionnaires[code]) apply(r.questionnaires[code]); });
  },

  /** בודק מבנה ותקינות. מחזיר מחרוזת שגיאה או '' */
  validateRules(r) {
    if (!r || typeof r !== 'object') return 'אובייקט כללים לא תקין';
    if (!Array.isArray(r.coreSubjects) || !Array.isArray(r.majors) || !Array.isArray(r.internals)) return 'חסרים coreSubjects / majors / internals';
    const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
    if (!num(r.passGrade, 0, 100)) return 'ציון עובר חייב להיות בין 0 ל-100';
    if (!num(r.compensationMin, 0, 100) || !num(r.compensationMax, 0, 100) || r.compensationMin > r.compensationMax) return 'טווח הקיזוז לא תקין';
    if (!num(r.maxCompensations, 0, 20)) return 'מכסת קיזוזים לא תקינה';
    if (r.magenWeight !== undefined && !num(Number(r.magenWeight), 0, 100)) return 'משקל ציון המגן חייב להיות בין 0 ל-100';
    const optMagen = v => v === undefined || v === null || v === '' || num(Number(v), 0, 100);
    const badList = list => (list || []).some(c => !c || !Array.isArray(c.codes) || !num(Number(c.weight), 0, 100));
    const badMagen = list => (list || []).some(c => c && !optMagen(c.magenWeight));
    for (const s of r.coreSubjects) {
      if (!s || !s.id || !s.name) return 'מקצוע ליבה ללא שם או מזהה';
      if (s.variableUnits) {
        if (!s.levels || typeof s.levels !== 'object') return `למקצוע ${s.name} חסרות רמות יח"ל`;
        if (Object.values(s.levels).some(badList)) return `משקל או סמל שאלון לא תקין במקצוע ${s.name}`;
        if (Object.values(s.levels).some(badMagen)) return `משקל מגן לא תקין במקצוע ${s.name} (0–100 או ריק)`;
      } else if (!Array.isArray(s.components) || badList(s.components)) return `משקל או סמל שאלון לא תקין במקצוע ${s.name}`;
      else if (badMagen(s.components)) return `משקל מגן לא תקין במקצוע ${s.name} (0–100 או ריק)`;
    }
    const badQ = Object.entries(r.questionnaires || {}).find(([, q]) => q && !optMagen(q.magenWeight));
    if (badQ) return `משקל מגן לא תקין בשאלון ${badQ[0]} (0–100 או ריק)`;
    if (r.internals.some(i => !i || !i.id || !i.name || !Array.isArray(i.codes))) return 'יחידה פנימית לא תקינה';
    if (r.majors.some(m => !m || !m.id || !m.name || !Array.isArray(m.codes))) return 'מגמה לא תקינה (נדרשים שם וסמלי שאלון)';
    return '';
  },

  /** אזהרות לא חוסמות: סכום משקלים שאינו 100 במקצוע פעיל, ושכבות יעד לא מאומתות / סותרות ברכיבי ליבה */
  rulesWarnings(r = this.rules()) {
    const out = [];
    const sum = list => (list || []).filter(c => c.enabled !== false).reduce((a, c) => a + (Number(c.weight) || 0), 0);
    const validRank = g => { const n = Util.ord(Util.normGrade(g)); return n >= 10 ? n : 0; };
    const cat = r.questionnaires || {};
    const unverified = code => {
      const q = cat[code];
      return !q || q.unverifiedGrade === true || (!KNOWN_VERIFIED_CODES.has(code) && q.verifiedGrade !== true);
    };
    const seen = new Set();
    const push = msg => { if (!seen.has(msg)) { seen.add(msg); out.push(msg); } };
    (r.coreSubjects || []).filter(s => s.enabled !== false).forEach(s => {
      const lists = s.variableUnits ? Object.entries(s.levels || {}).map(([l, v]) => [`${s.name} (${l} יח"ל)`, v]) : [[s.name, s.components]];
      lists.forEach(([name, list]) => {
        if (list && list.length && Math.round(sum(list)) !== 100) out.push(`${name}: סכום המשקלים ${Math.round(sum(list))}% (צפוי 100%)`);
        (list || []).filter(c => c.enabled !== false).forEach(c => {
          if (validRank(c.expectedGrade)) return;
          const codes = (c.codes || []).map(String);
          codes.filter(unverified).forEach(code => push(`${s.name}: לשאלון ${code} לא הוגדרה שכבת יעד מאומתת (נקבעה ברירת מחדל י"ב)`));
          const ranks = new Set(codes.map(code => validRank((cat[code] || {}).expectedGrade)).filter(Boolean));
          if (ranks.size > 1) push(`${s.name}: סמלי שאלון חלופיים באותו רכיב (${codes.join('/')}) מוגדרים לשכבות יעד שונות`);
        });
      });
    });
    return out;
  },

  _syncQuestionnaires() {
    Object.values(this.data.cohortProfiles).forEach(p => this._syncQuestionnairesOf(p.rules));
  },

  /**
   * מילוי expectedGrade ברכיבי ליבה של פרופילים שמורים שנוצרו לפני שהשדה נוסף: התאמה לרכיב ברירת המחדל באותו
   * (מקצוע, רמה) לפי מפתח סמלים זהה, ובהיעדרו לפי סמל משותף. שכבה קיימת בקטלוג נשמרת בעדיפות;
   * רכיב שכבר יש לו שכבה מפורשת לא משתנה.
   */
  _backfillExpectedGrades(r) {
    if (!r || !Array.isArray(r.coreSubjects)) return;
    const defaults = defaultBagrutRules().coreSubjects;
    const catalog = r.questionnaires || {};
    const keyOf = c => (c.codes || []).map(String).sort().join(',');
    r.coreSubjects.forEach(s => {
      /* מתמטיקה 5 יח"ל אינה מחליפה מגמה בשער 2 – גם בפרופילים שמורים */
      if (s.id === 'math') s.majorEligible = false;
      const ds = defaults.find(d => d.id === s.id);
      if (!ds) return;
      const pairs = s.variableUnits
        ? Object.entries(s.levels || {}).map(([lv, list]) => [list, (ds.levels || {})[lv]])
        : [[s.components, ds.components]];
      pairs.forEach(([list, defList]) => (list || []).forEach(c => {
        if (!defList || !c || !Array.isArray(c.codes) || Util.ord(Util.normGrade(c.expectedGrade)) >= 10) return;
        const codes = c.codes.map(String);
        const grades = new Set(codes.map(code => Util.normGrade((catalog[code] || {}).expectedGrade)).filter(g => Util.ord(g) >= 10));
        if (grades.size === 1) { c.expectedGrade = [...grades][0]; return; }
        const match = defList.find(d => keyOf(d) === keyOf(c)) || defList.find(d => (d.codes || []).some(x => codes.includes(String(x))));
        if (match && match.expectedGrade) c.expectedGrade = match.expectedGrade;
      }));
    });
  },

  _syncQuestionnairesOf(r) {
    const normalizeCodes = codes => [...new Set((codes || []).map(Util.normQuestionnaireCode).filter(Boolean))];
    const items = [
      ...r.coreSubjects.flatMap(s => s.variableUnits ? Object.values(s.levels || {}).flat() : (s.components || [])),
      ...r.majors, ...r.internals
    ];
    items.forEach(item => {
      item.codes = normalizeCodes(item.codes);
      if (item.weights) item.weights = Object.fromEntries(Object.entries(item.weights).map(([code, weight]) => [Util.normQuestionnaireCode(code), weight]));
    });
    const catalog = r.questionnaires || {};
    r.questionnaires = Object.fromEntries(Object.entries(catalog).map(([code, entry]) => {
      const normalized = Util.normQuestionnaireCode(code);
      return [normalized, catalog[normalized] || entry];
    }));
    if (r.exceptionDetection && Array.isArray(r.exceptionDetection.immigrantCodes)) {
      r.exceptionDetection.immigrantCodes = normalizeCodes(r.exceptionDetection.immigrantCodes);
    }
    this._backfillExpectedGrades(r);
    /* קטלוג חדש אינו מחליף רכיבים, משקלים או מטא-דאטה שכבר נשמרו במחזור; סמל חסר נוסף בלי דריסת מגן,
       כדי שמחזור שמור ימשיך לחשב לפי משקל המגן שכבר הוגדר בו */
    Object.entries(defaultBagrutRules().questionnaires).forEach(([code, entry]) => {
      if (r.questionnaires[code]) return;
      const added = Util.clone(entry);
      delete added.magenWeight;
      r.questionnaires[code] = added;
    });
    const add = (code, name, expectedGrade) => {
      if (!code || code === 'פנימי') return;
      if (!r.questionnaires[code]) r.questionnaires[code] = { name: name || '', expectedGrade: expectedGrade || 'יב' };
    };
    r.coreSubjects.forEach(s => {
      const lists = s.variableUnits ? Object.values(s.levels || {}) : [s.components || []];
      lists.flat().forEach(c => (c.codes || []).forEach(raw => {
        const code = String(raw);
        if (!code || code === 'פנימי') return;
        const auto = c.label || s.name;
        const explicit = c.expectedGrade ? Util.normGrade(c.expectedGrade) : '';
        const q = r.questionnaires[code];
        if (!q) {
          r.questionnaires[code] = { name: auto || '', expectedGrade: explicit || 'יב' };
          if (!explicit && !KNOWN_VERIFIED_CODES.has(code)) r.questionnaires[code].unverifiedGrade = true;
        } else if (q.expectedGrade === 'יב' && !KNOWN_VERIFIED_CODES.has(code) && q.verifiedGrade !== true && (!explicit || q.name === auto)) {
          /* רשומת קטלוג ישנה שקיבלה י"ב כברירת מחדל ולא אושרה מעולם */
          q.unverifiedGrade = true;
        }
      }));
    });
    r.majors.forEach(m => {
      m.expectedGrade = Util.normGrade(m.expectedGrade) || 'יב';
      m.codes.forEach(code => add(code, m.name, m.expectedGrade));
    });
    r.internals.forEach(i => i.codes.forEach(code => add(code, i.name, i.expectedGrade)));
  },

  /** מחיל שינוי על כללי המחזור הנערך, שומר מיידית ומשדר 'sd:rules-changed' לחישוב מחדש */
  updateRules(mutator) {
    const denied = this.requireEdit(); if (denied) return denied;
    const profile = this._editProfile();
    const backup = Util.clone(profile.rules);
    try {
      mutator(profile.rules);
      const err = this.validateRules(profile.rules);
      if (err) throw new Error(err);
    } catch (e) {
      profile.rules = backup;
      return { ok: false, error: e.message };
    }
    this._syncQuestionnaires();
    const res = this.save();
    this.emit('rules-changed');
    return res.ok ? { ok: true, warnings: this.rulesWarnings() } : res;
  },

  setRules(obj) {
    const err = this.validateRules(obj);
    if (err) return { ok: false, error: err };
    return this.updateRules(r => { Object.keys(r).forEach(k => delete r[k]); Object.assign(r, Util.clone(obj)); });
  },
  resetRules() { return this.updateRules(r => { Object.keys(r).forEach(k => delete r[k]); Object.assign(r, defaultBagrutRules()); }); },

  setRuleParam(key, value) {
    const v = Number(value);
    if (!isFinite(v)) return { ok: false, error: 'ערך מספרי נדרש' };
    return this.updateRules(r => { r[key] = v; });
  },

  /** חוק קיזוז: { enabled, min, max, maxCount, excludedSubjects } */
  setCompensation(p) {
    return this.updateRules(r => {
      if ('enabled' in p) r.allowCompensationRule = !!p.enabled;
      if ('min' in p) r.compensationMin = Number(p.min);
      if ('max' in p) r.compensationMax = Number(p.max);
      if ('maxCount' in p) r.maxCompensations = Number(p.maxCount);
      if ('excludedSubjects' in p) r.compensationExcludedSubjects = p.excludedSubjects.map(s => String(s).trim()).filter(Boolean);
      if ('pointsEnabled' in p) r.pointsCompensation = { ...this.pointsCompensation(), enabled: !!p.pointsEnabled };
    });
  },

  setGateEnabled(gate, enabled) {
    return this.updateRules(r => { if (r.gates[gate]) r.gates[gate].enabled = !!enabled; });
  },

  _clauseList(r, kind) {
    return { core: r.coreSubjects, major: r.majors, internal: r.internals }[kind];
  },

  toggleClause(kind, id) {
    return this.updateRules(r => {
      const c = this._clauseList(r, kind).find(x => x.id === id);
      if (!c) throw new Error('סעיף לא נמצא');
      c.enabled = c.enabled === false;
    });
  },

  addClause(kind, clause) {
    return this.updateRules(r => {
      const list = this._clauseList(r, kind);
      const c = { enabled: true, keywords: [], ...clause, id: clause.id || Util.uid(kind) };
      if (!c.name) throw new Error('נדרש שם לסעיף');
      if (list.some(x => x.id === c.id)) throw new Error('מזהה סעיף כבר קיים');
      if (kind === 'internal') c.codes = c.codes || [];
      else if (kind === 'core') { c.units = c.units || 2; c.variableUnits = !!c.variableUnits; c.components = c.components || []; if (c.variableUnits) c.levels = c.levels || { 3: [], 4: [], 5: [] }; }
      else { c.units = c.units || 5; c.codes = c.codes || []; }
      list.push(c);
      const items = kind === 'core' ? [...c.components, ...Object.values(c.levels || {}).flat()] : [c];
      items.filter(item => item.expectedGrade).forEach(item => this._syncExpectedGrade(r, item.codes, item.expectedGrade));
    });
  },

  removeClause(kind, id) {
    return this.updateRules(r => {
      const list = this._clauseList(r, kind);
      const i = list.findIndex(x => x.id === id);
      if (i < 0) throw new Error('סעיף לא נמצא');
      list.splice(i, 1);
    });
  },

  _components(r, kind, id, level) {
    const s = this._clauseList(r, kind).find(x => x.id === id);
    if (!s) throw new Error('סעיף לא נמצא');
    if (s.variableUnits) { s.levels[level] = s.levels[level] || []; return s.levels[level]; }
    s.components = s.components || [];
    return s.components;
  },

  /** מוסיף שאלון (או מעדכן לפי אינדקס) – { codes: ['22283'], weight: 30, label } */
  upsertComponent(kind, id, level, index, comp) {
    return this.updateRules(r => {
      const list = this._components(r, kind, id, level);
      const codes = (comp.codes || []).map(c => String(c).trim()).filter(Boolean);
      if (!codes.length) throw new Error('נדרש סמל שאלון');
      const item = { enabled: true, ...(list[index] || {}), ...comp, codes, weight: Number(comp.weight) };
      const hasMagen = 'magenWeight' in comp;
      if (hasMagen) {
        const mw = this._normMagen(comp.magenWeight);
        if (mw === undefined) delete item.magenWeight; else item.magenWeight = mw;
      }
      /* שכבת יעד מפורשת לרכיב נשמרת מנורמלת (י / יא / יב); ערך לא תקין או ריק מסיר אותה */
      const grade = Util.normGrade(item.expectedGrade);
      if (grade) item.expectedGrade = grade; else delete item.expectedGrade;
      if (index == null || index < 0 || index >= list.length) list.push(item); else list[index] = item;
      if (grade) this._syncExpectedGrade(r, codes, grade);
      if (hasMagen) this._syncMagenWeight(r, codes, item.magenWeight);
    });
  },

  removeComponent(kind, id, level, index) {
    return this.updateRules(r => { this._components(r, kind, id, level).splice(index, 1); });
  },

  /** מעדכן סמלי שאלון של מגמה או יחידה פנימית (רשימה מופרדת בפסיקים) */
  setClauseCodes(kind, id, codes) {
    const list = (Array.isArray(codes) ? codes : String(codes).split(',')).map(c => String(c).trim()).filter(Boolean);
    return this.updateRules(r => {
      const c = this._clauseList(r, kind).find(x => x.id === id);
      if (!c) throw new Error('סעיף לא נמצא');
      c.codes = list;
      if (c.expectedGrade) this._syncExpectedGrade(r, list, c.expectedGrade);
    });
  },

  /** עדכון שדה פשוט בסעיף (שם, שכבה צפויה, ignorable וכו') */
  patchClause(kind, id, patch) {
    return this.updateRules(r => {
      const c = this._clauseList(r, kind).find(x => x.id === id);
      if (!c) throw new Error('סעיף לא נמצא');
      if ('name' in patch && !String(patch.name).trim()) throw new Error('נדרש שם לסעיף');
      Object.assign(c, patch);
      if ('expectedGrade' in patch) {
        const grade = Util.normGrade(patch.expectedGrade);
        if (!grade) throw new Error('שכבה לא תקינה');
        c.expectedGrade = grade;
        this._syncExpectedGrade(r, c.codes || [], grade);
      }
    });
  },

  /** קודים חלופיים ורכיבים החולקים סמל נשארים באותה שכבת יעד, במחזור הנערך בלבד. */
  _syncExpectedGrade(r, codes, expectedGrade) {
    const grade = Util.normGrade(expectedGrade);
    const affected = new Set((codes || []).map(Util.normQuestionnaireCode));
    const items = [
      ...r.coreSubjects.flatMap(s => s.variableUnits ? Object.values(s.levels || {}).flat() : (s.components || [])),
      ...r.majors, ...r.internals
    ];
    let size;
    do {
      size = affected.size;
      items.forEach(item => {
        if (!(item.codes || []).some(code => affected.has(Util.normQuestionnaireCode(code)))) return;
        item.expectedGrade = grade;
        item.codes.forEach(code => affected.add(Util.normQuestionnaireCode(code)));
      });
    } while (affected.size !== size);
    affected.forEach(code => {
      if (!code || code === 'פנימי') return;
      r.questionnaires[code] = { name: '', ...(r.questionnaires[code] || {}), expectedGrade: grade, verifiedGrade: true, unverifiedGrade: false };
    });
  },

  /** רק עדכון מפורש של שכבת היעד מאמת אותה; עריכת שם בלבד אינה משנה את סטטוס האימות */
  setQuestionnaire(code, patch) {
    code = Util.normQuestionnaireCode(code);
    const verifies = !!(patch && 'expectedGrade' in patch && Util.normGrade(patch.expectedGrade));
    return this.updateRules(r => {
      if (patch && 'expectedGrade' in patch && !verifies) throw new Error('שכבה לא תקינה');
      const hasMagen = !!patch && 'magenWeight' in patch;
      const magen = hasMagen ? this._normMagen(patch.magenWeight) : undefined;
      r.questionnaires[code] = { name: '', expectedGrade: 'יב', ...(r.questionnaires[code] || {}), ...patch, ...(verifies ? { verifiedGrade: true, unverifiedGrade: false } : {}) };
      if (verifies) this._syncExpectedGrade(r, [code], patch.expectedGrade);
      if (hasMagen) this._syncMagenWeight(r, [code], magen);
    });
  },
  removeQuestionnaire(code) {
    code = Util.normQuestionnaireCode(code);
    return this.updateRules(r => { delete r.questionnaires[code]; });
  },

  /**
   * משחזר מחזורים משחזור / סנכרון ענן. גיבוי ישן (כללים בודדים בלבד) הופך לעותק בכל המחזורים;
   * ללא אף אחד מהשדות – ההגדרות הקיימות נשמרות כפי שהן.
   */
  applyCohortState(profiles, map, legacyRules) {
    if (!profiles && !legacyRules) return;
    const n = this.normalizeCohorts(profiles, map, legacyRules);
    this.data.cohortProfiles = n.profiles;
    this.data.gradeCohortMap = n.map;
    if (!n.profiles[this._activeCohort]) this._activeCohort = n.map['12'];
  },

  /* ---------- גיבוי ושחזור ---------- */
  exportObject() {
    return {
      app: 'schoolDashboard', version: 2, exportedAt: new Date().toISOString(),
      classNicknames: this.data.classNicknames, specialEdClasses: this.data.specialEdClasses, mappingProfiles: this.data.mappingProfiles,
      cohortProfiles: this.data.cohortProfiles, gradeCohortMap: this.data.gradeCohortMap,
      /* שדה תאימות לגרסאות קודמות: כללי מחזור י"ב */
      bagrutRules: this.rulesForGrade('12'), traineeExceptions: this.data.traineeExceptions,
      rosterOverrides: this.data.rosterOverrides, rosterMismatchDismissed: this.data.rosterMismatchDismissed,
      masterRoster: this.getRosterEntry()
    };
  },

  exportJSON() {
    const blob = new Blob([JSON.stringify(this.exportObject(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  async importJSON(text, opts = {}) {
    const denied = this.requireEdit(); if (denied) throw new Error(denied.error);
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('קובץ JSON לא תקין'); }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('מבנה הגיבוי לא תקין');
    if (obj.bagrutRules) {
      const err = this.validateRules(obj.bagrutRules);
      if (err) throw new Error(`כללי הזכאות בגיבוי לא תקינים: ${err}`);
    }
    if (obj.cohortProfiles) {
      const list = Array.isArray(obj.cohortProfiles) ? obj.cohortProfiles : Object.values(obj.cohortProfiles || {});
      const bad = list.find(p => p && p.rules && this.validateRules(p.rules));
      if (bad) throw new Error(`כללי המחזור "${bad.name || bad.id}" בגיבוי לא תקינים: ${this.validateRules(bad.rules)}`);
    }
    if (obj.masterRoster && !(Array.isArray(obj.masterRoster.data))) throw new Error('מצבת החניכים בגיבוי לא תקינה');
    const d = this.data;
    if (obj.classNicknames && typeof obj.classNicknames === 'object') d.classNicknames = obj.classNicknames;
    if (obj.specialEdClasses && typeof obj.specialEdClasses === 'object') d.specialEdClasses = obj.specialEdClasses;
    if (obj.mappingProfiles && typeof obj.mappingProfiles === 'object') d.mappingProfiles = obj.mappingProfiles;
    if (obj.traineeExceptions && typeof obj.traineeExceptions === 'object') {
      /* מפתחות החריגים מנורמלים (ריפוד ל-9 ספרות), גם אם הקובץ נערך ידנית */
      const exceptions = {};
      Object.entries(obj.traineeExceptions).forEach(([tz, ex]) => {
        const id = Util.normId(tz);
        if (id && ex && typeof ex === 'object') exceptions[id] = { ...(exceptions[id] || {}), ...ex };
      });
      d.traineeExceptions = exceptions;
    }
    this.applyCohortState(obj.cohortProfiles, obj.gradeCohortMap, obj.bagrutRules);
    if (obj.rosterOverrides && typeof obj.rosterOverrides === 'object') {
      /* מפתחות מנורמלים; שכבה / כיתה / מסלול לא תקינים מנוקים, ודריסה ריקה נזרקת */
      const overrides = {};
      Object.entries(obj.rosterOverrides).forEach(([tz, o]) => {
        const id = Util.normId(tz);
        if (!id || !o || typeof o !== 'object') return;
        const p = o.homeroom ? Util.parseClass(o.grade || '', o.homeroom) : { gradeKey: '', classKey: '' };
        const homeroom = Util.GRADE_KEYS.includes(p.gradeKey) ? p.classKey : '';
        const grade = homeroom ? p.gradeKey : (Util.GRADE_KEYS.includes(o.grade) ? o.grade : '');
        const track = this.TRACKS.includes(o.track) ? o.track : '';
        const entry = { tz: id, grade, homeroom, track, hidden: !!o.hidden, note: String(o.note || '').slice(0, 200), updatedAt: Number(o.updatedAt) || Date.now() };
        if (o.name) entry.name = String(o.name).trim();
        if (entry.grade || entry.homeroom || entry.track || entry.hidden || entry.note) overrides[id] = entry;
      });
      d.rosterOverrides = overrides;
    }
    if (obj.rosterMismatchDismissed && typeof obj.rosterMismatchDismissed === 'object') {
      d.rosterMismatchDismissed = Object.fromEntries(Object.entries(obj.rosterMismatchDismissed).map(([tz, s]) => [Util.normId(tz), String(s)]).filter(([tz]) => tz));
    }
    this._invalidateRoster();
    this._syncQuestionnaires();
    const res = this.save();
    if (!res.ok) throw new Error(res.error);
    if (obj.masterRoster) {
      const norm = this.normalizeRosterRows(obj.masterRoster.data);
      if (norm.rows.length) {
        const extra = Array.isArray(obj.masterRoster.ignoredIds) ? obj.masterRoster.ignoredIds.map(Util.normId).filter(Boolean) : [];
        const ignoredIds = this._mergeIgnored([...norm.ignoredIds, ...extra], norm.rows);
        const entry = { data: norm.rows, ignoredIds, fileName: obj.masterRoster.fileName || '', uploadedAt: obj.masterRoster.uploadedAt || Date.now() };
        const w = this._write(this.KEYS.masterRoster, entry);
        if (!w.ok) throw new Error(w.error);
        this._cache.masterRoster = entry;
        this._invalidateRoster();
        this.setRosterCleared(false);
      }
    }
    /* ניקוי מיידי של חניכי ז-ט מהמצבת וקובצי המשנה, בלי לחכות לרענון */
    this.scrubRoster();
    await this.scrubDatasets(true);
    if (opts.silent) return;
    this.emit('roster-changed');
    this.emit('rules-changed');
    this.emit('exceptions-changed');
  }
};

Config.load();
Config.ready = Config.initStorage();
