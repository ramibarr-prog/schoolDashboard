(function () {
  'use strict';
  let initPromise, engine, db, depth = 0, savepoint = 0;
  const normalizeSubject = value => String(value == null ? '' : value)
    .trim().replace(/^מג(?:['׳]|מת)\s*/, '').replace(/["'״׳”“’‘`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const codeOf = value => {
    const s = String(value == null ? '' : value).trim();
    if (!/^\d{1,6}$/.test(s)) throw new Error('Invalid questionnaire code: ' + s);
    return s.padStart(6, '0');
  };
  const active = () => {
    if (!db) throw new Error('Database is not open');
    return db;
  };
  const api = {
    async init(opts = {}) {
      if (!initPromise) initPromise = window.initSqlJs({ locateFile: f => (opts.wasmBase || 'vendor/') + f });
      engine = await initPromise;
      return engine;
    },
    createEmpty() {
      if (!engine) throw new Error('Call DB.init() first');
      const next = new engine.Database();
      try {
        next.run(window.DbSchema.SQL);
        next.run('INSERT INTO schema_meta(key,value) VALUES (?,?)', ['version', String(window.DbSchema.VERSION)]);
      } catch (e) { next.close(); throw e; }
      if (db) db.close();
      db = next;
    },
    openBytes(bytes) {
      if (!engine) throw new Error('Call DB.init() first');
      if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
      const next = new engine.Database(bytes);
      const old = db;
      try {
        next.run('PRAGMA foreign_keys=ON');
        db = next;
        const result = api.checkIntegrity();
        if (!result.ok) throw new Error('Database integrity check failed: ' + JSON.stringify(result));
      } catch (e) { db = old; next.close(); throw e; }
      if (old) old.close();
    },
    exportBytes() {
      const current = active(), bytes = current.export();
      current.run('PRAGMA foreign_keys=ON');
      return bytes;
    },
    run(sql, params = []) { active().run(sql, params); },
    query(sql, params = []) {
      const stmt = active().prepare(sql);
      try {
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally { stmt.free(); }
    },
    queryOne(sql, params = []) { return api.query(sql, params)[0] || null; },
    scalar(sql, params = []) {
      const row = api.queryOne(sql, params);
      return row ? row[Object.keys(row)[0]] : null;
    },
    transaction(fn) {
      const nested = depth > 0, name = 'db_sp_' + (++savepoint);
      api.run(nested ? 'SAVEPOINT ' + name : 'BEGIN IMMEDIATE');
      depth++;
      try {
        const result = fn();
        if (result && typeof result.then === 'function') throw new Error('DB.transaction callback must be synchronous');
        api.run(nested ? 'RELEASE SAVEPOINT ' + name : 'COMMIT');
        return result;
      } catch (e) {
        if (nested) { api.run('ROLLBACK TO SAVEPOINT ' + name); api.run('RELEASE SAVEPOINT ' + name); }
        else api.run('ROLLBACK');
        throw e;
      } finally { depth--; }
    },
    checkIntegrity() {
      const integrity = api.query('PRAGMA integrity_check').map(r => Object.values(r)[0]);
      const fkViolations = api.query('PRAGMA foreign_key_check');
      return { ok: integrity.length === 1 && integrity[0] === 'ok' && fkViolations.length === 0, integrity, fkViolations };
    },
    normalizeSubject,
    codeOf,
    seedCatalogFromConfig(configObj = (typeof Config !== 'undefined' ? Config : window.Config)) {
      if (!configObj) throw new Error('Config is required');
      return api.transaction(() => {
        const grades = ['י', 'יא', 'יב'];
        const usedIds = new Set();
        api.run('DELETE FROM cohorts');
        grades.forEach(grade => {
          const rules = typeof configObj.rulesForGrade === 'function' ? configObj.rulesForGrade(grade) : configObj.rules();
          let cohort = typeof configObj.getCohortIdForGrade === 'function' ? configObj.getCohortIdForGrade(grade) : grade;
          if (usedIds.has(cohort)) cohort += ':' + grade;
          usedIds.add(cohort);
          const label = typeof configObj.getCohortNameForGrade === 'function' ? configObj.getCohortNameForGrade(grade) : grade;
          api.run('INSERT INTO cohorts(cohort_id,name,grade_key,default_magen_weight) VALUES (?,?,?,?) ON CONFLICT(cohort_id) DO UPDATE SET name=excluded.name, grade_key=excluded.grade_key, default_magen_weight=excluded.default_magen_weight',
            [cohort, label, grade, rules.magenWeight == null ? null : rules.magenWeight]);
          const catalog = rules.questionnaires || {};
          const putQuestion = (raw, subjectId, component, name) => {
            const code = codeOf(raw), q = catalog[String(Number(code))] || catalog[code] || {};
            const kind = component.internal ? 'internal' : 'external';
            api.run(`INSERT INTO questionnaires(code,subject_id,name,eval_kind,is_non_bagrut,default_magen_weight,is_known) VALUES (?,?,?,?,?,?,1)
              ON CONFLICT(code) DO UPDATE SET subject_id=COALESCE(excluded.subject_id,questionnaires.subject_id), name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE questionnaires.name END,
              eval_kind=CASE WHEN excluded.eval_kind='internal' THEN 'internal' ELSE questionnaires.eval_kind END, is_non_bagrut=excluded.is_non_bagrut,
              default_magen_weight=COALESCE(excluded.default_magen_weight,questionnaires.default_magen_weight), is_known=1`,
              [code, subjectId, q.name || name || '', kind, code === '700181' ? 1 : 0, q.magenWeight == null ? null : q.magenWeight]);
            return code;
          };
          Object.entries(catalog).forEach(([code, q]) => putQuestion(code, null, {}, q.name));
          [['core', rules.coreSubjects || []], ['major', rules.majors || []], ['internal', rules.internals || []]].forEach(([category, defs]) => {
            defs.forEach((s, order) => {
              const key = category + ':' + s.id;
              api.run(`INSERT INTO subjects(code_key,name,category,is_enabled,sort_order) VALUES (?,?,?,?,?)
                ON CONFLICT(code_key) DO UPDATE SET name=excluded.name,category=excluded.category,is_enabled=excluded.is_enabled,sort_order=excluded.sort_order`,
                [key, s.name, category, s.enabled === false ? 0 : 1, order]);
              const subjectId = api.scalar('SELECT subject_id FROM subjects WHERE code_key=?', [key]);
              [s.name, ...(s.keywords || []), ...(s.majorNames || []), ...(s.groupKeywords || [])].forEach(alias => {
                const norm = normalizeSubject(alias);
                if (norm) api.run('INSERT OR IGNORE INTO subject_aliases(alias_norm,alias_raw,subject_id,source) VALUES (?,?,?,?)', [norm, alias, subjectId, 'system']);
              });
              const add = (component, level) => {
                (component.codes || []).forEach(raw => {
                  const code = putQuestion(raw, subjectId, component, s.name);
                  const expected = Util.normGrade(component.expectedGrade || '');
                  api.run(`INSERT INTO cohort_rules(cohort_id,questionnaire_code,level_units,weight,is_internal,expected_grade,magen_weight)
                    VALUES (?,?,?,?,?,?,?) ON CONFLICT(cohort_id,questionnaire_code,level_units) DO UPDATE SET weight=excluded.weight,is_internal=excluded.is_internal,expected_grade=excluded.expected_grade,magen_weight=excluded.magen_weight`,
                    [cohort, code, Number(level) || 0, component.weight == null ? null : component.weight, component.internal ? 1 : 0,
                      ['י', 'יא', 'יב'].includes(expected) ? expected : '', component.magenWeight == null ? null : component.magenWeight]);
                });
              };
              (s.components || []).forEach(c => add(c, s.units || 0));
              Object.entries(s.levels || {}).forEach(([level, components]) => components.forEach(c => add(c, level)));
              if (s.codes) add({ codes: s.codes, expectedGrade: s.expectedGrade, internal: category === 'internal' }, s.units || 0);
            });
          });
          Object.entries(catalog).forEach(([raw, q]) => {
            const code = codeOf(raw), expected = Util.normGrade(q.expectedGrade || '');
            api.run(`INSERT INTO cohort_rules(cohort_id,questionnaire_code,level_units,weight,is_internal,expected_grade,magen_weight)
              SELECT ?,?,0,NULL,0,?,? WHERE NOT EXISTS (SELECT 1 FROM cohort_rules WHERE cohort_id=? AND questionnaire_code=?)`,
              [cohort, code, ['י', 'יא', 'יב'].includes(expected) ? expected : '', q.magenWeight == null ? null : q.magenWeight, cohort, code]);
          });
          putQuestion('700181', null, {}, '');
        });
      });
    }
  };
  window.DB = api;
})();
