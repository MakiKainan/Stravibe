# Stravibe

Strava for vibecoding. Every Claude Code session becomes an activity: moving time, commits, pace, "heart rate" (tokens per minute) and a usage road. The hero stat is pace in minutes per commit.

Two plugins, install either or both:

| Plugin | What it is | Where it works |
|---|---|---|
| `stravibe` | Records every session and prints a Strava-style text card with `/stravibe:activity`. | CLI and app |
| `stravibe-live` | A live pane beside the chat: animated charts, a randomly generated usage road, a mascot that runs at your pace. `/stravibe` opens it. | Full pane in the desktop app and VS Code. The terminal gets a text version with sparklines. |

`stravibe-live` reads the history `stravibe` records for its weekly chart, so install both for the full picture.

## Install

In a terminal session:

```
/plugin install stravibe --marketplace MakiKainan/Stravibe
/plugin install stravibe-live --marketplace MakiKainan/Stravibe
```

From a shell:

```
claude plugin install stravibe --marketplace MakiKainan/Stravibe
claude plugin install stravibe-live --marketplace MakiKainan/Stravibe
```

In the Claude Code desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `MakiKainan/Stravibe`, then **Add plugin** for each. A plugin installed from a terminal at the user scope also loads in the app's local sessions.

In the app, `stravibe-live` hides `/stravibe:activity`, since the pane shows the same data. The CLI keeps it.

## Commands

- `/stravibe:activity`: the text card for this session (CLI).
- `/stravibe`: open the live pane. Every run lays out a new road. The pane's buttons switch between the 5-hour track and the weekly marathon, and tapping the mascot plays a move that depends on your pace.

## Privacy

Nothing leaves your machine. Both plugins keep numbers only.

| Kept | Never kept |
|---|---|
| timestamps, event names, session ids, working directory, transcript path | prompt text |
| prompt length and flags: correction, shouting, started by Claude Code | file contents, diffs, command text |
| model id, token counts, usage-limit percentages | Claude's replies, compaction summaries |

## Development

Node 18 or newer, no dependencies for `stravibe`:

```
node --test
```

The mod in `mod/` is tested with Claude Code's own kit:

```
claude plugin validate mod
claude plugin test mod
```

The zone cutoffs, rage levels, pace levels and commit rules live in both `bin/stravibe-summarize` and `mod/hooks/stats.ts`. Change them in both places.
