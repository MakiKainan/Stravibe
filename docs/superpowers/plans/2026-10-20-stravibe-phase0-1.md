# Stravibe Phase 0 + 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that records sessions via hooks and prints a Strava-style text card on `/stravibe:activity`.

**Architecture:** A stateless Node recorder appends one JSON line per hook event to `${CLAUDE_PLUGIN_DATA}/events.jsonl`. A Node summarizer picks one session, computes timing stats from events, distance from `git log`, tokens and gear from the transcript, and prints the card. A skill runs the summarizer.

**Tech Stack:** Node ≥ 18, stdlib only, `node:test`, git CLI.

**Spec:** `docs/superpowers/specs/2026-10-20-stravibe-phase0-1-design.md`

## Global Constraints

- Node ≥ 18, CommonJS, zero dependencies, no `package.json` needed.
- Recorder: empty stdout, always exit 0, no git/transcript/network calls.
- Never store prompt text, file contents, diffs, command text or replies.
- All thresholds, cutoffs and keyword lists are named constants at the top of their file.
- `bin/*` files are extensionless, start with `#!/usr/bin/env node`, are `chmod +x`, and export their functions (`module.exports`) with `if (require.main === module) main()` so tests can `require('../bin/stravibe-record')`.
- Tests: `test/*.test.js`, run with `node --test`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. First run: `CLAUDE_PLUGIN_DATA` directory does not exist yet → recorder creates it and appends (Task 2 test).
2. Truncated or garbage line in `events.jsonl` → summarizer skips it, card still prints (Task 4 test).
3. Session `cwd` is not a git repo, was deleted, or the repo has no `user.email` → distance 0, no crash (Task 5 test).
4. Renamed files in a commit → `--no-renames` keeps numstat paths plain, so exclusion and line counts stay correct (Task 5 test).
5. `/activity` in a fresh window with no other sessions → `No activity recorded yet.`, exit 0 (Task 6 test).

---

### Task 1: Phase 0 spike

Needs the human partner for the interactive parts (a real session, `/clear`, an interrupt, invoking the skill). Nothing from this task is kept except `.claude-plugin/plugin.json` and the spec updates.

**Files:**
- Create: `.claude-plugin/plugin.json` — `{"name":"stravibe","version":"0.1.0","description":"Strava for vibecoding: every Claude Code session becomes an activity."}`
- Throwaway (scratchpad, never committed): a raw logger that appends `{event, stdin, env:{CLAUDE_PLUGIN_DATA}}` per hook to a scratch file; a `hooks/hooks.json` pointing all six spec hooks at it; a `skills/activity/SKILL.md` that runs `echo ${CLAUDE_SESSION_ID}; which stravibe-summarize; echo $CLAUDE_PLUGIN_DATA`.
- Modify: the spec's "Phase 0 spike" section and any section whose assumption turned out wrong.

- [ ] **Step 1:** Write the throwaway files and a dummy `bin/stravibe-summarize` that prints `ok`.
- [ ] **Step 2:** Human runs `claude --plugin-dir .`: types a few prompts, interrupts one with Esc, runs `/clear`, runs `/stravibe:activity`, makes 2 commits (one lockfile-only), exits.
- [ ] **Step 3:** Read the raw log and the session transcript; answer spec Phase 0 items 1–8. Record in the spec: exact payload field names, the self-started-turn rule, the `own` prompt text, transcript usage/model field paths, whether usage repeats per message ID, the subagent transcript location (or "none"), and whether `${CLAUDE_SESSION_ID}`/PATH/`CLAUDE_PLUGIN_DATA` work in the skill (and the workaround if not).
- [ ] **Step 4:** Run `git log --no-merges -w --no-renames --numstat --format=%x00%H%x09%at%x09%ae` in the test repo; confirm the counts match the spec's rules by hand.
- [ ] **Step 5:** Delete the raw log and the throwaway files. Commit `plugin.json` and the spec: `git commit -m "Phase 0: record real hook payloads in spec"`.

Later tasks use the field names and rules recorded here; where this plan says "per Phase 0", read the updated spec.

### Task 2: Recorder

