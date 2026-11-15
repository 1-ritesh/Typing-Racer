import { $, h, formatRaceTime, ordinal } from '../dom.js';
import { icon } from '../icons.js';
import { carThumb } from '../cars.js';
import { sfx } from '../audio.js';
import { store } from '../store.js';
import { state, isHost } from '../state.js';

const EMOJI = { fire: '\u{1F525}', laugh: '\u{1F602}', wow: '\u{1F631}', clap: '\u{1F44F}', flag: '\u{1F3C1}', wind: '\u{1F4A8}' };
const REACTION_LABEL = { fire: 'Fire', laugh: 'Laugh', wow: 'Wow', clap: 'Applause', flag: 'Chequered flag', wind: 'Speed' };

const placeBadge = (place, dnf) => h('span', { class: `place place-${dnf ? 'dnf' : Math.min(place, 4)}` }, String(place));

export function initResults({ net }) {
  const root = $('#panel-results');
  let recordedRound = 0;

  function recordStats(room, mine) {
    if (!mine || recordedRound === room.round) return false;
    recordedRound = room.round;
    const stats = store.stats();
    const previousBest = stats.bestWpm;
    if (room.results.length < 2 || mine.dnf) return false;
    stats.races += 1;
    if (mine.place === 1) stats.wins += 1;
    const beat = previousBest > 0 && mine.wpm > previousBest;
    if (mine.wpm > stats.bestWpm) stats.bestWpm = mine.wpm;
    store.saveStats(stats);
    return beat;
  }

  function headline(room, mine) {
    const winner = room.results[0];
    if (!winner || winner.dnf) return ['Time\u2019s up!', 'Nobody reached the finish line this time.'];
    const sub = `${winner.name} took the flag in ${formatRaceTime(winner.ms)} at ${Math.round(winner.wpm)} WPM.`;
    if (!mine) return [`${winner.name} wins!`, sub];
    if (mine.dnf) return ['Not this time', `You typed ${Math.round((mine.prog / room.race.len) * 100)}% of the text. ${sub}`];
    if (mine.place === 1) return ['You win!', sub];
    return [`You finished ${ordinal(mine.place)}`, sub];
  }

  function resultsTable(room) {
    const rows = room.results.map((result) => h('tr', { class: result.id === state.you ? 'is-you' : '' },
      h('td', { class: 'col-place' }, placeBadge(result.place, result.dnf)),
      h('td', { class: 'col-driver' },
        carThumb(result.style, result.color, 46),
        h('span', { class: 'driver-name' }, result.name),
        result.id === state.you ? h('span', { class: 'tag tag-you' }, 'YOU') : null,
        result.bot ? h('span', { class: 'tag tag-bot' }, 'BOT') : null),
      h('td', { class: 'num' }, result.prog ? String(Math.round(result.wpm)) : '-'),
      h('td', { class: 'num' }, result.prog ? `${Math.round(result.acc)}%` : '-'),
      h('td', { class: 'num' }, result.dnf ? `DNF ${Math.round((result.prog / room.race.len) * 100)}%` : formatRaceTime(result.ms)),
      h('td', { class: 'num pts' }, result.pts ? `+${result.pts}` : '')));
    return h('div', { class: 'table-wrap' },
      h('table', { class: 'results-table' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Driver'), h('th', { scope: 'col', class: 'num' }, 'WPM'),
          h('th', { scope: 'col', class: 'num' }, 'Acc'), h('th', { scope: 'col', class: 'num' }, 'Time'), h('th', { scope: 'col', class: 'num' }, 'Pts'))),
        h('tbody', null, rows)));
  }

  function standings(room) {
    const ranked = [...room.players].sort((a, b) => b.points - a.points || b.wins - a.wins);
    return h('ol', { class: 'standings' }, ranked.map((player, index) => h('li', { class: player.id === state.you ? 'is-you' : '' },
      h('span', { class: 'standing-rank' }, index === 0 && player.points > 0 ? icon('crown', 16) : String(index + 1)),
      h('span', { class: 'standing-name' }, player.name),
      h('span', { class: 'standing-points' }, `${player.points}`))));
  }

  function reactions() {
    return h('div', { class: 'reactions', role: 'group', 'aria-label': 'Send a reaction' },
      state.info.reactions.map((kind) => h('button', {
        class: 'reaction', type: 'button', title: REACTION_LABEL[kind] || kind, 'aria-label': REACTION_LABEL[kind] || kind,
        onclick: () => { net.send({ t: 'react', e: kind }); },
      }, EMOJI[kind] || '?')));
  }

  function actions(room) {
    if (!isHost()) {
      const host = room.players.find((p) => p.id === room.host);
      return h('p', { class: 'waiting' }, host ? `Waiting for ${host.name} to pick what\u2019s next\u2026` : 'Waiting for the host\u2026');
    }
    return h('div', { class: 'result-actions' },
      h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => { sfx.unlock(); net.send({ t: 'again' }); } }, icon('flag', 18), 'Race again'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => net.send({ t: 'lobby' }) }, 'Back to lobby'));
  }

  return {
    render(room) {
      const mine = room.results.find((r) => r.id === state.you) || null;
      const beat = recordStats(room, mine);
      const [title, sub] = headline(room, mine);
      root.replaceChildren(
        h('div', { class: 'results' },
          h('div', { class: 'results-main' },
            h('header', { class: 'results-head' },
              h('div', null,
                h('h2', { class: 'results-title' }, title),
                h('p', { class: 'results-sub' }, sub)),
              beat ? h('span', { class: 'chip chip-gold' }, icon('bolt', 14), 'New personal best!') : null),
            resultsTable(room)),
          h('aside', { class: 'results-side' },
            h('h3', { class: 'card-title' }, icon('trophy', 16), 'Championship'),
            standings(room),
            reactions(),
            actions(room))));
    },
  };
}
