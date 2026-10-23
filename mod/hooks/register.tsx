// Stravibe Live: records this session as an activity, live, and draws it Strava-style in a pane.
// Numbers only: prompt text is classified in memory and dropped; no replies, diffs or commands are kept.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Day, Limit, Track, TrackMode } from '../types'
import { elevationSvg, headerSvg, heartSvg, heroSvg, sparkline, splitsSvg, statsSvg, weekSvg, windowed } from './charts'
import { MIN, dayKey, daysFromEvents, emptyActivity, hms, isRage, kTokens, lastWeek, movingMs, mss, parseCommits, splits, summarize, titleOf } from './stats'
import { timeFraction, trackSvg } from './track'

const PANE = 'stravibe'
const COMMAND = 'stravibe'
const PANE_COLUMNS = 64
// the desktop measures a pane in its code font's cells; one is about this many CSS pixels across. a guess
const CELL_PX = 7.8
const MIN_CARD_PX = 320
// room left for the pane's padding and scrollbar
const PANE_GUTTER_PX = 28
const TICK_MS = 1000
const COMMIT_POLL_MS = 60e3
const MAX_TURNS = 2000
const KEPT_SESSIONS = 60
const GIT_COMMAND = /\bgit\b/
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const OWN = /^\s*\/(stravibe:)?activity\b|^\s*\/stravibe\b/
const SELF = /^\s*<[a-z]+(-[a-z]+)+>/ // e.g. <task-notification>
const TEXT_CARD = 'stravibe:activity' // the stravibe plugin's skill; its text card is for the CLI
const inApp = async ($: EngineInterface) => (await $.session.surfaces()).some((s) => s !== 'terminal')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const activity = atom({ plugin: 'stravibe-live', key: 'activity' } as const, emptyActivity(0))
const week = atom({ plugin: 'stravibe-live', key: 'week' } as const, [] as Day[])
const now = atom({ plugin: 'stravibe-live', key: 'now' } as const, 0)
const limits = atom({ plugin: 'stravibe-live', key: 'limits' } as const, [] as Limit[])
const track = atom({ plugin: 'stravibe-live', key: 'track' } as const, { seed: 0, mode: 'five_hour' } as Track)

const TRACK_NAMES: Record<TrackMode, string> = { five_hour: '5-hour track', seven_day: 'Weekly marathon' }
// the pace marker moves in steps this coarse, so the road isn't redrawn (and its animation replayed) every tick
const PACE_STEP = 0.02
const newSeed = () => Math.floor(Math.random() * 2 ** 32)

