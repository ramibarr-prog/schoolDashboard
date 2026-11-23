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
  window.UI = Object.freeze({ esc, badge, signalBadge, overallBadge });
})();
