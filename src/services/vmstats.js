'use strict';
// Live per-VM resource usage (CPU, memory, disk).
//
// CPU is derived from the cumulative CPU time of the VM's QEMU process: two samples a few seconds
// apart give a percentage. Memory and disk come from the node (virtio-balloon, qemu-img, and the
// guest agent when it is installed). Everything is cached in memory and rebuilt within one interval
// after a restart, so nothing is persisted.
const { db } = require('../db');
const nodes = require('./nodes');

// Linux USER_HZ. Close enough for a live readout on every mainstream distribution.
const CLK_TCK = 100;
const INTERVAL_MS = 5000;

// vmId -> { lastTicks, lastAt, cpu, ram, disk, guestDisk, at }
const state = new Map();

// Latest cached snapshot for a VM, or null when it is not running / not sampled yet.
function get(vmId) {
  return state.get(vmId) || null;
}

async function sample(vm) {
  const st = state.get(vm.id) || { lastTicks: null, lastAt: 0, cpu: 0, ram: null, disk: null, guestDisk: null, at: 0 };
  let snap;
  try { snap = await nodes.exec(vm.node_id).vmStats(vm); } catch { return; }
  if (!snap || !snap.running) { state.delete(vm.id); return; }

  const now = Date.now();
  if (snap.cpuTicks != null && st.lastTicks != null && now > st.lastAt) {
    const dt = (now - st.lastAt) / 1000;
    const dTicks = snap.cpuTicks - st.lastTicks;
    const cores = Math.max(1, vm.cpu || 1);
    const pct = Math.max(0, Math.min(100, (dTicks / (dt * CLK_TCK * cores)) * 100));
    st.cpu = Math.round(pct);
  }
  st.lastTicks = snap.cpuTicks;
  st.lastAt = now;
  st.ram = snap.ram;
  st.disk = snap.disk;
  st.guestDisk = snap.guestDisk;
  st.at = now;
  state.set(vm.id, st);
}

async function tick() {
  for (const vm of db.prepare('SELECT * FROM vms').all()) {
    let running = false;
    try { running = nodes.status(vm) === 'running'; } catch { running = false; }
    if (!running) { state.delete(vm.id); continue; }
    await sample(vm);
  }
}

let timer = null;
function start() {
  if (timer) return;
  // The first pass only records a baseline; the next one computes CPU use.
  tick().catch((e) => console.error('vm stats:', e.message));
  timer = setInterval(() => tick().catch((e) => console.error('vm stats:', e.message)), INTERVAL_MS);
  if (timer.unref) timer.unref();
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { get, start, stop, tick, INTERVAL_MS };
