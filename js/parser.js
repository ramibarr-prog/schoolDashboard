/* =====================================================================
   parser.js – קליטת קובצי Excel/CSV (מצבת / קבוצות / סדין ציונים / בגרות):
   זיהוי שורת כותרת, מיפוי עמודות אוטומטי ומאושר ע"י המשתמש, נרמול ת.ז,
   פענוח מחרוזות קבוצה ואירוע של משוב, ובדיקת התאמה למצבת העליונה.
   הערה: המילונים כוללים גם ניסוחים של קובצי המקור ("התלמיד"/"תלמידים")
   כדי שאפשר יהיה לזהות קבצי משוב אמיתיים; הממשק עצמו משתמש ב"חניכים".
   ===================================================================== */

const Parser = (() => {
  const hn = s => Util.stripQuotes(s).replace(/[.\-_()\[\]\s:]/g, '').toLowerCase();

  /** נרמול ת.ז: מקור יחיד ב-Util.normId */
  const normalizeTz = Util.normId;

  /** "שם מלא" ← שם פרטי (המילה הראשונה) ושם משפחה (השאר) */
  function splitFullName(value) {
    const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
  }

  /** אזהרת ת.ז בכתב מדעי (מ-CSV) שנאספה מאז האיפוס האחרון */
  function takeIdWarnings() {
    const n = Util.idWarn.sci;
    Util.idWarn.sci = 0;
    return n ? [`${n} שורות עם ת.ז בכתב מדעי (למשל 1.23457E+08) דולגו: הספרות אבדו בייצוא. יש לייצא את העמודה כטקסט.`] : [];
  }

  /* הגדרת שדות פנימיים + מילון מילים נרדפות (מנורמל ע"י hn) */
  const SCHEMA = {
    groups: {
      title: 'ייצוא קבוצות ורשימות (שחף / משוב)',
      fields: [
        { key: 'tz', label: 'ת.ז', req: true, syn: ['תז', 'תעודתזהות', 'מספרזהות', 'מזהה', 'תזחניך', 'תזתלמיד', 'תזהתלמיד', 'תזהחניך'] },
        { key: 'firstName', label: 'שם פרטי', syn: ['שםפרטי', 'פרטי'] },
        { key: 'lastName', label: 'שם משפחה', syn: ['שםמשפחה', 'משפחה'] },
        { key: 'grade', label: 'שכבה', syn: ['שכבה', 'שכבתלימוד'] },
        { key: 'classNum', label: 'כיתה', syn: ['כיתה', 'כיתהאם', 'כיתתאם'] },
        { key: 'groupId', label: 'מספר קבוצה', req: true, syn: ['מספרקבוצה', 'מזהקבוצה', 'קודקבוצה', 'קבוצה'] },
        { key: 'groupName', label: 'שם קבוצה / מקצוע', syn: ['שםקבוצה', 'שםמקצוע', 'מקצוע', 'תיאורקבוצה'] },
        { key: 'isTeacher', label: 'האם מורה (כן/לא)', syn: ['האםמורה', 'האםהואמורה', 'סוגמשתתף', 'תפקיד'] },
        { key: 'teacherName', label: 'שם המורה (בשורת חניך)', syn: ['מורה', 'שםהמורה', 'שםמורה', 'מורהמלמד', 'מלמד'] }
      ]
    },
    grades: {
      title: 'ציונים שוטפים (משוב – "הסדין")',
      fields: [
        { key: 'tz', label: 'ת.ז', req: true, syn: ['תזהתלמיד', 'תזהחניך', 'תז', 'תעודתזהות', 'מזהה'] },
        { key: 'name', label: 'שם החניך', syn: ['שםהתלמיד', 'שםהחניך', 'שםתלמיד', 'שםחניך', 'שם'] },
        { key: 'gender', label: 'מין', syn: ['מין'] },
        { key: 'grade', label: 'שכבה', syn: ['שכבה'] },
        { key: 'classNum', label: 'כיתה', syn: ['כיתה'] },
        { key: 'event', label: 'אירוע (משקל)', req: true, syn: ['אירועמשקל', 'אירוע', 'שםהאירוע'] },
        { key: 'date', label: 'תאריך האירוע', syn: ['תאריךהאירוע', 'תאריך'] },
        { key: 'score', label: 'ציון מספרי', req: true, syn: ['ציוןמספרי', 'ציוןשוטף', 'ציון'] },
        { key: 'group', label: 'קבוצה', req: true, syn: ['קבוצה', 'שםקבוצה'] }
      ]
    },
    bagrut: {
      title: 'ציוני בגרות / שאלונים (רשימה שטוחה: שורה לכל חניך × שאלון × מועד)',
      fields: [
        { key: 'tz', label: 'ת.ז', req: true, syn: ['תז', 'תעודתזהות', 'תזהתלמיד', 'תזהחניך', 'מזהה'] },
        { key: 'name', label: 'שם', syn: ['שםהתלמיד', 'שםהחניך', 'שםמלא', 'שם'] },
        { key: 'grade', label: 'שכבה', syn: ['שכבה', 'כיתה'] },
        { key: 'subject', label: 'שם מקצוע', syn: ['שםמקצוע', 'מקצוע'] },
        { key: 'questionnaireCode', label: 'סמל שאלון', req: true, syn: ['סמלשאלון', 'קודשאלון', 'שאלון', 'סמל'] },
        { key: 'submissionGrade', label: 'ציון הגשה / מגן', syn: ['ציוןהגשה', 'ציוןמגן', 'ציוןשנתי', 'הגשה', 'מגן', 'שנתי'] },
        { key: 'examGrade', label: 'ציון בחינה', syn: ['ציוןבחינה', 'בחינה', 'ציוןבגרות'] },
        { key: 'finalGrade', label: 'ציון סופי בשאלון', syn: ['ציוןסופיבשאלון', 'ציוןסופי', 'סופי', 'ציוןמסכם', 'ציון'] },
        { key: 'moed', label: 'מועד / שנה', syn: ['מועד', 'מועדבחינה', 'שנה', 'שנתבחינה'] }
      ]
    },
    roster: {
      title: 'מצבת חניכים (מקור אמת לכיתות אם)',
      fields: [
        { key: 'tz', label: 'ת.ז', req: true, syn: ['תז', 'תעודתזהות', 'מספרזהות'] },
        { key: 'firstName', label: 'שם פרטי', syn: ['שםפרטי'] },
        { key: 'lastName', label: 'שם משפחה', syn: ['שםמשפחה'] },
        { key: 'fullName', label: 'שם מלא (במקום פרטי ומשפחה)', syn: ['שםמלא', 'שםהחניך', 'שםהתלמיד', 'שםחניך', 'שםתלמיד'] },
        { key: 'grade', label: 'שכבה', syn: ['שכבה'] },
        { key: 'classNum', label: 'מקבילה / כיתה', req: true, syn: ['מקבילה', 'מספרכיתה', 'כיתהאם', 'כיתתאם', 'כיתה'] },
        { key: 'className', label: 'שם כיתה', syn: ['שםכיתה'] },
        { key: 'track', label: 'מסלול', syn: ['מסלול'] },
        { key: 'gender', label: 'מין', syn: ['מין'] }
      ]
    }
  };

  /* שמות סוג הקובץ בממשק ← מפתח הסכמה */
  const TYPE_ALIAS = { roster: 'roster', groups: 'groups', sadin: 'grades', grades: 'grades', bagrut: 'bagrut' };

  /* ---------- זיהוי שורת כותרת (בין 15 השורות הראשונות) ---------- */
  const SNIFF_WORDS = ['תז', 'שם', 'קבוצה', 'ציון', 'שאלון', 'כיתה', 'שכבה', 'אירוע', 'מקצוע', 'סמל'];

  /**
   * שורת כותרת "חזקה": באחת מ-10 השורות הראשונות יש תא "ת.ז" ובנוסף עמודת שם ("שם התלמיד" / "שם משפחה" ...).
   * כך קובצי משוב (כותרת קובץ בשורה 1, שורה ריקה, כותרות העמודות בשורה 3) מזוהים בוודאות.
   */
  function strongHeaderRow(aoa) {
    const limit = Math.min(10, aoa.length);
    for (let i = 0; i < limit; i++) {
      const cells = (aoa[i] || []).map(c => hn(c));
      if (cells.some(c => c === 'תז' || c === 'תעודתזהות') && cells.some(c => c.startsWith('שם'))) return i;
    }
    return -1;
  }

  function sniffHeader(aoa) {
    const strong = strongHeaderRow(aoa);
    if (strong >= 0) return { idx: strong, score: 99 };
    let best = { idx: 0, score: -1 };
    const limit = Math.min(15, aoa.length);
    for (let i = 0; i < limit; i++) {
      const cells = (aoa[i] || []).map(c => hn(c)).filter(Boolean);
      if (cells.length < 2) continue;
      const score = cells.filter(c => SNIFF_WORDS.some(w => c.includes(w))).length;
      if (score > best.score) best = { idx: i, score };
    }
    return best.score < 0 ? { idx: 0, score: 0 } : best;
  }

  function headerNames(row) {
    const seen = {};
    return (row || []).map((h, i) => {
      let name = String(h ?? '').trim() || `עמודה ${i + 1}`;
      if (seen[name]) { seen[name]++; name = `${name} (${seen[name]})`; } else seen[name] = 1;
      return name;
    });
  }

  function buildTable(aoa, idx) {
    const headers = headerNames(aoa[idx]);
    const rows = [];
    for (let r = idx + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      if (!row.some(c => String(c ?? '').trim() !== '')) continue;
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      rows.push(obj);
    }
    return { headers, rows, headerRow: idx + 1 };
  }

  /* ---------- קריאת קובץ ---------- */
  function readWorkbook(buf, fileName) {
    if (typeof XLSX === 'undefined') throw new Error('ספריית SheetJS לא נטענה (בדוק חיבור לאינטרנט).');
    if (/\.(csv|txt|tsv)$/i.test(fileName)) {
      /* מפענחים את הקידוד העברי בעצמנו ומעבירים ל-SheetJS כ-UTF-8 */
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('\uFFFD')) text = new TextDecoder('windows-1255').decode(buf);
      /* raw: ערכי ה-CSV נשארים טקסט (ת.ז עם אפסים מובילים או בכתב מדעי לא הופכות למספר בשקט) */
      return XLSX.read(new TextEncoder().encode(text), { type: 'array', cellStyles: false, codepage: 65001, raw: true });
    }
    // קבצי משוב לעיתים כוללים styles.xml פגום – cellStyles:false חובה
    return XLSX.read(buf, { type: 'array', cellStyles: false, cellFormula: false });
  }

  /** גיליון הנתונים הסביר ביותר בחוברת (לפי זיהוי שורת הכותרת, ובשוויון – הגדול ביותר) */
  function pickBestSheet(wb) {
    let best = null;
    const nonEmptySheets = [];
    wb.SheetNames.forEach(name => {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      if (!aoa.some(row => row.some(value => String(value ?? '').trim()))) return;
      nonEmptySheets.push(name);
      const { idx, score } = sniffHeader(aoa);
      if (!best || score > best.score || (score === best.score && aoa.length > best.aoa.length)) best = { name, aoa, idx, score };
    });
    if (!best) throw new Error(`לא נמצאו נתונים בגיליונות: ${wb.SheetNames.map(name => `"${name}"`).join(', ')}.`);
    return { ...best, skippedSheets: nonEmptySheets.filter(name => name !== best.name) };
  }

  async function readFile(file) {
    const wb = readWorkbook(await file.arrayBuffer(), file.name);
    const best = pickBestSheet(wb);
    const table = buildTable(best.aoa, best.idx);
    table.sheetName = best.name;
    table.fileName = file.name;
    table.aoa = best.aoa;
    table.headerIdx = best.idx;
    table.warnings = best.skippedSheets.length
      ? [`יובא רק הגיליון "${best.name}". גיליונות נוספים עם נתונים לא יובאו: ${best.skippedSheets.map(name => `"${name}"`).join(', ')}.`]
      : [];
    return table;
  }

  /* ---------- מצבת (גיליון לכל שכבה) ---------- */
  function rosterHeader(aoa) {
    const aliases = {
      tz: ['תז', 'תעודתזהות', 'מספרזהות'],
      firstName: ['שםפרטי'],
      lastName: ['שםמשפחה'],
      fullName: ['שםמלא', 'שםהחניך', 'שםהתלמיד', 'שםחניך', 'שםתלמיד'],
      grade: ['שכבה', 'כיתה'],
      classNum: ['מקבילה', 'מספרכיתה', 'כיתהאם', 'כיתתאם'],
      className: ['שםכיתה'],
      track: ['מסלול'],
      gender: ['מין']
    };
    const limit = Math.min(20, aoa.length);
    for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
      const columns = {};
      (aoa[rowIndex] || []).forEach((value, colIndex) => {
        const header = hn(value);
        Object.entries(aliases).forEach(([key, names]) => {
          if (columns[key] === undefined && names.includes(header)) columns[key] = colIndex;
        });
      });
      const hasName = (columns.firstName !== undefined && columns.lastName !== undefined) || columns.fullName !== undefined;
      if (columns.tz !== undefined && hasName && (columns.classNum !== undefined || columns.grade !== undefined)) return { rowIndex, columns };
    }
    return null;
  }

  /**
   * שכבה לפי שם הגיליון או שורת כותרת עליונה (מעל כותרות העמודות) בצורה "שכבה X".
   * null – אין תווית; { gradeKey: '' } – שכבה מוצהרת שאינה נתמכת (למשל ז'), כדי שהגיליון
   * לא יזוהה בטעות לפי טקסט של כותרות העמודות (למשל "פרטי" ← י).
   */
  function gradeFromSheet(name, aoa, headerIndex) {
    const labeled = value => {
      const m = Util.stripQuotes(value).match(/(?:^|[^א-ת])שכבה\s*([א-ת]{1,2}|\d{1,2})(?![א-ת\d])/);
      return m ? { gradeKey: Util.normGrade(m[1]) } : null;
    };
    const bare = Util.stripQuotes(name).trim();
    const fromName = labeled(name) || (/^(יב|יא|י|ט|ח|ז|12|11|10|9|8|7)$/.test(bare) ? { gradeKey: Util.normGrade(bare) } : null);
    if (fromName) return fromName;
    for (const row of aoa.slice(0, Math.max(0, headerIndex))) {
      for (const value of row || []) {
        const found = labeled(value);
        if (found) return found;
      }
    }
    return null;
  }

  /** כותרת מצבת לפי מיפוי שנבחר ידנית (שדה ← שם כותרת העמודה) */
  function rosterHeaderFromMapping(aoa, mapping) {
    if (!mapping || !mapping.tz) return null;
    const limit = Math.min(20, aoa.length);
    for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
      const names = headerNames(aoa[rowIndex]);
      const columns = {};
      Object.entries(mapping).forEach(([key, name]) => { const i = names.indexOf(name); if (i >= 0) columns[key] = i; });
      if (columns.tz !== undefined && (columns.classNum !== undefined || columns.grade !== undefined)) return { rowIndex, columns };
    }
    return null;
  }

  /** חלון מיפוי עמודות למצבת, על בסיס הגיליון הסביר ביותר; המיפוי שנבחר נשמר ומשמש בכל הגיליונות */
  async function confirmRosterMapping(wb) {
    const best = pickBestSheet(wb);
    const table = buildTable(best.aoa, best.idx);
    return openMappingModal('roster', table, autoMap('roster', table.headers));
  }

  /** קורא מצבת. מחזיר שורות בפורמט המצבת העליונה: tz, firstName, lastName, grade, homeroom, className, track */
  async function readRosterFile(file, opts = {}) {
    const wb = readWorkbook(await file.arrayBuffer(), file.name);
    let override = null;
    if (opts.confirmMapping) {
      override = await confirmRosterMapping(wb);
      if (!override) return null;
    }
    const warnings = [];
    let res = extractRoster(wb, file, override, warnings);
    /* כותרות המצבת לא זוהו אוטומטית: במקום להיכשל נפתח אשף מיפוי העמודות */
    if (!res && !override) {
      override = await confirmRosterMapping(wb);
      if (!override) return null;
      warnings.length = 0;
      res = extractRoster(wb, file, override, warnings);
    }
    if (!res) throw new Error(`לא נמצאו גיליונות מצבת. יש לוודא שכותרות ת.ז, שם (פרטי ומשפחה או שם מלא) וכיתה קיימות. ${warnings.join(' ')}`);
    return res;
  }

  /** מחזיר null כשלא זוהתה כותרת מצבת באף גיליון */
  function extractRoster(wb, file, override, warnings) {
    Util.idWarn.sci = 0;
    const saved = override || Config.getMapping('roster');
    const rows = [], seenIds = new Map(), nameVotes = new Map(), sheets = [], ignoredSheets = [];
    const juniorIds = new Set(), juniorSheets = [];
    let skipped = 0, duplicates = 0, firstHeaderRow = null;

    wb.SheetNames.forEach(name => {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      const warn = reason => warnings.push(`הגיליון "${name}" לא נקלט במצבת: ${reason}.`);
      if (!aoa.some(row => row.some(value => String(value ?? '').trim()))) { warn('הגיליון ריק'); return; }
      const header = (override ? null : rosterHeader(aoa)) || rosterHeaderFromMapping(aoa, saved);
      if (!header) { warn('לא זוהו כותרות מצבת תקינות'); return; }
      const tab = gradeFromSheet(name, aoa, header.rowIndex);
      if (tab && !tab.gradeKey) { ignoredSheets.push(name); warn('השכבה המוצהרת אינה נתמכת'); return; }
      (tab && Util.isJunior(tab.gradeKey) ? juniorSheets : sheets).push(name);
      if (firstHeaderRow == null || header.rowIndex < firstHeaderRow) firstHeaderRow = header.rowIndex;
      const get = (row, key) => header.columns[key] === undefined ? '' : row[header.columns[key]];
      const before = rows.length;
      let nonEmptyRows = 0, juniorRows = 0, duplicateRows = 0;

      for (let i = header.rowIndex + 1; i < aoa.length; i++) {
        const row = aoa[i] || [];
        if (!row.some(value => String(value ?? '').trim())) continue;
        nonEmptyRows++;
        const tz = normalizeTz(get(row, 'tz'));
        const gradeKey = tab ? tab.gradeKey : Util.normGrade(get(row, 'grade'));
        let cls = Util.parseClass(gradeKey, get(row, 'classNum'));
        /* עמודה אחת בלבד של כיתה (למשל "יב3") ללא מקבילה נפרדת */
        if (!cls.num && header.columns.classNum === undefined) cls = Util.parseClass('', get(row, 'grade'));
        /* חניכי ז-ט אינם נקלטים; ה-ת.ז שלהם נשמרת רק כדי להתעלם מהם בקובצי המשנה */
        if (tz && Util.isJunior(cls.gradeKey)) { juniorIds.add(tz); juniorRows++; continue; }
        if (!tz || !cls.gradeKey || !cls.num) { skipped++; continue; }

        const where = `גיליון "${name}" שורה ${i + 1}`;
        let names = { firstName: String(get(row, 'firstName') ?? '').trim(), lastName: String(get(row, 'lastName') ?? '').trim() };
        if (!names.firstName && !names.lastName && header.columns.fullName !== undefined) names = splitFullName(get(row, 'fullName'));
        const record = {
          tz, ...names,
          grade: cls.gradeKey, homeroom: cls.classKey,
          className: String(get(row, 'className') ?? '').trim(), track: String(get(row, 'track') ?? '').trim()
        };
        const previous = seenIds.get(tz);
        if (previous) {
          if (previous.record.homeroom !== record.homeroom) {
            throw new Error(`ת.ז ${tz} מופיעה במצבת ביותר מכיתת אם אחת: ${previous.record.homeroom} (${previous.where}) ו-${record.homeroom} (${where}).`);
          }
          duplicates++;
          duplicateRows++;
          continue;
        }
        seenIds.set(tz, { record, where });
        if (record.className) {
          if (!nameVotes.has(record.homeroom)) nameVotes.set(record.homeroom, new Map());
          const votes = nameVotes.get(record.homeroom);
          if (!votes.has(record.className)) votes.set(record.className, { count: 0, where });
          votes.get(record.className).count++;
        }
        rows.push(record);
      }
      if (rows.length === before) {
        if (!nonEmptyRows) warn('לא נמצאו שורות נתונים אחרי הכותרת');
        else if (juniorRows === nonEmptyRows) warn('חניכי ז-ט אינם נכללים במצבת התיכון');
        else if (duplicateRows === nonEmptyRows) warn('כל החניכים כבר הופיעו בגיליון אחר באותה כיתה');
        else warn('לא נמצאו חניכי תיכון תקינים עם ת.ז, שכבה וכיתת אם');
      }
    });

    if (!sheets.length && !juniorSheets.length) return null;
    if (!rows.length) throw new Error(`לא נמצאו חניכי תיכון (י-יב) בגיליונות המצבת. ${warnings.join(' ')}`);

    /* שם כיתה סותר אינו חוסם את הייבוא: נבחר השם השכיח ונדווח על הסתירה */
    const chosen = new Map();
    nameVotes.forEach((votes, homeroom) => {
      const ranked = [...votes.entries()].sort((a, b) => b[1].count - a[1].count);
      chosen.set(homeroom, ranked[0][0]);
      if (ranked.length > 1) {
        warnings.push(`כיתה ${homeroom}: נמצאו כמה שמות (${ranked.map(([n, v]) => `"${n}" – ${v.count} חניכים, ${v.where}`).join(' | ')}). נבחר "${ranked[0][0]}".`);
      }
    });
    rows.forEach(r => { r.className = chosen.get(r.homeroom) || ''; });
    warnings.push(...takeIdWarnings());
    const ignoredIds = [...juniorIds].filter(tz => !seenIds.has(tz));
    return { rows, skipped, duplicates, sheets, ignoredSheets, ignoredIds, warnings, headerRow: firstHeaderRow + 1, fileName: file.name };
  }

  /**
   * עמודת "מורה" עם ערכי כן/לא בלבד היא דגל "האם מורה"; עמודה עם שמות היא שם המורה בשורות החניכים.
   * ההכרעה לפי תוכן העמודה, כי הכותרת זהה בשני המקרים.
   */
  function reclassifyTeacherColumn(map, rows) {
    const col = map.teacherName;
    if (!col || map.isTeacher) return;
    const values = rows.slice(0, 500).map(r => String(r[col] ?? '').trim()).filter(Boolean);
    const flag = /^(0|1|כן|לא|true|false|yes|no|y|n|v|✓|-|מורה|תלמיד|חניך|חניכה)$/i;
    if (values.length && values.every(v => flag.test(Util.stripQuotes(v)))) {
      map.isTeacher = col;
      delete map.teacherName;
    }
  }

  /* ---------- מיפוי עמודות אוטומטי (פרופיל שמור + מילון נרדפות) ---------- */
  function autoMap(type, headers, rows) {
    const fields = SCHEMA[type].fields;
    const saved = Config.getMapping(type) || {};
    const map = {}, used = new Set();
    const hs = headers.map(hn);
    fields.forEach(f => {
      if (saved[f.key] && headers.includes(saved[f.key]) && !used.has(saved[f.key])) {
        map[f.key] = saved[f.key]; used.add(saved[f.key]);
      }
    });
    const pass = test => fields.forEach(f => {
      if (map[f.key]) return;
      for (let i = 0; i < headers.length; i++) {
        if (used.has(headers[i])) continue;
        if (f.syn.some(s => test(hs[i], hn(s)))) { map[f.key] = headers[i]; used.add(headers[i]); return; }
      }
    });
    pass((h, s) => h === s);
    pass((h, s) => s.length >= 3 && h.includes(s));
    if (type === 'groups' && rows) reclassifyTeacherColumn(map, rows);
    return map;
  }

  function missingRequired(type, mapping) {
    const missing = SCHEMA[type].fields.filter(f => f.req && !mapping[f.key]).map(f => f.label);
    /* בבגרות לפחות אחד מעמודות הציון (סופי / הגשה / בחינה) חייב להיות ממופה */
    if (type === 'bagrut' && !(mapping.finalGrade || mapping.submissionGrade || mapping.examGrade)) {
      missing.push('ציון סופי / הגשה / בחינה (לפחות אחד)');
    }
    if (type === 'roster' && !(mapping.firstName && mapping.lastName) && !mapping.fullName) {
      missing.push('שם פרטי + שם משפחה, או שם מלא');
    }
    return missing;
  }

  /* ---------- פענוח ערכים ---------- */
  const FAIL_RE = /לא עמד|לא עבר|לא ניגש|לא הוגש|חסם|פסילה|(^|\s)ח\.?\s?ד(\s|$)/;
  const PASS_RE = /בוצע|עמד בדרישות|עבודה עיונית|(^|[^א-ת])(עבר|עברה|השלים|השלימה)(?![א-ת])/;
  const EXEMPT_RE = /(^|[^א-ת])פטור(?![א-ת])/;

  /** סיווג ערך ציון: מספר / עבר / לא עבר-חסר / ריק. "חסם" מסומן ב-block כדי להציגו כחסם בגרות */
  function classify(v) {
    if (v == null || String(v).trim() === '') return { kind: 'none' };
    const s = String(v).trim();
    const n = Util.parseScore(v);
    if (n !== null) return EXEMPT_RE.test(s) ? { kind: 'num', num: n, exempt: true } : { kind: 'num', num: n };
    if (FAIL_RE.test(s)) return /חסם/.test(s) ? { kind: 'fail', block: true } : { kind: 'fail' };
    if (EXEMPT_RE.test(s)) return { kind: 'pass', exempt: true };
    if (PASS_RE.test(s)) return { kind: 'pass' };
    return { kind: 'none' };
  }

  /**
   * "ספרות יב1-יב4 רמי בר [1042] (29 תלמידים)" ←
   * { groupId: '1042', declaredCount: 29, subject: 'ספרות', teacher: 'רמי בר', targetClasses: 'יב1-יב4' }
   * רשימת הכיתות יכולה להיות עם מקף, פסיקים ("יא1,יא2") או רווח בין השכבה למספר ("י"ב 1").
   */
  const CLASS_TOKEN = '(?:י["״\'׳]?[אב]|[זחטי])\\s?\\d+';
  const CLASSES_RE = new RegExp(`(?:^|\\s)(${CLASS_TOKEN}(?:\\s*[,،/]\\s*${CLASS_TOKEN}|\\s*[-–]\\s*(?:${CLASS_TOKEN}|\\d+))*)(?=\\s|$)`);

  /** תחילית "מג'" / "מגמת" מסמנת קבוצת מגמה ואינה חלק משם המקצוע */
  const MAJOR_PREFIX_RE = /^מג(?:['׳’]|מת|מה)?\s+/;
  const FIXED_MULTIWORD = ['חינוך גופני', 'מדעי המחשב', 'מבוא למדעים', 'מפגש בוקר', 'אמנות חזותית', 'אמנות שימושית'];

  /** שם מקצוע קנוני: "תנך" ← "תנ"ך", "מדעים" ← "מבוא למדעים" */
  function canonSubject(subject) {
    return String(subject || '')
      .replace(/(^|\s)תנך(?=\s|$)/g, '$1תנ"ך')
      .replace(/(^|\s)מדעים(?=\s|$)/g, '$1מבוא למדעים')
      .trim();
  }

  /** כשאין רשימת כיתות במחרוזת (כותרות סדין): המילה הראשונה היא המקצוע, אלא אם היא פותחת מקצוע מרובה מילים מוכר */
  function splitSubjectTeacher(body) {
    const known = new Set(FIXED_MULTIWORD);
    try {
      const rules = Config.rules();
      [...rules.coreSubjects, ...rules.majors].forEach(s => (s.keywords || []).forEach(k => { if (/\s/.test(k.trim())) known.add(k.trim()); }));
    } catch (e) { /* ללא כללים – רשימת ברירת המחדל בלבד */ }
    const knownSubject = [...known].sort((a, b) => b.length - a.length).find(k => body.startsWith(k + ' '));
    const base = knownSubject || (body.match(/^\S+/) || [''])[0];
    let subject = base, rest = body.slice(base.length).trim();
    const level = rest.match(/^(?:[1-5]\s*(?:יח["״'׳]?ל|יחידות)|רמה\s*[1-5]|מצטיינים|הקבצה\s*א["״'׳]?)(?=\s|$)/);
    if (level) { subject += ' ' + level[0]; rest = rest.slice(level[0].length).trim(); }
    return { subject, teacher: rest };
  }

  function parseGroupString(str) {
    const raw = String(str ?? '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
    const out = { groupId: '', declaredCount: null, subject: '', teacher: '', targetClasses: '', major: false };
    if (!raw) return out;
    const id = raw.match(/\[(\d+)\]/);
    if (id) out.groupId = id[1];
    const cnt = raw.match(/\((\d+)\s*(?:תלמידים|תלמידות|תלמיד|חניכים|חניכות|חניך|משתתפים)\s*\)/);
    if (cnt) out.declaredCount = +cnt[1];
    let body = raw.replace(/\[\d+\]/, '').replace(/\(\s*\d+\s*[^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
    if (MAJOR_PREFIX_RE.test(body)) { out.major = true; body = body.replace(MAJOR_PREFIX_RE, ''); }
    const tok = body.match(CLASSES_RE);
    if (tok) {
      out.targetClasses = tok[1].replace(/\s+/g, '').replace(/["״'׳]/g, '');
      const at = tok.index + tok[0].length - tok[1].length;
      out.subject = body.slice(0, at).trim();
      out.teacher = body.slice(tok.index + tok[0].length).trim();
    } else if (id) {
      Object.assign(out, splitSubjectTeacher(body));
    } else {
      out.subject = body;
    }
    out.subject = canonSubject(out.subject);
    return out;
  }

  /** "מבחן הסיפור הקצר (15)" ← { eventName: 'מבחן הסיפור הקצר', weight: 15 } */
  function parseEventString(str) {
    const raw = String(str ?? '').trim();
    const m = raw.match(/^(.*?)\s*\((\d+(?:\.\d+)?)\)\s*$/);
    return m ? { eventName: m[1].trim(), weight: parseFloat(m[2]) } : { eventName: raw, weight: 1 };
  }

  /** ערך מפורש בלבד: כן / true / 1 / ערך תפקיד "מורה". שם של מורה או כל טקסט אחר אינם מסמנים שורת מורה */
  function truthyTeacher(v) {
    if (v === true || v === 1) return true;
    if (v === false || v == null) return false;
    const s = Util.stripQuotes(v).trim().toLowerCase();
    return /^(1|כן|true|yes|y|v|✓|מורה|מורה מלמד|מחנך|מחנכת|מלמד|מרצה)$/.test(s);
  }

  /**
   * ציון שאלון ממועד אחד – היררכיית האמת:
   *  א. ציון סופי בשאלון, אם קיים;
   *  ב. אחרת, כשיש גם הגשה (מגן) וגם בחינה: Math.round(הגשה × W + בחינה × (1-W)), כש-W הוא משקל המגן של השאלון
   *     במחזור (Config.magenWeight(code, rules): דריסה ברכיב / בקטלוג, אחרת ברירת המחדל של המחזור – 30%), derived = true;
   *  ג. אחרת ציון בודד (בחינה או הגשה) – מסומן partial, כדי שהמנוע יוכל להשלים מגן חסר מציון שוטף.
   */
  function roundWeightedScore(submission, exam, weight) {
    return Math.round(+(submission * weight + exam * (1 - weight)).toFixed(6));
  }

  function resolveAttempt(fin, exam, sub, code, rules) {
    const f = classify(fin);
    if (f.kind !== 'none') return { cls: f, shown: String(fin).trim(), derived: false, partial: '' };
    for (const v of [exam, sub]) {
      if (classify(v).exempt) return { cls: { kind: 'pass', exempt: true }, shown: String(v).trim(), derived: false, partial: '' };
    }
    const e = Util.parseScore(exam), s = Util.parseScore(sub);
    if (e !== null && s !== null) {
      const w = Config.magenWeight(code, rules) / 100;
      const num = roundWeightedScore(s, e, w);
      return { cls: { kind: 'num', num }, shown: String(num), derived: true, partial: '' };
    }
    for (const [v, partial] of [[exam, 'exam'], [sub, 'magen']]) {
      const c = classify(v);
      if (c.kind !== 'none') return { cls: c.kind === 'num' || c.kind === 'pass' ? { kind: 'none' } : c,
        shown: String(v).trim(), derived: false, partial: c.kind === 'num' || c.kind === 'pass' ? partial : '' };
    }
    return { cls: { kind: 'none' }, shown: '', derived: false, partial: '' };
  }

  /* ---------- נרמול שורות לפי סוג קובץ ---------- */
  function normalize(type, rows, mapping) {
    const get = (r, k) => (mapping[k] ? r[mapping[k]] : '');
    const out = [];
    let skipped = 0;

    rows.forEach(r => {
      if (type === 'groups') {
        const gidCell = get(r, 'groupId');
        const composite = parseGroupString(gidCell);
        const numericId = String(gidCell ?? '').trim();
        const groupId = composite.groupId || (/^\d+$/.test(numericId) ? numericId : '');
        const isTeacher = truthyTeacher(get(r, 'isTeacher'));
        const tz = normalizeTz(get(r, 'tz'));
        if (!groupId || (!tz && !isTeacher)) { skipped++; return; }
        const cls = Util.parseClass(get(r, 'grade'), get(r, 'classNum'));
        /* כשהמחרוזת המלאה של משוב נמצאת בעמודת הקבוצה ואין שם קבוצה נפרד, היא משמשת כשם הקבוצה (מקצוע ומורה) */
        const groupName = String(get(r, 'groupName') ?? '').trim() || (composite.groupId ? String(gidCell).trim() : '');
        const teacherName = String(get(r, 'teacherName') ?? '').trim();
        out.push({
          tz, firstName: String(get(r, 'firstName') ?? '').trim(), lastName: String(get(r, 'lastName') ?? '').trim(),
          gradeKey: cls.gradeKey, classNum: cls.num, classKey: cls.classKey,
          groupId, groupName, isTeacher, ...(teacherName && !isTeacher ? { teacherName } : {})
        });
      } else if (type === 'grades') {
        const tz = normalizeTz(get(r, 'tz'));
        if (!tz) { skipped++; return; }
        const cls = Util.parseClass(get(r, 'grade'), get(r, 'classNum'));
        const ev = parseEventString(get(r, 'event'));
        const grp = parseGroupString(get(r, 'group'));
        const sv = get(r, 'score');
        out.push({
          tz, name: String(get(r, 'name') ?? '').trim(), gender: String(get(r, 'gender') ?? '').trim(),
          gradeKey: cls.gradeKey, classNum: cls.num, classKey: cls.classKey,
          eventName: ev.eventName, weight: ev.weight, date: Util.parseDate(get(r, 'date')),
          score: Util.parseScore(sv), scoreRaw: sv,
          groupId: grp.groupId, subject: grp.subject, teacher: grp.teacher,
          declaredCount: grp.declaredCount, targetClasses: grp.targetClasses
        });
      } else if (type === 'bagrut') {
        /* שורה שטוחה: חניך × שאלון × מועד. כל הניסיונות נשמרים; הציון הגבוה ביותר לכל סמל נבחר ב-Store.bestOf */
        const tz = normalizeTz(get(r, 'tz'));
        const code = Util.normQuestionnaireCode(String(get(r, 'questionnaireCode')).trim().replace(/\.0+$/, '').replace(/\D/g, ''));
        if (!tz || !code) { skipped++; return; }
        const submission = get(r, 'submissionGrade'), exam = get(r, 'examGrade'), fin = get(r, 'finalGrade');
        const res = resolveAttempt(fin, exam, submission, code);
        const g = Util.parseClass(get(r, 'grade'), '');
        out.push({
          tz, name: String(get(r, 'name') ?? '').trim(), gradeKey: g.gradeKey,
          subject: String(get(r, 'subject') ?? '').trim(), code, questionnaireCode: code,
          submission: String(submission ?? '').trim(), exam: String(exam ?? '').trim(), final: String(fin ?? '').trim(),
          moed: String(get(r, 'moed') ?? '').trim(), cls: res.cls, shown: res.shown, scoreRaw: res.shown, derived: res.derived, partial: res.partial
        });
      }
    });
    return { rows: out, skipped };
  }

  /* ---------- פורמט "מטריצה רחבה" של משוב (קבוצות לימוד / סדין / בגרות) ---------- */
  const isBlank = v => v === '' || v == null || String(v).trim() === '';
  const isMark = v => v === 1 || v === true || /^(x|1|כן|v|✓)$/i.test(String(v ?? '').trim());
  const cleanLine = s => String(s ?? '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim();

  /** אינדקסי עמודות קבועות לפי כותרת (ת.ז, שם, שכבה, כיתה/מקבילה, מגמה) */
  function fixedCols(headerRow) {
    const col = {};
    (headerRow || []).forEach((c, i) => {
      const k = hn(c);
      if ((k === 'תז' || k === 'תעודתזהות') && col.tz === undefined) col.tz = i;
      else if (/^שם(התלמיד|החניך)?$/.test(k) && col.name === undefined) col.name = i;
      else if (k === 'שכבה' && col.grade === undefined) col.grade = i;
      else if ((k === 'כיתה' || k === 'מקבילה') && col.cls === undefined) col.cls = i;
      else if (k === 'מגמה' && col.major === undefined) col.major = i;
    });
    return col;
  }

  /** מזהה את סוג המטריצה הרחבה לפי כותרות העמודות: 'groups' | 'grades' | 'bagrut' | null */
  function detectWide(aoa, headerIdx) {
    const cells = (aoa[headerIdx] || []).map(c => String(c ?? ''));
    const count = fn => cells.filter(fn).length;
    if (count(c => { const lines = c.split(/\r?\n/).map(cleanLine).filter(Boolean); return lines.length >= 3 && /\(\d+\)\s*$/.test(lines[0]); }) >= 1) return 'bagrut';
    if (count(c => /\n/.test(c) && /משקל\s*[\d.]+\s*$/.test(c.trim()) && /\[\d+\]/.test(c)) >= 1) return 'grades';
    if (count(c => !/\n/.test(c) && /\[\d+\]\s*$/.test(c.trim())) >= 3) return 'groups';
    return null;
  }

  /** שורות נתונים של חניכים (עם ת.ז); שורות סיכום בתחתית ("מס' בנים"...) נדלגות */
  function wideStudents(aoa, headerIdx, col) {
    const out = [];
    for (let r = headerIdx + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const tz = normalizeTz(row[col.tz]);
      if (!tz) continue;
      const cls = Util.parseClass(row[col.grade], row[col.cls]);
      out.push({ row, tz, cls, name: cleanLine(row[col.name]), major: col.major === undefined ? '' : cleanLine(row[col.major]) });
    }
    return out;
  }

  /** "קבוצות לימוד": עמודה לכל קבוצה, "X" בתא = שיבוץ. כל סימון הופך לרשומת שיבוץ */
  function parseWideGroups(aoa, headerIdx) {
    const header = aoa[headerIdx] || [];
    const col = fixedCols(header);
    const groupCols = [];
    header.forEach((c, i) => {
      const raw = cleanLine(c);
      if (/\n/.test(String(c ?? '')) || !/\[\d+\]$/.test(raw)) return;
      const p = parseGroupString(raw);
      if (p.groupId) groupCols.push({ i, raw, p });
    });
    const rows = [];
    wideStudents(aoa, headerIdx, col).forEach(s => {
      groupCols.forEach(g => {
        if (!isMark(s.row[g.i])) return;
        rows.push({
          tz: s.tz, studentName: s.name, firstName: '', lastName: '',
          grade: s.cls.gradeKey, homeroom: s.cls.classKey, gradeKey: s.cls.gradeKey, classNum: s.cls.num, classKey: s.cls.classKey,
          majorName: s.major, groupId: g.p.groupId, groupName: g.raw, rawGroupName: g.raw,
          subject: g.p.subject, teacher: g.p.teacher, isTeacher: false
        });
      });
    });
    return { rows, skipped: 0 };
  }

  /** "ציונים שוטפים – סדין": עמודה לכל אירוע (3 שורות בכותרת). תא ריק = אין רשומה (החמצה מוסקת ב-Store לפי שיבוץ) */
  function parseWideGrades(aoa, headerIdx) {
    const header = aoa[headerIdx] || [];
    const col = fixedCols(header);
    const eventCols = [];
    header.forEach((c, i) => {
      const lines = String(c ?? '').split(/\r?\n/).map(cleanLine).filter(Boolean);
      if (lines.length < 2) return;
      const group = parseGroupString(lines[0]);
      if (!group.groupId) return;
      let weight = 1, middle = lines.slice(1);
      const last = middle[middle.length - 1];
      const wm = last && last.match(/^משקל\s*([\d.]+)$/);
      if (wm) { weight = parseFloat(wm[1]); middle = middle.slice(0, -1); }
      const title = middle.join(' ');
      const dm = title.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*$/);
      eventCols.push({
        i, group, weight, eventName: (dm ? title.slice(0, dm.index) : title).trim(), date: dm ? Util.parseDate(dm[1]) : ''
      });
    });
    const rows = [];
    wideStudents(aoa, headerIdx, col).forEach(s => {
      eventCols.forEach(e => {
        const v = s.row[e.i];
        if (isBlank(v)) return;
        const score = Util.parseScore(v);
        rows.push({
          tz: s.tz, name: s.name, gender: '', gradeKey: s.cls.gradeKey, classNum: s.cls.num, classKey: s.cls.classKey,
          groupId: e.group.groupId, subject: e.group.subject, teacher: e.group.teacher,
          eventName: e.eventName, date: e.date, eventDate: e.date, weight: e.weight,
          score, scoreRaw: typeof v === 'number' ? v : String(v).trim(), declaredCount: null, targetClasses: ''
        });
      });
    });
    return { rows, skipped: 0 };
  }

  /** "ציון הגשה לבגרות, בחינה וסופי": 3 עמודות (מגן / בחינה / סופי) לכל שאלון × מועד, מאוחדות לרשומה אחת לחניך */
  function parseWideBagrut(aoa, headerIdx) {
    const header = aoa[headerIdx] || [];
    const col = fixedCols(header);
    const TYPE = [[/סופי/, 'final'], [/שנתי|מגן|הגשה/, 'submission'], [/בחינה/, 'exam']];
    const cols = [], warnings = [];
    header.forEach((c, i) => {
      const lines = String(c ?? '').split(/\r?\n/).map(cleanLine).filter(Boolean);
      if (lines.length < 3) return;
      const code = Util.normQuestionnaireCode((lines[0].match(/\((\d+)\)\s*$/) || [])[1]);
      const type = (TYPE.find(([re]) => re.test(lines[2])) || [])[1];
      if (!code) return;
      if (!type) { warnings.push(`עמודת בגרות דולגה עקב כותרת ציון לא מזוהה: "${lines.join(' · ')}".`); return; }
      const moed = lines[1].match(/^(.*?)\s*\((\d+)\)\s*$/);
      cols.push({
        i, code, type, moed: moed ? moed[1].trim() : lines[1], moedCode: moed ? moed[2] : lines[1],
        subject: lines[0].replace(/\s*\(\d+\)\s*$/, '').replace(/\s*\((?:הערכה|הערכת)[^)]*\)\s*$/, '').trim()
      });
    });
    const rows = [];
    wideStudents(aoa, headerIdx, col).forEach(s => {
      const attempts = new Map();
      cols.forEach(c => {
        const v = s.row[c.i];
        if (isBlank(v)) return;
        const key = `${c.code}|${c.moedCode}`;
        if (!attempts.has(key)) attempts.set(key, { c, submission: '', exam: '', final: '' });
        attempts.get(key)[c.type] = v;
      });
      attempts.forEach(a => {
        const res = resolveAttempt(a.final, a.exam, a.submission, a.c.code);
        rows.push({
          tz: s.tz, name: s.name, gradeKey: s.cls.gradeKey, classKey: s.cls.classKey,
          subject: a.c.subject, code: a.c.code, questionnaireCode: a.c.code,
          submission: String(a.submission ?? '').trim(), exam: String(a.exam ?? '').trim(), final: String(a.final ?? '').trim(),
          moed: a.c.moed, moedCode: a.c.moedCode, cls: res.cls, shown: res.shown, scoreRaw: res.shown, derived: res.derived, partial: res.partial
        });
      });
    });
    return { rows, skipped: 0, warnings };
  }

  const WIDE_PARSERS = { groups: parseWideGroups, grades: parseWideGrades, bagrut: parseWideBagrut };
  const WIDE_LABEL = { groups: 'קבוצות לימוד', grades: 'ציונים שוטפים', bagrut: 'ציוני בגרות' };

  /** שומר רק את השדות הנדרשים לניתוח, כדי לצמצם את נפח האחסון */
  function slimRows(type, rows) {
    const pickFields = fields => r => Object.fromEntries(fields.map(f => [f, r[f]]));
    const slim = {
      groups: pickFields(['tz', 'firstName', 'lastName', 'studentName', 'gradeKey', 'classKey', 'majorName', 'groupId', 'groupName', 'subject', 'teacher', 'isTeacher', 'teacherName']),
      grades: r => {
        const o = Object.fromEntries(['tz', 'gradeKey', 'eventName', 'weight', 'date', 'score', 'groupId', 'subject', 'teacher', 'declaredCount', 'targetClasses'].map(f => [f, r[f]]));
        /* הערך המקורי נשמר רק כשהציון אינו מספר (עבר / פטור / חסם...), כדי לא להגדיל את נפח האחסון */
        if (r.score == null && r.scoreRaw != null && String(r.scoreRaw).trim() !== '') o.scoreRaw = String(r.scoreRaw).trim();
        return o;
      },
      bagrut: pickFields(['tz', 'name', 'gradeKey', 'classKey', 'subject', 'code', 'submission', 'exam', 'final', 'moed', 'moedCode', 'cls', 'derived', 'partial', 'scoreRaw'])
    }[type];
    return slim ? rows.map(slim) : rows;
  }

  /**
   * התאמה למצבת העליונה: המצבת קובעת מי חניך פעיל, שכבה וכיתת אם.
   * ת.ז שאינן בה נרשמות ב-unmatchedIds ואינן משנות את המצבת בשום אופן.
   */
  function validateAgainstRoster(rows) {
    const roster = Config.rosterMap(), hidden = Config.hiddenIds();
    if (!roster.size) return { rosterEmpty: true, unmatchedIds: [], matchedCount: 0 };
    const matched = new Set(), unmatched = new Set();
    rows.forEach(r => {
      if (r.isTeacher || !r.tz || hidden.has(r.tz)) return;
      if (roster.has(r.tz)) matched.add(r.tz); else unmatched.add(r.tz);
    });
    return { rosterEmpty: false, unmatchedIds: [...unmatched], matchedCount: matched.size };
  }

  /* ---------- חלון מיפוי עמודות (#mappingModal) ---------- */
  function openMappingModal(type, table, mapping) {
    return new Promise(resolve => {
      const modal = document.getElementById('mappingModal');
      if (!modal) throw new Error('חלון אישור מיפוי העמודות אינו זמין');
      const $ = id => document.getElementById(id);
      const fields = SCHEMA[type].fields;
      const opts = cur => `<option value="">— לא ממופה —</option>${table.headers.map(h => `<option value="${Util.esc(h)}" ${h === cur ? 'selected' : ''}>${Util.esc(h)}</option>`).join('')}`;
      $('mappingTitle').textContent = `מיפוי עמודות – ${SCHEMA[type].title}`;
      $('mappingError').textContent = '';
      $('mappingFields').innerHTML = fields.map(f => `
        <label class="flex flex-col gap-1 text-sm">${Util.esc(f.label)}${f.req ? ' <span class="text-red-500">*</span>' : ''}
          <select class="inp" data-map="${f.key}">${opts(mapping[f.key])}</select></label>`).join('');
      $('mappingPreview').innerHTML = `<table class="grid"><thead><tr>${table.headers.map(h => `<th>${Util.esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${table.rows.slice(0, 5).map(r => `<tr>${table.headers.map(h => `<td>${Util.esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

      let settled = false;
      const observer = new MutationObserver(() => { if (modal.classList.contains('hidden')) finish(null); });
      const onConfirm = () => {
        const chosen = {};
        document.querySelectorAll('#mappingFields [data-map]').forEach(s => { if (s.value) chosen[s.dataset.map] = s.value; });
        const missing = missingRequired(type, chosen);
        if (missing.length) { $('mappingError').textContent = `חובה למפות: ${missing.join(', ')}`; return; }
        const saved = Config.setMapping(type, chosen);
        if (!saved.ok) { $('mappingError').textContent = saved.error; return; }
        finish(chosen);
      };
      const onCancel = () => finish(null);
      const buttons = [['mappingConfirm', onConfirm], ['mappingCancel', onCancel], ['mappingClose', onCancel]];
      function finish(result) {
        if (settled) return;
        settled = true;
        observer.disconnect();
        buttons.forEach(([id, fn]) => { const b = $(id); if (b) b.removeEventListener('click', fn); });
        modal.classList.add('hidden');
        resolve(result);
      }
      buttons.forEach(([id, fn]) => { const b = $(id); if (b) b.addEventListener('click', fn); });
      observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
      modal.classList.remove('hidden');
    });
  }

  /** מסיר שורות של חניכי ז-ט (ראו Config.filterJuniorRows) */
  function dropJunior(type, rows) { return Config.filterJuniorRows(type, rows); }

  /**
   * קורא קובץ Excel/CSV לפי סוג: 'roster' | 'groups' | 'sadin' | 'bagrut'.
   * כשחסרות עמודות חובה (או כש-opts.confirmMapping, למיפוי ידני מחדש) נפתח חלון המיפוי; המיפוי המאושר נשמר ב-Config.
   * מחזיר { rows, skipped, unmatchedIds, mapping, fileName, ... } או null אם המשתמש ביטל.
   */
  async function parseExcelFile(file, targetType, opts = {}) {
    const type = TYPE_ALIAS[targetType];
    if (!type) throw new Error(`סוג קובץ לא מוכר: ${targetType}`);

    if (type === 'roster') {
      const res = await readRosterFile(file, opts);
      if (!res) return null;
      return { targetType, type, fileName: file.name, rows: res.rows, skipped: res.skipped, duplicates: res.duplicates,
        ignoredIds: res.ignoredIds, sheets: res.sheets, warnings: res.warnings, mapping: null, unmatchedIds: [], rosterEmpty: false };
    }

    const table = await readFile(file);

    /* קובץ משוב במטריצה רחבה: מזוהה לפי הכותרות ונפרש אוטומטית, ללא חלון מיפוי */
    const wideKind = detectWide(table.aoa, table.headerIdx);
    if (wideKind && wideKind !== type) {
      throw new Error(`הקובץ "${file.name}" הוא קובץ ${WIDE_LABEL[wideKind]} – יש לטעון אותו בפאנל המתאים.`);
    }
    if (wideKind) {
      Util.idWarn.sci = 0;
      const wide = WIDE_PARSERS[wideKind](table.aoa, table.headerIdx);
      const { rows, ignored } = dropJunior(type, wide.rows);
      const check = validateAgainstRoster(rows);
      const grades = [...new Set(rows.map(r => r.gradeKey).filter(Boolean))];
      return { targetType, type, wide: true, grades, fileName: file.name, headerRow: table.headerRow, sheetName: table.sheetName, rows, skipped: wide.skipped, ignored,
        mapping: null, unmatchedIds: check.unmatchedIds, matchedCount: check.matchedCount, rosterEmpty: check.rosterEmpty, warnings: [...table.warnings, ...(wide.warnings || []), ...takeIdWarnings()] };
    }

    let mapping = autoMap(type, table.headers, table.rows);
    if (missingRequired(type, mapping).length || opts.confirmMapping) {
      const confirmed = await openMappingModal(type, table, mapping);
      if (!confirmed) return null;
      mapping = confirmed;
    }

    Util.idWarn.sci = 0;
    const normalized = normalize(type, table.rows, mapping);
    const { skipped } = normalized;
    const { rows, ignored } = dropJunior(type, normalized.rows);
    const check = validateAgainstRoster(rows);
    return { targetType, type, fileName: file.name, headerRow: table.headerRow, sheetName: table.sheetName, rows, skipped, ignored, mapping,
      unmatchedIds: check.unmatchedIds, matchedCount: check.matchedCount, rosterEmpty: check.rosterEmpty, warnings: [...table.warnings, ...takeIdWarnings()] };
  }

  return {
    SCHEMA, readFile, readRosterFile, sniffHeader, buildTable, autoMap, missingRequired, normalize, classify,
    parseGroupString, parseEventString, parseEvent: parseEventString, normalizeTz, slimRows, validateAgainstRoster,
    resolveAttempt, roundWeightedScore, openMappingModal, parseExcelFile, detectWide, canonSubject
  };
})();

function parseExcelFile(file, targetType, opts) { return Parser.parseExcelFile(file, targetType, opts); }
function parseGroupString(str) { return Parser.parseGroupString(str); }
function parseEventString(str) { return Parser.parseEventString(str); }
