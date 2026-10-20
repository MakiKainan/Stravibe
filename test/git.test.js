const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { countCommits } = require('../bin/stravibe-summarize');

const START = Date.parse('2026-10-20T09:00:00Z');
const END = Date.parse('2026-10-20T11:00:00Z');
const lines = (n, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join('\n') + '\n';

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-git-'));
  const git = (args, env = {}) => execFileSync('git', args, { cwd: repo, env: { ...process.env, ...env }, stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'me@x']);
  git(['config', 'user.name', 'me']);
  let minute = 0;
  const commit = (files, { at, email = 'me@x', mv } = {}) => {
    if (mv) git(['mv', ...mv]);
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
      fs.writeFileSync(path.join(repo, f), body);
    }
    git(['add', '-A']);
    const date = new Date(at ?? START + ++minute * 60e3).toISOString();
    git(['commit', '-qm', 'c', `--author=x <${email}>`], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  };
  commit({ 'src/old.js': lines(50) }, { at: START - 3600e3 }); // before window
  commit({ 'src/a.js': lines(10) }); // counts: +10
  commit({ 'src/b.js': lines(3) }); // too small
  commit({ 'package-lock.json': lines(30) }); // lockfile only
  commit({ 'dist/app.js': lines(30) }); // generated
  commit({ 'other.js': lines(20) }, { email: 'teammate@x' }); // other author
  commit({ 'src/a.js': lines(10, '    line') }); // whitespace-only
  commit({ 'src/renamed.js': lines(10, '    line') + lines(6, 'new') }, { mv: ['src/a.js', 'src/renamed.js'] }); // rename + 6: counts
  commit({}, { mv: ['src/b.js', 'src/b2.js'] }); // pure rename
  return repo;
}

test('counts only qualifying commits in the window', () => {
  const repo = makeRepo();
  assert.deepEqual(countCommits([repo, path.join(repo, 'src')], START, END), { commits: 2, added: 16, removed: 0 });
});

test('non-repo and deleted cwd give zero, no throw', () => {
  const zero = { commits: 0, added: 0, removed: 0 };
  assert.deepEqual(countCommits([path.join(os.tmpdir(), 'definitely-missing-sv')], 0, Date.now()), zero);
  assert.deepEqual(countCommits([fs.mkdtempSync(path.join(os.tmpdir(), 'sv-plain-'))], 0, Date.now()), zero);
});

test('repo without user.email gives zero', () => {
  const repo = makeRepo();
  execFileSync('git', ['config', '--unset', 'user.email'], { cwd: repo });
  const empty = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sv-cfg-')), 'gitconfig');
  fs.writeFileSync(empty, '');
  const saved = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = empty;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  try {
    assert.deepEqual(countCommits([repo], START, END), { commits: 0, added: 0, removed: 0 });
  } finally {
    for (const [k, v] of [['GIT_CONFIG_GLOBAL', saved.g], ['GIT_CONFIG_NOSYSTEM', saved.s]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});