**Files:**
- Create: `bin/stravibe-record`, `hooks/hooks.json`
- Test: `test/record.test.js`

**Interfaces:**
- Produces: `classify(prompt: string) -> {len: number, corr: boolean, caps: boolean, own: boolean}`; `toEvent(payload: object, now: Date) -> object` (event line per spec table; `self` per Phase 0 rule; only fields relevant to the event type); `main()` reads stdin, appends `JSON.stringify(toEvent(...)) + "\n"` to `path.join(process.env.CLAUDE_PLUGIN_DATA, "events.jsonl")` after `mkdirSync(..., {recursive: true})`, catches everything.
- `hooks.json`: for each of `SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`, `PostCompact`, `SessionEnd`: `[{"hooks":[{"type":"command","command":"\"${CLAUDE_PLUGIN_ROOT}/bin/stravibe-record\""}]}]` under top-level `"hooks"`.

- [ ] **Step 1: Write failing tests**

```js
test('classify flags corrections in both languages', () => {
  assert.equal(classify('no, use the other file').corr, true);
  assert.equal(classify('masih error bro').corr, true);
  assert.equal(classify('that is still broken').corr, true);
  assert.equal(classify('add a known bug note').corr, false); // "no" only at start
  assert.equal(classify('notify me').corr, false);           // whole word
});
test('classify caps needs >=10 letters and >=60% upper', () => {
  assert.equal(classify('WHY IS THIS BROKEN').caps, true);
  assert.equal(classify('OK FIX').caps, false);
  assert.equal(classify('fix the API and CSS').caps, false);
});
test('classify own and len', () => {
  assert.equal(classify('/stravibe:activity last').own, true); // exact form per Phase 0
  assert.equal(classify('hello').len, 5);
});
test('toEvent never contains prompt text', () => {
  const e = toEvent({hook_event_name:'UserPromptSubmit', session_id:'s', cwd:'/r', transcript_path:'/t', prompt:'SECRET sk-123'}, new Date(0));
  assert.ok(!JSON.stringify(e).includes('SECRET'));
  assert.deepEqual(Object.keys(e).sort(), ['caps','corr','cwd','ev','len','own','self','sid','t','tp']);
});
test('recorder appends one line, empty stdout, exit 0, creates data dir', () => { /* spawnSync with CLAUDE_PLUGIN_DATA = fresh tmp subdir that does not exist; assert status 0, stdout '', file has 1 line */ });
test('recorder exits 0 with empty stdout on garbage stdin', () => { /* input 'not json'; status 0, stdout '' */ });
```

- [ ] **Step 2:** `node --test test/record.test.js` → FAIL (module not found).
- [ ] **Step 3:** Implement. Keywords and caps thresholds from the spec as top-of-file constants; match keywords with `\b` regexes, case-insensitive, `no` as `^\s*no\b`.
- [ ] **Step 4:** `node --test test/record.test.js` → all PASS.
- [ ] **Step 5:** `chmod +x bin/stravibe-record`; commit `"feat: hook recorder"`.

### Task 3: Transcript parser

**Files:**
- Create: `lib/transcript.js`, `test/fixtures/transcript.jsonl`
- Test: `test/transcript.test.js`

**Interfaces:**
- Produces: `readTranscripts(paths: string[]) -> {tokens: number, models: {[model: string]: number}} | null`. Sums `input_tokens + output_tokens + cache_creation_input_tokens` over assistant messages (field paths per Phase 0), deduplicated by message ID across all files; `models` counts messages per model. Returns `null` if no path is readable or no assistant message parses. Never throws.

- [ ] **Step 1: Write failing tests** — fixture has 3 assistant messages, one repeated on 2 lines with identical usage, one non-JSON line, one user line.

```js
test('sums tokens once per message id, excludes cache reads', () => {
  const r = readTranscripts([fixture]);
  assert.equal(r.tokens, /* hand-computed from fixture, cache_read excluded */);
  assert.deepEqual(r.models, {'claude-opus-5-5': 2, 'claude-sonnet-5-5': 1});
});
test('missing file returns null', () => assert.equal(readTranscripts(['/nope']), null));
```

