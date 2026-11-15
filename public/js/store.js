function read(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* storage can be blocked; the game still works */ }
}

export const store = {
  profile: () => read(localStorage, 'tr.profile', null),
  saveProfile: (profile) => write(localStorage, 'tr.profile', profile),

  stats: () => ({ races: 0, wins: 0, bestWpm: 0, ...read(localStorage, 'tr.stats', {}) }),
  saveStats: (stats) => write(localStorage, 'tr.stats', stats),

  sound: () => read(localStorage, 'tr.sound', true),
  saveSound: (on) => write(localStorage, 'tr.sound', on),

  // sessionStorage is per tab, so a refresh resumes the seat while a second tab is a second player.
  session: () => read(sessionStorage, 'tr.session', null),
  saveSession: (session) => write(sessionStorage, 'tr.session', session),
  clearSession: () => { try { sessionStorage.removeItem('tr.session'); } catch { /* ignore */ } },
};
