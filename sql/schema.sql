PRAGMA foreign_keys = ON;
CREATE TABLE schema_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE import_batches (
  batch_id INTEGER PRIMARY KEY AUTOINCREMENT, file_type TEXT NOT NULL CHECK(file_type IN ('roster','groups','sadin','bagrut')),
  file_name TEXT NOT NULL DEFAULT '', grade_scope TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rows_ok INTEGER NOT NULL DEFAULT 0, rows_quarantined INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE class_settings (class_key TEXT PRIMARY KEY NOT NULL, roster_name TEXT NOT NULL DEFAULT '', nickname TEXT NOT NULL DEFAULT '', is_special_ed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE students (
  tz TEXT PRIMARY KEY NOT NULL CHECK(length(tz)=9 AND tz NOT GLOB '*[^0-9]*'), first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '', gender TEXT NOT NULL DEFAULT '', roster_grade TEXT NOT NULL CHECK(roster_grade IN ('י','יא','יב')),
  roster_homeroom TEXT NOT NULL DEFAULT '', roster_track TEXT NOT NULL DEFAULT '', declared_major TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK(source IN ('roster','manual')), is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE student_overrides (
  tz TEXT PRIMARY KEY NOT NULL REFERENCES students(tz) ON DELETE CASCADE, grade TEXT, homeroom TEXT, track TEXT,
  hidden INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE student_exceptions (
  tz TEXT PRIMARY KEY NOT NULL REFERENCES students(tz) ON DELETE CASCADE, is_exception INTEGER NOT NULL DEFAULT 0,
  override_status TEXT NOT NULL DEFAULT '' CHECK(override_status IN ('','eligible','expected','atrisk','noteligible','twelve')),
  track_override TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE subjects (
  subject_id INTEGER PRIMARY KEY AUTOINCREMENT, code_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK(category IN ('core','major','internal','other')), is_enabled INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE subject_aliases (
  alias_norm TEXT PRIMARY KEY NOT NULL, alias_raw TEXT NOT NULL, subject_id INTEGER NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('system','manual'))
);
CREATE TABLE questionnaires (
  code TEXT PRIMARY KEY NOT NULL CHECK(length(code)=6 AND code NOT GLOB '*[^0-9]*'), subject_id INTEGER REFERENCES subjects(subject_id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '', eval_kind TEXT NOT NULL DEFAULT 'external' CHECK(eval_kind IN ('external','alternative','internal')),
  is_non_bagrut INTEGER NOT NULL DEFAULT 0, default_magen_weight REAL, is_known INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE cohorts (cohort_id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, grade_key TEXT NOT NULL UNIQUE CHECK(grade_key IN ('י','יא','יב')), default_magen_weight REAL);
CREATE TABLE cohort_rules (
  cohort_id TEXT NOT NULL REFERENCES cohorts(cohort_id) ON DELETE CASCADE, questionnaire_code TEXT NOT NULL REFERENCES questionnaires(code) ON DELETE CASCADE,
  level_units INTEGER NOT NULL DEFAULT 0, weight REAL, is_internal INTEGER NOT NULL DEFAULT 0,
  expected_grade TEXT NOT NULL DEFAULT '' CHECK(expected_grade IN ('','י','יא','יב')), magen_weight REAL,
  PRIMARY KEY(cohort_id, questionnaire_code, level_units)
);
CREATE TABLE groups (
  group_id TEXT PRIMARY KEY NOT NULL, raw_name TEXT NOT NULL DEFAULT '', raw_subject TEXT NOT NULL DEFAULT '',
  subject_id INTEGER REFERENCES subjects(subject_id) ON DELETE SET NULL, teacher_name TEXT NOT NULL DEFAULT '',
  target_classes TEXT NOT NULL DEFAULT '', declared_units REAL, is_major_prefix INTEGER NOT NULL DEFAULT 0, in_groups_file INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE enrollments (
  tz TEXT NOT NULL REFERENCES students(tz) ON DELETE CASCADE, group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
  grade_scope TEXT NOT NULL, PRIMARY KEY(tz, group_id)
);
CREATE TABLE assessment_events (
  event_id TEXT PRIMARY KEY NOT NULL, group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE, title TEXT NOT NULL,
  event_date TEXT NOT NULL DEFAULT '', weight REAL NOT NULL DEFAULT 1, grade_scope TEXT NOT NULL DEFAULT '',
  UNIQUE(group_id, title, event_date, weight)
);
CREATE TABLE sadin_grades (
  tz TEXT NOT NULL REFERENCES students(tz) ON DELETE CASCADE, event_id TEXT NOT NULL REFERENCES assessment_events(event_id) ON DELETE CASCADE,
  score REAL, score_raw TEXT NOT NULL DEFAULT '', PRIMARY KEY(tz, event_id)
);
CREATE TABLE bagrut_grades (
  tz TEXT NOT NULL REFERENCES students(tz) ON DELETE CASCADE, questionnaire_code TEXT NOT NULL REFERENCES questionnaires(code),
  moed_code TEXT NOT NULL DEFAULT '', moed_label TEXT NOT NULL DEFAULT '', submission_raw TEXT NOT NULL DEFAULT '',
  exam_raw TEXT NOT NULL DEFAULT '', final_raw TEXT NOT NULL DEFAULT '', PRIMARY KEY(tz, questionnaire_code, moed_code)
);
CREATE TABLE import_quarantine (
  id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL REFERENCES import_batches(batch_id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('student_missing','unmapped_group','unknown_questionnaire','invalid_row')),
  reason TEXT NOT NULL, external_key TEXT NOT NULL DEFAULT '', raw_json TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_enrollments_group ON enrollments(group_id);
CREATE INDEX idx_enrollments_scope ON enrollments(grade_scope);
CREATE INDEX idx_events_group ON assessment_events(group_id);
CREATE INDEX idx_sadin_event ON sadin_grades(event_id);
CREATE INDEX idx_bagrut_code ON bagrut_grades(questionnaire_code);
CREATE INDEX idx_quarantine_open ON import_quarantine(resolved, entity_type);
CREATE VIEW v_effective_students AS
  SELECT s.*, COALESCE(NULLIF(o.grade,''),s.roster_grade) AS grade_key,
    COALESCE(NULLIF(o.homeroom,''),s.roster_homeroom) AS class_key,
    COALESCE(NULLIF(o.track,''),s.roster_track) AS track
  FROM students s LEFT JOIN student_overrides o ON o.tz=s.tz
  WHERE s.is_active=1 AND COALESCE(o.hidden,0)=0;
CREATE VIEW v_class_core_coverage AS
  SELECT s.class_key, s.grade_key, sub.subject_id, sub.code_key, sub.name AS subject_name,
    COUNT(DISTINCT s.tz) AS class_size, COUNT(DISTINCT CASE WHEN g.subject_id=sub.subject_id THEN s.tz END) AS enrolled,
    CASE WHEN COUNT(DISTINCT s.tz)>0 AND COUNT(DISTINCT CASE WHEN g.subject_id=sub.subject_id THEN s.tz END)*1.0/COUNT(DISTINCT s.tz)>=0.30 THEN 1 ELSE 0 END AS is_required
  FROM v_effective_students s CROSS JOIN subjects sub
  LEFT JOIN enrollments e ON e.tz=s.tz
  LEFT JOIN groups g ON g.group_id=e.group_id AND g.in_groups_file=1
  WHERE sub.category='core' AND sub.is_enabled=1 AND s.class_key<>''
  GROUP BY s.class_key, s.grade_key, sub.subject_id;
CREATE VIEW v_sadin_not_enrolled AS
  SELECT sg.tz, ev.group_id, sg.event_id, sg.score, sg.score_raw
  FROM sadin_grades sg JOIN assessment_events ev ON ev.event_id=sg.event_id
  LEFT JOIN enrollments e ON e.tz=sg.tz AND e.group_id=ev.group_id WHERE e.tz IS NULL;
