import { h } from './dom.js';

export const MAX_ERRORS = 8;

function commonPrefix(a, b) {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

// Progress is the longest correct prefix, so mistakes must be erased before the car can move on.
export class TypingEngine {
  constructor(text, nitroStreak = 15) {
    this.text = text;
    this.nitroStreak = nitroStreak;
    this.reset(0);
  }

  reset(prefix) {
    this.typed = this.text.slice(0, prefix);
    this.prefix = prefix;
    this.keys = prefix;
    this.wrong = 0;
    this.streak = 0;
  }

  get finished() { return this.prefix === this.text.length; }
  get accuracy() { return this.keys ? (this.keys - this.wrong) / this.keys : 1; }
  get nitro() { return this.streak >= this.nitroStreak; }

  input(value) {
    const text = this.text;
    let next = value.length > text.length ? value.slice(0, text.length) : value;
    const prefix = commonPrefix(text, next);
    if (next.length > prefix + MAX_ERRORS) next = next.slice(0, prefix + MAX_ERRORS);

    const outcome = { value: next, correct: 0, wrong: 0, deleted: false, nitroStarted: false, finished: false };
    const wasNitro = this.nitro;
    if (next.length > this.typed.length && next.startsWith(this.typed)) {
      let cursor = this.prefix;
      for (let i = this.typed.length; i < next.length; i += 1) {
        this.keys += 1;
        if (cursor === i && next[i] === text[i]) {
          cursor += 1;
          this.streak += 1;
          outcome.correct += 1;
        } else {
          this.wrong += 1;
          this.streak = 0;
          outcome.wrong += 1;
        }
      }
    } else if (next !== this.typed) {
      this.streak = 0;
      outcome.deleted = next.length < this.typed.length;
    }
    this.typed = next;
    this.prefix = prefix;
    outcome.nitroStarted = !wasNitro && this.nitro;
    outcome.finished = this.finished;
    return outcome;
  }
}

const stateClass = (state, isSpace, isCursor) =>
  `c${isSpace ? ' sp' : ''}${state === 1 ? ' ok' : state === 2 ? ' bad' : ''}${isCursor ? ' cur' : ''}`;

export class TypingView {
  constructor() {
    this.caret = h('span', { class: 'tt-caret' });
    this.tt = h('div', { class: 'tt', 'aria-hidden': 'true' });
    this.el = h('div', { class: 'tt-viewport' }, this.tt);
    this.chars = [];
    this.classes = [];
    this.text = '';
    this.cursor = 0;
    this.prefix = 0;
    this.line = 0;
    this.lineHeight = 0;
    this.done = false;
    new ResizeObserver(() => this.measure()).observe(this.el);
  }

  setText(text) {
    this.text = text;
    this.chars = [];
    this.done = false;
    const fragment = document.createDocumentFragment();
    for (const token of text.split(/( )/)) {
      if (token === ' ') {
        const space = h('span', { class: 'c sp' }, ' ');
        this.chars.push(space);
        fragment.append(space);
      } else if (token) {
        const word = h('span', { class: 'w' });
        for (const letter of token) {
          const char = h('span', { class: 'c' }, letter);
          this.chars.push(char);
          word.append(char);
        }
        fragment.append(word);
      }
    }
    this.tt.replaceChildren(fragment, this.caret);
    this.classes = this.chars.map((_, i) => stateClass(0, text[i] === ' ', false));
    this.cursor = 0;
    this.prefix = 0;
    this.line = 0;
    this.tt.style.transform = 'translateY(0)';
    this.el.classList.remove('done');
    this.render(0, 0, true);
  }

  render(typedLength, prefix, all = false) {
    const count = this.chars.length;
    const from = all ? 0 : Math.max(0, Math.min(this.cursor, typedLength, this.prefix, prefix) - 1);
    const to = all ? count - 1 : Math.min(count - 1, Math.max(this.cursor, typedLength, this.prefix, prefix) + 1);
    for (let i = from; i <= to; i += 1) {
      const state = i < prefix ? 1 : i < typedLength ? 2 : 0;
      const next = stateClass(state, this.text[i] === ' ', i === typedLength);
      if (next !== this.classes[i]) {
        this.classes[i] = next;
        this.chars[i].className = next;
      }
    }
    this.cursor = typedLength;
    this.prefix = prefix;
    this.done = typedLength >= count && prefix >= count;
    this.el.classList.toggle('done', this.done);
    this.placeCaret();
  }

  measure() {
    const style = getComputedStyle(this.tt);
    this.lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.75 || 36;
    this.placeCaret();
  }

  placeCaret() {
    if (!this.chars.length || !this.lineHeight) return;
    const atEnd = this.cursor >= this.chars.length;
    const target = this.chars[atEnd ? this.chars.length - 1 : this.cursor];
    const base = this.tt.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    if (!box.height) return;
    const x = box.left - base.left + (atEnd ? box.width : 0);
    const y = box.top - base.top;
    const firstTop = this.chars[0].getBoundingClientRect().top - base.top;
    const line = Math.max(0, Math.round((y - firstTop) / this.lineHeight));
    this.caret.style.height = `${box.height}px`;
    this.caret.style.transform = `translate(${x}px, ${y}px)`;
    this.caret.classList.toggle('jump', line !== this.line);
    this.line = line;
    this.tt.style.transform = `translateY(${-Math.max(0, line - 1) * this.lineHeight}px)`;
  }
}
