// Pure numbers: moving time, pace, zones, commits from git output, the week from events.jsonl.
// Mirrors bin/stravibe-summarize so the pane and the card agree.
import type { Activity, Commit, Day } from '../types'

export const MIN = 60e3
export const AUTO_PAUSE_MS = 5 * MIN
export const WARMUP_MIN_MOVING_MS = 10 * MIN
export const MIN_COMMIT_LINES = 5
export const ZONE_CUTOFFS = [2000, 5000, 10000, 20000] // tokens per moving minute; guesses
export const RAGE_LEVELS: [number, string][] = [[0.1, 'Chill'], [0.25, 'Warm'], [0.5, 'Spicy'], [Infinity, 'Meltdown']]
// minutes per commit -> mascot speed; 0 = asleep. guesses
export const PACE_LEVELS: [number, number][] = [[10, 3], [20, 2], [45, 1], [Infinity, 0]]
export const CORRECTIONS = [
  /^\s*no\b/i,
  /\b(wrong|still broken|still failing|doesn'?t work|not working|revert|undo|that'?s not)\b/i,
  /\b(salah|masih error|masih rusak|ga jalan|gak jalan|nggak jalan|bukan itu|balikin)\b/i,
]
export const CAPS_MIN_LETTERS = 10
export const CAPS_MIN_SHARE = 0.6
export const EXCLUDED_PATHS = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/,
  /\.min\.[^/]+$/,
  /\.map$/,
  /(^|\/)(dist|build)\//,
]
const TITLES: [number, string][] = [[5, 'Late-Night Grind'], [12, 'Morning Vibe'], [17, 'Afternoon Session'], [22, 'Evening Flow'], [24, 'Late-Night Grind']]
const END_EVENTS = new Set(['Stop', 'StopFailure', 'SessionEnd'])

export function emptyActivity(startedAt: number): Activity {
  return { startedAt, turns: [], commits: [], prompts: 0, rageHits: 0, walls: 0, model: null, openSince: null, toolsInTurn: 0, editsInTurn: 0 }
}

/** The prompt is read here and dropped: only the flag leaves. */
export function isRage(prompt: string): boolean {
  const letters = prompt.match(/\p{L}/gu) ?? []
  const upper = letters.filter((c) => c !== c.toLowerCase()).length
  return CORRECTIONS.some((re) => re.test(prompt)) || (letters.length >= CAPS_MIN_LETTERS && upper / letters.length >= CAPS_MIN_SHARE)
}