/** The usage windows the last API response reported; written only when they change. */
async function refreshLimits($: EngineInterface) {
  try {
    const fresh: Limit[] = (await $.session.usage()).rateLimits.map((l) => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
    const held = await read($, limits)
    if (JSON.stringify(fresh) !== JSON.stringify(held)) await update($, limits, () => fresh)
  } catch {
    // best effort: the road keeps its last reading
  }
}

/** "resets 15:42" for the 5-hour window, "resets Thu 10:00" for the week: fixed until it resets. */
function resetLabel(limit: Limit | undefined, mode: TrackMode) {
  if (!limit?.resetsAt) return ''
  const d = new Date(limit.resetsAt)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `resets ${mode === 'seven_day' ? `${DAYS[d.getDay()]} ` : ''}${hm}`
}

type Kept = Record<string, { day: string; movingMs: number }>
let gitBusy = false

const run = async ($: EngineInterface, argv: string[], cwd: string) => {
  try {
    const r = await $.process.run(argv, { cwd, timeoutMs: 15e3 })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

/** Own commits since the activity began, counted the way the card counts them. */
async function refreshCommits($: EngineInterface) {
  if (gitBusy) return
  gitBusy = true
  try {
    const a = await read($, activity)
    if (!a.startedAt) return
    const cwd = await $.session.cwd()
    const top = (await run($, ['git', 'rev-parse', '--show-toplevel'], cwd))?.trim()
    const email = top && (await run($, ['git', 'config', 'user.email'], top))?.trim().toLowerCase()
    if (!top || !email) return
    const out = await run($, ['git', 'log', '--branches', '--no-merges', '-w', '-M', '--numstat', `--since=${new Date(a.startedAt).toISOString()}`, '--format=%x00%H%x09%at%x09%ae'], top)
    if (out === null) return
    const commits = parseCommits(out, email, a.startedAt, Date.now())
    const key = (cs: typeof commits) => cs.map((c) => `${c.t}:${c.added}:${c.removed}`).join()
    if (key(commits) !== key(a.commits)) await update($, activity, (cur) => ({ ...cur, commits }))
  } catch {
    // best effort: the next poll tries again
  } finally {
    gitBusy = false
  }
}

/** The last seven days: the recorder's history plus what this mod kept, plus this session so far. */
async function refreshWeek($: EngineInterface) {
  try {
    await loadWeek($)
  } catch {
    // best effort: the chart keeps its last week
  }
}

async function loadWeek($: EngineInterface) {
  const a = await read($, activity)
  const sid = await $.session.id()
  const at = Date.now()
  const live = movingMs({ ...a, openSince: null }, at)
  const kept = ((await $.store.get('sessions')) ?? {}) as Kept
  kept[sid] = { day: dayKey(a.startedAt || at), movingMs: live }
  const newest = Object.entries(kept).slice(-KEPT_SESSIONS)
  await $.store.set('sessions', Object.fromEntries(newest))

  let days = new Map<string, number>(), seen = new Set<string>()
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (home) {
    const root = `${home}/.claude/plugins/data`
    try {
      for (const dir of await $.fs.list(root)) {
        if (!dir.name.startsWith('stravibe') || dir.name.startsWith('stravibe-live')) continue
        try {
          const found = daysFromEvents(await $.fs.read(`${root}/${dir.name}/events.jsonl`), sid)
          for (const [d, ms] of found.days) days.set(d, (days.get(d) ?? 0) + ms)
          seen = new Set([...seen, ...found.sids])
        } catch {}
      }
    } catch {}
  }
  for (const [s, k] of newest) if (s === sid || !seen.has(s)) days.set(k.day, (days.get(k.day) ?? 0) + k.movingMs)
  await update($, week, () => lastWeek(days, at))
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { startedAt } = await $.session.usage()
    // $.state outlives a hot reload; a new session (or a resumed one) starts its own activity
    await update($, activity, (a) => (a.startedAt === startedAt ? a : emptyActivity(startedAt)))
    await update($, now, () => Date.now())
    await $.command.register({ name: COMMAND, description: 'Open the live Stravibe activity pane' })
    if (e.isInteractive) void $.ui.open({ id: PANE, title: 'Stravibe', columns: PANE_COLUMNS })

    $.clock.every(TICK_MS, () => {
      void read($, activity).then((a) => (a.openSince !== null ? update($, now, () => Date.now()) : undefined))
    })
    $.clock.every(COMMIT_POLL_MS, () => {
      void refreshCommits($)
      void refreshLimits($)
    })
    await update($, track, (t) => (t.seed ? t : { ...t, seed: newSeed() }))
    void refreshCommits($)
    void refreshWeek($)
    void refreshLimits($)
    return result
  })

  // /clear is the lap button: the next prompt starts a fresh activity
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, activity, () => emptyActivity(Date.now()))
    return next(e)
  })

  // every /stravibe lays out a new road
  on('command.run', { command: COMMAND }, async ($) => {
    await update($, track, (t) => ({ ...t, seed: newSeed() }))
    void refreshLimits($)
    await $.ui.open({ id: PANE, title: 'Stravibe', columns: PANE_COLUMNS, focus: true })
    return { text: 'Stravibe pane opened on a new route.' }
  })

  // the app has the pane, so the plain-text card from the stravibe plugin is left out there; the CLI keeps it
  on('command.describe', { command: TEXT_CARD }, async ($, e, next) => {
    const described = await next(e)
    return (await inApp($)) ? { ...described, isHidden: true } : described
  })
  on('command.run', { command: TEXT_CARD }, async ($, e, next) => {
    if (!(await inApp($))) return next(e)
    return { text: 'The Stravibe pane shows this in the app: run /stravibe.' }
  })
  // the menus answer once per command: ask again when the app connects or leaves
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    $.ui.invalidate('command.describe')
    return attached
  })
  on('session.detach', async ($, e, next) => {
    const detached = await next(e)
    $.ui.invalidate('command.describe')
    return detached
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const typed = e.text.trim() !== '' && !SELF.test(e.text) && !OWN.test(e.text)
      const rage = typed && isRage(e.text)
      const at = Date.now()
      await update($, activity, (a) => ({
        ...a,
        prompts: a.prompts + (typed ? 1 : 0),
        rageHits: a.rageHits + (rage ? 1 : 0),
        openSince: a.openSince ?? at,
        toolsInTurn: 0,
        editsInTurn: 0,
      }))
      await update($, now, () => at)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await update($, activity, (a) => ({
      ...a,
      toolsInTurn: a.toolsInTurn + 1,
      editsInTurn: a.editsInTurn + (EDIT_TOOLS.has(String(e.tool)) ? 1 : 0),
    }))
    const ran = await next(e)
    if (e.tool === 'Bash' && GIT_COMMAND.test(e.command)) $.clock.after(300, () => void refreshCommits($))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const u = e.usage
      const at = Date.now()
      await update($, activity, (a) => ({
        ...a,
        turns: [...a.turns, {
          t: at,
          ms: e.durationMs,
          tokens: u ? u.input_tokens + u.output_tokens + u.cache_creation_input_tokens : 0,
          isAborted: e.isAborted,
          tools: a.toolsInTurn,
          edits: a.editsInTurn,
        }].slice(-MAX_TURNS),
        // an interrupt reads as frustration, as on the card
        rageHits: a.rageHits + (e.isAborted ? 1 : 0),
        walls: a.walls + (e.reason === 'error' ? 1 : 0),
        model: u?.model ?? a.model,
        openSince: null,
      }))
      await update($, now, () => at)
      void refreshWeek($)
      void refreshLimits($)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const a = await read($, activity)
    await read($, now) // subscribes the pane to the clock tick
    const days = await read($, week)
    const at = Math.max(Date.now(), a.startedAt)
    const s = summarize(a, at)
    const d = new Date(a.startedAt || at)
    const when = `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const recording = a.openSince !== null
    const tpm = a.turns.map((t) => t.tokens / Math.max(t.ms / MIN, 0.05))
    const gear = (a.model ?? '—').replace(/^claude-/, '')
    // the cards only change when a turn ends or a commit lands, so their animations don't replay on every tick
    const settled = a.turns.at(-1)?.t ?? a.startedAt

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text color="claude" bold>S T R A V I B E  <Text dimColor>{when}</Text></Text>
          <Text bold>{titleOf(a.startedAt || at)}</Text>
          <Text color={recording ? 'error' : 'subtle'}>{recording ? '● REC ' : '❚❚ auto-paused '}{hms(s.moving)}</Text>
          <Text> </Text>
          <Text><Text color="claude" bold>{s.pace}</Text> {s.warmup ? 'warm-up' : '/commit'}   <Text color="claude" bold>{s.commits}</Text> commits   +{s.added} −{s.removed}</Text>
          <Text dimColor>HR    </Text>
          <Text color="error">{sparkline(tpm) || '—'}</Text>
          <Text dimColor>LAPS  </Text>
          <Text color="claude">{sparkline(splits(a, at).map((ms) => ms / MIN)) || '—'}</Text>
          <Text dimColor>WEEK  </Text>
          <Text color="claude">{sparkline(days.map((x) => x.movingMs), 7) || '—'}</Text>
          <Text> </Text>
          <Text dimColor>calories {kTokens(s.tokens)} · zone Z{s.zone ?? '—'} · rage {s.rage.name} · walls {a.walls} · {gear}</Text>
        </Box>
      )
    }

    // every word is drawn inside an Svg: a Text takes the app's font, and the pane is set in Claude's
    const { Box, Button, Svg } = $.ui.resolve(e)
    const clock = `${hms(s.moving)} moving · ${hms(s.elapsed)} elapsed`
    const route = await read($, track)
    const limit = (await read($, limits)).find((l) => l.kind === route.mode)
    const used = limit ? Math.min(1, limit.percentUsed / 100) : null
    const gone = timeFraction(limit, route.mode, at)
    const pace = gone === null ? null : Math.round(gone / PACE_STEP) * PACE_STEP
    const laps = splits(a, settled)
    const shownWeek = days.length ? days : lastWeek(new Map(), at)
    const weekMin = Math.round(shownWeek.reduce((n, d) => n + d.movingMs, 0) / MIN)
    // the cards fill the pane and grow with it; their viewBox scales everything inside
    const fill = e.props.bodyColumns ? Math.max(MIN_CARD_PX, Math.round(e.props.bodyColumns * CELL_PX) - PANE_GUTTER_PX) : undefined
    // an interactive Svg sits in a frame that is 150px tall unless told, so every card gets its height too:
    // the same width for all, each height from the card's own proportions, one scale across the pane
    const card = (source: string) => {
      const w = Number(/width="([\d.]+)"/.exec(source)?.[1] ?? 1)
      const h = Number(/height="([\d.]+)"/.exec(source)?.[1] ?? 1)
      const width = fill ?? w
      return { source, width, height: Math.round((width * h) / w) }
    }
    // one window per category, every one flush left
    return (
      <Box flexDirection="column" alignItems="flex-start" gap="md">
        <Svg {...card(headerSvg({ when, title: titleOf(a.startedAt || at), recording, clock }))} alt={`Stravibe, ${titleOf(a.startedAt || at)}, ${when}. ${recording ? 'Recording' : 'Auto-paused'}: ${clock}`} isInteractive />
        <Svg
          {...card(windowed('OVERVIEW', [
            heroSvg({ pace: s.pace, paceLabel: s.warmup ? 'WARM-UP' : 'PACE /COMMIT', commits: s.commits, level: s.level }),
            statsSvg([
              ['ELEVATION', `+${s.added} −${s.removed}`],
              ['CALORIES', `${kTokens(s.tokens)} tokens`],
              ['CADENCE', s.cadence === null ? '—' : `${s.cadence.toFixed(1)} /min`],
              ['RAGE', s.rage.name],
              ['WALLS HIT', String(a.walls)],
              ['GEAR', gear],
            ]),
          ]))}
          alt={`Pace ${s.pace}${s.warmup ? ', warming up' : ' per commit'}; ${s.commits} commits; calories ${kTokens(s.tokens)} tokens, rage ${s.rage.name}, walls hit ${a.walls}, gear ${gear}`}
          isInteractive
        />
        <Box flexDirection="row" gap="xs">
          {(['five_hour', 'seven_day'] as const).map((m) => (
            <Button key={m} label={TRACK_NAMES[m]} variant={m === route.mode ? 'primary' : 'secondary'} onPress={() => update($, track, (t) => ({ ...t, mode: m }))} />
          ))}
          <Button key="reroll" label="New route" dimColor onPress={() => update($, track, (t) => ({ ...t, seed: newSeed() }))} />
        </Box>
        <Svg
          {...card(windowed(route.mode === 'five_hour' ? 'ROUTE · 5-HOUR TRACK' : 'ROUTE · WEEKLY MARATHON', [trackSvg(route.mode, route.seed, used, pace)], [used === null ? '' : `${Math.round(used * 100)}% used`, resetLabel(limit, route.mode)].filter(Boolean).join(' · ')))}
          alt={used === null ? `${TRACK_NAMES[route.mode]}: no usage reading yet` : `${TRACK_NAMES[route.mode]}: ${Math.round(used * 100)}% of the limit used${pace === null ? '' : `, ${Math.round(pace * 100)}% of the window gone`}`}
          isInteractive
        />
        <Svg {...card(windowed('HEART RATE · TOKENS/MIN', [heartSvg(a.turns)], s.zone ? `Z${s.zone}` : ''))} alt="Tokens per minute of each turn over the heart-rate zones" isInteractive />
        <Svg {...card(windowed('ELEVATION · LINES ADDED', [elevationSvg(a.commits, a.startedAt, Math.max(settled, a.commits.at(-1)?.t ?? 0))], s.commits ? `▲ ${s.added}` : ''))} alt={`${s.added} lines added over ${s.commits} commits`} isInteractive />
        <Svg {...card(windowed('SPLITS · PER COMMIT', [splitsSvg(laps)], laps.length ? `★ ${mss(Math.min(...laps))}` : ''))} alt="Moving time between commits" isInteractive />
        <Svg {...card(windowed('THIS WEEK · MOVING TIME', [weekSvg(shownWeek)], weekMin ? `${Math.floor(weekMin / 60)}h ${weekMin % 60}m` : ''))} alt="Moving minutes for each of the last seven days" isInteractive />
      </Box>
    )
  })
}
