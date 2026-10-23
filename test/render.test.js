const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { render, big } = require('../bin/stravibe-summarize');

const BIN = path.join(__dirname, '../bin/stravibe-summarize');
const MIN = 60e3;
const base = {
  startMs: Date.parse('2026-10-20T09:14:00Z'), movingMs: 60 * MIN, elapsedMs: 90 * MIN,
  commits: 4, added: 842, removed: 120, tokens: 184000, typed: 20, rageHits: 0, walls: 1, gear: 'claude-opus-5-5',
};

const plain = (s) => render(s);
const local = (h) => new Date(2026, 9, 20, h, 14).getTime();

test('pace and commits in block digits', () => {
  const out = plain({ ...base, movingMs: (68 * 60 + 24) * 1e3, commits: 6 });
  big('11:24').forEach((row) => assert.ok(out.includes(row), row));
  assert.match(out, /PACE \/commit\s+COMMITS/);
  assert.match(out, /1:08:24 moving/);
  assert.match(out, /S T R A V I B E\s+\w{3} \w{3} \d{1,2} · \d\d:\d\d/);
});

test('warm-up under 10 min or zero commits', () => {
  assert.match(plain({ ...base, movingMs: 9 * MIN, commits: 3 }), /WARM-UP/);
  assert.match(plain({ ...base, commits: 0 }), /WARM-UP/);
  assert.doesNotMatch(plain(base), /WARM-UP/);
});

test('secondary stats', () => {
  const out = plain(base);
  assert.match(out, /\+842 −120/);
  assert.match(out, /1:30:00 elapsed/);
  assert.match(out, /CALORIES\s+184k tokens/);
  assert.match(plain({ ...base, tokens: 2252000 }), /CALORIES\s+2\.3M tokens/);
  assert.match(out, /CADENCE\s+0\.3 \/min/);
  assert.match(out, /HR ZONE\s+▰▰▱▱▱ Z2/); // 3067 tokens/min
  assert.match(out, /WALLS HIT\s+1/);
  assert.match(out, /GEAR\s+opus-5-5/);
  assert.match(out, /stravibe/);
});

test('missing transcript shows dashes', () => {
  const out = plain({ ...base, tokens: null, gear: null });
  assert.match(out, /CALORIES\s+—/);
  assert.match(out, /HR ZONE\s+—/);
  assert.match(out, /GEAR\s+—/);
});

test('rage meter buckets', () => {
  const rage = (hits, typed = 20) => plain({ ...base, rageHits: hits, typed }).match(/RAGE\s+([▰▱]+) (\w+)/).slice(1).join(' ');
  assert.equal(rage(1), '▰▱▱▱ CHILL');
  assert.equal(rage(3), '▰▰▱▱ WARM');
  assert.equal(rage(6), '▰▰▰▱ SPICY');
  assert.equal(rage(10), '▰▰▰▰ MELTDOWN');
  assert.equal(rage(0, 0), '▰▱▱▱ CHILL');
});

test('title follows local time of day', () => {
  assert.match(plain({ ...base, startMs: local(9) }), /Morning Vibe/);
  assert.match(plain({ ...base, startMs: local(14) }), /Afternoon Session/);
  assert.match(plain({ ...base, startMs: local(19) }), /Evening Flow/);
  assert.match(plain({ ...base, startMs: local(2) }), /Late-Night Grind/);
});

test('color only when asked', () => {
  assert.ok(render(base, { color: true }).includes('\x1b[38;2;217;119;87m'));
  assert.ok(!plain(base).includes('\x1b'));
});

const cli = (args, dataDir, env = {}) => spawnSync(BIN, args, { env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir, ...env }, encoding: 'utf8' });

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
  const r = cli(['s1', '--plain'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /WARM-UP/);
  assert.match(r.stdout, /CALORIES\s+—/);
  assert.match(r.stdout, /0:03:00 moving/);
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
  assert.match(cli(['s1', '--plain'], dir).stdout, / ▄█$/m); // big "1" at the end of the hero row
});

test('no args: finds the data dir under HOME, picks the latest session, prints color', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-home-'));
  const dir = path.join(home, '.claude/plugins/data/stravibe-stravibe');
  fs.mkdirSync(dir, { recursive: true });
  const e = (sid, min, ev, extra = {}) => JSON.stringify({ t: new Date(base.startMs + min * MIN).toISOString(), ev, sid, cwd: home, tp: '/nope.jsonl', ...extra });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    e('old', 0, 'UserPromptSubmit', { own: false, self: false }), e('old', 1, 'Stop'),
    e('new', 100, 'UserPromptSubmit', { own: false, self: false }), e('new', 107, 'Stop'),
  ].join('\n') + '\n');
  const r = cli([], '', { HOME: home, CLAUDE_PLUGIN_DATA: '' });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('\x1b['));
  assert.match(r.stdout.replace(/\x1b\[[0-9;]*m/g, ''), /0:07:00 moving/);
});

test('NO_COLOR turns color off', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-'));
  const e = (min, ev, extra = {}) => JSON.stringify({ t: new Date(base.startMs + min * MIN).toISOString(), ev, sid: 's1', cwd: dir, tp: '/nope.jsonl', ...extra });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [e(0, 'UserPromptSubmit', { own: false, self: false }), e(3, 'Stop')].join('\n') + '\n');
  const r = cli(['s1'], dir, { NO_COLOR: '1' });
  assert.match(r.stdout, /S T R A V I B E/);
  assert.ok(!r.stdout.includes('\x1b'));
});

test('mascot beside the commits: more speed lines the faster the pace', () => {
  const card = (s) => plain(s).split('\n');
  const rows = card({ ...base, commits: 12 }); // 5 min/commit
  const at = rows.findIndex((r) => r.endsWith(' ═══  ▐▛███▜▌'));
  assert.ok(at > 0 && rows[at].includes(big('12')[1]));
  assert.ok(rows[at + 1].endsWith('════ ▝▜█████▛▘'));
  assert.equal(rows[at + 1].length, rows[1].length); // right edge under the date
  assert.ok(rows[at + 2].includes('COMMITS') && rows[at + 2].endsWith(' ═══   ▘▘ ▝▝'));
  assert.ok(card({ ...base, commits: 4 }).some((r) => r.endsWith('   ═  ▐▛███▜▌'))); // 15 min
  assert.ok(card({ ...base, commits: 2 }).some((r) => r.endsWith('  ══ ▝▜█████▛▘'))); // 30 min
  const still = card({ ...base, commits: 0 });
  assert.ok(still.some((r) => r.endsWith('     ▝▜█████▛▘')));
  assert.ok(!/[═z]/.test(still.join('\n')));
});

test('mascot falls asleep when the pace is too slow', () => {
  const out = plain({ ...base, commits: 1 }); // 60 min/commit
  assert.match(out, /▐█████▌  z\n/);
  assert.match(out, /▝▜▇███▇▛▘/);
  assert.match(out, /z Z\n/);
  assert.doesNotMatch(out, /[═▛]███/);
});