/** The moving stretches: every turn, a running one up to now, and each idle gap of at most AUTO_PAUSE_MS. */
function moving(a: Activity, now: number): [number, number][] {
  const turns: [number, number][] = a.turns.map((t) => [t.t - t.ms, t.t])
  if (a.openSince !== null) turns.push([a.openSince, Math.max(a.openSince, now)])
  turns.sort((x, y) => x[0] - y[0])
  const out: [number, number][] = []
  for (const [s, e] of turns) {
    const last = out.at(-1)
    if (last && s - last[1] <= AUTO_PAUSE_MS) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

/** Moving time up to `at` (defaults to now). */
export function movingMs(a: Activity, now: number, at = now): number {
  return moving(a, now).reduce((n, [s, e]) => n + Math.max(0, Math.min(e, at) - s), 0)
}

/** Moving time between one commit and the next: the laps. */
export function splits(a: Activity, now: number): number[] {
  let prev = 0
  return a.commits.map((c) => {
    const at = movingMs(a, now, c.t)
    const lap = Math.max(0, at - prev)
    prev = Math.max(prev, at)
    return lap
  })
}

export const tokens = (a: Activity) => a.turns.reduce((n, t) => n + t.tokens, 0)
export const isWarmup = (a: Activity, moving: number) => !(a.commits.length > 0 && moving >= WARMUP_MIN_MOVING_MS)
export const zoneOf = (tokPerMin: number) => 1 + ZONE_CUTOFFS.filter((c) => tokPerMin >= c).length
export const rageOf = (a: Activity) => {
  const i = RAGE_LEVELS.findIndex(([max]) => (a.prompts ? a.rageHits / a.prompts : 0) < max)
  return { level: i + 1, name: RAGE_LEVELS[i]![1] }
}
export const paceLevel = (moving: number, commits: number) => PACE_LEVELS.find(([max]) => moving / commits / MIN <= max)![1]
export const titleOf = (ms: number) => TITLES.find(([h]) => new Date(ms).getHours() < h)![1]

const pad2 = (n: number) => String(n).padStart(2, '0')
export const hms = (t: number) => {
  const s = Math.round(t / 1000)
  return `${Math.floor(s / 3600)}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`
}
export const mss = (t: number) => {
  const s = Math.round(t / 1000)
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`
}
export const kTokens = (n: number) => (n < 1000 ? `${n}` : `${Math.round(n / 1000)}k`)
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// numstat shows renames as "src/{a.js => b.js}" or "a.js => b.js"; keep the new path.
const renamedTo = (p: string) => p.replace(/\{[^{}]* => ([^{}]*)\}/g, '$1').replace(/^.* => /, '').replace(/\/\//g, '/')

/** Parses `git log --numstat --format=%x00%H%x09%at%x09%ae`: own commits in the window, oldest first. */
export function parseCommits(out: string, email: string, from: number, to: number): Commit[] {
  const kept: Commit[] = []
  const seen = new Set<string>()
  for (const chunk of out.split('\0').slice(1)) {
    const [head = '', ...rows] = chunk.split('\n')
    const [hash = '', at = '0', ae = ''] = head.split('\t')
    const t = Number(at) * 1000
    if (seen.has(hash) || t < from || t > to || ae.toLowerCase() !== email) continue
    seen.add(hash)
    let added = 0, removed = 0
    for (const row of rows) {
      const [a, r, ...rest] = row.split('\t')
      if (!rest.length || a === '-') continue
      if (EXCLUDED_PATHS.some((re) => re.test(renamedTo(rest.join('\t'))))) continue
      added += Number(a)
      removed += Number(r)
    }
    if (added + removed >= MIN_COMMIT_LINES) kept.push({ t, added, removed })
  }
  return kept.sort((x, y) => x.t - y.t)
}

type Ev = { t: string; ev: string; sid: string; own?: boolean }

/** Moving time per day from the recorder's events.jsonl, leaving out one session (the live one). */
export function daysFromEvents(text: string, skipSid: string): { days: Map<string, number>; sids: Set<string> } {
  const bySid = new Map<string, Ev[]>()
  for (const line of text.split('\n')) {
    try {
      const e = JSON.parse(line) as Ev
      if (!e?.sid || !e.t || e.sid === skipSid) continue
      bySid.set(e.sid, [...(bySid.get(e.sid) ?? []), e])
    } catch {}
  }
  const days = new Map<string, number>()
  const add = (at: number, ms: number) => days.set(dayKey(at), (days.get(dayKey(at)) ?? 0) + ms)
  for (const evs of bySid.values()) {
    evs.sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
    let open: number | null = null, lastEnd: number | null = null, own = false
    for (const e of evs) {
      const t = Date.parse(e.t)
      if (e.ev === 'UserPromptSubmit') {
        own = !!e.own
        if (own) continue
        if (lastEnd !== null && t - lastEnd <= AUTO_PAUSE_MS) add(t, t - lastEnd)
        open = t
        lastEnd = null
      } else if (END_EVENTS.has(e.ev) && open !== null && !own) {
        add(open, t - open)
        open = null
        lastEnd = t
      }
    }
  }
  return { days, sids: new Set(bySid.keys()) }
}

/** The last seven local days, oldest first. */
export function lastWeek(days: Map<string, number>, now: number): Day[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = dayKey(now - (6 - i) * 24 * 60 * MIN)
    return { day, movingMs: days.get(day) ?? 0 }
  })
}

export type Summary = {
  moving: number
  elapsed: number
  commits: number
  added: number
  removed: number
  pace: string
  warmup: boolean
  level: number | null
  tokens: number
  zone: number | null
  cadence: number | null
  rage: { level: number; name: string }
}

export function summarize(a: Activity, now: number): Summary {
  const moving = movingMs(a, now)
  const warmup = isWarmup(a, moving)
  const tok = tokens(a)
  const min = moving / MIN
  return {
    moving,
    elapsed: now - a.startedAt,
    commits: a.commits.length,
    added: a.commits.reduce((n, c) => n + c.added, 0),
    removed: a.commits.reduce((n, c) => n + c.removed, 0),
    pace: warmup ? '--:--' : mss(moving / a.commits.length),
    warmup,
    level: warmup ? null : paceLevel(moving, a.commits.length),
    tokens: tok,
    zone: min ? zoneOf(tok / min) : null,
    cadence: min ? a.prompts / min : null,
    rage: rageOf(a),
  }
}
