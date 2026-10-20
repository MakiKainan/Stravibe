const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEvents, pickSession, timing } = require('../bin/stravibe-summarize');

const BASE = Date.parse('2026-10-20T09:00:00Z');
const MIN = 60e3;
const at = (sid, min, ev, extra = {}) => ({ t: new Date(BASE + min * MIN).toISOString(), ev, sid, cwd: '/r', tp: '/t.jsonl', ...extra });
const prompt = (sid, min, extra = {}) => at(sid, min, 'UserPromptSubmit', { len: 5, corr: false, caps: false, own: false, self: false, ...extra });

test('moving time: turns + short gaps, long gap paused', () => {
  const ev = [
    prompt('A', 0), at('A', 4, 'Stop'),
    prompt('A', 7), at('A', 10, 'Stop'), // 3 min gap counts
    prompt('A', 40), at('A', 45, 'Stop'), // 30 min gap paused
  ];
  const s = timing(ev, 'A');
  assert.equal(s.movingMs, 15 * MIN);
  assert.equal(s.elapsedMs, 45 * MIN);
  assert.equal(s.typed, 3);
  assert.deepEqual(s.cwds, ['/r']);
  assert.deepEqual(s.tps, ['/t.jsonl']);
});

test('interrupt capped at 5 min and counted as rage', () => {
  const ev = [prompt('I', 0), prompt('I', 12), at('I', 14, 'Stop')];
  const s = timing(ev, 'I');
  assert.equal(s.movingMs, 7 * MIN); // 5 (capped) + 2
  assert.equal(s.rageHits, 1);
});

test('corrections and caps count as rage', () => {
  const ev = [prompt('R', 0, { corr: true }), at('R', 1, 'Stop'), prompt('R', 2, { caps: true }), at('R', 3, 'Stop'), prompt('R', 4), at('R', 5, 'Stop')];
  assert.equal(timing(ev, 'R').rageHits, 2);
});

test('own and self prompts are not typed; own turn dropped', () => {
  const ev = [
    prompt('O', 0), at('O', 3, 'Stop'),
    prompt('O', 4, { self: true }), at('O', 6, 'Stop'),
    prompt('O', 8, { own: true }), at('O', 9, 'Stop'),
  ];
  const s = timing(ev, 'O');
  assert.equal(s.typed, 1);
  assert.equal(s.movingMs, 6 * MIN);
  assert.equal(s.endMs, BASE + 6 * MIN);
});

test('walls: rate-limit failure + auto compact, manual compact and other failures ignored', () => {
  const ev = [
    at('W', 0, 'SessionStart', { model: 'claude-opus-5-5' }), prompt('W', 0),
    at('W', 1, 'StopFailure', { reason: 'rate_limit' }),
    prompt('W', 2), at('W', 3, 'StopFailure', { reason: 'server_error' }),
    at('W', 4, 'PostCompact', { trigger: 'auto' }), at('W', 5, 'PostCompact', { trigger: 'manual' }),
    at('W', 6, 'SessionEnd'),
  ];
  const s = timing(ev, 'W');
  assert.equal(s.walls, 2);
  assert.equal(s.movingMs, 3 * MIN); // StopFailure ends turns: 1 + 1 gap + 1
  assert.equal(s.startModel, 'claude-opus-5-5');
});

test('end events with no open turn are ignored', () => {
  const ev = [prompt('E', 0), at('E', 2, 'Stop'), at('E', 3, 'SessionEnd')];
  assert.equal(timing(ev, 'E').movingMs, 2 * MIN);
});

test('pickSession falls back when current has only own prompts', () => {
  const ev = [
    prompt('A', 0), at('A', 1, 'Stop'),
    prompt('B', 100), at('B', 101, 'Stop'),
    prompt('C', 200, { own: true }),
  ];
  assert.equal(pickSession(ev, 'C', false), 'B');
  assert.equal(pickSession(ev, 'B', false), 'B');
  assert.equal(pickSession(ev, 'B', true), 'A');
  assert.equal(pickSession(ev, 'A', true), 'B');
  assert.equal(pickSession([], 'X', false), null);
});

test('loadEvents skips a truncated line and handles a missing file', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sv-')), 'events.jsonl');
  fs.writeFileSync(f, JSON.stringify(prompt('A', 0)) + '\n{"t":"2026');
  assert.equal(loadEvents(f).length, 1);
  assert.deepEqual(loadEvents(f + '.missing'), []);
});
