const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { classify, toEvent } = require('../bin/stravibe-record');

const BIN = path.join(__dirname, '../bin/stravibe-record');

test('classify flags corrections in both languages', () => {
  assert.equal(classify('no, use the other file').corr, true);
  assert.equal(classify('masih error bro').corr, true);
  assert.equal(classify('that is still broken').corr, true);
  assert.equal(classify('add a known bug note').corr, false); // "no" only at start
  assert.equal(classify('notify me').corr, false); // whole word
});

test('classify caps needs >=10 letters and >=60% upper', () => {
  assert.equal(classify('WHY IS THIS BROKEN').caps, true);
  assert.equal(classify('OK FIX').caps, false);
  assert.equal(classify('fix the API and CSS').caps, false);
});

test('classify own and len', () => {
  assert.equal(classify('/stravibe:activity last').own, true);
  assert.equal(classify('/stravibe:activity').own, true);
  assert.equal(classify('run /stravibe:activity').own, false);
  assert.equal(classify('/activity last').own, true); // unprefixed plugin skill
  assert.equal(classify('/activityx').own, false);
  assert.equal(classify('hello').len, 5);
});

test('toEvent never contains prompt text', () => {
  const e = toEvent({ hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: '/r', transcript_path: '/t', prompt: 'SECRET sk-123' }, new Date(0));
  assert.ok(!JSON.stringify(e).includes('SECRET'));
  assert.deepEqual(Object.keys(e).sort(), ['caps', 'corr', 'cwd', 'ev', 'len', 'own', 'self', 'sid', 't', 'tp']);
});

test('toEvent flags self-started turns', () => {
  const e = toEvent({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<task-id>x' }, new Date(0));
  assert.equal(e.self, true);
  assert.equal(toEvent({ hook_event_name: 'UserPromptSubmit', prompt: '<div> is broken' }, new Date(0)).self, false);
});

test('toEvent keeps only per-event fields, never compact_summary', () => {
  const pc = toEvent({ hook_event_name: 'PostCompact', trigger: 'auto', compact_summary: 'SECRET' }, new Date(0));
  assert.equal(pc.trigger, 'auto');
  assert.ok(!JSON.stringify(pc).includes('SECRET'));
  assert.equal(toEvent({ hook_event_name: 'StopFailure', error: 'rate_limit' }, new Date(0)).reason, 'rate_limit');
  assert.equal(toEvent({ hook_event_name: 'SessionStart', model: 'claude-opus-5-5' }, new Date(0)).model, 'claude-opus-5-5');
  assert.equal(toEvent({ hook_event_name: 'Stop', last_assistant_message: 'SECRET' }, new Date(0)).last_assistant_message, undefined);
});

function run(input) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sv-')), 'not-yet');
  const r = spawnSync(BIN, { input, env: { ...process.env, CLAUDE_PLUGIN_DATA: dir } });
  return { ...r, file: path.join(dir, 'events.jsonl') };
}

test('recorder appends one line, empty stdout, exit 0, creates data dir', () => {
  const r = run(JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.toString(), '');
  assert.equal(fs.readFileSync(r.file, 'utf8').trim().split('\n').length, 1);
});

test('recorder exits 0 with empty stdout on garbage stdin', () => {
  const r = run('not json');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.toString(), '');
});