- [ ] **Step 2:** `node --test test/transcript.test.js` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `"feat: transcript token parser"`.

### Task 4: Session selection and timing stats

**Files:**
- Create: `bin/stravibe-summarize` (this task adds the event functions)
- Test: `test/timing.test.js`, `test/fixtures/events.jsonl`

**Interfaces:**
- Produces:
  - `loadEvents(file: string) -> event[]` — skips unparseable lines; `[]` if the file is missing.
  - `pickSession(events, sid: string, last: boolean) -> string | null` — per spec "Activity selection".
  - `timing(events, sid) -> {startMs, endMs, movingMs, elapsedMs, typed, rageHits, walls, cwds: string[], tps: string[], startModel: string|null}`.

Rules `timing` must follow (exactly as spec): own turns (an `own` prompt through its end event) are dropped before anything is computed; a turn ends at the next `Stop`/`StopFailure`/`SessionEnd`; a turn ended by the next `UserPromptSubmit` is an interrupt, contributes `min(gap, 5 min)`, adds no gap, and marks that next prompt as a rage hit if it is typed; gaps from a turn end to the next prompt count only if ≤ 5 min; end events with no open turn are ignored; `rageHits` counts typed prompts with `corr || caps || interrupt`; `walls` = rate-limit `StopFailure` (reason per Phase 0) + `PostCompact` with `trigger === 'auto'`; `startMs`/`endMs` = first/last remaining event.

- [ ] **Step 1: Write failing tests** against a fixture with sessions `A` (older) and `B`:

```js
test('moving time: turns + short gaps, long gap paused', () => {
  // A: prompt 0:00, Stop 0:04; prompt 0:07 (3 min gap counts), Stop 0:10; prompt 0:40 (30 min gap paused), Stop 0:45
  assert.equal(timing(ev, 'A').movingMs, 15 * 60e3);
  assert.equal(timing(ev, 'A').elapsedMs, 45 * 60e3);
});
test('interrupt capped at 5 min and counted as rage', () => { /* prompt 0:00, prompt 0:12 no Stop between → +5 min, rageHits 1 */ });
test('own and self prompts are not typed; own turn dropped', () => { /* typed excludes both; own turn time not in movingMs or endMs */ });
test('walls: rate-limit failure + auto compact, manual compact ignored', () => { /* walls 2 */ });
test('pickSession falls back when current has only own prompts', () => {
  assert.equal(pickSession(ev, 'C', false), 'B'); // C has only an own prompt
  assert.equal(pickSession(ev, 'B', false), 'B');
  assert.equal(pickSession(ev, 'B', true), 'A');
  assert.equal(pickSession([], 'X', false), null);
});
test('loadEvents skips a truncated line', () => { /* fixture ends with '{"t":"2026' */ });
```

- [ ] **Step 2:** `node --test test/timing.test.js` → FAIL.
- [ ] **Step 3:** Implement; 5-min pause and 5-min interrupt cap as constants. Mark the interrupt cap with `// ponytail: interrupted turns capped at 5 min; use transcript timestamps if moving time reads low`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** `chmod +x`; commit `"feat: session selection and timing stats"`.

### Task 5: Commit counting

**Files:**
- Modify: `bin/stravibe-summarize` (adds git functions)
- Test: `test/git.test.js`

**Interfaces:**
- Produces: `countCommits(cwds: string[], startMs: number, endMs: number) -> {commits: number, added: number, removed: number}`. Resolves each cwd with `git rev-parse --show-toplevel` (skip on failure), dedupes repos, reads `git config user.email` per repo (skip repo if unset), runs `git log --no-merges -w --no-renames --numstat --format=%x00%H%x09%at%x09%ae` via `execFileSync`, keeps commits with author time in `[startMs, endMs]` and matching email, drops excluded paths and binary (`-`) rows, counts commits with remaining added+removed ≥ 5, dedupes by hash. Exclusion list and threshold as constants from the spec.

- [ ] **Step 1: Write failing tests** — build a temp repo in `before()` with `git -c user.email=me@x` and `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` env to place commits:

