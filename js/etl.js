(function () {
  'use strict';
  const text = v => v == null ? '' : String(v).trim();
  const id = v => {
    const raw = text(v);
    if (!/^\d{1,9}$/.test(raw)) return '';
    return raw.padStart(9, '0');
  };
  const grade = v => {
    const g = Util.normGrade(v);
    return ['י', 'יא', 'יב'].includes(g) ? g : '';
  };
  const studentExists = tz => !!DB.scalar('SELECT 1 FROM students WHERE tz=?', [tz]);
  const resolveSubject = value => {
    const key = DB.normalizeSubject(value);
    return key ? DB.scalar('SELECT subject_id FROM subject_aliases WHERE alias_norm=?', [key]) : null;
  };
  const majorPrefix = value => /^(?:מג['׳]|מגמת)/.test(text(value));
  const groupData = row => {
    const rawName = text(row.groupName || row.rawGroupName || row.group);
    const parsed = typeof Parser !== 'undefined' && rawName ? Parser.parseGroupString(rawName) : {};
    return {
      groupId: text(row.groupId || row.group_id || parsed.groupId), rawName,
      subject: text(row.subject || row.raw_subject || parsed.subject),
      teacher: text(row.teacher || row.teacherName || parsed.teacher),
      targetClasses: text(row.targetClasses || parsed.targetClasses),
      units: row.units == null || row.units === '' ? null : Number(row.units),
      major: majorPrefix(rawName) || majorPrefix(row.subject)
    };
  };
  const begin = (type, meta, scope) => {
    DB.run('INSERT INTO import_batches(file_type,file_name,grade_scope) VALUES (?,?,?)', [type, text(meta.fileName || meta.file_name), scope || '']);
    return { batchId: DB.scalar('SELECT last_insert_rowid()'), rowsOk: 0, rowsQuarantined: 0, rowIndex: -1, lastQuarantined: -1 };
  };
  const quarantine = (batch, type, reason, key, row) => {
    DB.run('INSERT INTO import_quarantine(batch_id,entity_type,reason,external_key,raw_json) VALUES (?,?,?,?,?)',
      [batch.batchId, type, reason, text(key), JSON.stringify(row)]);
    if (batch.rowIndex !== batch.lastQuarantined) {
      batch.rowsQuarantined++;
      batch.lastQuarantined = batch.rowIndex;
    }
  };
  const finish = batch => {
    DB.run('UPDATE import_batches SET rows_ok=?,rows_quarantined=? WHERE batch_id=?', [batch.rowsOk, batch.rowsQuarantined, batch.batchId]);
    return { batchId: batch.batchId, rowsOk: batch.rowsOk, rowsQuarantined: batch.rowsQuarantined };
  };
  const ensureRows = rows => { if (!Array.isArray(rows)) throw new TypeError('Expected an array of rows'); };
  const scopeOf = (row, meta) => grade(row.gradeKey || row.grade_scope || row.gradeScope || row.grade || meta.gradeScope);
  const validStudent = (row, batch) => {
    const tz = id(row.tz);
    if (!tz) { quarantine(batch, 'invalid_row', 'Invalid student identifier', row.tz, row); return ''; }
    if (!studentExists(tz)) { quarantine(batch, 'student_missing', 'Student not in roster', tz, row); return ''; }
    return tz;
  };
  const ETL = {
    normalizeSubject: DB.normalizeSubject,
    ingestRoster(rows, meta = {}) {
      ensureRows(rows);
      return DB.transaction(() => {
        const batch = begin('roster', meta, '');
        DB.run("UPDATE students SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE source='roster'");
        rows.forEach((row, index) => {
          batch.rowIndex = index;
          const tz = id(row.tz), g = grade(row.gradeKey || row.grade);
          if (!tz || !g) { quarantine(batch, 'invalid_row', 'Invalid student identifier or grade', row.tz, row); return; }
          const c = text(row.classKey || row.homeroom) || Util.parseClass(g, row.classNum).classKey;
          DB.run(`INSERT INTO students(tz,first_name,last_name,gender,roster_grade,roster_homeroom,roster_track,declared_major,source,is_active)
            VALUES (?,?,?,?,?,?,?,?, 'roster',1) ON CONFLICT(tz) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,
            gender=excluded.gender,roster_grade=excluded.roster_grade,roster_homeroom=excluded.roster_homeroom,roster_track=excluded.roster_track,
            declared_major=excluded.declared_major,source='roster',is_active=1,updated_at=CURRENT_TIMESTAMP`,
            [tz, text(row.firstName), text(row.lastName), text(row.gender), g, c, text(row.track), text(row.majorName || row.declaredMajor)]);
          if (c) DB.run(`INSERT INTO class_settings(class_key,roster_name) VALUES (?,?) ON CONFLICT(class_key) DO UPDATE SET roster_name=excluded.roster_name`,
            [c, text(row.className || c)]);
          batch.rowsOk++;
        });
        return finish(batch);
      });
    },
    ingestGroups(rows, meta = {}) {
      ensureRows(rows);
      const metaScope = meta.gradeScope ? grade(meta.gradeScope) : '';
      if (meta.gradeScope && !metaScope) throw new Error('Invalid grade scope');
      if (metaScope && rows.some(r => {
        const explicit = r.gradeKey || r.grade_scope || r.gradeScope || r.grade;
        return explicit && grade(explicit) !== metaScope;
      })) throw new Error('Group row does not match grade scope');
      const scopes = new Set(rows.map(r => scopeOf(r, meta)).filter(Boolean));
      if (metaScope) scopes.add(metaScope);
      if (!scopes.size || rows.some(r => !scopeOf(r, meta))) throw new Error('Every group row must have a valid grade scope');
      return DB.transaction(() => {
        const batch = begin('groups', meta, [...scopes].sort().join(','));
        scopes.forEach(scope => DB.run('DELETE FROM enrollments WHERE grade_scope=?', [scope]));
        const unmapped = new Set();
        rows.forEach((row, index) => {
          batch.rowIndex = index;
          const g = groupData(row), scope = scopeOf(row, meta);
          if (!g.groupId || (g.units != null && !Number.isFinite(g.units))) {
            quarantine(batch, 'invalid_row', 'Invalid group', g.groupId, row); return;
          }
          const subjectId = resolveSubject(g.subject);
          DB.run(`INSERT INTO groups(group_id,raw_name,raw_subject,subject_id,teacher_name,target_classes,declared_units,is_major_prefix,in_groups_file)
            VALUES (?,?,?,?,?,?,?,?,1) ON CONFLICT(group_id) DO UPDATE SET raw_name=excluded.raw_name,raw_subject=excluded.raw_subject,
            subject_id=excluded.subject_id,teacher_name=excluded.teacher_name,target_classes=excluded.target_classes,
            declared_units=excluded.declared_units,is_major_prefix=excluded.is_major_prefix,in_groups_file=1`,
            [g.groupId, g.rawName, g.subject, subjectId, g.teacher, g.targetClasses, g.units, g.major ? 1 : 0]);
          if (!subjectId && !unmapped.has(g.groupId)) {
            unmapped.add(g.groupId);
            quarantine(batch, 'unmapped_group', 'Subject has no alias', g.groupId, row);
          }
          if (row.isTeacher) return;
          const tz = validStudent(row, batch);
          if (!tz) return;
          DB.run(`INSERT INTO enrollments(tz,group_id,grade_scope) VALUES (?,?,?)
            ON CONFLICT(tz,group_id) DO UPDATE SET grade_scope=excluded.grade_scope`, [tz, g.groupId, scope]);
          if (row.majorName != null || row.declaredMajor != null)
            DB.run('UPDATE students SET declared_major=?, updated_at=CURRENT_TIMESTAMP WHERE tz=?', [text(row.majorName != null ? row.majorName : row.declaredMajor), tz]);
          batch.rowsOk++;
        });
        return finish(batch);
      });
    },
    ingestSadin(rows, meta = {}) {
      ensureRows(rows);
      return DB.transaction(() => {
        const batch = begin('sadin', meta, grade(meta.gradeScope));
        rows.forEach((row, index) => {
          batch.rowIndex = index;
          const g = groupData(row), title = text(row.eventName || row.title), date = Util.parseDate(row.date || row.event_date);
          const weight = row.weight == null || row.weight === '' ? 1 : Number(row.weight);
          if (!g.groupId || !title || !Number.isFinite(weight) || (row.date && !date)) {
            quarantine(batch, 'invalid_row', 'Invalid assessment event', g.groupId, row); return;
          }
          const tz = validStudent(row, batch);
          if (!tz) return;
          DB.run(`INSERT OR IGNORE INTO groups(group_id,raw_name,raw_subject,subject_id,teacher_name,target_classes,is_major_prefix,in_groups_file)
            VALUES (?,?,?,?,?,?,?,0)`, [g.groupId, g.rawName, g.subject, resolveSubject(g.subject), g.teacher, g.targetClasses, g.major ? 1 : 0]);
          const eventId = [g.groupId, title, date, weight].join('|');
          DB.run(`INSERT INTO assessment_events(event_id,group_id,title,event_date,weight,grade_scope) VALUES (?,?,?,?,?,?)
            ON CONFLICT(event_id) DO UPDATE SET grade_scope=excluded.grade_scope`,
            [eventId, g.groupId, title, date, weight, scopeOf(row, meta)]);
          const raw = row.scoreRaw != null ? row.scoreRaw : row.score_raw != null ? row.score_raw : row.score;
          const score = Util.parseScore(row.score != null ? row.score : raw);
          DB.run(`INSERT INTO sadin_grades(tz,event_id,score,score_raw) VALUES (?,?,?,?)
            ON CONFLICT(tz,event_id) DO UPDATE SET score=excluded.score,score_raw=excluded.score_raw`, [tz, eventId, score, text(raw)]);
          batch.rowsOk++;
        });
        return finish(batch);
      });
    },
    ingestBagrut(rows, meta = {}) {
      ensureRows(rows);
      return DB.transaction(() => {
        const batch = begin('bagrut', meta, grade(meta.gradeScope)), warned = new Set();
        rows.forEach((row, index) => {
          batch.rowIndex = index;
          let code;
          const rawCode = row.questionnaireCode || row.questionnaire_code || row.code;
          try { code = DB.codeOf(rawCode); }
          catch (e) { quarantine(batch, 'invalid_row', e.message, rawCode, row); return; }
          const tz = validStudent(row, batch);
          if (!tz) return;
          const kind = text(row.evalKind || row.eval_kind) || 'external';
          if (!['external', 'alternative', 'internal'].includes(kind)) {
            quarantine(batch, 'invalid_row', 'Invalid evaluation kind', code, row); return;
          }
          const known = DB.queryOne('SELECT is_known FROM questionnaires WHERE code=?', [code]);
          if (!known) DB.run('INSERT INTO questionnaires(code,name,eval_kind,is_non_bagrut,is_known) VALUES (?,?,?,?,0)', [code, text(row.subject), kind, code === '700181' ? 1 : 0]);
          if ((!known || !known.is_known) && !warned.has(code)) {
            warned.add(code);
            quarantine(batch, 'unknown_questionnaire', 'Questionnaire is not in the catalog', code, row);
          }
          if (row.evalKind || row.eval_kind) DB.run('UPDATE questionnaires SET eval_kind=? WHERE code=?', [kind, code]);
          DB.run(`INSERT INTO bagrut_grades(tz,questionnaire_code,moed_code,moed_label,submission_raw,exam_raw,final_raw) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(tz,questionnaire_code,moed_code) DO UPDATE SET moed_label=excluded.moed_label,submission_raw=excluded.submission_raw,
            exam_raw=excluded.exam_raw,final_raw=excluded.final_raw`,
            [tz, code, text(row.moedCode || row.moed_code || row.moed), text(row.moedLabel || row.moed_label || row.moed),
              text(row.submissionRaw ?? row.submission_raw ?? row.submissionGrade ?? row.submission),
              text(row.examRaw ?? row.exam_raw ?? row.examGrade ?? row.exam),
              text(row.finalRaw ?? row.final_raw ?? row.finalGrade ?? row.final)]);
          batch.rowsOk++;
        });
        return finish(batch);
      });
    }
  };
  window.ETL = ETL;
})();
