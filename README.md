# Stravibe

Strava for vibecoding. Every Claude Code session becomes an activity: moving time, commits, pace, a "heart rate" and a usage road. The hero stat is **pace in minutes per commit**.

## Install

Stravibe is two plugins from one marketplace, `MakiKainan/Stravibe`. Install either or both.

| Plugin | What it gives you |
|---|---|
| `stravibe` | Records every session and prints a text card with `/stravibe:activity`. Works in the CLI and the app. |
| `stravibe-live` | A live pane beside the chat with animated charts, a usage road and a tappable mascot. Best with `stravibe`, which supplies the history for its weekly chart. |

### In a terminal session

```
/plugin install stravibe --marketplace MakiKainan/Stravibe
/plugin install stravibe-live --marketplace MakiKainan/Stravibe
```

Each one asks `Add marketplace?` the first time (answer `y`), then which scope to install at.

### From a shell

```
claude plugin install stravibe --marketplace MakiKainan/Stravibe
claude plugin install stravibe-live --marketplace MakiKainan/Stravibe
```

### In the Claude Code desktop app

`/plugin` doesn't run in the app. Instead:

1. Click **+** next to the prompt box, then **Plugins**.
2. Choose **Add marketplace** and enter `MakiKainan/Stravibe`.
3. Choose **Add plugin** for `stravibe`, then again for `stravibe-live`.

A plugin installed from a terminal at the user scope also loads in the app's local sessions, so installing once in the CLI is enough.

### Then

Start a session and work as usual. Run `/stravibe` to open the pane (desktop app), or `/stravibe:activity` for the text card (CLI).

`stravibe-live` is a Claude Code function-hooks mod, which is early access. It was built and tested on Claude Code 2.1.304.

## What it does

### The card: `/stravibe:activity`

A Strava-style text card for the current session, in orange block digits with the mascot beside them:

- **Pace**, the hero stat: moving time divided by commits. Shows `--:--` and "warm-up" until you have a commit and 10 minutes of moving time.
- **Commits**, plus lines added and removed.
- **Calories**: tokens used (input, output and cache writes).
- **Heart-rate zone** Z1 to Z5, from tokens per moving minute.
- **Cadence**: prompts per moving minute.
- **Rage**: the share of your prompts that were corrections ("no", "wrong", "revert"), shouting in caps, or interrupts. Chill, Warm, Spicy or Meltdown.
- **Walls hit**: rate limits and automatic compactions.
- **Gear**: the model you used most.

With `stravibe-live` installed, the card is hidden in the app, because the pane shows the same data. The CLI keeps it.

### The pane: `/stravibe`

A live view in the desktop app, redrawn as the session goes. Every window is a framed card, set in a serif font (Claude's own if installed, Georgia otherwise), and everything scales with the width of the pane.

| Window | Shows |
|---|---|
| **Header** | The session title ("Morning Vibe", "Evening Flow"), a `REC` clock while Claude is working, and `Auto-paused` while it isn't. |
| **Overview** | Pace and commits in big numerals, the mascot, and calories, cadence, rage, walls and gear. |
| **Route** | Your usage as a road. See below. |
| **Heart rate** | Tokens per minute for each turn, over coloured Z1 to Z5 bands, with a heart that beats faster in the higher zones. |
| **Elevation** | Lines added, climbing commit by commit. Hover a dot to see that commit. |
| **Splits** | Moving time between each pair of commits, with the fastest lap starred. |
| **This week** | Moving minutes for each of the last seven days, today in orange. |

In a terminal the pane is a text version: the same numbers, with sparklines in place of the charts.

### The usage road

The Route window turns your usage limit into a road you run along. Switch between two with the buttons above it:

- **5-hour track**: a closed circuit with corners, hairpins, curbs and sector marks. It represents your rolling 5-hour window.
- **Weekly marathon**: a long winding road from START to FINISH, with 10K, HALF and 30K marks. It represents your weekly limit, scaled to the real 42.195 km.

An orange line fills the road as far as you have used of the limit, and a tag on the runner shows the percentage. A hollow marker shows where an even pace would be by now: if you are ahead of it, you are burning through the limit faster than time is passing. The title bar shows when the window resets.

Every `/stravibe`, and the **New route** button, generates a different road. A road is made from a random seed, so no two look alike.

The usage figures come from the limits Claude Code reports with each reply. On an API-key account there are no usage limits, so the road shows no progress.

### The mascot

Claude Code's mascot runs at your pace, drawn as a pixel sprite that moves a whole cell at a time, like Claude Code's own animations. Tap it for a move that depends on your pace:

| Pace | Looks like | On tap |
|---|---|---|
| Warm-up | stands, blinks | jumping jacks ×3, then a hop |
| Jog (20 to 45 min per commit) | slow stride, one speed line | waves while still jogging |
| Run (10 to 20 min per commit) | faster stride, two speed lines | jumps a scuttling pixel bug |
| Sprint (under 10 min per commit) | fastest stride, three speed lines | snaps the finish tape, confetti |
| Asleep (over 45 min per commit) | eyes shut, z's drifting up | jolts awake with a `!`, looks around, dozes off |

## How the numbers work

- **Moving time** is the time Claude spends on your turns, plus the gaps between turns of at most 5 minutes. A longer gap pauses the clock, so a session left open for days still reads honestly.
- **Commits** are your own commits (matching your `git config user.email`) made during the session, on any local branch. A commit counts if it changes at least 5 lines, not counting lockfiles, minified files, source maps and `dist/` or `build/` folders.
- **One session is one activity.** `/clear` starts a new one.

## Privacy

Nothing leaves your machine. Both plugins keep numbers only.

| Kept | Never kept |
|---|---|
| timestamps, event names, session ids, working directory, transcript path | prompt text |
| prompt length and flags: correction, shouting, started by Claude Code | file contents, diffs, command text |
| model id, token counts, usage-limit percentages | Claude's replies, compaction summaries |

## Development

`stravibe` needs Node 18 or newer and no dependencies:

```
node --test
```

The mod lives in `mod/` and is tested with Claude Code's own kit:

```
claude plugin validate mod
claude plugin test mod
```

The zone cutoffs, rage levels, pace levels and commit rules exist in both `bin/stravibe-summarize` and `mod/hooks/stats.ts`. Change them in both places.
