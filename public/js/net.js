const HEARTBEAT_MS = 8000;
const SILENCE_MS = 22000;
const WAKE_GRACE_MS = 5000;
const CONNECT_TIMEOUT_MS = 7000;

export class Net {
  constructor() {
    this.ws = null;
    this.opening = null;
    this.lastRx = 0;
    this.visibleSince = 0;
    this.beat = 0;
    this.listeners = new Map();
    this.onVisibility = () => {
      if (document.hidden) return;
      this.visibleSince = performance.now();
      this.send({ t: 'ping', ts: Date.now() });
    };
  }

  get open() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type).delete(fn);
  }

  emit(type, payload) {
    for (const fn of [...(this.listeners.get(type) || [])]) {
      try { fn(payload); } catch (error) { console.error(`net handler "${type}" failed`, error); }
    }
  }

  connect() {
    if (this.open) return Promise.resolve();
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;
      try {
        ws = new WebSocket(`${scheme}//${location.host}/ws`);
      } catch (error) {
        this.opening = null;
        reject(error);
        return;
      }
      this.ws = ws;
      const stalled = setTimeout(() => ws.close(), CONNECT_TIMEOUT_MS);
      ws.onopen = () => {
        clearTimeout(stalled);
        this.opening = null;
        this.lastRx = performance.now();
        this.startHeartbeat();
        resolve();
        this.emit('open');
      };
      ws.onmessage = (event) => {
        this.lastRx = performance.now();
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message && typeof message.t === 'string') this.emit(message.t, message);
      };
      ws.onclose = () => {
        clearTimeout(stalled);
        const wasCurrent = this.ws === ws;
        if (wasCurrent) {
          this.ws = null;
          this.stopHeartbeat();
        }
        this.opening = null;
        reject(new Error('socket closed'));
        if (wasCurrent) this.emit('close');
      };
      ws.onerror = () => {};
    });
    this.opening.catch(() => {});
    return this.opening;
  }

  send(message) {
    if (!this.open) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  close() {
    this.stopHeartbeat();
    if (this.ws) this.ws.close();
  }

  // Background tabs get throttled timers, so silence only counts while the tab is visible and awake.
  startHeartbeat() {
    this.stopHeartbeat();
    this.visibleSince = performance.now();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.beat = setInterval(() => {
      if (!this.open || document.hidden) return;
      const now = performance.now();
      if (now - this.lastRx > SILENCE_MS && now - this.visibleSince > WAKE_GRACE_MS) {
        this.ws.close();
        return;
      }
      this.send({ t: 'ping', ts: Date.now() });
    }, HEARTBEAT_MS);
  }

  stopHeartbeat() {
    clearInterval(this.beat);
    this.beat = 0;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
