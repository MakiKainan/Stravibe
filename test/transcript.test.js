const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readTranscripts, withSubagents } = require('../lib/transcript');

const main = path.join(__dirname, 'fixtures/sess.jsonl');
const sub = path.join(__dirname, 'fixtures/sess/subagents/agent-a1.jsonl');

test('sums tokens once per message id, excludes cache reads', () => {
  const r = readTranscripts([main, sub, main]); // main twice: dedup across files too
  assert.equal(r.tokens, 1102 + 703 + 51);
  assert.deepEqual(r.models, { 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 1 });
});

test('missing file returns null', () => {
  assert.equal(readTranscripts(['/nope']), null);
  assert.equal(readTranscripts([]), null);
});

test('withSubagents adds agent-*.jsonl next to each transcript', () => {
  assert.deepEqual(withSubagents([main, '/nope.jsonl']), [main, '/nope.jsonl', sub]);
});
