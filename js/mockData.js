/* =====================================================================
   mockData.js – נתוני דמו סינתטיים ומציאותיים (שכבות י' / י"א / י"ב, 45 חניכים).
   הנתונים נוצרים כשורות "גולמיות" בדיוק כפי שהיו מגיעות מקובצי Excel של משוב,
   כך שכל תהליך הקליטה (נרמול ת.ז, פענוח קבוצה/אירוע, חוקי הבגרות) נבדק מקצה לקצה.

   כולל במכוון: חניכים ללא קבוצת ליבה, כפילויות שיבוץ, ת.ז שאינן במצבת, אירועים עם
   ציון 0 או חסר, מספר מועדים לאותו שאלון, ערכי טקסט ("בוצע", "9 - לא עבר"...), מקרה
   קיזוז, ומקרים חריגים (שאלון עולים, ציון חיצוני ללא רכיב בית-ספרי, רמות יח"ל מעורבות).
   ===================================================================== */

const MockData = (() => {
  const FIRST_F = ['נועה', 'מאיה', 'שירה', 'תמר', 'יעל', 'רוני', 'אביגיל', 'הילה', 'ליה', 'מיכל', 'דנה', 'עדי', 'ספיר', 'גל', 'אורי', 'טליה', 'רותם', 'מור'];
  const FIRST_M = ['איתי', 'יונתן', 'דניאל', 'אריאל', 'עומר', 'נועם', 'רועי', 'אלון', 'יובל', 'גיא', 'תומר', 'שחר', 'ליאור', 'אדם', 'מתן', 'עידו', 'אורן', 'אסף'];
  const LAST = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'דהן', 'אברהם', 'פרידמן', 'אזולאי', 'חדד', 'גבאי', 'שפירא', 'רוזן', 'אוחנה', 'סבג', 'קדוש', 'ברק', 'נחום', 'עמר', 'וקנין', 'שמש', 'טל', 'זיו', 'גולן'];
  const TEACHERS = [['רמי', 'בר'], ['דנה', 'שמש'], ['יוסי', 'כהן'], ['מיכל', 'לוי'], ['אבי', 'פרץ'], ['רונית', 'גבאי'], ['עמית', 'ברק'], ['נעמה', 'זיו'], ['שלמה', 'אוחנה'], ['תמר', 'רוזן']];
  const EVENT_POOL = [['מבחן סיום פרק', 20], ['בוחן פתע', 10], ['עבודה בכיתה', 5], ['פרויקט אישי', 15], ['מבחן מסכם', 25]];
  const DATES = ['12/10/2025', '02/11/2025', '23/11/2025', '14/12/2025', '11/01/2026', '01/02/2026'];
  /* שכבה, כיתת אם, מספר חניכים */
  const CLASS_PLAN = [['י', 'י1', 7], ['י', 'י2', 7], ['יא', 'יא3', 7], ['יא', 'יא4', 7], ['יב', 'יב3', 9], ['יב', 'יב4', 8]];
  const MAJOR_IDS = ['cs', 'physics', 'biology'];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generate() {
    const rules = defaultBagrutRules();
    const rand = mulberry32(20261114);
    const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const pick = arr => arr[Math.floor(rand() * arr.length)];
    const normal = () => { let s = 0; for (let i = 0; i < 6; i++) s += rand(); return (s - 3) / 0.7071; };
    const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
    const gl = k => Util.GRADE_LABEL[k];
    const qOrd = code => Util.ord((rules.questionnaires[code] || {}).expectedGrade) || 12;

    /* ---------- חניכים ---------- */
    const SPECIAL = new Set([7, 18, 38]), CHALLENGE = new Set([3, 21]), MBAR = new Set([10, 30]);
    const trainees = [];
    let idx = 0;
    CLASS_PLAN.forEach(([gradeKey, classKey, count]) => {
      for (let k = 0; k < count; k++, idx++) {
        const female = idx % 2 === 0 ? rand() < 0.7 : rand() < 0.3;
        const track = SPECIAL.has(idx) ? 'חנ"מ' : CHALLENGE.has(idx) ? 'אתגר' : MBAR.has(idx) ? 'מב"ר' : 'רגילה';
        const ability = Math.round(clamp(76 + normal() * 9 - (track === 'חנ"מ' ? 12 : 0), 50, 96));
        const names = female ? FIRST_F : FIRST_M;
        /* חלק מהת.ז באורך 8 ספרות, כדי לבדוק ריפוד באפסים */
        const tzNum = idx % 9 === 4 ? 31000000 + idx * 8191 : 201000000 + idx * 37931;
        const noisy = () => ability + normal() * 6;
        const majorId = pick(MAJOR_IDS);
        const major = rand() < 0.93 ? rules.majors.find(m => m.id === majorId) : null;
        const t = {
          idx, tz: String(tzNum), first: names[(idx * 7) % names.length], last: LAST[(idx * 5 + 3) % LAST.length],
          gender: female ? 'נקבה' : 'זכר', gradeKey, classKey, classNum: classKey.replace(/\D/g, ''), track, ability, major,
          engLevel: noisy() < 62 ? '3' : noisy() < 80 ? '4' : '5', mathLevel: noisy() < 80 ? '3' : '4',
          summerDone: rand() < 0.88, offsets: {}, force: {}, skipCodes: [], noGroup: [], dupHistory: false,
          internalValue: {}, extra: []
        };
        rules.coreSubjects.forEach(s => { t.offsets[s.id] = Math.round(normal() * 5); });
        trainees.push(t);
      }
    });

    /* ---------- תרחישים מכוונים ---------- */
    const at = (classKey, k) => trainees.filter(t => t.classKey === classKey)[k];
    /* חניכי התרחישים מקבלים נתונים מלאים ודטרמיניסטיים, כדי שהמקרה שנבדק לא יטושטש בדילוג אקראי */
    const scenario = (t, fn) => { if (t) { t.scenario = true; t.summerDone = true; t.ability = Math.max(t.ability, 80); fn(t); } };
    scenario(at('יא3', 2), t => { t.noGroup.push('hebrew'); });                       // ללא קבוצת עברית
    scenario(at('יב4', 1), t => { t.noGroup.push('english'); });                      // ללא קבוצת אנגלית
    scenario(at('יב3', 1), t => { t.dupHistory = true; });                            // שתי קבוצות היסטוריה
    scenario(at('יא4', 2), t => { t.dupHistory = true; });
    scenario(at('יב3', 4), t => { t.major = null; });                                 // ללא מגמה
    scenario(at('יב3', 0), t => { t.ability = 84; t.mathLevel = '3'; t.force.math = 52; t.major = t.major || rules.majors.find(m => m.id === 'cs'); }); // קיזוז: מתמטיקה 52
    scenario(at('יב4', 3), t => {                                                     // שאלון עולים
      t.skipCodes.push('11281', '11283');
      t.extra.push({ subject: 'עברית לעולים', code: '5384', final: 74, moed: 'קיץ 2025' });
    });
    scenario(at('יא4', 4), t => { t.extra.push({ subject: 'שאלון מותאם לעולים', code: '585580', final: 66, moed: 'חורף 2026' }); });
    scenario(at('יב3', 6), t => { t.skipCodes.push('22283'); });                      // ציון חיצוני ללא רכיב בית-ספרי
    scenario(at('יב4', 5), t => { t.mathLevel = '3'; t.extra.push({ subject: 'מתמטיקה', code: '35481', final: 61, moed: 'קיץ 2025' }); }); // רמות מעורבות
    scenario(at('יב4', 7), t => { t.force.english = 40; });                           // נכשל באנגלית
    scenario(at('יב3', 8), t => { t.skipCodes.push('41083'); });                      // חסר חנ"ג פנימי
    scenario(at('יב4', 2), t => { t.internalValue.social = '9 - לא עבר'; });           // מעורבות חברתית לא עברה
    scenario(at('יב3', 3), t => { t.extra.push({ subject: 'מקצוע מורחב (שאלון לא מוגדר)', code: '819387', final: 70, moed: 'קיץ 2025' }); });
    const twelve = at('יב4', 6);

    /* ---------- קבוצות ומורים ---------- */
    const teacherPool = TEACHERS.map(([first, last], i) => ({ first, last, tz: 150000000 + i * 1111 }));
    let teacherIdx = 0, nextId = 2001;
    const groups = [];
    const mk = (gradeKey, subjId, subject, members, tok) => {
      const g = { id: nextId++, gradeKey, subjId, subject, tok, members, teacher: teacherPool[teacherIdx++ % teacherPool.length], declared: members.length };
      groups.push(g);
      return g;
    };
    ['י', 'יא', 'יב'].forEach(gk => {
      const ts = trainees.filter(t => t.gradeKey === gk);
      const rooms = [...new Set(ts.map(t => t.classKey))];
      const span = rooms.length > 1 ? `${rooms[0]}-${rooms[rooms.length - 1]}` : rooms[0];
      const eligible = (id, list) => list.filter(t => !t.noGroup.includes(id));
      rooms.forEach(room => {
        const c = ts.filter(t => t.classKey === room);
        mk(gk, 'hebrew', 'עברית', eligible('hebrew', c), room);
        mk(gk, 'history', 'היסטוריה', eligible('history', c), room);
        mk(gk, 'civics', 'אזרחות', eligible('civics', c), room);
      });
      mk(gk, 'literature', 'ספרות', eligible('literature', ts), span);
      mk(gk, 'tanach', 'תנ"ך', eligible('tanach', ts), span);
      ['3', '4', '5'].forEach(l => {
        const e = eligible('english', ts.filter(t => t.engLevel === l));
        if (e.length) mk(gk, 'english', `אנגלית ${l} יח"ל`, e, span);
        const m = eligible('math', ts.filter(t => t.mathLevel === l));
        if (m.length) mk(gk, 'math', `מתמטיקה ${l} יח"ל`, m, span);
      });
      MAJOR_IDS.forEach(id => {
        const m = rules.majors.find(x => x.id === id);
        const members = ts.filter(t => t.major && t.major.id === id);
        if (members.length) mk(gk, id, `${m.keywords[0]} 5 יח"ל`, members, span);
      });
    });
    const litB = groups.find(g => g.subjId === 'literature' && g.gradeKey === 'יב');
    litB.id = 1042;
    litB.teacher = teacherPool[0];
    litB.declared = litB.members.length + 2;

    /* כפילות שיבוץ: חניך רשום גם לקבוצת היסטוריה של כיתה אחרת באותה שכבה */
    trainees.filter(t => t.dupHistory).forEach(t => {
      const other = groups.find(g => g.subjId === 'history' && g.gradeKey === t.gradeKey && !g.members.includes(t));
      if (other) other.members.push(t);
    });
    const memberGroups = new Map();
    groups.forEach(g => g.members.forEach(t => { if (!memberGroups.has(t.tz)) memberGroups.set(t.tz, []); memberGroups.get(t.tz).push(g); }));

    /* ---------- קובץ קבוצות ---------- */
    const groupRows = [];
    groups.forEach(g => {
      groupRows.push({ 'ת.ז': g.teacher.tz, 'שם פרטי': g.teacher.first, 'שם משפחה': g.teacher.last, 'שכבה': '', 'כיתה': '', 'מספר קבוצה': g.id, 'שם קבוצה': g.subject, 'מורה': 'כן' });
      g.members.forEach(t => groupRows.push({ 'ת.ז': t.tz, 'שם פרטי': t.first, 'שם משפחה': t.last, 'שכבה': gl(t.gradeKey), 'כיתה': t.classKey, 'מספר קבוצה': g.id, 'שם קבוצה': g.subject, 'מורה': '' }));
    });
    const orphans = [
      { tz: '399888777', first: 'חיים', last: 'לביא', gradeKey: 'יב', classKey: 'יב4' },
      { tz: '388777666', first: 'שקד', last: 'ארד', gradeKey: 'יא', classKey: 'יא3' }
    ];
    const histB = groups.find(g => g.subjId === 'history' && g.gradeKey === 'יב');
    const histA = groups.find(g => g.subjId === 'history' && g.gradeKey === 'יא');
    [[orphans[0], histB], [orphans[1], histA]].forEach(([o, g]) => groupRows.push({
      'ת.ז': o.tz, 'שם פרטי': o.first, 'שם משפחה': o.last, 'שכבה': gl(o.gradeKey), 'כיתה': o.classKey, 'מספר קבוצה': g.id, 'שם קבוצה': g.subject, 'מורה': ''
    }));

    /* ---------- קובץ ציונים שוטפים (פורמט משוב) ---------- */
    const gradeRows = [];
    let seq = 1;
    const groupString = g => `${g.subject} ${g.tok} ${g.teacher.first} ${g.teacher.last} [${g.id}] (${g.declared} תלמידים)`;
    const pushGrade = (t, g, eventName, weight, date, shown) => gradeRows.push({
      "מס'": seq++, 'ת.ז. החניך': t.tz, 'שם החניך': `${t.first} ${t.last}`, 'מין': t.gender, 'שכבה': gl(t.gradeKey), 'כיתה': t.classNum,
      'אירוע (משקל)': `${eventName} (${weight})`, 'תאריך האירוע': date, 'ציון מספרי': shown, 'קבוצה': groupString(g)
    });
    groups.forEach(g => {
      const events = g.subjId === 'literature'
        ? [['מבחן הסיפור הקצר', 15], ['תשובת בגרות אדונית והרוכל', 2], ['בוחן פתע', 10]]
        : [0, 1, 2].map(i => EVENT_POOL[(g.id + i * 2) % EVENT_POOL.length]);
      events.forEach(([name, weight], ei) => {
        const date = DATES[(g.id + ei) % DATES.length];
        g.members.forEach((t, mi) => {
          if (g.subjId === 'literature' && g.id === 1042) {
            if (ei === 0 && mi === 0) { pushGrade(t, g, name, weight, date, ''); return; }   // ציון חסר
            if (ei === 1 && mi === 1) { pushGrade(t, g, name, weight, date, 0); return; }    // ציון 0
          }
          const base = t.force[g.subjId] != null ? t.force[g.subjId] : t.ability + (t.offsets[g.subjId] || 0);
          const score = Math.round(clamp(base + normal() * 8, 25, 100));
          const r = rand();
          if (r < 0.02) return;
          pushGrade(t, g, name, weight, date, r < 0.05 ? '' : r < 0.07 ? 0 : score);
        });
      });
    });
    /* ת.ז שאינה במצבת מופיעה בסדין */
    orphans.slice(0, 1).forEach(o => {
      [['מבחן סיום פרק', 20], ['בוחן פתע', 10], ['עבודה בכיתה', 5]].forEach(([name, w], i) => {
        gradeRows.push({
          "מס'": seq++, 'ת.ז. החניך': o.tz, 'שם החניך': `${o.first} ${o.last}`, 'מין': 'זכר', 'שכבה': gl(o.gradeKey), 'כיתה': o.classKey.replace(/\D/g, ''),
          'אירוע (משקל)': `${name} (${w})`, 'תאריך האירוע': DATES[i], 'ציון מספרי': 70 + i * 3, 'קבוצה': groupString(histB)
        });
      });
    });

    /* ---------- קובץ ציוני בגרות ---------- */
    const bagrutRows = [];
    const row = (t, subject, code, final, moed, sub) => bagrutRows.push({
      'ת.ז': t.tz, 'שם': `${t.first} ${t.last}`, 'שכבה': gl(t.gradeKey), 'מקצוע': subject, 'סמל שאלון': code,
      'הגשה': sub != null ? sub : '', 'בחינה': typeof final === 'number' ? final : '', 'סופי': final, 'מועד': moed
    });
    trainees.forEach(t => {
      const ord = Util.ord(t.gradeKey);
      const taken = code => {
        const e = qOrd(code);
        if (e < ord) return t.scenario || rand() < 0.96;
        if (e === ord) return t.gradeKey === 'יב' ? t.summerDone : rand() < 0.35;
        return false;
      };
      rules.coreSubjects.forEach(s => {
        const lv = s.id === 'english' ? t.engLevel : s.id === 'math' ? t.mathLevel : null;
        const comps = s.variableUnits ? s.levels[lv] : s.components;
        comps.forEach(c => {
          const code = c.codes[0];
          if (t.skipCodes.includes(code) || !taken(code)) return;
          const forced = t.force[s.id] != null;
          const g = forced ? t.force[s.id] : Math.round(clamp(t.ability + (t.offsets[s.id] || 0) + normal() * 7, 30, 100));
          if (!forced && !t.scenario && rand() < 0.012) { row(t, s.name, code, 'לא ניגש', 'קיץ 2025'); return; }
          if (!forced && rand() < 0.15) row(t, s.name, code, Math.max(30, g - ri(10, 22)), 'חורף 2025');   // ניסיון קודם נמוך יותר
          row(t, s.name, code, g, 'קיץ 2025', forced ? g : Math.round(clamp(g + ri(-4, 6), 20, 100)));
        });
      });
      if (t.major && ord >= 11 && (t.gradeKey === 'יב' ? t.summerDone : rand() < 0.3)) {
        t.major.codes.forEach(code => row(t, t.major.name, code, Math.round(clamp(t.ability + normal() * 8, 40, 100)), 'קיץ 2025'));
      }
      t.extra.forEach(x => row(t, x.subject, x.code, x.final, x.moed));
      rules.internals.forEach(it => {
        const code = it.codes[0];
        if (Util.ord(it.expectedGrade) > ord || t.skipCodes.includes(code) || (!t.scenario && rand() < 0.04)) return;
        let v = t.internalValue[it.id];
        if (v == null) {
          if (it.id === 'social' || it.id === 'general') v = rand() < 0.5 ? 'בוצע' : '2 - עמד בדרישות';
          else if (it.id === 'science') v = rand() < 0.5 ? 'עבודה עיונית' : Math.round(clamp(t.ability + normal() * 8, 56, 100));
          else v = rand() < 0.15 ? 'פטור' : Math.round(clamp(t.ability + normal() * 8, 56, 100));
        }
        row(t, it.name, code, v, 'קיץ 2025');
      });
    });
    bagrutRows.push({ 'ת.ז': orphans[1].tz, 'שם': `${orphans[1].first} ${orphans[1].last}`, 'שכבה': gl(orphans[1].gradeKey), 'מקצוע': 'מתמטיקה', 'סמל שאלון': '35183', 'הגשה': 70, 'בחינה': '', 'סופי': 70, 'מועד': 'קיץ 2025' });

    const roster = trainees.map(t => ({ tz: t.tz.padStart(9, '0'), firstName: t.first, lastName: t.last, grade: t.gradeKey, homeroom: t.classKey, track: t.track }));
    const meta = {};
    if (twelve) meta[twelve.tz.padStart(9, '0')] = { excludeFromBagrut: true, coordinatorNote: 'סוכם עם ההורים' };

    return {
      roster,
      groups: { headers: Object.keys(groupRows[0]), rows: groupRows },
      grades: { headers: Object.keys(gradeRows[0]), rows: gradeRows },
      bagrut: { headers: Object.keys(bagrutRows[0]), rows: bagrutRows },
      meta,
      unmatchedIds: orphans.map(o => o.tz)
    };
  }

  /**
   * מאכלס את Config בנתוני דמו אם המצבת העליונה ריקה.
   * מחזיר true כשנטענו נתונים, false כשכבר קיימת מצבת (ללא דריסה).
   */
  async function initMockDataIfEmpty() {
    await Config.ready;
    if (Config.getRoster().length || Config.isRosterCleared()) return false;
    const d = generate();
    const r = Config.setRoster(d.roster, 'נתוני דמו');
    if (!r.ok) throw new Error(r.error);
    const keyOf = { groups: 'groupsData', grades: 'sadinData', bagrut: 'bagrutData' };
    for (const type of ['groups', 'grades', 'bagrut']) {
      const mapping = Parser.autoMap(type, d[type].headers, d[type].rows);
      const { rows } = Parser.normalize(type, d[type].rows, mapping);
      const res = await Config.setDataset(keyOf[type], Parser.slimRows(type, rows), 'נתוני דמו');
      if (!res.ok) throw new Error(res.error);
    }
    Object.entries(d.meta).forEach(([tz, m]) => {
      if (m.excludeFromBagrut && !Config.getException(tz).isException) {
        Config.setException(tz, { isException: true, overrideStatus: 'twelve', reason: m.coordinatorNote });
      }
    });
    return true;
  }

  return { generate, initMockDataIfEmpty };
})();

function initMockDataIfEmpty() { return MockData.initMockDataIfEmpty(); }
