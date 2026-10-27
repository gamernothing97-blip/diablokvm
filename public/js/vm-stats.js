// Live CPU / memory / disk readout for the VM management page.
// Polls /vms/:id/stats and updates the bars in the "Resource usage" panel.
(() => {
  const root = document.getElementById('vm-usage');
  if (!root) return;
  const vmId = root.dataset.vmId;
  const running = root.dataset.running === '1';
  const interval = parseInt(root.dataset.interval, 10) || 5000;
  const live = document.getElementById('usage-live');

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const fmtBytes = (n) => {
    if (n == null) return '\u2014';
    const i = n ? Math.min(4, Math.floor(Math.log(n) / Math.log(1024))) : 0;
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + units[i];
  };
  const pctOf = (used, total) => (total > 0 && used != null ? Math.max(0, Math.min(100, Math.round((used / total) * 100))) : 0);
  const level = (p) => (p >= 90 ? 'crit' : p >= 75 ? 'warn' : p >= 50 ? 'busy' : 'ok');

  const setBar = (key, pct, valueText, subText) => {
    const bar = root.querySelector('[data-bar="' + key + '"]');
    const val = root.querySelector('[data-val="' + key + '"]');
    const sub = root.querySelector('[data-sub="' + key + '"]');
    if (bar) { bar.style.width = pct + '%'; bar.dataset.level = level(pct); }
    if (val) val.textContent = valueText;
    if (sub) sub.textContent = subText;
  };

  async function refresh() {
    if (!running) return;
    try {
      const r = await fetch('/vms/' + vmId + '/stats', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (!r.ok) return;
      const d = await r.json();
      if (!d.running) { if (live) live.textContent = 'VM stopped'; return; }

      setBar('cpu', d.cpu, d.cpu + '%', d.cpuTotal + ' vCPU');

      const ramUsed = d.ram ? d.ram.used : null;
      const ramTotal = d.ram ? d.ram.total : d.ramTotal;
      const ramPct = pctOf(ramUsed, ramTotal);
      setBar('ram', ramPct, fmtBytes(ramUsed) + ' / ' + fmtBytes(ramTotal), ramPct + '% of ' + fmtBytes(ramTotal));

      const gd = d.guestDisk;
      const diskUsed = gd ? gd.used : (d.disk ? d.disk.used : null);
      const diskTotal = gd ? gd.total : (d.disk ? d.disk.total : d.diskTotal);
      const diskPct = pctOf(diskUsed, diskTotal);
      setBar('disk', diskPct, fmtBytes(diskUsed) + ' / ' + fmtBytes(diskTotal), diskPct + '% used' + (gd ? '' : ' (allocated)'));

      if (live) live.textContent = 'live';
    } catch { /* ignore transient errors and try again next tick */ }
  }

  refresh();
  if (running) setInterval(refresh, interval);
})();
