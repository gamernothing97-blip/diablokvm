'use strict';
// One persistent connection per VM to QEMU's serial console socket.
//
// QEMU's "-chardev socket,server=on" accepts ONE client at a time and keeps a tiny accept queue.
// Every extra connection (the browser Terminal, the SSHX start/stop commands, a second tab...)
// used to open its own socket, so as soon as two overlapped the next connect() failed with
// EAGAIN ("Could not reach the VM console: connect EAGAIN .../console.sock"). It also meant the
// guest's serial output was not always being read.
//
// The hub owns the only connection. Browsers and panel commands share it:
//   hub.subscribe(fn)  -> unsubscribe()   receive console output
//   hub.send(data)                         write to the console (waits for a connection, retries)
const net = require('net');
const { EventEmitter } = require('events');

const hubs = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_CODES = new Set(['EAGAIN', 'ECONNREFUSED', 'ENOENT', 'ECONNRESET', 'EPIPE']);

class Hub extends EventEmitter {
  constructor(sockPath) {
    super();
    this.setMaxListeners(50);
    this.path = sockPath;
    this.sock = null;
    this.connecting = null;
    this.refs = 0;
    this.idle = null;
  }

  // Open (or reuse) the connection. Retries for a few seconds: right after a start or reboot the
  // socket may not exist yet, and while another client holds QEMU's slot connect() says EAGAIN.
  connect(timeoutMs = 10000) {
    if (this.sock && !this.sock.destroyed) return Promise.resolve(this.sock);
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const until = Date.now() + timeoutMs;
      let lastErr;
      for (let delay = 150; Date.now() < until; delay = Math.min(delay * 1.6, 1000)) {
        try { return await this._open(); } catch (e) {
          lastErr = e;
          if (!RETRY_CODES.has(e.code)) break;
          await sleep(delay);
        }
      }
      throw new Error(`Could not reach the VM console: ${lastErr ? lastErr.message : 'timed out'}`);
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  _open() {
    return new Promise((resolve, reject) => {
      const s = net.createConnection(this.path);
      let opened = false;
      s.once('connect', () => {
        opened = true;
        this.sock = s;
        s.on('data', (d) => this.emit('data', d));
        resolve(s);
      });
      s.on('error', (e) => { if (!opened) { s.destroy(); reject(e); } else { this.emit('sockerror', e); } });
      s.on('close', () => {
        if (this.sock === s) this.sock = null;
        if (opened) this.emit('disconnect');
      });
    });
  }

  async send(data) {
    const s = await this.connect();
    await new Promise((resolve, reject) => s.write(data, (err) => (err ? reject(err) : resolve())));
  }

  // Attach a listener. The connection is kept while anyone is attached, and dropped ~20 s after the
  // last one leaves so QEMU's slot is free again for tools outside the panel.
  retain() { this.refs++; clearTimeout(this.idle); this.idle = null; }
  release() {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs === 0 && !this.idle) {
      this.idle = setTimeout(() => {
        this.idle = null;
        if (this.refs === 0 && this.sock) this.sock.destroy();
        if (this.refs === 0) hubs.delete(this.path);
      }, 20000);
      this.idle.unref();
    }
  }
}

function hubFor(sockPath) {
  let h = hubs.get(sockPath);
  if (!h) { h = new Hub(sockPath); h.on('error', () => {}); hubs.set(sockPath, h); }
  return h;
}

// Run a one-off write (used by panel commands). Output is drained by the hub, never left unread.
async function exec(sockPath, text) {
  const h = hubFor(sockPath);
  h.retain();
  try { await h.send(text); await sleep(300); } finally { h.release(); }
}

module.exports = { hubFor, exec };