```js
test('counts only qualifying commits in the window', () => {
  // in window: 10-line src change (counts), 3-line change (no), package-lock.json-only (no),
  //   dist/app.js-only (no), other author 20 lines (no), whitespace-only reformat (no), rename + 6 lines (counts)
  // before window: 50-line change (no)
  assert.deepEqual(countCommits([repo, repo + '/src'], start, end), {commits: 2, added: /*…*/, removed: /*…*/});
});
test('non-repo and deleted cwd give zero, no throw', () => {
  assert.deepEqual(countCommits([os.tmpdir() + '/definitely-missing'], 0, Date.now()), {commits: 0, added: 0, removed: 0});
});
```

- [ ] **Step 2:** `node --test test/git.test.js` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `"feat: commit counting"`.

### Task 6: Card rendering, CLI and skill

**Files:**
- Modify: `bin/stravibe-summarize` (adds `render`, `main`)
- Create: `skills/activity/SKILL.md`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `loadEvents`, `pickSession`, `timing` (Task 4), `countCommits` (Task 5), `readTranscripts` (Task 3).
- Produces: `render(s) -> string` where `s = {startMs, movingMs, elapsedMs, commits, added, removed, tokens|null, typed, rageHits, walls, gear|null}`; `main(argv)` = `stravibe-summarize <sid> [last]`.
- Formatting: layout exactly as the spec's text card. Pace `mm:ss /commit` or `Warm-up` (commits 0 or moving < 10 min); moving and elapsed `h:mm:ss`; elevation `+A / −R`; calories `184k tokens` (thousands, rounded) or `—`; cadence `typed ÷ moving minutes` to 1 decimal `/min`; HR zone `Z1`–`Z5` from cutoffs `[2000, 5000, 10000, 20000]` tokens/min or `—`; rage `Chill <0.10 ≤ Warm <0.25 ≤ Spicy <0.50 ≤ Meltdown` (`Chill` when typed is 0); gear = most-counted transcript model, else `startModel`, else `—`; header date from `startMs` in local time, `Tue Oct 20, 09:14`.
- `main`: `pickSession` null → print `No activity recorded yet.`, exit 0. Transcript paths = session `tps` plus subagent files per Phase 0.
- `SKILL.md`: frontmatter `name: activity`, `description: Show the Strava-style card for this coding session`; body: run `stravibe-summarize ${CLAUDE_SESSION_ID} $ARGUMENTS` (adjusted per Phase 0) and show its output verbatim in a code block, adding nothing.

- [ ] **Step 1: Write failing tests**

```js
test('pace and hero row', () => {
  const out = render({...base, movingMs: (68*60+24)*1e3, commits: 6});
  assert.match(out, /11:24 \/commit/);
  assert.match(out, /1:08:24/);
});
test('warm-up under 10 min or zero commits', () => {
  assert.match(render({...base, movingMs: 9*60e3, commits: 3}), /Warm-up/);
  assert.match(render({...base, commits: 0}), /Warm-up/);
});
test('missing transcript shows dashes', () => {
  const out = render({...base, tokens: null, gear: null});
  assert.match(out, /Calories\s+—/); assert.match(out, /HR zone\s+—/);
});
test('rage buckets', () => { /* 1/20 → Chill, 3/20 → Warm, 6/20 → Spicy, 10/20 → Meltdown */ });
test('main with empty data dir prints no-activity message', () => { /* spawnSync with CLAUDE_PLUGIN_DATA=fresh tmp; stdout 'No activity recorded yet.\n', status 0 */ });
```

- [ ] **Step 2:** `node --test test/render.test.js` → FAIL.
- [ ] **Step 3:** Implement `render`, `main`, `SKILL.md`.
- [ ] **Step 4:** `node --test` → all suites PASS.
- [ ] **Step 5:** End-to-end: human runs `claude --plugin-dir .`, works ~15 min with 2+ commits, runs `/stravibe:activity`; card prints with plausible numbers; `/stravibe:activity last` shows the previous session.
- [ ] **Step 6:** Commit `"feat: text card and activity skill"`.
