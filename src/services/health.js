'use strict';
// Per-VM health: an at-a-glance summary derived from a VM's run state and the CPU samples the
// mining guard already collects every few seconds. Nothing new is sampled here — this just turns
// the data the panel already has into one clear level per VM.
//
// Levels, from best to worst:
//   healthy  — running and using a normal amount of CPU
//   busy     — running and fairly busy (60-84% CPU)
//   warning  — running and pegged (85%+ CPU)
//   critical — suspended, or flagged as a mining suspect
//   stopped  — not running
//   unknown  — the VM's node is offline, so its state cannot be read
const mining = require('./mining');

// Thresholds (percent of the VM's total vCPU capacity).
const BUSY_PCT = 60;
const HIGH_PCT = 85;

function compute(vm) {
  const base = { cpu: 0, detail: '', level: 'unknown', label: 'Unknown' };
  if (!vm) return base;

  if (vm.status === 'unknown') {
    return { ...base, level: 'unknown', label: 'Node offline', detail: 'The node hosting this VM is offline, so its state is unknown.' };
  }
  if (vm.status !== 'running') {
    return { ...base, level: 'stopped', label: 'Stopped', detail: 'This VM is not running.' };
  }

  // Running: pull the latest CPU sample from the mining guard.
  let cpu = 0;
  let suspect = !!vm.mining_suspect;
  try {
    const m = mining.status(vm.id);
    cpu = m.cpu || 0;
    suspect = suspect || m.suspect;
  } catch { /* node offline mid-read: keep what we have */ }

  if (vm.suspended) {
    return { cpu, level: 'critical', label: 'Suspended', detail: 'This VM is suspended (paused).' };
  }
  if (suspect) {
    return { cpu, level: 'critical', label: 'Mining suspect', detail: `CPU has stayed very high (${cpu}%), which can indicate mining.` };
  }
  if (cpu >= HIGH_PCT) {
    return { cpu, level: 'warning', label: 'High CPU', detail: `CPU is pegged at ${cpu}%.` };
  }
  if (cpu >= BUSY_PCT) {
    return { cpu, level: 'busy', label: 'Busy', detail: `CPU is fairly busy at ${cpu}%.` };
  }
  return { cpu, level: 'healthy', label: 'Healthy', detail: cpu ? `Running normally at ${cpu}% CPU.` : 'Running normally.' };
}

module.exports = { compute, BUSY_PCT, HIGH_PCT };
