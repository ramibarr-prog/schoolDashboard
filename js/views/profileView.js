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
    const active = !!ex.isException;
    const dim = active ? '' : ' opacity-50';
    this.openModal(`
      <h3 class="text-lg font-semibold mb-1">⚡ מצב חריג – ${E(t.name)}</h3>
      <p class="text-xs text-slate-500 mb-3">ת.ז ${E(t.tz)} · ${E(Config.classLabel(t.classKey))}</p>
      ${ev.isPotentialException ? `<div class="text-sm bg-violet-50 text-violet-800 rounded-lg p-2 mb-3">חשד לחריג: ${E(ev.potentialExceptionReason)}</div>` : ''}
      ${ev.manualReview && ev.manualReview.required ? `<div class="text-sm bg-violet-50 text-violet-800 rounded-lg p-2 mb-3">🔎 נדרשת החלטת רכזת:<br>${this.manualReviewLines(ev).map(l => E(l)).join('<br>')}</div>` : ''}
      <label class="flex items-center gap-2 text-sm mb-3"><input type="checkbox" id="xmIs" class="w-4 h-4" ${active ? 'checked' : ''}>הכרעה ידנית (עוקפת חישוב אוטומטי)</label>
      <label class="flex flex-col gap-1 text-sm mb-3${dim}" data-xm-field>סטטוס מוכרע
        <select id="xmStatus" class="inp" ${active ? '' : 'disabled'}>${Config.OVERRIDE_STATUSES.map(s => `<option value="${s.value}" ${(ex.overrideStatus || 'atrisk') === s.value ? 'selected' : ''}>${E(s.label)}</option>`).join('')}</select></label>
      <label class="flex flex-col gap-1 text-sm${dim}" data-xm-field>סיבת החריג
        <input id="xmReason" class="inp" maxlength="200" value="${E(ex.reason)}" placeholder="למשל: עולה חדש – הקלות שפה / המרת שאלון מבי&quot;ס קודם" ${active ? '' : 'disabled'}></label>
      <div class="flex gap-2 mt-4">
        <button type="button" class="btn btn-primary" data-act="excModalSave" data-tz="${E(t.tz)}">שמירה</button>
        <button type="button" class="btn btn-ghost" data-act="excModalClear" data-tz="${E(t.tz)}">הסרת חריג</button>
        <button type="button" class="btn btn-ghost mr-auto" data-act="closeModal">סגירה</button>
      </div>`);
    const xmIs = $('xmIs');
    const syncFields = () => {
      const on = !!(xmIs && xmIs.checked);
      ['xmStatus', 'xmReason'].forEach(id => {
        const field = $(id);
        if (!field) return;
        field.disabled = !on;
        const wrap = field.closest('[data-xm-field]');
        if (wrap) wrap.classList.toggle('opacity-50', !on);
      });
    };
    syncFields();
    if (xmIs) xmIs.addEventListener('change', syncFields);
  },

  saveProfileException(el) {
    const tz = el.dataset.tz;
    const prev = !!Config.getException(tz).isException;
    const is = $('xmIs') ? $('xmIs').checked : false;
    const res = Config.setException(tz, {
      isException: is,
      overrideStatus: is && $('xmStatus') ? $('xmStatus').value : '',
      reason: is && $('xmReason') ? $('xmReason').value.trim() : ''
    });
    this.closeModal();
    if (res.ok === false) {
      this.toast(res.error, 'error');
    } else if (is) {
      this.toast('החריג נשמר', 'ok');
    } else if (prev) {
      this.toast('ההכרעה הידנית הוסרה — חזר לחישוב אוטומטי', 'info');
    } else {
      this.toast('לא הופעלה הכרעה ידנית — נשאר חישוב אוטומטי', 'info');
    }
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
    if (s.compApplied) return badge('tier-3', `${s.forecast || s.source === 'current' ? 'תחזית ' : ''}${s.compApplied === 'points' ? 'קומפנסציה' : 'קיזוז'} (${Util.fmt(s.adj, 0)})`);
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
      items.push(`${s.name}${s.variableUnits && s.units ? ` ${s.units} יח"ל` : ''}: ציון ${Util.fmt(s.adj, 0)}${low ? ` בשאלון ${low.code}` : ''} (${s.forecast || s.source === 'current' ? 'תחזית ' : 'מופעל '}${s.compApplied === 'points' ? 'קומפנסציה' : 'קיזוז'})`);
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
    this.renderTrainee360Inner();
  },

  /** חיווי לקריאה בלבד: מצב ההערכה שבו מוצג כרטיס 360° (נגזר מהבחירה בלשונית צפי זכאות לבגרות) */
  profileModeBadge(t, ev) {
    const [cls, text, title] = t.gradeKey !== 'יב'
      ? ['badge fresh-slate', '📅 קצב צבירה (מותאם לשלב בשנה)', 'שכבות י\' ו-י"א נשפטות תמיד לפי קצב צבירה (מותאם לשלב בשנה), ללא תלות בבדיקה במסך הזכאות']
      : ev.adaptive
        ? ['badge fresh-slate', '📅 צפי מותאם לשלב בשנה', 'מצב ההערכה הכללי במערכת: צפי מותאם לשלב בשנה; בדיקת הזכאות לסוף י״ב נפרדת']
        : ['badge bg-indigo-50 text-indigo-800 border-indigo-200', '🎓 מצב תעודה סופית (סוף י"ב)', 'מצב ההערכה הכללי במערכת: תעודה סופית — כל השאלונים והיחידות הפנימיות נדרשים'];
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
    return Config.withRulesForGrade(t.gradeKey, () => {
    this.state.profileTz = t.tz;
    const ev = this.getEval(t.tz), ex = Config.getException(t.tz), rules = Config.rules();
    const signal = SignalEngine.computeForTrainee(t.tz, this.state.sim);
    const bagrutUnknown = signal.pedagogical.some(f => f.id === 'bagrut.unknown');
    const breakdown = UI.buildBagrutBreakdown(t, ev, { noData: bagrutUnknown, className: Config.classLabel(t.classKey) });
    ['excTrack', 'excNote', 'excOpen', 'profilePin'].forEach(id => { if ($(id)) $(id).disabled = false; });

    if (sel) sel.innerHTML = list.map(x => `<option value="${E(x.tz)}" ${x.tz === t.tz ? 'selected' : ''}>${E(Config.classLabel(x.classKey))} · ${E(x.name)}</option>`).join('');
    this.renderProfileNav(idx + 1, list.length);
    setText('profName', t.name);
    setHtml('profMeta', `ת.ז ${E(t.tz)} · שכבה ${E(Util.gl(t.gradeKey))} · ${E(Config.classLabel(t.classKey))}${this.overrideBadge(t.tz)} · מסלול ${E(this.trackOf(t))}`);
    const units = breakdown.totalUnits;
    const unitsLabel = units == null ? 'לא ניתן לקבוע יח״ל' : breakdown.enforceUnits ? `${units} מתוך 21 יח״ל` : `${units} יח״ל נצברו עד כה`;
    const mainStatusBadge = bagrutUnknown ? UI.signalBadge('bagrut.unknown').replace('class="badge', 'class="badge prof-status') :
      ev.manualReview.required ? `<span class="badge tier-3 prof-status" title="${E(`חישוב אוטומטי: ${ev.tierText} | ${this.manualReviewLines(ev).join(' | ')}`)}">נדרשת החלטת רכזת</span>` :
      this.tierBased(ev) ? `<span class="badge tier-${ev.tier} prof-status" title="${E(ev.diagnostic)}">${E(ev.tierText)}</span>` : this.paceBadge(ev).replace('class="badge', 'class="prof-status badge');
    setHtml('profBadges', `${mainStatusBadge}${this.profileModeBadge(t, ev)}`);
    const pin = $('profilePin');
    if (pin) {
      const pinned = BagrutView.chipMatch.call(this, { t, ev }, 'pinned', signal);
      pin.dataset.tz = t.tz; pin.setAttribute('aria-pressed', String(pinned));
      pin.textContent = `${pinned ? '★' : '☆'} מעקב צמוד`;
      pin.setAttribute('aria-label', pinned ? 'הסרה ממעקב צמוד' : 'הוספה למעקב צמוד');
    }
    const cur = this.profileCurrentModel(t, ev, rules);
    const mapModel = signal.prereqs.hasGroups ? this.studentMapModel(t.tz) : null;
    const placementIssues = mapModel ? mapModel.tiles.filter(x => x.status !== 'ok') : [];
    const placementCount = placementIssues.length;
    this.renderProfileKpis(t, cur, signal.prereqs, mapModel);
    const groupsFor = keywords => Store.groupsOf(t.tz).filter(g => !g.reinforcement && Util.matchKeywords(g.subject, keywords));
    const groupText = groups => {
      if (!groups.length) return '<span class="text-slate-500">—</span>';
      return `<span class="flex max-w-[11rem] items-center gap-1" title="${E(groups.map(g => `${g.teacher || 'ללא מורה'} [${g.groupId}]`).join(' · '))}"><span class="truncate min-w-0">${E(groups[0].teacher || 'ללא מורה')}</span>${groups.length > 1 ? `<span class="shrink-0">(+${groups.length - 1})</span>` : ''}</span>`;
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
      const subjectUnits = this.profileSubjectUnits(t.tz, s, def);
      const external = s.comps.filter(c => !c.internal), internal = s.comps.filter(c => c.internal);
      const partial = s.pending.length || s.unresolved.length;
      const value = partial && s.reportedScore != null ? s.reportedScore : s.adj;
      const suffix = partial && s.reportedScore != null ? ` (${s.reportedPct}%)` : s.forecast ? ' (תחזית)' : s.source === 'current' ? ' (שוטף)' : s.boosted ? ' (סימולציה)' : '';
      const status = breakdown.isTrack12 ? '<span class="badge fresh-slate">מסלול 12 שנות לימוד</span>' :
        s.incomplete && !s.comps.some(c => c.failed || c.blocked) ? '<span class="badge tier-3">נצברו</span>' : this.profileSubjectStatus(s);
      const final = s.exempt ? '<span class="text-amber-700 font-semibold">פטור</span>' : s.incomplete ? `<span class="profile-360-partial">${E(this.subjectDisplayCell(ev, s.id).text)} · נצברו</span>` : value != null ? scoreText(value, `${Util.fmt(value, 1)}${suffix}`, !!s.compApplied) : s.allPass ? 'עבר' : '—';
      return `<tr data-act="profileSubjectToggle"><td><strong>${E(s.name)}</strong>${subjectUnits ? ` <span class="text-slate-500">· ${E(subjectUnits)} יח׳</span>` : ''}</td>
        <td>${this.profileComponents(external, s.variableUnits)} ${examProgress(external, s.name)}</td><td>${this.profileComponents(internal, false)}</td>
        <td>${final}</td><td>${status}</td><td>${details(s.comps, s.reverse)}</td></tr>`;
    }).join('');
    const majors = ev.major.cands.filter(c => !c.coreId);
    const majorRows = majors.map(c => {
      const def = rules.majors.find(m => m.id === c.id);
      const groups = def ? groupsFor(def.keywords) : [];
      const units = groups.find(g => Number(g.units) === Number(c.units)) || groups.find(g => g.units);
      const codes = def ? def.codes.filter(code => Store.bagrutBest(t.tz, [code])) : [];
      const requiredUnits = (rules.gates && rules.gates.major && rules.gates.major.requiredUnits) || 5;
      const status = breakdown.isTrack12 ? '<span class="badge fresh-slate">מסלול 12 שנות לימוד</span>' : c.units < requiredUnits ? '<span class="text-slate-500">לא מגמה מורחבת</span>' : c.exempt ? '<span class="badge tier-3">פטור — נדרשת החלטת רכזת</span>' : c.blocked || c.failed ? '<span class="badge tier-4">לא עבר</span>' : c.status === 'fail' ? '<span class="badge tier-4">נכשל</span>' : c.status === 'pass' && c.source === 'bagrut' && c.complete && !c.forecast ? '<span class="text-emerald-700 font-semibold">✓ עובר</span>' : `<span class="text-slate-500">${!c.complete && c.bagrut != null ? 'נצברו' : c.enrolled ? 'לומד' : 'ממתין לדיווח'}</span>`;
      const value = c.adj != null ? c.adj : c.bagrut;
      const detail = c.adj != null ? (c.forecast ? 'תחזית' : c.source === 'current' ? 'שוטף' : '') : c.bagrut != null ? 'חלקי' : c.missing.length ? 'חלקי' : '';
      const comps = (def ? def.codes : []).map(code => {
        const best = Store.bagrutBest(t.tz, [code]);
        return { code, state: best ? best.kind : 'missing', num: best && best.num, failed: best && best.kind === 'fail', blocked: best && best.block, weight: def.weights && def.weights[code], alternative: def.codeMode === 'any' };
      });
      return `<tr data-act="profileSubjectToggle"><td><strong>${E(c.name)}</strong>${units ? ` <span class="text-slate-500">· ${E(units.units)} יח׳</span>` : ''}</td>
        <td title="${E(codes.length ? `שאלונים: ${codes.join(', ')}` : '')}">${c.bagrut != null ? scoreText(c.bagrut) : c.exempt ? 'פטור' : c.bagrutPass ? 'עבר' : '—'}</td><td class="text-slate-400">—</td><td>${c.exempt ? '<span class="text-amber-700 font-semibold">פטור</span>' : value != null ? `${scoreText(value, detail)}${!c.complete ? ' · ציון חלקי' : ''}` : c.bagrutPass ? `<span title="${E(detail)}">עבר</span>` : '—'}</td><td>${status}</td><td>${details(comps)}</td></tr>`;
    });
    const missingMajor = !breakdown.isTrack12 && !bagrutUnknown && (signal.prereqs.hasGroups || ev.mode === 'full' && !ev.adaptive) && ev.blockers.some(b => b.k === 'major-none') ? '<tr><td colspan="6" class="score-alert">ללא מגמה — חסר מקצוע מורחב 5 יח"ל</td></tr>' : '';
    const g2 = missingMajor + majorRows.join('') || `<tr><td colspan="6" class="text-slate-500">${ev.major.chosen && ev.major.chosen.coreId ? 'מקצוע מורחב נכלל במקצועות הליבה' : 'לא נמצאה מגמת בחירה'}</td></tr>`;
    const g3 = ev.internals.map(i => {
      const label = i.id === 'pe' ? 'חינוך גופני' : i.name;
      const cls = i.explicitFail ? 'badge tier-4' : i.done || i.exempt ? 'text-emerald-700 font-semibold' : 'text-slate-500';
      const text = i.explicitFail ? 'לא עבר' : i.exempt ? '✓ פטור' : i.done ? '✓ עבר' : i.ignored ? 'הוזנח בסימולציה' : typeof i.value === 'number' ? `ציון ${i.value} – לבדיקה` : 'בתהליך';
      return `<li class="flex justify-between items-center gap-1"><span class="font-medium">${E(label)}</span><span class="${cls} whitespace-nowrap">${E(text)}</span></li>`;
    }).join('');

    const groupsRows = Store.groupsOf(t.tz).map(g => {
      const e = Store.activeCurrentOf(t.tz).find(x => x.groupId === g.groupId);
      return `<tr><td>[${E(g.groupId)}]</td><td class="font-medium">${E(g.subject)}</td><td>${E(g.teacher || '—')}</td><td class="${e && e.avg != null && !passingScore(e.avg, e.subject) ? 'text-red-600 font-semibold' : ''}">${e ? Util.fmt(e.avg, 1) : '—'}</td></tr>`;
    }).join('');
    const inactive = Store.inactiveCurrentOf(t.tz);
    const inactiveRows = inactive.map(e => {
      const g = Store.groups.get(e.groupId);
      return `<li>${E(e.subject || 'ללא מקצוע')} · [${E(e.groupId)}] · ${E((g && g.teacher) || e.teacher || 'ללא מורה')} · ממוצע ${E(Util.fmt(e.avg, 1))}${e.enrollmentStatus === 'unassigned' ? ' · ללא שיבוץ' : ''}</li>`;
    }).join('');
    const events = Store.currentOf(t.tz).flatMap(e => e.events.map(x => ({ ...x, subj: e.subject, enrollmentStatus: e.enrollmentStatus })));
    const eventId = e => JSON.stringify([e.groupId || '', e.eventName || '', e.date || '', e.weight]);
    const missedEvents = new Map();
    if (cur.sheet) cur.sheet.subjects.forEach(subject => {
      subject.missed.forEach(m => {
        const group = Store.groups.get(m.groupId);
        const confirmed = signal.prereqs.hasGroups && group && group.inFile && group.members.has(t.tz);
        missedEvents.set(eventId(m), !!confirmed);
        if (subject.events.some(e => e.key === m.key)) return;
        events.push({ ...m, subj: subject.name, enrollmentStatus: 'active', inferred: true, confirmed });
      });
    });
    events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const eventsRows = events.map(x => {
      const active = x.enrollmentStatus === 'active', missed = active && missedEvents.get(eventId(x));
      const value = x.inferred ? (x.confirmed ? 'חסר (הוסק משיבוץ)' : 'לא ניתן לאמת שיבוץ') :
        x.score != null ? `${x.score}${x.score === 0 && missed ? ' · הוחמץ' : ''}` :
          x.scoreRaw || (!active || missed ? 'חסר' : missedEvents.has(eventId(x)) ? 'לא ניתן לאמת שיבוץ' : '—');
      return `<tr><td>${E(x.date || '—')}</td><td>${E(x.subj)}${!active ? ` <span class="text-slate-500 text-xs">${x.enrollmentStatus === 'moved' ? 'קבוצה קודמת' : 'ללא שיבוץ'}</span>` : ''}</td><td>${E(x.eventName)}</td><td>${E(x.weight)}</td>
        <td class="${!active || (x.inferred && !x.confirmed) ? 'text-slate-500' : x.score == null || x.score === 0 ? 'text-amber-600' : !passingScore(x.score, x.subj) ? 'text-red-600 font-semibold' : ''}">${E(value)}</td></tr>`;
    }).join('');
    const attRows = Store.attemptsOf(t.tz).sort((a, b) => natural(a.code, b.code) || natural(a.moed, b.moed)).map(a => {
      const exempt = a.cls.exempt || Parser.classify(a.shown || a.final || a.scoreRaw).exempt;
      const internalDef = rules.internals.find(i => i.codes.includes(a.code)), internal = !!internalDef;
      /* כמו שער 3 במנוע: מעורבות חברתית בסולם 1–4 – 2–4 עבר, 0–1 לא עבר; ציון 0–100 נשפט לפי ציון עובר */
      const social = internalDef ? internalDef.scale === '1-4' || internalDef.id === 'social' : String(a.code) === '86083' || /מעורבות חברתית/.test(a.subject || '');
      const cls = exempt ? (internal ? ['text-emerald-700 font-semibold', '✓ פטור'] : ['badge tier-3', 'פטור — נדרשת החלטת רכזת']) :
        a.partial ? ['text-slate-500', 'ניסיון חלקי'] :
        a.cls.kind === 'num' ? (SignalEngine.isPassingScore(a.cls.num, { social }) ? ['text-emerald-700 font-semibold', '✓ עבר'] : social && a.cls.num <= 1 ? ['badge tier-4', 'לא עבר'] : ['badge tier-4', 'נכשל']) : a.cls.kind === 'pass' ? ['text-emerald-700 font-semibold', '✓ עבר'] : a.cls.kind === 'fail' ? ['badge tier-4', 'לא עבר'] : ['text-slate-500', '—'];
      return `<tr><td>${E(a.code)}</td><td class="text-xs">${E((rules.questionnaires[a.code] || {}).name || '')}</td><td>${E(a.subject)}</td>
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
      text, category: ev.reverse.some(r => text.includes(r.subject)) || /קיזוז|קומפנסציה/.test(text) ? 'משפר ציון' : 'חוסם זכאות'
    }));
    const actionList = rows => `<ul class="profile-360-focus-list">${rows.map(item => `<li><span class="profile-360-focus-tag">${E(item.category)}</span><span>${E(item.text)}</span></li>`).join('')}</ul>`;
    const visibleFocus = focusItems.slice(0, 4);
    const remainingFocus = focusItems.slice(4);
    const hasGrades = ev.subjects.some(s => s.comps.some(c => c.state === 'num' || c.state === 'pass')) || majors.some(c => c.bagrut != null);
    const focusHtml = breakdown.isTrack12 ? '<p class="text-slate-600">החניך נמצא במסלול 12 שנות לימוד.</p>' : bagrutUnknown ? '<p class="text-slate-600">לא ניתן לקבוע יעדי בגרות — חסרים נתוני בגרות לשכבה.</p>' : focus.length ? actionList(visibleFocus) :
      ev.tier === 0 && !ev.manual || !hasGrades ? '<p class="text-slate-600">אין מספיק נתוני בגרות להצגת יעדים.</p>' : ev.manualReview.required ? '<p class="text-slate-600">לא אותרו חסמים פדגוגיים נוספים.</p>' : '<p class="text-emerald-700 font-semibold">✓ אין חסמים פתוחים — כל הבחינות שהתקיימו עברו בהצלחה</p>';
    const paceLine = bagrutUnknown || this.tierBased(ev) ? '' : `<p class="mb-1.5 flex flex-wrap items-center gap-1.5">${this.paceBadge(ev)}<span>${ev.paceInfo.passedDueCount} מתוך ${ev.paceInfo.dueCount} שאלונים שמועדם הגיע עברו${ev.paceInfo.futureCount ? ` · ${ev.paceInfo.futureCount} עתידיים` : ''}</span></p>`;

    /* 1. תמצית זכאות לבגרות */
    const bagrutStatusLabel = bagrutUnknown ? 'חסרים נתוני בגרות לשכבה' : ev.manualReview.required ? 'נדרשת החלטת רכזת' : this.tierBased(ev) ? ev.tierText : ev.paceText;
    const bagrutCountsText = breakdown.isTrack12 ? 'מסלול 12 שנות לימוד' : breakdown.noData ? 'לא ניתן לקבוע חסמים' : `${breakdown.subjectCount} מקצועות חוסמים · ${breakdown.internalCount} חסמים פנימיים`;
    const bagrutSummary = [bagrutStatusLabel, unitsLabel, !breakdown.noData && !breakdown.isTrack12 ? bagrutCountsText : ''].filter(Boolean).join(' · ');
    const bagrutTone = !bagrutUnknown && !breakdown.isTrack12 && (ev.atRisk || breakdown.subjectCount > 0) ? 'is-warn' : '';

    /* 2. תמצית וטבלת שיבוצים וקבוצות (1:1 מול studentMapModel) */
    const placementSummary = !signal.prereqs.hasGroups ? 'לא ניתן לבדוק שיבוץ ללא קובץ קבוצות לשכבה' :
      !mapModel || !mapModel.tiles.length ? 'לא נמצאו שיבוצים לחניך זה' :
      !placementCount ? `הכול תקין · ${mapModel.tiles.length} מקצועות` :
      `${placementCount === 1 ? 'חריגת שיבוץ אחת' : `${placementCount} חריגות שיבוץ`}`;
    const placementTone = placementCount ? (mapModel.counts.missing ? 'is-bad' : 'is-warn') : '';
    const placementMapRows = mapModel ? mapModel.tiles.map(tile => {
      const statusCls = tile.status === 'ok' ? 'text-emerald-700 font-semibold' : tile.status === 'missing' ? 'score-alert font-semibold' : 'text-amber-700 font-semibold';
      const statusTxt = tile.status === 'ok' ? '✓ תקין' : tile.status === 'missing' ? `ללא שיבוץ (${tile.sub})` : tile.sub;
      const groupCol = tile.status === 'missing' ? '<span class="text-slate-500">ללא שיבוץ</span>' : E(tile.teacher || 'ללא מורה');
      const actionCol = tile.status !== 'ok' ? `<button type="button" class="profile-360-fix" data-act="inspectGroups" data-tz="${E(t.tz)}" data-subject="${E(tile.subject)}">השוואת קבוצות</button>` : '';
      return `<tr><td><strong>${E(tile.label)}</strong></td><td>${groupCol}</td><td><span class="${statusCls}">${E(statusTxt)}</span>${actionCol ? ` ${actionCol}` : ''}</td></tr>`;
    }).join('') : '';
    const signalList = flags => flags.map(f => `<div class="flex flex-wrap items-center gap-1.5">${UI.signalBadge(f)}${f.detail ? `<span class="text-xs text-slate-600">${E(f.detail)}</span>` : ''}</div>`).join('');
    const reviewLines = [...new Set([...reviewReasons, ...(ev.manualReview.required ? this.manualReviewLines(ev) : []), ...(ev.manualReview.required ? ev.suspectExtra : ev.suspect)])];
    const qualityHtml = signal.dataQuality.length || reviewLines.length
      ? `<div id="profile-quality" class="p360-quality-note" data-tz="${E(t.tz)}"><strong>הערות איכות נתונים ובדיקת רכזת</strong>${signalList(signal.dataQuality)}${reviewLines.map(line => `<div>${E(line)}</div>`).join('')}</div>`
      : '';

    /* 3. תמצית וטבלת ציונים שוטפים */
    const currentEntries = [
      ...ev.subjects.map(s => {
        const def = rules.coreSubjects.find(x => x.id === s.id);
        return { name: s.name, groups: def ? groupsFor(def.keywords) : [], cur: cur.core.get(s.id) };
      }),
      ...majors.map(c => {
        const def = rules.majors.find(m => m.id === c.id);
        return { name: c.name, groups: def ? groupsFor(def.keywords) : [], cur: cur.majors.get(c.id) };
      }),
      ...cur.extras.map(x => ({ name: x.name, groups: x.groups, cur: x }))
    ].filter(x => x.cur && x.cur.state !== 'none' || x.groups.length);
    const totalMissed = currentEntries.reduce((sum, x) => sum + ((x.cur && x.cur.missed) || 0), 0);
    const sadinAvg = cur.sheet && cur.sheet.overall != null ? Util.fmt(cur.sheet.overall, 1) : null;
    const sadinSummary = !signal.prereqs.hasSadin ? 'חסר קובץ ציונים שוטפים לשכבה' :
      !cur.any ? 'אין ציונים שוטפים' :
      [sadinAvg != null ? `ממוצע ${sadinAvg}` : '', cur.failing.length ? `${cur.failing.length} נכשלים` : '', totalMissed ? `${totalMissed} הוחמצו` : '', cur.missing.length ? `${cur.missing.length} חסרי ציון` : ''].filter(Boolean).join(' · ') || 'כל המקצועות עוברים';
    const sadinTone = cur.failing.length ? 'is-bad' : (totalMissed || cur.missing.length) ? 'is-warn' : '';
    const sadinRows = currentEntries.map(x => {
      const mCount = (x.cur && x.cur.missed) || 0;
      return `<tr><td><strong>${E(x.name)}</strong></td><td>${x.groups.length ? groupText(x.groups) : '<span class="text-slate-500">ללא שיבוץ</span>'}</td><td>${this.currentCell(x.cur)}</td><td>${mCount ? `<span class="miss-grade">${mCount}</span>` : '<span class="text-slate-400">—</span>'}</td></tr>`;
    }).join('');

    /* 4. תמצית מקצועות פנימיים */
    const internalDone = ev.internals.filter(i => i.done || i.exempt).length;
    const internalSummary = breakdown.isTrack12 ? 'מסלול 12 שנות לימוד' :
      breakdown.internalCount > 0 ? `${breakdown.internalCount} חסמים פנימיים · ${internalDone}/${ev.internals.length} הושלמו` :
      internalDone === ev.internals.length && ev.internals.length ? `${internalDone}/${ev.internals.length} עובר` :
      `${internalDone}/${ev.internals.length} הושלמו · בתהליך`;
    const internalTone = !breakdown.isTrack12 && breakdown.internalCount > 0 ? 'is-warn' : '';

    setHtml('profBody', `
      <div class="p360-sheet">
        <section class="card p360-snapshot" aria-label="תמונת מצב קצרה"><div id="profile-kpi-slot"></div></section>
        <div class="card p360-accordion">
          <details class="p360-sec" data-p360-sec="bagrut">
            <summary><div class="p360-sec-head"><strong>זכאות לבגרות</strong><span class="p360-sec-sub ${bagrutTone}">${E(bagrutSummary)}</span></div><span class="p360-chevron" aria-hidden="true">⌄</span></summary>
            <div class="p360-sec-body">
              <div class="p360-focus"><h3 class="p360-subhead">מיקוד פדגוגי ויעדים לחניך</h3>${paceLine}${focusHtml}${remainingFocus.length ? `<details><summary class="profile-360-more">עוד ${remainingFocus.length} פעולות</summary>${actionList(remainingFocus)}</details>` : ''}${bagrutUnknown || breakdown.isTrack12 ? '' : this.advisoryHtml(ev)}</div>
              <section id="profile-academic" class="profile-360-academic">
                <div class="tbl-wrap"><table class="grid w-full" aria-label="מקצועות בגרות — ליבה ומגמות"><thead><tr><th>מקצוע ויח״ל</th><th>בחינה חיצונית</th><th>הערכה פנימית</th><th>סופי / מצטבר</th><th>סטטוס</th><th>פירוט</th></tr></thead><tbody>
                  <tr class="room-divider"><td colspan="6">מקצועות ליבה (שער 1)</td></tr>${g1 || '<tr><td colspan="6" class="text-slate-500">אין מקצועות פעילים</td></tr>'}
                  <tr class="room-divider"><td colspan="6">מגמות ומקצועות בחירה (שער 2)</td></tr>${g2}
                </tbody></table></div>
              </section>
              <details id="profile-more" class="p360-sub-details">
                <summary class="profile-360-more">נתוני מקור: שאלונים, אירועים וקבוצות</summary>
                <div class="flex flex-wrap gap-2 my-2" role="tablist" aria-label="נתוני חניך">${PROFILE_TABS.map(([id, label]) => `
                  <button type="button" role="tab" class="chip" data-act="profTab" data-sub="${id}" aria-selected="${profTab === id}" aria-pressed="${profTab === id}">${label} (${counts[id]})</button>`).join('')}</div>
                <div class="tbl-wrap">${tabTables[profTab]}</div>
              </details>
            </div>
          </details>
          <details class="p360-sec" data-p360-sec="groups">
            <summary><div class="p360-sec-head"><strong>שיבוצים וקבוצות</strong><span class="p360-sec-sub ${placementTone}">${E(placementSummary)}</span></div><span class="p360-chevron" aria-hidden="true">⌄</span></summary>
            <div class="p360-sec-body">
              ${!signal.prereqs.hasGroups ? `<p class="text-slate-500 text-xs">${UI.signalBadge('placement.unknown')}</p>` :
                `<div class="tbl-wrap"><table class="grid w-full" aria-label="שיבוצי החניך בקבוצות"><thead><tr><th>מקצוע</th><th>קבוצה ומורה</th><th>סטטוס שיבוץ</th></tr></thead><tbody>${placementMapRows || emptyRow(3, 'לא נמצאו שיבוצים לחניך זה')}</tbody></table></div>`}
              ${qualityHtml}
            </div>
          </details>
          <details class="p360-sec" data-p360-sec="sadin">
            <summary><div class="p360-sec-head"><strong>ציונים שוטפים</strong><span class="p360-sec-sub ${sadinTone}">${E(sadinSummary)}</span></div><span class="p360-chevron" aria-hidden="true">⌄</span></summary>
            <div class="p360-sec-body">
              ${!signal.prereqs.hasSadin ? `<p class="text-slate-500 text-xs">${UI.signalBadge('sadin.unknown')}</p>` :
                `<div class="tbl-wrap"><table class="grid w-full" aria-label="ציונים שוטפים לחניך"><thead><tr><th>מקצוע</th><th>קבוצה ומורה</th><th>ציון שוטף</th><th>הוחמצו</th></tr></thead><tbody>${sadinRows || emptyRow(4, 'אין ציונים שוטפים להצגה')}</tbody></table></div>`}
              ${inactiveRows ? `<div class="text-slate-500 text-xs mt-2"><strong>ציונים מקבוצה קודמת (לא נכללים בממוצע)</strong><ul class="mt-1 space-y-1">${inactiveRows}</ul></div>` : ''}
            </div>
          </details>
          <details class="p360-sec" data-p360-sec="internals">
            <summary><div class="p360-sec-head"><strong>מקצועות פנימיים</strong><span class="p360-sec-sub ${internalTone}">${E(internalSummary)}</span></div><span class="p360-chevron" aria-hidden="true">⌄</span></summary>
            <div class="p360-sec-body">
              <ul class="space-y-1.5 text-xs p360-internals">${g3}</ul>
            </div>
          </details>
        </div>
        <section class="p360-note-box" aria-label="הערת רכזת">
          <div class="p360-note-head"><h3>הערת רכזת</h3><small id="profile-note-status" role="status">נשמר בשינוי השדה</small></div>
          <div id="profile-note-slot"></div>
        </section>
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
    });
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
      const confirmedMissed = missed.filter(confirmed).length;
      const hasActualFail = counted.some(e => !passingScore(e.score, subject) &&
        !(e.score === 0 && missed.some(m => m.key === e.key)));
      if (onlyMissedZeros) return { state: counted.every(e => missed.some(m => m.key === e.key && confirmed(m))) ? 'missed' : 'unverified', value: avg, missed: confirmedMissed };
      if (avg != null) return { state: passingScore(avg, subject) ? 'ok' : 'fail', value: avg, missed: confirmedMissed, hasActualFail };
      if (missed.length) return { state: confirmedMissed ? 'missed' : 'unverified', value: null, missed: confirmedMissed };
      return null;
    };
    const status = (keywords, groups, subject) => {
      const entries = Store.activeCurrentOf(t.tz).filter(e => Util.matchKeywords(e.subject, keywords));
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
    Store.activeCurrentOf(t.tz).forEach(e => { const x = extraOf(e.subject); if (x) { x.entries++; x.events.push(...e.events); } });
    const extras = [...extraMap.values()].map(x => {
      const avg = Store.weightedAverage(x.events).avg;
      const result = classifyCurrent(avg, sheetSubjects.filter(s => Util.norm(s.name) === Util.norm(x.name)), x.name);
      return { ...x, ...(result || { value: null, state: gradesOn && (x.entries || x.groups.length) ? 'missing' : 'none' }) };
    })
      /* מקצועות שגרתיים (חינוך / מגדר / מפגש בוקר) ללא ציון אינם חסר ציון: הם אינם מדורגים מעצם טבעם */
      .filter(x => x.state !== 'none' && !(x.state === 'missing' && isRoutineDuplicateSubject(x.name)))
      .sort((a, b) => natural(a.name, b.name));
    const rows = [...core.values(), ...majors.values(), ...extras];
    return { core, majors, extras, sheet, failing: rows.filter(r => r.state === 'fail'), missing: rows.filter(r => r.state === 'missing'), any: gradesOn && Store.activeCurrentOf(t.tz).length > 0 };
  },

  /** תא "ציון שוטף": נכשל בטרקוטה מודגשת, "חסר ציון" כתג חרדל, ומקף רק כשאין קבוצה ואין רשומת סדין */
  currentCell(c) {
    if (!c || c.state === 'none') return '<span class="text-slate-400">–</span>';
    if (c.state === 'missing') return '<span class="miss-grade" title="רשום בקבוצה / יש רשומה בסדין ציונים, אך אין ציון שוטף">חסר ציון</span>';
    if (c.state === 'missed') return `<span class="miss-grade">${c.missed > 1 ? `${c.missed} הוחמצו` : 'הוחמץ'}</span>`;
    if (c.state === 'unverified') return '<span class="text-slate-500" title="לא ניתן לאמת החמצה ללא שיבוץ מאומת">לא ניתן לאמת</span>';
    const text = E(Util.fmt(c.value, 0));
    return `${c.state === 'fail' ? `<span class="score-alert font-bold">${text} • נכשל</span>` : `<span class="text-slate-800 font-normal">${text}</span>`}${c.missed ? ` <span class="miss-grade">${c.missed > 1 ? `${c.missed} הוחמצו` : 'הוחמץ'}</span>` : ''}`;
  },

  /** תמונת מצב קצרה בראש כרטיס החניך: ממוצע ציונים, ממוצע כיתתי וסטטוס שיבוץ בקבוצות (1:1 מול studentMapModel) */
  renderProfileKpis(t, cur, prereqs = SignalEngine.prerequisitesFor(t.gradeKey), mapModel = prereqs.hasGroups ? this.studentMapModel(t.tz) : null) {
    const classmates = Store.traineeList().filter(x => x.classKey === t.classKey);
    const sheet = Store.loaded.grades ? GroupAnalyzer.sadinSheet(classmates, {}) : [];
    const mine = sheet.find(r => r.t.tz === t.tz);
    const scores = sheet.filter(r => r.overall != null).map(r => r.overall);
    const classAvg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const own = mine ? mine.overall : null;
    const delta = own != null && classAvg != null ? own - classAvg : null;
    const box = (label, value, sub, cls = '', title = '') => `<div class="prof-kpi"${title ? ` title="${E(title)}"` : ''}><div class="k">${label}</div><div class="v ${cls}">${value}</div><div class="s">${sub}</div></div>`;
    const issues = mapModel ? mapModel.tiles.filter(x => x.status !== 'ok') : [];
    const issueCount = issues.length;
    const issueText = issues.map(x => `${x.label}: ${x.sub}`).join(' · ');
    const placement = !prereqs.hasGroups ? ['—', 'חסר קובץ קבוצות לשכבה', ''] :
      !issueCount ? ['✓ תקין', mapModel && mapModel.tiles.length ? `${mapModel.tiles.length} מקצועות` : 'ללא חריגות', 'txt-ok'] :
      [issueCount === 1 ? 'חריגה אחת' : `${issueCount} חריגות`, E(issueText), mapModel.counts.missing ? 'txt-bad' : 'txt-warn'];
    setHtml('profKpis', [
      box('ממוצע ציונים', own == null ? '—' : Util.fmt(own, 1),
        delta == null ? 'אין ציונים שוטפים' : `${delta >= 0 ? '+' : ''}${Util.fmt(delta, 1)} ביחס לכיתה`, own != null && delta != null && delta < 0 ? 'txt-warn' : ''),
      box('ממוצע כיתתי', classAvg == null ? '—' : Util.fmt(classAvg, 1), `${E(Config.classLabel(t.classKey))} · ${scores.length} נמדדים`),
      box('שיבוץ בקבוצות', placement[0], placement[1], placement[2], issueCount && prereqs.hasGroups ? issueText : '')
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
      label: tab === 'sadin' && st.sadin.mode !== 'full' ? 'מוקדי חולשה' : tab === 'sadin' && st.sadin.view === 'flat' ? 'פירוט ציונים' : this.NAV_LABELS[tab] || 'מסך קודם',
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
