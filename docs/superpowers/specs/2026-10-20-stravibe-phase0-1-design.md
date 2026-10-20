# Stravibe — Phase 0 + 1 design

Date: 2026-10-20 · Scope: spike, recorder, summarizer, terminal card. The PNG card, launch and retention features (records, pruning, `activities.jsonl`) get their own specs later.

## Goal

A Claude Code plugin that records every session as an activity and prints a Strava-style text card on `/stravibe:activity`. The hero stat is pace in minutes per commit. Phase 1 is done when a week of real sessions gives believable numbers.

Hard rules:
- Hooks append one line and exit 0 with empty stdout. No git, transcript or network work inside a hook.
- Nothing leaves the machine. Prompt text, file contents, diffs, command text and Claude's replies are never stored.

## Decisions

- **Name:** `stravibe`. **Runtime:** Node (v18+), no dependencies.
- **One session = one activity.** Activities never merge across sessions; `/clear` starts a new session and therefore a new activity (the lap button). No idle split: moving time auto-pauses, so a session left open for days still shows honest pace.
- **Data sources:** hooks are the source of truth for timing, prompts and walls; git for distance and elevation; the transcript only for calories, HR zone and gear.

## Layout

The plugin lives at the repo root so a Phase 3 marketplace can point at `./`.

```
.claude-plugin/plugin.json      name: stravibe
hooks/hooks.json                every event → ${CLAUDE_PLUGIN_ROOT}/bin/stravibe-record
bin/stravibe-record             recorder
bin/stravibe-summarize          summarizer + text card
lib/transcript.js               the only code that knows the transcript format
skills/activity/SKILL.md        → /stravibe:activity
test/                           node:test, fixtures
```

## Recorder

Hooks: `SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`, `PostCompact`, `SessionEnd`. (`PostToolUse` is dropped: no stat uses it.)

Behaviour: read stdin JSON, build one event, append it as one line to `${CLAUDE_PLUGIN_DATA}/events.jsonl`, exit 0. Never write to stdout. Any error is swallowed (optionally logged to stderr) and the exit code is still 0. Lines are well under 4 KB, so concurrent appends from parallel sessions don't interleave.

Event fields:

| Field | When | Meaning |
|---|---|---|
| `t` | always | ISO timestamp (recorder clock) |
| `ev` | always | hook event name |
| `sid` | always | session ID |
| `cwd` | always | full working directory path (needed for `git log`; only the folder name may ever reach a card, and only opt-in) |
| `tp` | always | transcript path |
| `model` | SessionStart | model ID, if present |
| `len` | UserPromptSubmit | prompt length in characters |
| `corr` | UserPromptSubmit | prompt matches a correction keyword |
| `caps` | UserPromptSubmit | ≥10 letters and ≥60% of letters uppercase |
| `own` | UserPromptSubmit | prompt invokes `/stravibe:activity` |
| `self` | UserPromptSubmit | turn was started by Claude Code, not typed (detection per Phase 0 finding) |
| `reason` | StopFailure | failure reason (e.g. rate limit) |
| `trigger` | PostCompact | `auto` or `manual` |

Correction keywords (case-insensitive, whole-word, starting list):
- English: `no` (at start of prompt), `wrong`, `still broken`, `still failing`, `doesn't work`, `not working`, `revert`, `undo`, `that's not`
- Indonesian: `salah`, `masih error`, `masih rusak`, `ga jalan`, `gak jalan`, `nggak jalan`, `bukan itu`, `balikin`

The prompt is classified in memory and discarded; only the flags are written.

## Summarizer

`stravibe-summarize <session_id> [last]` reads `events.jsonl` (skipping unparseable lines), picks an activity, computes stats and prints the text card.

**Activity selection:** the given session, unless it has no typed prompt apart from `own` ones; then the session with the most recent last event. `last` always picks the most recent session other than the current one.

**Definitions:**
- *Typed prompt*: a `UserPromptSubmit` with `self` and `own` both false.
- *Turn*: from a `UserPromptSubmit` to the next `Stop`, `StopFailure` or `SessionEnd`. A turn that reaches the next `UserPromptSubmit` first is an *interrupt*.

