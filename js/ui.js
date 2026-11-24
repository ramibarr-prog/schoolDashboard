(function () {
  'use strict';
  const esc = value => Util.esc(value);
  const badge = (text, className = '') => `<span class="badge ${esc(className)}">${esc(text)}</span>`;
  const signalBadge = (signalOrId, customText) => {
    const id = typeof signalOrId === 'string' ? signalOrId : signalOrId.id;
    const entry = window.SignalEngine.CATALOG[id];
    if (!entry) throw new Error('Unknown signal: ' + id);
    return badge(customText == null ? entry.label : customText, entry.badgeClass);
  };
  const overallBadge = overall => {
    const id = {
      ok: 'bagrut.eligible', watch: 'bagrut.watch', risk: 'bagrut.risk',
      unknown: 'bagrut.unknown', twelve: 'bagrut.twelve'
    }[overall];
    if (!id) throw new Error('Unknown overall status: ' + overall);
    return signalBadge(id);
  };

  const buildBagrutBreakdown = (t, ev, opts = {}) => {
    const isTrack12 = ev.tier === 5;
    const noData = !isTrack12 && (opts.noData || ev.tier === 0);
    const enforceUnits = !isTrack12 && !noData && ev.rank >= 12 && ev.mode === 'full' && !ev.adaptive;
    const totalUnits = Number.isFinite(ev.totalUnits) && !noData ? ev.totalUnits : null;
    const subjects = [], internals = [], other = [];
    const active = isTrack12 || noData ? [] : ev.blockers.filter(b => !b.info);
    const junior = ev.rank < 12 && !ev.manual;
    const addSubject = (name, tags) => {
      if (!tags.length) return;
      const existing = subjects.find(s => s.name === name);
      const item = existing || { name, tags: [] };
      tags.forEach(tag => { if (!item.tags.some(x => x.label === tag.label)) item.tags.push(tag); });
      if (!existing) subjects.push(item);
    };
    const tag = (code, text) => ({ code: code ? String(code) : '', label: code ? `${code} · ${text}` : text });
    if (!isTrack12 && !noData) {
      ev.subjects.forEach(subject => {
        const tags = [];
        if (junior) {
          ev.paceInfo.failedList.filter(x => x.subject === subject.name).forEach(x => tags.push(tag(x.code, 'נכשל')));
          ev.paceInfo.missingDueList.filter(x => x.subject === subject.name).forEach(x => tags.push(tag(x.code, 'חסר')));
          subject.comps.filter(c => c.state === 'exempt' && ev.paceInfo.blockedSubjects.includes(subject.name))
            .forEach(c => tags.push(tag(c.code, 'החלטה')));
        } else {
          const blockers = active.filter(b => b.gate === 1 && b.k !== 'units' &&
            (b.subject === subject.id || b.text.includes(subject.name)));
          blockers.forEach(b => {
            const match = b.text.match(/שאלון\s+([\d/]+)/);
            if (match) {
              const comp = subject.comps.find(c => String(c.code) === match[1]);
              tags.push(tag(match[1], b.k === 'bagrut-block' ? 'חסם' : comp && comp.failed ? 'נכשל' : 'חסר'));
            }
            else if (['fail', 'severe', 'critical', 'comp-over'].includes(b.k)) {
              const failed = ev.paceInfo.failedList.filter(x => x.subject === subject.name);
              if (failed.length) failed.forEach(x => tags.push(tag(x.code, 'נכשל')));
              else tags.push(tag('', b.k === 'comp-over' ? 'מעבר למכסת הקיזוז' : 'נדרש מעבר'));
            } else if (b.k === 'exempt-review') tags.push(tag('', 'נדרשת החלטה'));
            else if (b.k === 'enroll') tags.push(tag('', 'חסר שיבוץ'));
            else if (b.k === 'reverse30' || b.k === 'reverse-pending') tags.push(tag('', 'נדרש תיקון ציון'));
            else tags.push(tag('', 'חסר ציון'));
          });
        }
        addSubject(subject.name, tags);
      });
      active.filter(b => b.gate === 2).forEach(b => {
        const candidate = ev.major.cands.find(c => b.text.includes(c.name));
        const core = candidate && candidate.coreId && ev.subjects.find(s => s.id === candidate.coreId);
        const name = core ? core.name : candidate ? `מגמה: ${candidate.name}` : 'מגמה';
        const match = b.text.match(/שאלון\s+([\d/]+)/);
        const label = b.k === 'major-none' ? b.text :
          b.k === 'exempt-review' ? 'נדרשת החלטה' : b.k === 'major-fail' ? 'נדרש מעבר' :
          b.k === 'bagrut-block' ? 'חסם' : candidate && candidate.failed ? 'חסר או נכשל' : 'חסר';
        addSubject(name, match ? match[1].split('/').map(code => tag(code, label)) : [tag('', label)]);
      });
      active.filter(b => b.gate === 3).forEach(b => {
        const item = ev.internals.find(i => b.text.includes(i.name));
        const name = item ? item.name : b.text;
        if (!internals.some(i => i.name === name)) internals.push({ name, text: b.text });
      });
      if (ev.manual) other.push('הכרעה ידנית; הפירוט מציג את החישוב האוטומטי');
      if (ev.manualReview && ev.manualReview.required) other.push('נדרשת החלטת רכזת');
      active.filter(b => b.k !== 'units' && b.gate !== 2 && b.gate !== 3 &&
        !ev.subjects.some(s => b.subject === s.id || b.text.includes(s.name)))
        .forEach(b => { if (!other.includes(b.text)) other.push(b.text); });
    }
    const subjectCount = subjects.length, internalCount = internals.length;
    const questionnaireCount = subjects.reduce((n, s) => n + new Set(s.tags.filter(x => x.code).map(x => x.code)).size, 0);
    const unitsText = totalUnits == null ? '—' : enforceUnits ? `${totalUnits}/21 יח״ל` : `${totalUnits} יח״ל נצברו`;
    const subjectSummary = s => {
      const count = new Set(s.tags.filter(x => x.code).map(x => x.code)).size;
      return count ? `${s.name} (${count} ${count === 1 ? 'שאלון' : 'שאלונים'})` : `${s.name} · ${s.tags[0].label}`;
    };
    const cellSummary = isTrack12 ? 'מסלול 12 שנות לימוד' : noData ? 'לא ניתן לקבוע ללא נתוני בגרות' :
      subjectCount >= 3 ? `${subjectCount} מקצועות · ${internalCount} פנימיים · ${unitsText}` :
      [...subjects.map(subjectSummary), internalCount ? `${internalCount} פנימיים` : '',
        enforceUnits && totalUnits < 21 ? unitsText : '', ...other].filter(Boolean).join(' · ') || 'לא אותרו חסמים';
    const tooltipLines = isTrack12 || noData ? [cellSummary] : [
      ...subjects.map(s => `${s.name}: ${s.tags.map(x => x.label).join(', ')}`),
      ...(internals.length ? [`פנימיים: ${internals.map(i => i.name).join(', ')}`] : []),
      ...(enforceUnits && totalUnits < 21 ? [unitsText] : []), ...other
    ].slice(0, 3);
    if (!tooltipLines.length) tooltipLines.push('לא אותרו חסמים');
    return {
      tz: t.tz, name: t.name, className: opts.className || t.classKey,
      status: isTrack12 ? 'מסלול 12 שנות לימוד' : noData ? 'לא ניתן לקבוע' :
        ev.manualReview && ev.manualReview.required ? 'נדרשת החלטת רכזת' :
        junior ? ev.paceText : ev.tierText,
      isTrack12, noData, enforceUnits, totalUnits, subjects, internals, other,
      subjectCount, internalCount, questionnaireCount, cellSummary, tooltipLines
    };
  };

  const renderBagrutBreakdown = (b, opts = {}) => {
    const neutral = b.isTrack12 || b.noData;
    const units = b.totalUnits == null ? '—' : b.enforceUnits ? `${b.totalUnits}/21` : String(b.totalUnits);
    const unitLabel = b.enforceUnits ? 'יח״ל לזכאות' : 'יח״ל שנצברו עד כה';
    const metric = (label, value, warning) => `<div class="bg-bd-metric${warning && !neutral ? ' bg-bd-metric-warn' : ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    const header = opts.showHeader ? `<header class="bg-bd-header"><div><h2>${esc(b.name)}</h2><p>${esc(b.className)} · ${esc(b.status)}</p></div>
      ${opts.showPin ? `<button type="button" class="bg-bd-pin" data-act="bagrutPin" data-tz="${esc(b.tz)}" aria-pressed="${!!opts.pinned}" aria-label="${opts.pinned ? 'הסרה ממעקב צמוד' : 'הוספה למעקב צמוד'}">${opts.pinned ? '★' : '☆'}</button>` : ''}</header>` : '';
    const subjectRows = b.subjects.map(s => `<li><strong>${esc(s.name)}</strong><span class="bg-bd-tags">${s.tags.map(x => `<span class="bg-bd-tag">${esc(x.label)}</span>`).join('')}</span></li>`).join('');
    const internalTags = b.internals.map(i => `<span class="bg-bd-tag" title="${esc(i.text)}">${esc(i.name)}</span>`).join('');
    const metrics = `<div class="bg-bd-metrics">
      ${metric(unitLabel, units, b.enforceUnits && b.totalUnits < 21)}
      ${metric('מקצועות חסרים או חסומים', neutral ? '—' : b.subjectCount, b.subjectCount > 0)}
      ${metric('חסמים פנימיים', neutral ? '—' : b.internalCount, b.internalCount > 0)}</div>`;
    const open360 = opts.showOpen360 ? `<button type="button" class="bg-bd-open" data-act="openProfile" data-tz="${esc(b.tz)}">פתח כרטיס 360 מלא</button>` : '';
    if (opts.matrixSubjects) {
      const rows = opts.matrixSubjects.map(s => `<li class="bg-drawer-subject${s.state === 'bad' ? ' bg-drawer-subject-blocked' : ''}"><span class="bg-drawer-subject-name">${esc(s.label)}</span><span class="bagrut-cell bagrut-cell-${esc(s.state)}${s.state === 'bad' ? ' score-alert' : ''}">${esc(s.text)}</span>${s.more ? `<span class="bagrut-more">+${esc(s.more)}</span>` : ''}${s.gap ? `<span class="bg-drawer-subject-gap">${esc(s.gap)}</span>` : ''}</li>`).join('');
      const internalContent = neutral ? (b.isTrack12 ? 'מסלול 12 שנות לימוד' : 'לא ניתן לקבוע ללא נתוני בגרות') : internalTags || '<span>לא אותרו חסמים פנימיים</span>';
      return `<div class="bg-bd"><div class="bg-drawer-body">${header}${metrics}
        <section class="bg-bd-section"><h3>מקצועות</h3><ul class="bg-drawer-subjects">${rows}</ul></section>
        <section class="bg-bd-section"><h3>חסמים במקצועות פנימיים</h3><div class="bg-bd-tags">${internalContent}</div></section>
        ${subjectRows ? `<details class="bg-drawer-exams"><summary>פירוט שאלונים לטיפול</summary><ul class="bg-bd-subjects">${subjectRows}</ul></details>` : ''}
        ${b.other.length ? `<section class="bg-bd-section"><h3>נוסף לבדיקה</h3><ul>${b.other.map(text => `<li>${esc(text)}</li>`).join('')}</ul></section>` : ''}</div>${open360}</div>`;
    }
    return `<div class="bg-bd">${header}${metrics}
      ${neutral ? `<p class="bg-bd-note">${esc(b.cellSummary)}</p>` : `<section class="bg-bd-section"><h3>בחינות ומקצועות לטיפול</h3><ul class="bg-bd-subjects">${subjectRows || '<li>לא אותרו חסמים במקצועות</li>'}</ul></section>
      <section class="bg-bd-section"><h3>חסמים במקצועות פנימיים</h3><div class="bg-bd-tags">${internalTags || '<span>לא אותרו חסמים פנימיים</span>'}</div></section>
      ${b.other.length ? `<section class="bg-bd-section"><h3>נוסף לבדיקה</h3><ul>${b.other.map(text => `<li>${esc(text)}</li>`).join('')}</ul></section>` : ''}`}
      ${open360}</div>`;
  };

  window.UI = Object.freeze({ esc, badge, signalBadge, overallBadge, buildBagrutBreakdown, renderBagrutBreakdown });
})();
