# Stravibe

A Claude Code plugin ("Strava for vibecoding"). Hooks record every session as an activity, and `/stravibe:activity` prints a Strava-style card. The hero stat is pace in minutes per commit.

- Spec: `docs/superpowers/specs/2026-10-20-stravibe-phase0-1-design.md` (includes real Phase 0 hook-payload findings)
- Plan: `docs/superpowers/plans/2026-10-20-stravibe-phase0-1.md`

## Layout

- `bin/stravibe-record`: hook recorder. Appends one JSON line to `${CLAUDE_PLUGIN_DATA}/events.jsonl`.
- `bin/stravibe-summarize`: picks the session, works out timing, counts git commits, renders the card.
  - `[sid [last]] [--plain]`
  - With no args it uses the latest session and finds `~/.claude/plugins/data/stravibe*` on its own.
- `lib/transcript.js`: the only code that knows the transcript format (tokens, model, subagent files).
- `skills/activity/SKILL.md`: `/stravibe:activity`. Runs the summarizer with `--plain`, because Claude's code block can't show color.
- `hooks/hooks.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (local marketplace, source `./`)
- Tests: `node --test` (Node ≥ 18, no dependencies)
- `mod/`: the second plugin, `stravibe-live` (marketplace source `./mod`). A Claude Code function-hooks mod: `/stravibe` opens a live pane in the desktop app and VS Code, with animated SVG cards, a randomly generated usage road (5-hour track / weekly marathon) and a mascot that plays a move when tapped. The terminal gets a text version with sparklines.
  - `mod/hooks/register.tsx`: recording and the pane layout. `charts.ts`: the SVG cards and mascot sprites. `track.ts`: the road generator. `stats.ts`: the numbers.
  - It also hides `/stravibe:activity` in the app, since the pane covers it. The CLI keeps it.
  - Tests: `claude plugin test mod`. Check: `claude plugin validate mod`.
  - `mod/.claude-plugin/types/` is written by the engine and git-ignored. Don't commit it.

## Rules

- No `Co-Authored-By: Claude` or other Claude attribution in commits or PRs.
- The recorder never writes to stdout and always exits 0. No git, network or transcript work inside hooks.
- Never store prompt text, file contents, diffs, command text, Claude's replies or `compact_summary`.
- Thresholds, cutoffs and keyword lists are named constants at the top of their file.
- The zone cutoffs, rage levels, pace levels, auto-pause and commit rules exist in both `bin/stravibe-summarize` and `mod/hooks/stats.ts` (zone cutoffs also in `mod/hooks/charts.ts`). Change them in every place, so the card and the pane agree.
- The mod stores numbers only, like the recorder. Its `$.store` holds per-session moving time, nothing else.

## Progress (2026-10-20)

Done:
- Phase 0 spike (headless)
- Phase 1: recorder, summarizer and text card
- Final review, with 3 important fixes applied
- Orange block-digit card. `! stravibe-summarize` prints it in Claude orange `#D97757`; `/stravibe:activity` prints it in monochrome.

The user's machine:
- Symlink `~/.local/bin/stravibe-summarize` → repo `bin/`. `~/.local/bin` may still need adding to PATH in `~/.bashrc`.
- The plugin is **not installed yet**. Next step:
  ```
  /plugin marketplace add /home/phuuun/Projects/Personal/claude/Stravibe
  /plugin install stravibe@stravibe
  ```
- The installed copy is cached. After editing the repo, run `/plugin marketplace update stravibe`.

Next:
1. First real session with the plugin installed. Verify the 3 interactive checks that couldn't be tested headless:
   - Esc interrupt fires no `Stop`.
   - `/clear` gives a new session id.
   - Whether queued mid-turn prompts fire `UserPromptSubmit` without a `Stop` (that would count them as interrupts).

   Also check whether running the skill brings up a permission prompt.
2. A week of real sessions → tune `ZONE_CUTOFFS`, `RAGE_LEVELS`, `MIN_COMMIT_LINES` and the correction keywords.
3. Phase 3 launch: README with install line `/plugin install stravibe --marketplace MakiKainan/Stravibe`, example card and privacy table.

Deferred minors (from the final review):
- Quoted non-ASCII paths bypass the exclusion list (fix: `-c core.quotePath=false`).
- `SELF` regex false positive on pasted `<my-component>` prompts.
- An interrupted turn followed by `/activity` adds 0 moving time.
- `StopFailure` reason length is unbounded.
- No CLI test for a fresh window holding only SessionStart + an own prompt.
- A crash mid-write glues the next line onto the truncated one.
