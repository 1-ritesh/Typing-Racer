const listeners = new Map();

export const bus = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  },
  emit(type, ...args) {
    for (const fn of [...(listeners.get(type) || [])]) {
      try { fn(...args); } catch (error) { console.error(`handler for "${type}" failed`, error); }
    }
  },
};

export const state = {
  info: null,
  you: '',
  token: '',
  room: null,
  ticks: new Map(),
  deadlineAt: 0,
  addressIndex: 0,
  customDraft: '',
};

export const me = () => (state.room ? state.room.players.find((p) => p.id === state.you) || null : null);
export const isHost = () => !!state.room && state.room.host === state.you;
export const isLocalHost = () => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

export function inviteBase() {
  const urls = state.info?.urls || [];
  if (isLocalHost() && urls.length) return urls[state.addressIndex % urls.length];
  return location.origin;
}

export const inviteLink = (code) => `${inviteBase()}/?room=${code}`;
