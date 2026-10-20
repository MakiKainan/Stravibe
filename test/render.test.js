const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { render } = require('../bin/stravibe-summarize');

const BIN = path.join(__dirname, '../bin/stravibe-summarize');
const MIN = 60e3;
const base = {
  startMs: Date.parse('2026-10-20T09:14:00Z'), movingMs: 60 * MIN, elapsedMs: 90 * MIN,
  commits: 4, added: 842, removed: 120, tokens: 184000, typed: 20, rageHits: 0, walls: 1, gear: 'claude-opus-5-5',
};

test('pace and hero row', () => {
  const out = render({ ...base, movingMs: (68 * 60 + 24) * 1e3, commits: 6 });
  assert.match(out, /11:24 \/commit/);
  assert.match(out, /1:08:24/);
  assert.match(out, /^STRAVIBE · \w{3} \w{3} \d{1,2}, \d\d:\d\d$/m);
});

test('warm-up under 10 min or zero commits', () => {
  assert.match(render({ ...base, movingMs: 9 * MIN, commits: 3 }), /Warm-up/);
  assert.match(render({ ...base, commits: 0 }), /Warm-up/);
  assert.doesNotMatch(render(base), /Warm-up/);
});

test('secondary stats', () => {
  const out = render(base);
  assert.match(out, /Elevation\s+\+842 \/ −120/);
  assert.match(out, /Elapsed\s+1:30:00/);
  assert.match(out, /Calories\s+184k tokens/);
  assert.match(out, /Cadence\s+0\.3 \/min/);
  assert.match(out, /HR zone\s+Z2/); // 3067 tokens/min
  assert.match(out, /Walls hit\s+1/);
  assert.match(out, /Gear\s+claude-opus-5-5/);
  assert.match(out, /^stravibe$/m);
});

test('missing transcript shows dashes', () => {
  const out = render({ ...base, tokens: null, gear: null });
  assert.match(out, /Calories\s+—/);
  assert.match(out, /HR zone\s+—/);
  assert.match(out, /Gear\s+—/);
});

test('rage buckets', () => {
  const rage = (hits, typed = 20) => render({ ...base, rageHits: hits, typed }).match(/Rage\s+(\w+)/)[1];
  assert.equal(rage(1), 'Chill');
  assert.equal(rage(3), 'Warm');
  assert.equal(rage(6), 'Spicy');
  assert.equal(rage(10), 'Meltdown');
  assert.equal(rage(0, 0), 'Chill');
});

const cli = (args, dataDir) => spawnSync(BIN, args, { env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir }, encoding: 'utf8' });

test('main with empty data dir prints no-activity message', () => {
  const r = cli(['sid'], fs.mkdtempSync(path.join(os.tmpdir(), 'sv-')));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'No activity recorded yet.\n');
});

test('main prints a card for a session outside any repo with no transcript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-plain-'));
  const e = (min, ev, extra = {}) => JSON.stringify({ t: new Date(base.startMs + min * MIN).toISOString(), ev, sid: 's1', cwd, tp: '/nope.jsonl', ...extra });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [e(0, 'UserPromptSubmit', { own: false, self: false }), e(3, 'Stop')].join('\n') + '\n');
  const r = cli(['s1'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Warm-up/);
  assert.match(r.stdout, /Calories\s+—/);
  assert.match(r.stdout, /0:03:00/);
});

test('main counts commits made after the last turn when showing the current session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-repo-'));
  const git = (args, env = {}) => spawnSync('git', args, { cwd: repo, env: { ...process.env, ...env } });
  git(['init', '-q']); git(['config', 'user.email', 'me@x']); git(['config', 'user.name', 'me']);
  const now = Date.now();
  const e = (agoMin, ev, extra = {}) => JSON.stringify({ t: new Date(now - agoMin * MIN).toISOString(), ev, sid: 's1', cwd: repo, tp: '/nope.jsonl', ...extra });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [e(20, 'UserPromptSubmit', { own: false, self: false }), e(15, 'Stop')].join('\n') + '\n');
  fs.writeFileSync(path.join(repo, 'a.js'), 'x\n'.repeat(10));
  git(['add', '-A']);
  const date = new Date(now - 5 * MIN).toISOString(); // user commits by hand after Claude's last Stop
  git(['commit', '-qm', 'c'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  assert.match(cli(['s1'], dir).stdout, /^ {3}1 +Warm-up/m);
});