| Stat | Formula |
|---|---|
| Moving time | Sum of turn durations, plus every gap between a turn's end and the next prompt that is ≤ 5 min. Interrupted turns count at most 5 min past their start (`ponytail:` ceiling; switch to transcript timestamps if moving time reads low). The open `own` turn is ignored. |
| Elapsed | Last event − first event. |
| Distance | Counted commits. For each distinct repo among the session's `cwd`s (`git rev-parse --show-toplevel`; skip folders that aren't repos or no longer exist): `git log --branches --no-merges -w -M --numstat` (all local branches, not just HEAD; never `--all`, which would count stash commits) with author date and email in the format (renamed paths `{old => new}` are normalized to the new path, so a pure rename counts 0 lines). Keep commits whose **author date** is within [first event, last event] (for the current session the window ends now, so commits made by hand after Claude's last turn count) and whose author email equals `git config user.email`. Exclude lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock*`, `Cargo.lock`, `poetry.lock`, `go.sum`, `Gemfile.lock`, `composer.lock`), `*.min.*`, `*.map`, paths under `dist/` or `build/`, and binary files. A commit counts if the remaining added + removed lines ≥ 5. Deduplicate by hash. |
| Elevation | Added / removed lines summed over counted commits, shown `+842 / −120`. |
| Pace | Moving time ÷ counted commits as `mm:ss /commit`. **Warm-up** if counted commits = 0 or moving time < 10 min. |
| Calories | Transcript: input + output + cache-creation tokens over assistant messages, deduplicated by message ID. Cache reads excluded. |
| Cadence | Typed prompts ÷ moving minutes. |
| HR zone | Calories ÷ moving minutes, bucketed into Z1–Z5 by cutoffs `[2k, 5k, 10k, 20k]` tokens/min (guesses, tuned after a week of data). |
| Rage index | Share of typed prompts with `corr`, `caps` or interrupt. Chill < 10%, Warm < 25%, Spicy < 50%, Meltdown ≥ 50%. |
| Walls hit | `StopFailure` events with a rate-limit reason + `PostCompact` events with `trigger: auto`. |
| Gear | Model with the most assistant messages in the transcript; fallback: `SessionStart` model. |

All thresholds, cutoffs and keyword lists are named constants at the top of their file.

**Failure handling:** if the transcript is missing or unparseable, calories and HR zone show `—` and gear uses the fallback; the card still prints. No events file or no matching session → print `No activity recorded yet.` and exit 0. A git failure in one repo skips that repo.

## Text card

```
STRAVIBE · Tue Oct 20, 09:14
──────────────────────────────────────────
   6            11:24 /commit     1:08:24
   commits      pace              moving

Elevation   +842 / −120    Elapsed   1:32:10
Calories    184k tokens    Cadence   0.4 /min
HR zone     Z3             Rage      Warm
Walls hit   1              Gear      claude-opus-5-5
──────────────────────────────────────────
stravibe
```

## Skill

`skills/activity/SKILL.md` tells Claude to run `stravibe-summarize ${CLAUDE_SESSION_ID} $ARGUMENTS` and show the output verbatim in a code block, adding nothing else.

## Phase 0 spike

Throwaway: point every hook at a raw logger that saves stdin to a scratch file, use it for one real session, read the payloads, then delete the raw log (it contains prompt text). Confirm, and update this spec where reality differs:

1. Plugin loads via `claude --plugin-dir .`.
2. Payload field names for `session_id`, `transcript_path`, `cwd`, `prompt`, SessionStart `model`, StopFailure reason, PostCompact trigger.
3. How self-started turns appear in `UserPromptSubmit` (sets `self`).
4. `/clear` produces a new `session_id`.
5. Invoking `/stravibe:activity` fires `UserPromptSubmit`, and with what prompt text (sets `own`).
6. Transcript: usage field names, duplicate usage per message ID, per-message `model`, whether subagent transcripts are separate files that must be added to calories.
7. In the skill: `${CLAUDE_SESSION_ID}` substitution works, `bin/` is on PATH, `CLAUDE_PLUGIN_DATA` is set in both the hook env and the skill's shell.
8. `git log -w --numstat` with author-date filtering counts one test session's commits correctly.

### Phase 0 findings (Claude Code 2.1.304, 2026-10-20)

Observed with a raw logger over headless (`claude -p`) sessions. Items marked *unverified* get checked in the Task 6 interactive end-to-end session.

1. `--plugin-dir` loads the plugin; skill shows as `/stravibe:activity`. ✔
2. All payloads carry `session_id`, `transcript_path`, `cwd`, `hook_event_name`; `UserPromptSubmit` has `prompt`; `SessionStart` has `source` (`startup`/`resume`/`compact`/`clear`) and only sometimes `model` (seen on `source: compact`, not on `startup`). `PostCompact` has `trigger` (`manual`/`auto`) and a `compact_summary` that must never be stored. `StopFailure` was not triggered (*unverified*): the recorder stores `error ?? reason` as `reason`, and a wall counts when it matches `/rate.?limit/i`.
3. Self-started turns arrive as `UserPromptSubmit` whose prompt starts with a hyphenated tag such as `<task-notification>`. Rule: `self = /^\s*<[a-z]+(-[a-z]+)+>/.test(prompt)`.
4. `--resume` keeps the same `session_id`. `/clear` → new `session_id` is *unverified* (expected from `source: clear`).
5. Invoking the skill fires `UserPromptSubmit` with the literal text, e.g. `/stravibe:activity last`. Rule: `own = /^\s*\/(stravibe:)?activity\b/.test(prompt)` (the unprefixed `/activity` form also works).
6. Transcript lines with `type: "assistant"` carry `message.id`, `message.model`, `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`. The same `message.id` repeats on several lines with identical usage. Subagent transcripts (including compaction's) live at `<transcript_path minus .jsonl>/subagents/agent-*.jsonl` and are added to calories.
7. `${CLAUDE_SESSION_ID}` and `${CLAUDE_PLUGIN_DATA}` are substituted in SKILL.md; `bin/` is on PATH. `CLAUDE_PLUGIN_DATA` is set in the hook env but **not** in the skill's shell, so the skill passes it: `CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" stravibe-summarize ${CLAUDE_SESSION_ID} $ARGUMENTS`.
8. `git log --no-merges -w --no-renames --numstat --format=%x00%H%x09%at%x09%ae` emits `\0hash\tauthor-epoch\temail`, a blank line, then `added\tremoved\tpath` rows. Spike repo: 1 counted commit (+10/−0); lockfile-only commit and pre-session commit correctly excluded. ✔
9. Interrupt behaviour (no `Stop` on Esc) is *unverified*.

## Testing

`node --test`. Fixtures: hand-written `events.jsonl` covering turns, auto-pause, interrupts, `own`/`self` prompts and walls; a small transcript fixture with duplicated usage lines; a temp git repo built in the test with commits inside and outside the window, a lockfile-only commit, a <5-line commit and another author. Recorder test: pipe payloads in, assert one line appended, empty stdout, exit 0 even on garbage stdin. Classifier test: keyword and caps cases.
