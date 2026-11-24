(function () {
  'use strict';
  const E = Util.esc;
  const $ = id => document.getElementById(id);
  const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };
  const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const setVal = (id, value) => { const el = $(id); if (el) el.value = value; };
  const passingScore = (score, subject) => SignalEngine.isPassingScore(score, { social: Util.norm(subject) === Util.norm('מעורבות חברתית') });

  function restoreProfileControls() {
    const body = $('profBody'), parent = $('profile-stable') || (body && body.parentElement);
    if (!body || !parent) return;
    ['profKpis', 'excNote'].forEach(id => {
      const el = $(id);
      if (el && body.contains(el)) parent.appendChild(el);
    });
  }

  window.ProfileView = {
  subjectDisplayCell(ev, id) {
    const cell = ev.cells[id], s = ev.subjects.find(s => s.id === id);
    if (!cell || !s) return cell;
    if (s.exempt) return { ...cell, text: 'פטור', sub: 'נדרשת החלטת רכזת', state: 'exempt', cls: 'text-amber-700 font-semibold',
      tip: `${s.name}: פטור — נדרשת החלטת רכזת | ${s.comps.map(c => BagrutAdvisor.compTip(ev.tz, c)).join(' | ')}` };
    if (s.incomplete) return { ...cell, text: s.earnedScore != null ? `${s.earnedScore} (חסר ${s.missingPct}%)` : `חסר ${s.missingPct}%`, state: 'missing', cls: 'score-alert',
      tip: `${cell.tip} | ${s.earnedScore != null ? `ציון נצבר: ${s.earnedScore} · ` : ''}חסר ${s.missingPct}% — המקצוע טרם הושלם` };
    return cell;
  },

  openExceptionModal(tz) {
    const t = Store.trainees.get(tz);
    if (!t) return;
    const ex = Config.getException(tz), ev = this.getEval(tz);
    this.openModal(`
      <h3 class="text-lg font-semibold mb-1">⚡ מצב חריג – ${E(t.name)}</h3>
      <p class="text-xs text-slate-500 mb-3">ת.ז ${E(t.tz)} · ${E(Config.classLabel(t.classKey))}</p>
      ${ev.isPotentialException ? `<div class="text-sm bg-violet-50 text-violet-800 rounded-lg p-2 mb-3">חשד לחריג: ${E(ev.potentialExceptionReason)}</div>` : ''}
      ${ev.manualReview && ev.manualReview.required ? `<div class="text-sm bg-violet-50 text-violet-800 rounded-lg p-2 mb-3">🔎 נדרשת החלטת רכזת:<br>${this.manualReviewLines(ev).map(l => E(l)).join('<br>')}</div>` : ''}
      <label class="flex items-center gap-2 text-sm mb-3"><input type="checkbox" id="xmIs" class="w-4 h-4" ${ex.isException ? 'checked' : ''}>מוחרג מחישוב אוטומטי</label>
      <label class="flex flex-col gap-1 text-sm mb-3">סטטוס מוכרע
        <select id="xmStatus" class="inp">${Config.OVERRIDE_STATUSES.map(s => `<option value="${s.value}" ${(ex.overrideStatus || 'atrisk') === s.value ? 'selected' : ''}>${E(s.label)}</option>`).join('')}</select></label>
      <label class="flex flex-col gap-1 text-sm">סיבת החריג
        <input id="xmReason" class="inp" maxlength="200" value="${E(ex.reason)}" placeholder="למשל: עולה חדש – הקלות שפה / המרת שאלון מבי&quot;ס קודם"></label>
      <div class="flex gap-2 mt-4">
        <button type="button" class="btn btn-primary" data-act="excModalSave" data-tz="${E(t.tz)}">שמירה</button>
        <button type="button" class="btn btn-ghost" data-act="excModalClear" data-tz="${E(t.tz)}">הסרת חריג</button>
        <button type="button" class="btn btn-ghost mr-auto" data-act="closeModal">סגירה</button>
      </div>`);
  },

  saveProfileException(el) {
    const is = $('xmIs') ? $('xmIs').checked : false;
    const res = Config.setException(el.dataset.tz, { isException: is, overrideStatus: is && $('xmStatus') ? $('xmStatus').value : '', reason: $('xmReason') ? $('xmReason').value.trim() : '' });
    this.closeModal();
    this.toast(res.ok === false ? res.error : 'החריג נשמר', res.ok === false ? 'error' : 'ok');
  },

  clearProfileException(el) {
    const res = Config.setException(el.dataset.tz, { isException: false, overrideStatus: '', reason: '' });
    this.closeModal();
    this.toast(res.ok === false ? res.error : 'החריג הוסר', res.ok === false ? 'error' : 'ok');
  },

  profTab(id) {
    this.state.profTab = id;
    this.dirty.add('profile');
    this.renderTab('profile');
  },

  profileSubjectUnits(tz, s, def) {
    if (!def || !Number(s.units)) return null;
    const groups = Store.groupsOf(tz);
    const matching = groups.filter(g => !g.reinforcement && Util.matchKeywords(g.subject, def.keywords));
    const recorded = s.comps.filter(c => c.state === 'num' || c.state === 'pass');
    if (!matching.length && !recorded.length && Store.currentGrade(tz, def.keywords) == null) return null;
    if (s.variableUnits && !matching.some(g => String(g.units) === String(s.units))) {
      const otherCodes = new Set(Object.entries(def.levels || {}).filter(([level]) => level !== String(s.units)).flatMap(([, comps]) => comps.flatMap(c => c.codes)));
      if (!recorded.some(c => !otherCodes.has(c.code))) return null;
    }
    return Number(s.units);
  },

  unitsBadge(ev) {
    /* מינימום 21 יח"ל נשפט רק במצב תעודה סופית; בצפי המותאם ובשכבות י' / י"א התגית ניטרלית */
    const strict = ev.mode === 'full' && !ev.adaptive;
    const short = strict && ev.totalUnits < 21 && ev.tier !== 0;
    const tip = strict
      ? `צבר ${ev.totalUnits} יח"ל (מינימום לזכאות: 21 יח"ל); סך היחידות במסלול: ${ev.expectedUnits}`
      : `יחידות שנצברו עד כה במקצועות שהושלמו; סך היחידות במסלול: ${ev.expectedUnits}`;
    return `<span class="badge ${short ? 'tier-4' : 'fresh-slate'} whitespace-nowrap" title="${E(tip)}">${ev.totalUnits} יח"ל</span>`;
  },

  profileComponents(comps, variable) {
    const detail = comps.map((c, i) => {
      const q = Config.rules().questionnaires[c.code];
      const match = q && (q.name || '').match(/שאלון\s+([א-ת])(?:$|[\s"'׳״–-])/);
      const label = variable && comps.length > 1 ? `שאלון ${match ? `${match[1]}׳` : i + 1}: ` : '';
      const future = c.future && c.state === 'missing' && !c.failed && !c.blocked;
      const value = c.state === 'num' ? Util.fmt(c.reportedNum ?? c.num, 1) : c.state === 'exempt' ? 'פטור — נדרשת החלטת רכזת' : c.state === 'pass' ? 'עבר' : c.failed ? 'לא עבר' : future ? `עתידי ל${Util.gl(Util.GRADE_KEYS.find(g => Util.ord(g) === c.targetRank))}` : '—';
      return `${label}${value} (שאלון ${c.code}${c.weight ? ` · ${c.weight}%` : ''})`;
    }).join(' | ');
    const nums = comps.filter(c => c.state === 'num');
    const weight = nums.reduce((sum, c) => sum + c.weight, 0);
    const score = weight ? nums.reduce((sum, c) => sum + (c.reportedNum ?? c.num) * c.weight, 0) / weight :
      nums.length ? nums.reduce((sum, c) => sum + (c.reportedNum ?? c.num), 0) / nums.length : null;
    const allFuture = comps.length > 0 && comps.every(c => c.future && c.state === 'missing' && !c.failed && !c.blocked);
    const exempt = comps.some(c => c.state === 'exempt');
    const value = exempt ? 'פטור' : score != null ? Util.fmt(score, 0) : comps.some(c => c.failed) ? 'לא עבר' : comps.some(c => c.state === 'pass') ? 'עבר' : allFuture ? '–' : '—';
    const cls = exempt ? 'text-amber-700 font-semibold' : score != null && score < Config.rules().passGrade || value === 'לא עבר' ? 'score-alert' : allFuture && score == null ? 'future-cell' : value === '—' ? 'text-slate-400' : 'text-slate-800 font-normal';
    return `<span class="whitespace-nowrap ${cls}" title="${E(detail)}">${E(value)}</span>`;
  },

  profileSubjectStatus(s) {
    const badge = (cls, text) => `<span class="badge ${cls} whitespace-nowrap">${E(text)}</span>`;
    const plain = (cls, text) => `<span class="${cls} whitespace-nowrap">${E(text)}</span>`;
    if (s.exempt) return badge('tier-3', 'פטור — נדרשת החלטת רכזת');
    if (s.incomplete) return badge('tier-4', `חסר ${s.missingPct}% — המקצוע טרם הושלם`);
    if (s.comps.some(c => c.failed)) return badge('tier-4', 'לא עבר');
    if (s.noShow && s.unresolved.some(c => !c.internal)) return badge('tier-4', 'לא ניגש');
    if (s.enrolled === false) return plain('text-slate-500', 'לא משובץ');
    if (s.comps.length && s.comps.every(c => c.future && c.state === 'missing')) return plain('future-cell', s.group ? 'לומד' : 'עתידי');
    if (s.learning || s.pending.length || s.unresolved.length) return plain('text-slate-500', s.group ? 'לומד' : 'ממתין לדיווח');
    if ((s.forecast || s.filled.length) && s.status === 'pass') return plain('text-slate-500', 'לומד');
    if (s.compApplied) return badge('tier-3', `${s.forecast || s.source === 'current' ? 'תחזית ' : ''}${s.compApplied === 'points' ? 'פיצוי' : 'קיזוז'} (${Util.fmt(s.adj, 0)})`);
    if (s.status === 'pass') return plain('text-emerald-700 font-semibold', '✓ עובר');
    if (s.status === 'comp') return badge('tier-4', `קיזוז לא זמין (${Util.fmt(s.adj, 0)})`);
    if (s.status === 'fail' || s.status === 'severe') return badge('tier-4', 'נכשל');
    return plain('text-slate-500', s.group ? 'לומד' : 'אין נתון');
  },

  profileFocus(ev) {
    const items = [];
    ev.reverse.forEach(r => {
      const subject = ev.subjects.find(s => s.name === r.subject);
      const external = subject ? subject.comps.filter(c => !c.internal && c.state === 'num') : [];
      const weight = external.reduce((sum, c) => sum + c.weight, 0);
      const examScore = weight ? external.reduce((sum, c) => sum + (c.reportedNum ?? c.num) * c.weight, 0) / weight : r.externalScore;
      if (examScore >= Config.rules().passGrade || r.required30 <= 0) return;
      const prefix = `${r.subject} (${subject && subject.comps.some(c => c.magenForecast) ? 'בחינה ומגן משוער' : 'בחינה'} ${Util.fmt(r.externalScore, 0)})`;
      if (r.required30 > 100) {
        items.push(`${prefix}: עובר ב-${r.pct}% אינו אפשרי${r.level !== 'red' && r.requiredFor45 <= 100 ? `; לקיזוז נדרש ${r.requiredFor45}+` : ' – נדרש מועד נוסף'}`);
      } else items.push(`${prefix}: נדרש ${Math.max(1, r.required30)}+ ב-${r.pct}% לעובר`);
    });
    ev.subjects.filter(s => s.compApplied).forEach(s => {
      const low = s.comps.find(c => c.state === 'num' && c.num < Config.rules().passGrade);
      items.push(`${s.name}${s.variableUnits && s.units ? ` ${s.units} יח"ל` : ''}: ציון ${Util.fmt(s.adj, 0)}${low ? ` בשאלון ${low.code}` : ''} (${s.forecast || s.source === 'current' ? 'תחזית ' : 'מופעל '}${s.compApplied === 'points' ? 'פיצוי נקודות' : 'קיזוז'})`);
    });
    const failedCodes = new Set();
    ev.subjects.forEach(s => {
      const failed = s.comps.filter(c => c.failed);
      if (failed.length) items.push(`${s.name}: דווח לא עבר בשאלון`);
      failed.forEach(c => failedCodes.add(c.code));
    });
    ev.major.cands.filter(c => c.failed && !c.blocked).forEach(c => items.push(`${c.name}: דווח לא עבר בשאלון`));
    ev.blockers.filter(b => !b.info && b.k !== 'exempt-review' && b.k !== 'reverse30' && b.k !== 'reverse-pending' && !(b.inner && ev.reverse.length)).forEach(b => {
      if ((b.k === 'questionnaire' || b.k === 'noshow') && [...failedCodes].some(code => b.text.includes(`שאלון ${code}`))) return;
      const text = b.k === 'questionnaire' ? b.text.replace(/^שאלון [\d/]+ ב/, 'חסר שאלון ב') : b.text.replace(/\s*\(שאלון [\d/]+\)/g, '');
      items.push(text);
    });
    const suspect = ev.manualReview.required ? ev.suspectExtra : ev.suspect;
    suspect.filter(s => !s.startsWith('ציון חיצוני ללא רכיב בית-ספרי')).forEach(s => items.push(`לבדיקה: ${s}`));
    ev.subjects.forEach(s => {
      const low = s.comps.find(c => !c.internal && c.state === 'num' && (c.reportedNum ?? c.num) < Config.rules().passGrade);
      if (low && !items.some(text => text.includes(s.name))) items.push(`${s.name}: ציון ${Util.fmt(low.reportedNum ?? low.num, 0)} בבחינה`);
    });
    ev.internals.filter(i => i.explicitFail).forEach(i => {
      if (!items.some(text => text.includes(i.name))) items.push(`${i.name}: לא עבר`);
    });
    return [...new Set(items)];
  },

  /** ב-360 הבחירה פתוחה לכל המצבת; מחוץ למסך נשמר סדר הניווט של טבלת המקור. */
  profileList() {
    if (this.state.tab === 'profile') return this.sortTrainees(Store.traineeList());
    const o = this.state.navOrigin;
    const ordered = o && o.orderedTzList ? o.orderedTzList.map(tz => Store.trainees.get(tz)).filter(Boolean) : [];
    return ordered.length ? ordered : this.filtered(false);
  },

  /** כרטיס 360°: כל התצוגה מחושבת לפי כללי המחזור המשויך לשכבת החניך */
  renderTrainee360Panel() {
    if ($('panel-profile') && !$('weakness-styles')) {
      const link = document.createElement('link');
      link.id = 'weakness-styles'; link.rel = 'stylesheet'; link.href = 'css/style.css';
      document.head.appendChild(link);
    }
    const list = this.profileList();
    const t = list.find(x => x.tz === this.state.profileTz) || list[0];
    const restore = Config.pushRulesForGrade(t ? t.gradeKey : '');
    try { this.renderTrainee360Inner(); } finally { restore(); }
  },

  /** חיווי לקריאה בלבד: מצב ההערכה שבו מוצג כרטיס 360° (נגזר מהבחירה בלשונית צפי זכאות לבגרות) */
  profileModeBadge(t, ev) {
    const [cls, text, title] = t.gradeKey !== 'יב'
      ? ['badge fresh-slate', '📅 קצב צבירה (מותאם לשלב בשנה)', 'שכבות י\' ו-י"א נשפטות תמיד לפי קצב צבירה (מותאם לשלב בשנה), ללא תלות בבחירה בלשונית "צפי זכאות לבגרות"']
      : ev.adaptive
        ? ['badge fresh-slate', '📅 צפי מותאם לשלב בשנה', 'מצב ההערכה נגזר מהבחירה בלשונית "צפי זכאות לבגרות": צפי מותאם לשלב בשנה']
        : ['badge bg-indigo-50 text-indigo-800 border-indigo-200', '🎓 מצב תעודה סופית (סוף י"ב)', 'מצב ההערכה נגזר מהבחירה בלשונית "צפי זכאות לבגרות": מצב תעודה סופית — כל השאלונים והיחידות הפנימיות נדרשים'];
    return `<span class="${cls}" data-eval-mode="${t.gradeKey !== 'יב' ? 'pace' : ev.adaptive ? 'adaptive' : 'final'}" title="${E(title)}">${text}</span>`;
  },

  renderTrainee360Inner() {
    restoreProfileControls();
    const list = this.profileList();
    const sel = $('profSelect');
    if (!Store.hasData() || !list.length) {
      if (sel) sel.innerHTML = '';
      setText('profName', Store.hasData() ? 'אין חניכים בסינון הנוכחי' : 'טרם נטענה מצבת חניכים');
      ['profMeta', 'profBadges', 'profBody', 'profKpis'].forEach(id => setHtml(id, ''));
      ['excTrack', 'excNote', 'excOpen', 'profilePin'].forEach(id => { if ($(id)) $(id).disabled = true; });
      const pin = $('profilePin');
      if (pin) { pin.dataset.tz = ''; pin.setAttribute('aria-pressed', 'false'); pin.textContent = '☆ מעקב צמוד'; }
      this.renderProfileNav(0, 0);
      return;
    }
    let idx = list.findIndex(t => t.tz === this.state.profileTz);
    if (idx < 0) idx = 0;
    const t = list[idx];
    this.state.profileTz = t.tz;
    const ev = this.getEval(t.tz), ex = Config.getException(t.tz), rules = Config.rules();
    const signal = SignalEngine.computeForTrainee(t.tz, this.state.sim);
    const bagrutUnknown = signal.pedagogical.some(f => f.id === 'bagrut.unknown');
    const breakdown = UI.buildBagrutBreakdown(t, ev, { noData: bagrutUnknown, className: Config.classLabel(t.classKey) });
    ['excTrack', 'excNote', 'excOpen', 'profilePin'].forEach(id => { if ($(id)) $(id).disabled = false; });

    if (sel) sel.innerHTML = list.map(x => `<option value="${E(x.tz)}" ${x.tz === t.tz ? 'selected' : ''}>${E(Config.classLabel(x.classKey))} · ${E(x.name)}</option>`).join('');
    this.renderProfileNav(idx + 1, list.length);
    setText('profName', t.name);
    setHtml('profMeta', `ת.ז ${E(t.tz)} · שכבה ${E(Util.gl(t.gradeKey))} · ${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)} · מסלול ${E(this.trackOf(t))} · ${E(ev.cohortName)}`);
    const units = breakdown.totalUnits;
    const unitsLabel = units == null ? 'לא ניתן לקבוע יח״ל' : breakdown.enforceUnits ? `${units} מתוך 21 יח״ל` : `${units} יח״ל נצברו עד כה`;
    const progress = breakdown.enforceUnits && units != null ? `<div class="profile-360-progress" role="progressbar" aria-label="יחידות לזכאות" aria-valuemin="0" aria-valuemax="21" aria-valuenow="${Math.min(21, Math.max(0, units))}"><span style="width:${Math.min(100, Math.max(0, units / 21 * 100))}%"></span></div>` : '';
    setHtml('profBadges', `${bagrutUnknown ? UI.signalBadge('bagrut.unknown').replace('class="badge', 'class="badge prof-status') :
      ev.manualReview.required ? `<span class="badge tier-3 prof-status" title="${E(`חישוב אוטומטי: ${ev.tierText} | ${this.manualReviewLines(ev).join(' | ')}`)}">נדרשת החלטת רכזת</span>` :
      this.tierBased(ev) ? `<span class="badge tier-${ev.tier} prof-status" title="${E(ev.diagnostic)}">${E(ev.tierText)}</span>` : this.paceBadge(ev).replace('class="badge', 'class="prof-status badge')}
      <div class="profile-360-units"><span>${E(unitsLabel)}</span>${progress}</div>
      <span class="profile-360-counts">${breakdown.isTrack12 ? 'מסלול 12 שנות לימוד' : breakdown.noData ? 'לא ניתן לקבוע חסמים' : `${breakdown.subjectCount} מקצועות חוסמים · ${breakdown.internalCount} חסמים פנימיים`}</span>
      ${ev.manualReview.required ? '' : this.manualReviewBadge(ev)}${this.profileModeBadge(t, ev)}`);
    const pin = $('profilePin');
    if (pin) {
      const pinned = BagrutView.chipMatch.call(this, { t, ev }, 'pinned', signal);
      pin.dataset.tz = t.tz; pin.setAttribute('aria-pressed', String(pinned));
      pin.textContent = `${pinned ? '★' : '☆'} מעקב צמוד`;
      pin.setAttribute('aria-label', pinned ? 'הסרה ממעקב צמוד' : 'הוספה למעקב צמוד');
    }
    const cur = this.profileCurrentModel(t, ev, rules);
    this.renderProfileKpis(t, cur, signal.prereqs);
    const groupsFor = keywords => Store.groupsOf(t.tz).filter(g => !g.reinforcement && Util.matchKeywords(g.subject, keywords));
    const anomalies = signal.prereqs.hasGroups ? this.placementAnomaliesModel([t]).rows : [];
    const groupText = groups => {
      if (!groups.length) return '<span class="text-slate-500">—</span>';
      const ids = new Set(groups.map(g => g.groupId));
      const duplicate = anomalies.some(a => a.kind === 'dup' && a.groups.filter(g => ids.has(g.groupId)).length > 1);
      return `<span class="flex max-w-[9rem] items-center gap-1" title="${E(groups.map(g => `${g.teacher || 'ללא מורה'} [${g.groupId}]`).join(' · '))}"><span class="truncate min-w-0">${E(groups[0].teacher || 'ללא מורה')}</span>${duplicate ? '<span class="profile-360-duplicate">כפילות</span>' : groups.length > 1 ? `<span class="shrink-0">(+${groups.length - 1})</span>` : ''}</span>`;
    };
    const scoreText = (value, detail = '', compensated = false) => value == null ? '<span class="text-slate-400">—</span>' :
      `<span class="${compensated ? 'text-amber-700 font-semibold' : value < rules.passGrade ? 'score-alert' : 'text-slate-800 font-normal'}"${detail ? ` title="${E(detail)}"` : ''}>${E(Util.fmt(value, 0))}</span>`;
    const examProgress = (comps, subject) => comps.length ? `<span class="profile-360-exam-count">${comps.filter(c => !c.failed && !c.blocked && (c.state === 'pass' || c.state === 'num' && passingScore(c.reportedNum ?? c.num, subject))).length} מתוך ${comps.length}</span>` : '';
    const details = (comps, reverse) => `<details class="profile-360-details"><summary aria-label="פתיחת פירוט שאלונים">⌄</summary><div class="profile-360-detail-content">${comps.length ? comps.map(c => {
      const value = c.state === 'num' ? Util.fmt(c.reportedNum ?? c.num, 0) : c.state === 'pass' ? 'עבר' : c.state === 'exempt' ? 'פטור' : c.failed || c.blocked ? 'לא עבר' : 'טרם דווח';
      const bad = c.failed || c.blocked || (c.state === 'num' && !passingScore(c.reportedNum ?? c.num, ''));
      return `<div><strong>שאלון ${E(c.code)}</strong>${c.alternative ? ' (חלופה)' : ''} · <span class="${bad ? 'score-alert' : ''}">${E(value)}</span>${c.internal == null ? '' : ` · ${c.internal ? 'פנימי' : 'חיצוני'}`}${c.weight ? ` ${E(c.weight)}%` : ''}${c.magenForecast ? ' · מגן משוער' : ''}</div>`;
    }).join('') : '<div>אין שאלונים זמינים</div>'}${reverse ? `<div>${E(BagrutPolicies.reverseNeed(reverse))}</div>` : ''}</div></details>`;
    const g1 = ev.subjects.map(s => {
      const def = rules.coreSubjects.find(x => x.id === s.id);
      const groups = def ? groupsFor(def.keywords) : [];
      const subjectUnits = this.profileSubjectUnits(t.tz, s, def);
      const external = s.comps.filter(c => !c.internal), internal = s.comps.filter(c => c.internal);
      const partial = s.pending.length || s.unresolved.length;
      const value = partial && s.reportedScore != null ? s.reportedScore : s.adj;
      const suffix = partial && s.reportedScore != null ? ` (${s.reportedPct}%)` : s.forecast ? ' (תחזית)' : s.source === 'current' ? ' (שוטף)' : s.boosted ? ' (סימולציה)' : '';
      const status = breakdown.isTrack12 ? '<span class="badge fresh-slate">מסלול 12 שנות לימוד</span>' :
        s.incomplete && !s.comps.some(c => c.failed || c.blocked) ? '<span class="badge tier-3">נצברו</span>' : this.profileSubjectStatus(s);
      const final = s.exempt ? '<span class="text-amber-700 font-semibold">פטור</span>' : s.incomplete ? `<span class="profile-360-partial">${E(this.subjectDisplayCell(ev, s.id).text)} · נצברו</span>` : value != null ? scoreText(value, `${Util.fmt(value, 1)}${suffix}`, !!s.compApplied) : s.allPass ? 'עבר' : '—';
      return `<tr data-act="profileSubjectToggle"><td><strong>${E(s.name)}</strong>${subjectUnits ? ` <span class="text-slate-500">· ${E(subjectUnits)} יח׳</span>` : ''}</td>
        <td>${groupText(groups)}</td><td>${this.currentCell(cur.core.get(s.id))}</td><td>${this.profileComponents(external, s.variableUnits)} ${examProgress(external, s.name)}</td><td>${this.profileComponents(internal, false)}</td>
        <td>${final}</td><td>${status}</td><td>${details(s.comps, s.reverse)}</td></tr>`;
    }).join('');
    const majors = ev.major.cands.filter(c => !c.coreId);
    const majorRows = majors.map(c => {
      const def = rules.majors.find(m => m.id === c.id);
      const groups = def ? groupsFor(def.keywords) : [];
      const units = groups.find(g => g.units);
      const codes = def ? def.codes.filter(code => Store.bagrutBest(t.tz, [code])) : [];
      const status = breakdown.isTrack12 ? '<span class="badge fresh-slate">מסלול 12 שנות לימוד</span>' : c.exempt ? '<span class="badge tier-3">פטור — נדרשת החלטת רכזת</span>' : c.blocked || c.failed ? '<span class="badge tier-4">לא עבר</span>' : c.status === 'fail' ? '<span class="badge tier-4">נכשל</span>' : c.status === 'pass' && c.source === 'bagrut' && c.complete && !c.forecast ? '<span class="text-emerald-700 font-semibold">✓ עובר</span>' : `<span class="text-slate-500">${!c.complete && c.bagrut != null ? 'נצברו' : c.enrolled ? 'לומד' : 'ממתין לדיווח'}</span>`;
      const value = c.adj != null ? c.adj : c.bagrut;
      const detail = c.adj != null ? (c.forecast ? 'תחזית' : c.source === 'current' ? 'שוטף' : '') : c.bagrut != null ? 'חלקי' : c.missing.length ? 'חלקי' : '';
      const comps = (def ? def.codes : []).map(code => {
        const best = Store.bagrutBest(t.tz, [code]);
        return { code, state: best ? best.kind : 'missing', num: best && best.num, failed: best && best.kind === 'fail', blocked: best && best.block, weight: def.weights && def.weights[code], alternative: def.codeMode === 'any' };
      });
      return `<tr data-act="profileSubjectToggle"><td><strong>${E(c.name)}</strong>${units ? ` <span class="text-slate-500">· ${E(units.units)} יח׳</span>` : ''}</td><td>${groupText(groups)}</td><td>${this.currentCell(cur.majors.get(c.id))}</td>
        <td title="${E(codes.length ? `שאלונים: ${codes.join(', ')}` : '')}">${c.bagrut != null ? scoreText(c.bagrut) : c.exempt ? 'פטור' : c.bagrutPass ? 'עבר' : '—'}</td><td class="text-slate-400">—</td><td>${c.exempt ? '<span class="text-amber-700 font-semibold">פטור</span>' : value != null ? `${scoreText(value, detail)}${!c.complete ? ' · ציון חלקי' : ''}` : c.bagrutPass ? `<span title="${E(detail)}">עבר</span>` : '—'}</td><td>${status}</td><td>${details(comps)}</td></tr>`;
    });
    /* מקצועות נוספים מהסדין / מקבוצות הלימוד: מוצגים כאן כדי שכל מקצוע שנספר ב-KPI נראה גם בטבלה */
    const extraRows = cur.extras.map(x => `<tr><td><strong>${E(x.name)}</strong> <span class="text-[11px] text-slate-500">מקצוע נוסף</span></td><td>${groupText(x.groups)}</td><td>${this.currentCell(x)}</td>
        <td class="text-slate-400">—</td><td class="text-slate-400">—</td><td class="text-slate-400">—</td><td><span class="text-slate-500">${x.groups.length ? 'לומד' : 'ללא שיבוץ'}</span></td><td>—</td></tr>`);
    const missingMajor = !breakdown.isTrack12 && !bagrutUnknown && (signal.prereqs.hasGroups || ev.mode === 'full' && !ev.adaptive) && ev.blockers.some(b => b.k === 'major-none') ? '<tr><td colspan="8" class="score-alert">ללא מגמה — חסר מקצוע מורחב 5 יח"ל</td></tr>' : '';
    const g2 = missingMajor + [...majorRows, ...extraRows].join('') || `<tr><td colspan="8" class="text-slate-500">${ev.major.chosen && ev.major.chosen.coreId ? 'מקצוע מורחב נכלל במקצועות הליבה' : 'לא נמצאה מגמת בחירה'}</td></tr>`;
    const g3 = ev.internals.map(i => {
      const label = i.id === 'pe' ? 'חינוך גופני' : i.name;
      const cls = i.explicitFail ? 'badge tier-4' : i.done || i.exempt ? 'text-emerald-700 font-semibold' : 'text-slate-500';
      const text = i.explicitFail ? 'לא עבר' : i.exempt ? '✓ פטור' : i.done ? '✓ עבר' : i.ignored ? 'הוזנח בסימולציה' : typeof i.value === 'number' ? `ציון ${i.value} – לבדיקה` : 'בתהליך';
      return `<li class="flex justify-between items-center gap-1"><span class="font-medium">${E(label)}</span><span class="${cls} whitespace-nowrap">${E(text)}</span></li>`;
    }).join('');

    const groupsRows = Store.groupsOf(t.tz).map(g => {
      const e = Store.currentOf(t.tz).find(x => x.groupId === g.groupId);
      return `<tr><td>[${E(g.groupId)}]</td><td class="font-medium">${E(g.subject)}</td><td>${E(g.teacher || '—')}</td><td class="${e && e.avg != null && !passingScore(e.avg, e.subject) ? 'text-red-600 font-semibold' : ''}">${e ? Util.fmt(e.avg, 1) : '—'}</td></tr>`;
    }).join('');
    const events = Store.currentOf(t.tz).flatMap(e => e.events.map(x => ({ ...x, subj: e.subject }))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const eventsRows = events.map(x => `<tr><td>${E(x.date || '—')}</td><td>${E(x.subj)}</td><td>${E(x.eventName)}</td><td>${x.weight}</td>
      <td class="${x.score == null || x.score === 0 ? 'text-amber-600' : !passingScore(x.score, x.subj) ? 'text-red-600 font-semibold' : ''}">${x.score == null ? 'חסר' : x.score}</td></tr>`).join('');
    const attRows = Store.attemptsOf(t.tz).sort((a, b) => natural(a.code, b.code) || natural(a.moed, b.moed)).map(a => {
      const exempt = a.cls.exempt || Parser.classify(a.shown || a.final || a.scoreRaw).exempt;
      const internalDef = rules.internals.find(i => i.codes.includes(a.code)), internal = !!internalDef;
      /* כמו שער 3 במנוע: מעורבות חברתית בסולם 1–4 – 2–4 עבר, 0–1 לא עבר; ציון 0–100 נשפט לפי ציון עובר */
      const social = internalDef ? internalDef.scale === '1-4' || internalDef.id === 'social' : String(a.code) === '86083' || /מעורבות חברתית/.test(a.subject || '');
      const cls = exempt ? (internal ? ['text-emerald-700 font-semibold', '✓ פטור'] : ['badge tier-3', 'פטור — נדרשת החלטת רכזת']) :
        a.cls.kind === 'num' ? (SignalEngine.isPassingScore(a.cls.num, { social }) ? ['text-emerald-700 font-semibold', '✓ עבר'] : social && a.cls.num <= 1 ? ['badge tier-4', 'לא עבר'] : ['badge tier-4', 'נכשל']) : a.cls.kind === 'pass' ? ['text-emerald-700 font-semibold', '✓ עבר'] : a.cls.kind === 'fail' ? ['badge tier-4', 'לא עבר'] : ['text-slate-500', '—'];
      return `<tr><td>${a.code}</td><td class="text-xs">${E((rules.questionnaires[a.code] || {}).name || '')}</td><td>${E(a.subject)}</td>
        <td>${E(a.submission || '—')}</td><td>${E(a.exam || '—')}</td><td class="font-medium">${E(a.final || '—')}</td><td>${E(a.moed || '—')}</td><td><span class="${cls[0]}">${cls[1]}</span></td></tr>`;
    }).join('');

    const emptyRow = (cols, text) => `<tr><td colspan="${cols}" class="text-slate-400">${text}</td></tr>`;
    const PROFILE_TABS = [['bagrut', 'שאלוני בגרות'], ['events', 'ציר אירועי הערכה'], ['groups', 'קבוצות לימוד ומורים']];
    const counts = { bagrut: Store.attemptsOf(t.tz).length, events: events.length, groups: Store.groupsOf(t.tz).length };
    const profTab = this.state.profTab && PROFILE_TABS.some(x => x[0] === this.state.profTab) ? this.state.profTab : 'bagrut';
    const tabTables = {
      bagrut: `<table class="grid w-full"><thead><tr><th class="text-right">סמל</th><th class="text-right">שאלון</th><th class="text-right">מקצוע</th><th class="text-right">הגשה</th><th class="text-right">בחינה</th><th class="text-right">סופי</th><th class="text-right">מועד</th><th class="text-right">סטטוס</th></tr></thead><tbody>${attRows || emptyRow(8, 'אין ציוני בגרות')}</tbody></table>`,
      events: `<table class="grid w-full"><thead><tr><th class="text-right">תאריך</th><th class="text-right">מקצוע</th><th class="text-right">אירוע</th><th class="text-right">משקל</th><th class="text-right">ציון</th></tr></thead><tbody>${eventsRows || emptyRow(5, 'אין אירועים')}</tbody></table>`,
      groups: `<table class="grid w-full"><thead><tr><th class="text-right">קבוצה</th><th class="text-right">מקצוע</th><th class="text-right">מורה</th><th class="text-right">ממוצע</th></tr></thead><tbody>${groupsRows || emptyRow(4, 'אין שיבוצים')}</tbody></table>`
    };

    const reviewReasons = ev.blockers.filter(b => b.k === 'exempt-review').map(b => b.text);
    const focus = breakdown.isTrack12 || breakdown.noData ? [] : [...new Set([...this.profileFocus(ev).filter(text => !text.startsWith('לבדיקה:')), ...ev.focus.filter(f => !f.target && !f.text.startsWith('לבדיקה:') && !/לא מספיק/.test(f.text) && !reviewReasons.some(reason => f.text.includes(reason))).map(f => f.text)])];
    const focusItems = focus.map(text => ({
      text, category: ev.reverse.some(r => text.includes(r.subject)) || /קיזוז|פיצוי/.test(text) ? 'משפר ציון' : 'חוסם זכאות'
    }));
    const currentRows = [...cur.core.values(), ...cur.majors.values(), ...cur.extras];
    const currentItems = currentRows.flatMap(row => [
      ...(row.state === 'fail' && row.hasActualFail ? [{ text: `${row.name}: נכשל בציון שוטף (ממוצע ${Util.fmt(row.value, 1)})`, category: 'ציון שוטף' }] : []),
      ...(!breakdown.isTrack12 && (row.state === 'missed' || row.missed) ? [{ text: `${row.name}: אירוע הערכה שהוחמץ`, category: 'הוחמץ' }] : [])
    ]);
    const placementByText = new Map();
    anomalies.forEach(a => {
      const text = `${a.kindLabel}: ${a.subject}`;
      const item = placementByText.get(text);
      if (item) {
        item.count++;
        a.groups.forEach(g => item.groups.set(g.groupId, g));
        a.sadinGroups.forEach(g => item.sadinGroups.set(g.groupId, g));
      } else {
        placementByText.set(text, { text, subject: a.kind === 'nomajor' ? GroupAnalyzer.MAJOR_KEY : a.subject, count: 1,
          groups: new Map(a.groups.map(g => [g.groupId, g])), sadinGroups: new Map(a.sadinGroups.map(g => [g.groupId, g])) });
      }
    });
    const groupDetails = groups => [...groups.values()].map(g => `[${g.groupId}] ${g.teacher || 'ללא מורה'}`).join(' · ');
    const placementItems = [...placementByText.values()].map(item => {
      const current = groupDetails(item.groups), sadin = groupDetails(item.sadinGroups);
      return `<li><div><span>${E(item.text)}${item.count > 1 ? ` (×${item.count})` : ''}</span>${current ? `<small>שיבוץ: ${E(current)}</small>` : ''}${sadin ? `<small>בסדין: ${E(sadin)}</small>` : ''}</div>
        <button type="button" class="profile-360-fix" data-act="inspectGroups" data-tz="${E(t.tz)}" data-subject="${E(item.subject)}">בדיקה לתיקון</button></li>`;
    }).join('');
    const actionList = rows => `<ul class="profile-360-focus-list">${rows.map(item => `<li><span class="profile-360-focus-tag">${E(item.category)}</span><span>${E(item.text)}</span></li>`).join('')}</ul>`;
    const visibleFocus = focusItems.slice(0, 4);
    const visibleCurrent = currentItems.slice(0, Math.max(0, 4 - visibleFocus.length));
    const remaining = [...focusItems.slice(4), ...currentItems.slice(visibleCurrent.length)];
    const hasGrades = ev.subjects.some(s => s.comps.some(c => c.state === 'num' || c.state === 'pass')) || majors.some(c => c.bagrut != null);
    const focusHtml = breakdown.isTrack12 ? '<p class="text-slate-600">החניך נמצא במסלול 12 שנות לימוד.</p>' : bagrutUnknown ? '<p class="text-slate-600">לא ניתן לקבוע יעדי בגרות — חסרים נתוני בגרות לשכבה.</p>' : focus.length ? actionList(visibleFocus) :
      ev.tier === 0 && !ev.manual || !hasGrades ? '<p class="text-slate-600">אין מספיק נתוני בגרות להצגת יעדים.</p>' : ev.manualReview.required ? '<p class="text-slate-600">לא אותרו חסמים פדגוגיים נוספים.</p>' : '<p class="text-emerald-700 font-semibold">✓ אין חסמים פתוחים — כל הבחינות שהתקיימו עברו בהצלחה</p>';
    const paceLine = bagrutUnknown || this.tierBased(ev) ? '' : `<p class="mb-1.5 flex flex-wrap items-center gap-1.5">${this.paceBadge(ev)}<span>${ev.paceInfo.passedDueCount} מתוך ${ev.paceInfo.dueCount} שאלונים שמועדם הגיע עברו${ev.paceInfo.futureCount ? ` · ${ev.paceInfo.futureCount} עתידיים` : ''}</span></p>`;
    const signalList = flags => flags.map(f => `<div class="flex flex-wrap items-center gap-1.5">${UI.signalBadge(f)}${f.detail ? `<span class="text-xs text-slate-600">${E(f.detail)}</span>` : ''}</div>`).join('');
    const reviewLines = [...new Set([...reviewReasons, ...(ev.manualReview.required ? this.manualReviewLines(ev) : []), ...(ev.manualReview.required ? ev.suspectExtra : ev.suspect)])];
    const otherIssues = signal.dataQuality.length || reviewLines.length;
    const qualitySummary = anomalies.length ? `${anomalies.length} חריגות שיבוץ לבדיקה${otherIssues ? ' · ממצאים נוספים' : ''}` :
      !signal.prereqs.hasGroups ? `לא ניתן לבדוק שיבוץ ללא קובץ קבוצות${otherIssues ? ' · ממצאים נוספים' : ''}` :
      otherIssues ? 'נמצאו ממצאים לבדיקה' : 'אין חריגות ידועות';
    const qualityDetails = $('profile-quality');
    const qualityOpen = qualityDetails && qualityDetails.dataset.tz === t.tz && qualityDetails.open;
    const detailsOpen = !!($('profile-more') && $('profile-more').open);
    setHtml('profBody', `
      <div class="profile-360-layout">
        <div class="profile-360-main">
          <section class="card profile-360-card">
            <div><h3>מה צריך כדי לזכות · מיקוד פדגוגי ויעדים לחניך</h3>${paceLine}${focusHtml}</div>
            ${visibleCurrent.length ? actionList(visibleCurrent) : ''}
            ${remaining.length ? `<details><summary class="profile-360-more">עוד ${remaining.length} פעולות</summary>${actionList(remaining)}</details>` : ''}
            ${bagrutUnknown || breakdown.isTrack12 ? '' : this.advisoryHtml(ev)}
          </section>
          <section id="profile-academic" class="card profile-360-academic">
            <h3>מקצועות</h3>
            <div class="tbl-wrap"><table class="grid w-full" aria-label="מקצועות ליבה ומגמות — תמונת 360°"><thead><tr><th>מקצוע ויח״ל</th><th>קבוצה ומורה</th><th>שוטף</th><th>בחינה חיצונית</th><th>הערכה פנימית</th><th>סופי / מצטבר</th><th>סטטוס</th><th>פירוט</th></tr></thead><tbody>
              <tr class="room-divider"><td colspan="8">מקצועות ליבה (שער 1)</td></tr>${g1 || '<tr><td colspan="8" class="text-slate-500">אין מקצועות פעילים</td></tr>'}
              <tr class="room-divider"><td colspan="8">מגמות ומקצועות בחירה (שער 2)</td></tr>${g2}
            </tbody></table></div>
          </section>
          <details id="profile-more" class="card profile-360-card" ${detailsOpen ? 'open' : ''}>
            <summary class="profile-360-more">נתונים נוספים: שאלונים, אירועים וקבוצות</summary>
            <div class="flex flex-wrap gap-2 my-3" role="tablist" aria-label="נתוני חניך">${PROFILE_TABS.map(([id, label]) => `
              <button type="button" role="tab" class="chip" data-act="profTab" data-sub="${id}" aria-selected="${profTab === id}" aria-pressed="${profTab === id}">${label} (${counts[id]})</button>`).join('')}</div>
            <div class="tbl-wrap">${tabTables[profTab]}</div>
          </details>
        </div>
        <aside class="profile-360-side">
          <section class="card profile-360-card"><h3>ממוצעים ומדדים</h3><div id="profile-kpi-slot"></div></section>
          <section class="card profile-360-card"><h3>מקצועות פנימיים</h3><ul class="space-y-1.5 text-xs">${g3}</ul></section>
          <section class="card profile-360-card"><h3>הערת רכזת</h3><div id="profile-note-slot"></div><small id="profile-note-status" role="status">נשמר בשינוי השדה</small></section>
          <details id="profile-quality" class="card profile-360-card profile-360-quality" data-tz="${E(t.tz)}" aria-label="איכות נתונים והחלטת רכזת" ${qualityOpen ? 'open' : ''}>
            <summary><span><strong>איכות נתונים ובדיקת רכזת</strong><small>${E(qualitySummary)}</small></span><span class="profile-360-quality-arrow" aria-hidden="true">⌄</span></summary>
            <div class="profile-360-quality-body">${placementItems ? `<ul class="profile-360-quality-list">${placementItems}</ul>` : ''}${signalList(signal.dataQuality)}${reviewLines.map(line => `<div>${E(line)}</div>`).join('')}</div>
          </details>
        </aside>
      </div>`);
    const kpiSlot = $('profile-kpi-slot'), noteSlot = $('profile-note-slot');
    if (kpiSlot && $('profKpis')) kpiSlot.appendChild($('profKpis'));
    if (noteSlot && $('excNote')) noteSlot.appendChild($('excNote'));

    setHtml('excTrack', `<option value="">לפי המצבת (${E(Config.defaultTrack(t.track, t.classKey))})</option>` +
      Config.TRACKS.map(x => `<option value="${E(x)}" ${ex.trackOverride === x ? 'selected' : ''}>${E(x)}</option>`).join(''));
    setVal('excNote', ex.note);
    const openBtn = $('excOpen');
    if (openBtn) {
      openBtn.dataset.tz = t.tz;
      openBtn.classList.toggle('btn-primary', !!ex.isException);
      openBtn.classList.toggle('btn-ghost', !ex.isException);
      openBtn.textContent = ex.isException ? '⚡ מצב חריג פעיל' : '⚡ הגדר מצב חריג';
    }
  },

  /**
   * מקור יחיד לציונים שוטפים בכרטיס 360°: שורה לכל מקצוע ליבה (שער 1), מגמה (שער 2) ומקצוע נוסף מהסדין / מקבוצות הלימוד.
   * state: ok / fail (ציון < ציון עובר, כולל 0) / missing (רשום בקבוצה או יש רשומת סדין, ללא ציון) / none (אין קבוצה ואין סדין).
   * הטבלה ותיבת ה-KPI "מקצועות נכשלים / חסרים" נבנות מאותן שורות בדיוק.
   */
  profileCurrentModel(t, ev, rules) {
    const prereqs = SignalEngine.prerequisitesFor(t.gradeKey), gradesOn = prereqs.hasSadin;
    const sheet = gradesOn ? GroupAnalyzer.sadinSheet([t], {})[0] : null;
    const sheetSubjects = sheet ? [...sheet.subjects.values()] : [];
    const groupsFor = kw => Store.groupsOf(t.tz).filter(g => !g.reinforcement && Util.matchKeywords(g.subject, kw));
    const classifyCurrent = (avg, subjects, subject) => {
      const events = subjects.flatMap(s => s.events);
      const scored = events.filter(e => e.score != null);
      const counted = scored.some(e => e.weight > 0) ? scored.filter(e => e.weight > 0) : scored;
      const missed = subjects.flatMap(s => [...s.missed.values()]);
      const confirmed = m => {
        const group = Store.groups.get(m.groupId);
        return prereqs.hasGroups && group && group.inFile && group.members.has(t.tz);
      };
      const onlyMissedZeros = avg === 0 && counted.length && counted.every(e =>
        e.score === 0 && subjects.some(s => s.missed.has(e.key)));
      const confirmedMissed = missed.some(confirmed);
      const hasActualFail = counted.some(e => !passingScore(e.score, subject) &&
        !(e.score === 0 && missed.some(m => m.key === e.key)));
      if (onlyMissedZeros) return { state: counted.every(e => missed.some(m => m.key === e.key && confirmed(m))) ? 'missed' : 'unverified', value: avg, missed: confirmedMissed };
      if (avg != null) return { state: passingScore(avg, subject) ? 'ok' : 'fail', value: avg, missed: confirmedMissed, hasActualFail };
      if (missed.length) return { state: missed.some(confirmed) ? 'missed' : 'unverified', value: null };
      return null;
    };
    const status = (keywords, groups, subject) => {
      const entries = Store.currentOf(t.tz).filter(e => Util.matchKeywords(e.subject, keywords));
      const avg = Store.weightedAverage(entries.flatMap(e => e.events)).avg;
      const result = classifyCurrent(avg, sheetSubjects.filter(s => Util.matchKeywords(s.name, keywords)), subject);
      if (result) return result;
      return { state: gradesOn && (entries.length || groups.length) ? 'missing' : 'none', value: null };
    };
    const core = new Map(), majors = new Map(), claimed = [...rules.coreSubjects.map(d => d.keywords)];
    ev.subjects.forEach(s => {
      const def = rules.coreSubjects.find(x => x.id === s.id);
      core.set(s.id, { name: s.name, ...(def ? status(def.keywords, groupsFor(def.keywords), s.name) : { state: 'none', value: null }) });
    });
    ev.major.cands.filter(c => !c.coreId).forEach(c => {
      const def = rules.majors.find(m => m.id === c.id);
      if (def) claimed.push(def.keywords);
      majors.set(c.id, { name: c.name, ...(def ? status(def.keywords, groupsFor(def.keywords), c.name) : { state: 'none', value: null }) });
    });
    /* מקצועות נוספים: כל מקצוע בקבוצות או בסדין שאינו מקצוע ליבה ואינו אחת המגמות המוצגות */
    const extraMap = new Map();
    const extraOf = name => {
      const key = Util.norm(name);
      if (!key || claimed.some(kw => Util.matchKeywords(name, kw))) return null;
      if (!extraMap.has(key)) extraMap.set(key, { name: String(name).trim(), groups: [], events: [], entries: 0 });
      return extraMap.get(key);
    };
    Store.groupsOf(t.tz).filter(g => !g.reinforcement).forEach(g => { const x = extraOf(g.subject); if (x) x.groups.push(g); });
    Store.currentOf(t.tz).forEach(e => { const x = extraOf(e.subject); if (x) { x.entries++; x.events.push(...e.events); } });
    const extras = [...extraMap.values()].map(x => {
      const avg = Store.weightedAverage(x.events).avg;
      const result = classifyCurrent(avg, sheetSubjects.filter(s => Util.norm(s.name) === Util.norm(x.name)), x.name);
      return { ...x, ...(result || { value: null, state: gradesOn && (x.entries || x.groups.length) ? 'missing' : 'none' }) };
    })
      /* מקצועות שגרתיים (חינוך / מגדר / מפגש בוקר) ללא ציון אינם חסר ציון: הם אינם מדורגים מעצם טבעם */
      .filter(x => x.state !== 'none' && !(x.state === 'missing' && isRoutineDuplicateSubject(x.name)))
      .sort((a, b) => natural(a.name, b.name));
    const rows = [...core.values(), ...majors.values(), ...extras];
    return { core, majors, extras, failing: rows.filter(r => r.state === 'fail'), missing: rows.filter(r => r.state === 'missing'), any: gradesOn && t.inGrades };
  },

  /** תא "ציון שוטף": נכשל בטרקוטה מודגשת, "חסר ציון" כתג חרדל, ומקף רק כשאין קבוצה ואין רשומת סדין */
  currentCell(c) {
    if (!c || c.state === 'none') return '<span class="text-slate-400">–</span>';
    if (c.state === 'missing') return '<span class="miss-grade" title="רשום בקבוצה / יש רשומה בסדין ציונים, אך אין ציון שוטף">חסר ציון</span>';
    if (c.state === 'missed') return '<span class="miss-grade">הוחמץ</span>';
    if (c.state === 'unverified') return '<span class="text-slate-500" title="לא ניתן לאמת החמצה ללא שיבוץ מאומת">לא ניתן לאמת</span>';
    const text = E(Util.fmt(c.value, 0));
    return `${c.state === 'fail' ? `<span class="score-alert font-bold">${text} • נכשל</span>` : `<span class="text-slate-800 font-normal">${text}</span>`}${c.missed ? ' <span class="miss-grade">הוחמץ</span>' : ''}`;
  },

  /** תיבות KPI בראש כרטיס החניך: ממוצע החניך מול ממוצע הכיתה, מקצועות נכשלים/חסרים וסטטוס שיבוץ */
  renderProfileKpis(t, cur, prereqs = SignalEngine.prerequisitesFor(t.gradeKey)) {
    const classmates = Store.traineeList().filter(x => x.classKey === t.classKey);
    const sheet = Store.loaded.grades ? GroupAnalyzer.sadinSheet(classmates, {}) : [];
    const mine = sheet.find(r => r.t.tz === t.tz);
    const scores = sheet.filter(r => r.overall != null).map(r => r.overall);
    const classAvg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const own = mine ? mine.overall : null;
    const anomalies = this.placementAnomaliesModel([t]);
    const delta = own != null && classAvg != null ? own - classAvg : null;
    const box = (label, value, sub, cls = '', title = '') => `<div class="prof-kpi"${title ? ` title="${E(title)}"` : ''}><div class="k">${label}</div><div class="v ${cls}">${value}</div><div class="s">${sub}</div></div>`;
    const names = list => { const n = list.map(r => r.name); return n.slice(0, 3).join(', ') + (n.length > 3 ? ` +${n.length - 3}` : ''); };
    const nf = cur.failing.length, nm = cur.missing.length, total = nf + nm;
    const riskSub = !cur.any ? 'אין ציונים שוטפים' : !total ? 'כל המקצועות עוברים' : E([
      nf ? `${nf} ${nf === 1 ? 'נכשל' : 'נכשלו'} (${names(cur.failing)})` : '',
      nm ? `${nm} ${nm === 1 ? 'חסר ציון' : 'חסרי ציון'} (${names(cur.missing)})` : ''
    ].filter(Boolean).join(' • '));
    const riskTitle = [...cur.failing.map(r => `נכשל: ${r.name}`), ...cur.missing.map(r => `חסר ציון: ${r.name}`)].join(' | ');
    const placement = !prereqs.hasGroups ? ['—', 'לא ניתן לקבוע — חסר קובץ קבוצות לשכבה', ''] :
      !anomalies.total ? ['✓ תקין', 'ללא חריגות', 'txt-ok'] :
      [anomalies.total === 1 ? 'חריגה אחת' : `${anomalies.total} חריגות`, E(anomalies.byTrainee.get(t.tz).text), anomalies.rows.some(r => r.kind !== 'sadin' && r.kind !== 'nomajor') ? 'txt-bad' : anomalies.rows.some(r => r.kind === 'nomajor') ? 'txt-warn' : 'text-slate-600'];
    setHtml('profKpis', [
      box('ממוצע חניך', own == null ? '—' : Util.fmt(own, 1),
        delta == null ? 'אין ציונים שוטפים' : `${delta >= 0 ? '+' : ''}${Util.fmt(delta, 1)} ביחס לכיתה`, own != null && delta != null && delta < 0 ? 'txt-warn' : ''),
      box('ממוצע כיתתי', classAvg == null ? '—' : Util.fmt(classAvg, 1), `${E(Config.classLabel(t.classKey))} · ${scores.length} חניכים עם ציונים`),
      box('מקצועות נכשלים / חסרים (ציון שוטף)', cur.any ? total : '—', riskSub, total ? (nf ? 'txt-bad' : 'txt-warn') : cur.any ? 'txt-ok' : '', riskTitle),
      box('סטטוס שיבוץ בקבוצות', placement[0], placement[1], placement[2], anomalies.total && prereqs.hasGroups ? anomalies.byTrainee.get(t.tz).text : '')
    ].join(''));
  },

  /** מכל הלשוניות: האלמנט הפנימי שגולל (עטיפת הטבלה עם הכותרת הצמודה) */
  navScrollTarget(tab) {
    if (tab === 'bagrut') return $('bagrut-table');
    if (tab === 'sadin') return document.querySelector('#sadin-table .sticky-scroll') || $('sadin-table');
    if (tab === 'groups') return document.querySelector(this.state.groupsViewMode === 'explorer' ? '#groups-detail .sticky-scroll' : '#groups-table .sticky-scroll');
    return null;
  },

  /** שומר את הקשר המקור לפני מעבר לכרטיס: לשונית, תצוגה, גלילות, החניך והסדר הנראה של החניכים בטבלה שממנה לחצו */
  captureNavOrigin(tz, el) {
    const st = this.state, tab = st.tab;
    const root = (el && el.closest && el.closest('table')) || $(`panel-${tab}`);
    const SEL = '[data-act="openProfile"][data-tz], [data-act="openBoardProfile"][data-tz]';
    let list = [...new Set([...(root ? root.querySelectorAll(SEL) : [])].map(n => n.dataset.tz))];
    if (list.length < 2 || !list.includes(tz)) {
      list = this.filtered(false).map(t => t.tz);
      if (!list.includes(tz)) list = [tz];
    }
    const scroller = this.navScrollTarget(tab), master = $('groups-master'), main = $('mainContent');
    st.navOrigin = {
      tab, tz, orderedTzList: list,
      subView: tab === 'groups' ? st.groupsViewMode : tab === 'sadin' ? st.sadin.view : tab === 'bagrut' ? st.bagrut.drill : '',
      label: tab === 'sadin' && st.sadin.view === 'flat' ? 'פירוט ציונים' : this.NAV_LABELS[tab] || 'מסך קודם',
      scrollTop: main ? main.scrollTop : 0, windowScrollTop: window.scrollY,
      containerScrollTop: scroller ? scroller.scrollTop : 0, masterScrollTop: tab === 'groups' && master ? master.scrollTop : 0
    };
    /* רשומת היסטוריה אחת לכל כניסה לכרטיס: כפתור "אחורה" בדפדפן או בעכבר חוזר למסך המקור */
    try { history.pushState({ sdProfile: true }, ''); this._histPushed = true; } catch (e) { this._histPushed = false; }
  },

  openProfile(tz, el) {
    const o = this.state.navOrigin;
    if (this.state.tab !== 'profile') this.captureNavOrigin(tz, el);
    else if (o) {
      o.tz = tz;
      if (o.orderedTzList && !o.orderedTzList.includes(tz)) o.orderedTzList = null;
    }
    this.state.profileTz = tz;
    this.dirty.add('profile');
    this.closeModal();
    this.showTab('profile');
    this.scrollToTop();
  },

  /** מעבר לחניך אחר בכרטיס; מעדכן את navOrigin.tz כדי שהחזרה לטבלה תגלול ותדגיש את החניך האחרון שנצפה */
  setProfile(tz) {
    this.state.profileTz = tz;
    if (this.state.navOrigin) this.state.navOrigin.tz = tz;
    this.dirty.add('profile');
    this.renderTab('profile');
    this.scrollToTop();
  },

  /** מעבר יחסי בין חניכים ברשימת 360 (ללא כפתורים במסך; נשמר לבדיקות ולקריאות פנימיות) */
  profileStep(d) {
    const list = this.profileList();
    const i = list.findIndex(t => t.tz === this.state.profileTz) + d;
    if (list[i]) this.setProfile(list[i].tz);
  },

  renderProfileNav(pos, total) {
    const o = this.state.navOrigin, back = $('profBack');
    if (back) {
      back.classList.toggle('hidden', !o);
      if (o) back.textContent = `→ חזרה ל${o.label}`;
    }
    setText('profPos', total ? `חניך ${pos} מתוך ${total}` : '');
  },

  /** כפתור/Esc: דרך ההיסטוריה, כדי שמחסנית הדפדפן תישאר עקבית; popstate מבצע את החזרה בפועל */
  profBack() {
    if (!this.state.navOrigin) return;
    if (this._histPushed) {
      history.back();
      setTimeout(() => { if (this.state.tab === 'profile' && this.state.navOrigin) this.returnToOrigin(); }, 400);
    } else this.returnToOrigin();
  },

  returnToOrigin() {
    const o = this.state.navOrigin;
    if (!o) return;
    this.state.navOrigin = null;
    this._histPushed = false;
    this.dirty.add('profile');
    this.showTab(o.tab);
    const main = $('mainContent');
    const apply = () => {
      if (main) main.scrollTop = o.scrollTop;
      window.scrollTo(0, o.windowScrollTop);
      const scroller = this.navScrollTarget(o.tab);
      if (scroller) scroller.scrollTop = o.containerScrollTop;
      const master = $('groups-master');
      if (master && o.tab === 'groups') master.scrollTop = o.masterScrollTop;
    };
    apply();
    setTimeout(() => {
      apply();
      const panel = $(`panel-${o.tab}`);
      const hit = panel && [...panel.querySelectorAll('[data-tz]')].find(n => n.dataset.tz === o.tz && /^(openProfile|openBoardProfile)$/.test(n.dataset.act));
      const row = hit && (hit.closest('tr') || hit);
      if (!row) return;
      const box = (this.navScrollTarget(o.tab) || main).getBoundingClientRect(), r = row.getBoundingClientRect();
      if (r.top < box.top + 40 || r.bottom > box.bottom) row.scrollIntoView({ block: 'center' });
      row.classList.add('nav-flash');
      setTimeout(() => row.classList.remove('nav-flash'), 2600);
    }, 30);
  },

  scrollToTop() { $('mainContent').scrollTop = 0; window.scrollTo({ top: 0 }); },

  saveProfileField(patch) {
    const tz = this.state.profileTz;
    if (!tz) return;
    const res = Config.setException(tz, patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'note')) setText('profile-note-status', res.ok === false ? 'השמירה נכשלה' : 'ההערה נשמרה');
    this.toast(res.ok === false ? res.error : 'נשמר', res.ok === false ? 'error' : 'ok');
  },

  };
})();
