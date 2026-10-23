// SVG cards for the pane. Pure strings; animated with SMIL (the desktop draws an interactive Svg in a sandboxed frame).
// Every animated attribute holds its final value, so a surface that draws the Svg as a still image shows the end state.
import type { Commit, Day, Turn } from '../types'

export const W = 340
export const ORANGE = '#D97757'
export const ORANGE_DEEP = '#C2410C'
const INK = '#8B8B8B' // reads on light and dark
const GRID = 'rgba(128,128,128,0.16)'
const ZONE_COLORS = ['#9CA3AF', '#60A5FA', '#34D399', '#F59E0B', '#EF4444']
const ZONE_CUTOFFS = [2000, 5000, 10000, 20000] // keep in step with stats.ts
// Claude's serif first; those faces are licensed and used when installed, else Georgia stands in
const FONT = "'Anthropic Serif', Copernicus, 'Tiempos Text', 'Tiempos Headline', Georgia, 'Times New Roman', serif"
// strong text follows the theme; INK stays mid-gray for both
const INK_STYLE = '<style>.ink{fill:#3D3929}@media (prefers-color-scheme: dark){.ink{fill:#ECE9E3}}</style>'
const MIN = 60e3

const r1 = (n: number) => Math.round(n * 10) / 10
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const svg = (h: number, body: string, w = W) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}">${INK_STYLE}${body}</svg>`
/** a gray 11px text unless `extra` sets its own fill or size (a repeated attribute breaks the whole SVG) */
const text = (x: number, y: number, s: string, extra = '') => {
  const fill = /\bfill=/.test(extra) ? '' : ` fill="${INK}"`
  const size = /\bfont-size=/.test(extra) ? '' : ' font-size="11"'
  return `<text x="${r1(x)}" y="${r1(y)}"${fill}${size} ${extra}>${esc(s)}</text>`
}
const label = (x: number, y: number, s: string) => text(x, y, s, 'font-weight="600" letter-spacing="1"')
/** places a whole card inside another, at x, y */
const nest = (card: string, x: number, y: number) => card.replace('<svg ', `<svg x="${x}" y="${y}" `)

const WIN_PAD = 12
const WIN_BAR = 30
const heightOf = (card: string) => Number(/height="([\d.]+)"/.exec(card)?.[1] ?? 0)

/** One category in a window of its own: a framed panel, its name in a title bar, a headline figure on the right. */
export function windowed(name: string, cards: string[], aside = ''): string {
  const w = W + 2 * WIN_PAD
  let y = WIN_BAR + 4, body = ''
  for (const card of cards) {
    body += nest(card, WIN_PAD, y)
    y += heightOf(card) + 10
  }
  const h = y - 10 + WIN_PAD
  return svg(h,
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="rgba(128,128,128,0.05)" stroke="rgba(128,128,128,0.22)"/>` +
    `<line x1="0" y1="${WIN_BAR}" x2="${w}" y2="${WIN_BAR}" stroke="rgba(128,128,128,0.16)"/>` +
    `<circle cx="${WIN_PAD + 3}" cy="${WIN_BAR / 2}" r="3" fill="${ORANGE}"/>` +
    label(WIN_PAD + 12, WIN_BAR / 2 + 3.5, name) +
    (aside ? text(w - WIN_PAD, WIN_BAR / 2 + 4, aside, `text-anchor="end" font-size="11" font-weight="600" fill="${ORANGE_DEEP}"`) : '') +
    body,
  w)
}
/** grows an attribute from `from` to its final value after `delay` seconds */
const grow = (attr: string, from: number, to: number, dur: number, delay = 0) => {
  const k = r1(delay / (delay + dur)) || 0
  return `<animate attributeName="${attr}" values="${r1(from)};${r1(from)};${r1(to)}" keyTimes="0;${k};1" dur="${delay + dur}s" fill="freeze" calcMode="spline" keySplines="0 0 1 1;0.25 0.1 0.25 1"/>`
}
const reveal = (id: string, h: number, dur = 1.6, w = W) =>
  `<clipPath id="${id}"><rect x="0" y="0" width="${w}" height="${h}">${grow('width', 0, w, dur)}</rect></clipPath>`

/** Catmull-Rom through the points, as cubic Béziers. */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0]![0]} ${pts[0]![1]}` : ''
  let d = `M${r1(pts[0]![0])} ${r1(pts[0]![1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${r1(c1[0]!)} ${r1(c1[1]!)} ${r1(c2[0]!)} ${r1(c2[1]!)} ${r1(p2[0])} ${r1(p2[1])}`
  }
  return d
}

// Claude Code's mascot on the card's block-art grid: 18 cells across, each twice as tall as wide.
// It moves the way Claude Code's own sprites do: whole cells, one pose per frame, no easing.
// Every frame is a full drawing; a loop shows them in turn, and a tap plays the state's one-shot.
const PW = 5, PH = 10
const M_W = 150, M_H = 88
const MX = 30, MY = 30 // cell (0, 0): room left for speed lines, above for jumps, right for props
const IDLE_FRAME_S = { warm: 0.3, jog: 0.3, run: 0.2, sprint: 0.12, asleep: 0.6 }
const TAP_FRAME_S = { warm: 0.14, jog: 0.15, run: 0.11, sprint: 0.1, asleep: 0.14 }
const CONFETTI = [ORANGE, '#F2CC60', '#60A5FA', '#3FB950', '#EF4444']
const BUG = '#B42318'
const DUST = 'rgba(139,139,139,0.55)'

type Cell = [number, number]
type Arms = 'down' | 'up' | 'waveA' | 'waveB'
type Eyes = 'open' | 'left' | 'right' | 'wide' | 'shut' | 'heavy'
type Legs = 'a' | 'b' | 'spread' | 'tuck'
type Pose = { dx?: number; dy?: number; arms?: Arms; eyes?: Eyes; legs?: Legs }

// arms hang off the third row; up, they reach past the head
const ARMS: Record<Arms, Cell[]> = {
  down: [[1, 2], [2, 2], [15, 2], [16, 2]],
  up: [[2, 2], [1, 1], [1, 0], [15, 2], [16, 1], [16, 0]],
  waveA: [[1, 2], [2, 2], [15, 2], [16, 1], [16, 0]],
  waveB: [[1, 2], [2, 2], [15, 2], [16, 1], [17, 0]],
}
const LEG_COLS: Record<Legs, number[]> = { a: [4, 6, 11, 13], b: [5, 7, 10, 12], spread: [2, 4, 13, 15], tuck: [5, 7, 10, 12] }
const EYE_COLS: Record<Eyes, number[]> = { open: [5, 12], left: [4, 11], right: [6, 13], wide: [5, 12], shut: [], heavy: [] }
const PIXEL_Z = ['####', '..#.', '.#..', '####']

/** cells as one crisp path, so no seams show between pixels; `tall` < 1 draws short cells (tucked legs) */
const cellPath = (cells: Cell[], fill: string, tall = 1) =>
  `<path d="${cells.map(([c, r]) => `M${c * PW} ${r * PH}h${PW}v${r1(PH * tall)}h-${PW}z`).join('')}" fill="${fill}" shape-rendering="crispEdges"/>`
const block = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="${fill}" shape-rendering="crispEdges"/>`
const fmt = (s: number) => String(Math.round(s * 1000) / 1000)

/** The mascot in one pose, with its shadow; props in `extras` sit on the grid, not on the mascot. */
function scene(p: Pose, extras = ''): string {
  const dx = p.dx ?? 0, dy = p.dy ?? 0, eyes = p.eyes ?? 'open'
  const lidded = eyes === 'shut' || eyes === 'heavy'
  const holes = new Set(EYE_COLS[eyes].flatMap((c) => (eyes === 'wide' ? [`${c},0`, `${c},1`] : [`${c},1`])))
  const body: Cell[] = []
  for (let r = 0; r < 4; r++) for (let c = 3; c <= 14; c++) {
    if (holes.has(`${c},${r}`) || (lidded && r === 1 && (c === 5 || c === 12))) continue
    body.push([c, r])
  }
  body.push(...ARMS[p.arms ?? 'down'])
  // shut: the socket fills leaving a thin lid line; heavy: the lid hangs halfway
  const lids = !lidded ? '' : [5, 12].map((c) => eyes === 'shut'
    ? block(c * PW, PH, PW, PH * 0.45, ORANGE) + block(c * PW, PH * 1.6, PW, PH * 0.4, ORANGE)
    : block(c * PW, PH, PW, PH * 0.6, ORANGE)).join('')
  const legs = cellPath(LEG_COLS[p.legs ?? 'a'].map((c) => [c, 4] as Cell), ORANGE, p.legs === 'tuck' ? 0.5 : 1)
  // the shadow stays on the ground and shrinks as the mascot leaves it
  const shadow = `<ellipse cx="${MX + (9 + dx) * PW}" cy="${MY + 5 * PH + 3}" rx="${Math.max(18, 40 - 9 * Math.abs(dy))}" ry="3" fill="${INK}" opacity="0.18"/>`
  return `${shadow}<g transform="translate(${MX + dx * PW} ${MY + dy * PH})">${cellPath(body, ORANGE)}${lids}${legs}</g>${extras}`
}

/** Drawings shown one at a time: looping (the idle state), or once from each tap. A new tap restarts it. */
function frames(list: string[], frameS: number, tap: boolean): string {
  const n = list.length
  if (n === 1 && !tap) return list[0]!
  const k = (i: number) => fmt(i / n)
  const timing = tap ? 'begin="hit.click"' : 'repeatCount="indefinite"'
  return list.map((body, i) => {
    const [values, keys] = i === 0 ? ['visible;hidden', `0;${k(1)}`] : i === n - 1 ? ['hidden;visible', `0;${k(i)}`] : ['hidden;visible;hidden', `0;${k(i)};${k(i + 1)}`]
    // an idle loop's first frame shows by default, so a surface that draws a still image still shows the mascot
    const rest = !tap && i === 0 ? 'visible' : 'hidden'
    return `<g visibility="${rest}"><animate attributeName="visibility" values="${values}" keyTimes="${keys}" calcMode="discrete" dur="${fmt(n * frameS)}s" ${timing}/>${body}</g>`
  }).join('')
}

/** Speed lines trailing the runner, stepped a few pixels per frame. */
const speedLines = (count: number, frame: number) =>
  Array.from({ length: count }, (_, i) => {
    const len = 10 + ((i * 5) % 8)
    const x = MX - 4 - len - ((frame * 6 + i * 9) % 18)
    return block(x, MY + 8 + i * 9, len, 2, INK)
  }).join('')

const pixelZ = (x: number, y: number, s: number) =>
  PIXEL_Z.flatMap((row, r) => [...row].map((ch, c) => (ch === '#' ? block(x + c * s, y + r * s, s, s, INK) : ''))).join('')

/** A pixel bug scuttling left along the ground, antennae first. */
const bug = (col: number) => {
  const x = MX + col * PW, y = MY + 4 * PH
  return block(x, y + 3, PW * 3, PH - 3, BUG) + block(x + 2, y + 5, 2, 2, '#fff') +
    block(x - 2, y, 1.5, 4, BUG) + block(x + 4, y - 1, 1.5, 4, BUG)
}

/** Puffs kicked up either side of a landing. */
const dust = (dx = 0) => [-1, 0, 17, 18].map((c, i) => block(MX + (c + dx) * PW, MY + 4 * PH + (i % 2 ? 6 : 3), 4, 4, DUST)).join('')

/** The finish tape, standing (a checkered column) or snapped into two flying ends. */
const tape = (col: number, snapped = 0) => {
  const x = MX + col * PW
  if (!snapped) return Array.from({ length: 10 }, (_, i) => block(x, MY + i * (PH / 2), PW, PH / 2, i % 2 ? '#111' : '#fff')).join('')
  const up = Array.from({ length: 4 }, (_, i) => block(x + snapped * PW + i * 2, MY - snapped * PH + i * (PH / 2), PW, PH / 2, i % 2 ? '#111' : '#fff')).join('')
  const down = Array.from({ length: 4 }, (_, i) => block(x + snapped * PW + i * 2, MY + 3 * PH + snapped * 4 + i * (PH / 2), PW, PH / 2, i % 2 ? '#fff' : '#111')).join('')
  return up + down
}

/** Pixel confetti bursting from a point, frame by frame: out, then falling. */
const confetti = (col: number, frame: number) => {
  const ox = MX + col * PW, oy = MY + PH
  return Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2
    // snapped to a 5px grid: confetti moves like the sprite does
    const x = Math.round((ox + Math.cos(a) * frame * 9) / 5) * 5
    const y = Math.round((oy + Math.sin(a) * frame * 7 + frame * frame * 2) / 5) * 5
    return block(x, y, 4, 4, CONFETTI[i % CONFETTI.length]!)
  }).join('')
}

/** "!" over the mascot's head, in pixels. */
const bang = (dy: number) => {
  const x = MX + 8.5 * PW, top = MY + dy * PH - 18
  return block(x, top, PW, 9, ORANGE_DEEP) + block(x, top + 11, PW, 4, ORANGE_DEEP)
}

type MascotState = 'warm' | 'jog' | 'run' | 'sprint' | 'asleep'
const stateOf = (level: number | null): MascotState => (level === null ? 'warm' : (['asleep', 'jog', 'run', 'sprint'] as const)[level] ?? 'jog')

/** The state's idle loop. */
function idle(state: MascotState): string[] {
  const stride = (lines: number, n = 4) => Array.from({ length: n }, (_, f) => scene({ legs: f % 2 ? 'b' : 'a' }, speedLines(lines, f)))
  switch (state) {
    // stands, and blinks now and then
    case 'warm': return [...Array<string>(6).fill(scene({})), scene({ eyes: 'shut' }), scene({})]
    case 'jog': return stride(1)
    case 'run': return stride(2)
    case 'sprint': return stride(3)
    // eyes shut, z's stepping up and away
    case 'asleep': return [
      scene({ eyes: 'shut' }, pixelZ(MX + 82, MY - 6, 2)),
      scene({ eyes: 'shut' }, pixelZ(MX + 82, MY - 6, 2) + pixelZ(MX + 90, MY - 17, 2.5)),
      scene({ eyes: 'shut' }, pixelZ(MX + 90, MY - 17, 2.5) + pixelZ(MX + 99, MY - 29, 3)),
    ]
  }
}

/** The state's one-shot when tapped. */
function tap(state: MascotState): string[] {
  switch (state) {
    // jumping jacks ×3, then a hop and a dusty landing
    case 'warm': {
      const open = scene({ arms: 'up', legs: 'spread' }), shut = scene({})
      return [open, shut, open, shut, open, shut, scene({ dy: -1, arms: 'up', legs: 'tuck' }), scene({ legs: 'spread' }, dust())]
    }
    // keeps jogging and waves with the right arm
    case 'jog': {
      const arms: Arms[] = ['waveA', 'waveB', 'waveA', 'waveB', 'waveA', 'waveB', 'waveA', 'down']
      return arms.map((a, f) => scene({ arms: a, legs: f % 2 ? 'b' : 'a' }, speedLines(1, f)))
    }
    // a bug scuttles in; clear it in a stepped arc and land in a puff of dust
    case 'run': {
      const bugAt = [25, 22, 19, 16, 12, 8, 4, 0, -4, -8]
      const dy = [0, 0, 0, -1, -2, -2, -1, 0, 0, 0]
      const legs: Legs[] = ['a', 'b', 'a', 'tuck', 'tuck', 'tuck', 'tuck', 'spread', 'b', 'a']
      return bugAt.map((b, f) => scene({ dy: dy[f], legs: legs[f], arms: dy[f] ? 'up' : 'down' }, bug(b) + (f === 7 ? dust() : '')))
    }
    // the tape comes in, a dash forward snaps it, confetti bursts
    case 'sprint': return [
      scene({ legs: 'a' }, tape(21) + speedLines(3, 0)),
      scene({ legs: 'b' }, tape(20) + speedLines(3, 1)),
      scene({ dx: 1, legs: 'a' }, tape(19) + speedLines(3, 2)),
      scene({ dx: 2, legs: 'b', arms: 'up' }, tape(19) + speedLines(3, 3)),
      scene({ dx: 2, arms: 'up', legs: 'spread' }, tape(19, 1) + confetti(19, 1)),
      scene({ dx: 2, arms: 'up', legs: 'spread' }, tape(19, 2) + confetti(19, 2)),
      scene({ dx: 1, arms: 'up' }, tape(19, 3) + confetti(19, 3)),
      scene({}, confetti(19, 4)),
      scene({}),
    ]
    // jolts awake with a "!", looks around, then sags back to sleep
    case 'asleep': return [
      scene({ dy: -1, eyes: 'wide', arms: 'up', legs: 'spread' }, bang(-1)),
      scene({ dy: -1, eyes: 'wide', arms: 'up', legs: 'spread' }, bang(-1)),
      scene({ eyes: 'open' }, bang(0)),
      scene({ eyes: 'left' }),
      scene({ eyes: 'left' }),
      scene({ eyes: 'right' }),
      scene({ eyes: 'right' }),
      scene({ eyes: 'open' }),
      scene({ eyes: 'heavy' }),
      scene({ eyes: 'shut' }),
      scene({ eyes: 'shut' }, pixelZ(MX + 82, MY - 6, 2)),
    ]
  }
}

/** Every frame of a state as a still SVG of its own, the idle loop's and the tap one-shot's: a sprite sheet. */
export function mascotFrames(level: number | null) {
  const state = stateOf(level)
  const still = (frame: string) => svg(M_H, frame, M_W)
  return { state, idle: idle(state).map(still), tap: tap(state).map(still), idleFrameS: IDLE_FRAME_S[state], tapFrameS: TAP_FRAME_S[state] }
}

/** The mascot at the session's pace (3 sprint, 2 run, 1 jog, 0 asleep, null warming up); tap it for its move. */
export function mascotSvg(level: number | null): string {
  const state = stateOf(level)
  const shots = tap(state)
  const tapS = shots.length * TAP_FRAME_S[state]
  // the idle loop steps aside while the one-shot plays, and comes back when it ends
  const idleLoop = `<g>${frames(idle(state), IDLE_FRAME_S[state], false)}<set attributeName="display" to="none" begin="hit.click" dur="${fmt(tapS)}s"/></g>`
  const oneShot = `<g id="tap-${state}">${frames(shots, TAP_FRAME_S[state], true)}</g>`
  const hit = `<rect id="hit" width="${M_W}" height="${M_H}" fill="#000" fill-opacity="0" style="cursor:pointer"><title>Tap me</title></rect>`
  return svg(M_H, idleLoop + oneShot + hit, M_W)
}

/** Brand, date, the session's title and the recording clock. Redrawn each second while a turn runs. */
export function headerSvg(o: { when: string; title: string; recording: boolean; clock: string }): string {
  const status = o.recording
    ? `<circle cx="5" cy="68" r="4" fill="#EF4444"><animate attributeName="opacity" values="1;0.25;1" dur="1s" repeatCount="indefinite"/></circle>` +
      text(14, 72, `REC   ${o.clock}`, 'font-size="12" font-weight="600" fill="#EF4444"')
    : text(0, 72, `❚❚  Auto-paused   ${o.clock}`, 'font-size="12"')
  // as wide as the windows below, so the date lines up with their right edge
  const w = W + 2 * WIN_PAD
  return svg(80,
    text(0, 13, 'S T R A V I B E', `font-size="13" font-weight="700" fill="${ORANGE}"`) +
    text(w, 13, o.when, 'font-size="11" text-anchor="end"') +
    `<text x="0" y="44" class="ink" font-size="24" font-weight="700">${esc(o.title)}</text>` +
    status, w)
}

/** Pace and commits in big numerals, the mascot running beside them. */
export function heroSvg(o: { pace: string; paceLabel: string; commits: number; level: number | null }): string {
  const big = (x: number, value: string, name: string) =>
    text(x, 60, value, `font-size="42" font-weight="700" fill="${ORANGE}" style="font-variant-numeric: tabular-nums"`) + label(x + 2, 78, name)
  // the serif's numerals run wide: "24:34" takes about 130 of the 42px digits' width;
  // the card is tall enough for the mascot to jump inside it
  return svg(92, big(0, o.pace, o.paceLabel) + big(152, String(o.commits), 'COMMITS') + nest(mascotSvg(o.level), W - M_W, 2))
}

/** The small stats, three to a row. */
export function statsSvg(pairs: [string, string][]): string {
  const colW = W / 3, rowH = 40
  const rows = Math.ceil(pairs.length / 3)
  return svg(rows * rowH, pairs.map(([name, value], i) => {
    const x = (i % 3) * colW, y = Math.floor(i / 3) * rowH
    return label(x, y + 12, name) + `<text x="${x}" y="${y + 32}" class="ink" font-size="17" font-weight="600">${esc(value)}</text>`
  }).join(''))
}

/** Tokens per minute of each turn over moving time, on Strava's heart-rate zone bands. */
export function heartSvg(turns: Turn[]): string {
  const h = 120, top = 8, bottom = h - 18, left = 4, right = W - 30
  const pts = turns.map((t) => t.tokens / Math.max(t.ms / MIN, 0.05))
  const ceiling = Math.max(ZONE_CUTOFFS[3]! * 1.2, ...pts.map((p) => p * 1.15))
  // square-root scale: the low zones keep room when one turn spikes
  const yOf = (v: number) => bottom - (Math.sqrt(v) / Math.sqrt(ceiling)) * (bottom - top)
  const edges = [0, ...ZONE_CUTOFFS, ceiling]
  let body = ''
  for (let z = 0; z < 5; z++) {
    const y1 = yOf(edges[z + 1]!), y0 = yOf(edges[z]!)
    body += `<rect x="${left}" y="${r1(y1)}" width="${right - left}" height="${r1(y0 - y1)}" fill="${ZONE_COLORS[z]}" opacity="0.10"/>`
    body += text(right + 6, (y0 + y1) / 2 + 3, `Z${z + 1}`, `fill="${ZONE_COLORS[z]}" font-weight="600"`)
  }
  if (!pts.length) return svg(h, body + text((left + right) / 2, h / 2, 'Resting heart rate', 'text-anchor="middle"'))
  let acc = 0
  const total = turns.reduce((n, t) => n + t.ms, 0) || 1
  const xy: [number, number][] = [[left, yOf(pts[0]!)]]
  turns.forEach((t, i) => {
    acc += t.ms
    xy.push([left + (acc / total) * (right - left), yOf(pts[i]!)])
  })
  const line = smooth(xy)
  const last = xy.at(-1)!
  const zone = 1 + ZONE_CUTOFFS.filter((c) => pts.at(-1)! >= c).length
  body +=
    `<defs><linearGradient id="hr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EF4444" stop-opacity="0.45"/><stop offset="1" stop-color="#EF4444" stop-opacity="0"/></linearGradient>${reveal('hrclip', h, 1.6)}</defs>` +
    `<g clip-path="url(#hrclip)"><path d="${line} L${r1(last[0])} ${bottom} L${left} ${bottom} Z" fill="url(#hr)"/>` +
    `<path d="${line}" fill="none" stroke="#EF4444" stroke-width="2" stroke-linejoin="round"/></g>` +
    // a beating heart rides the latest reading
    `<g transform="translate(${r1(last[0])} ${r1(last[1])})" opacity="1">${grow('opacity', 0, 1, 0.2, 1.6)}` +
    `<path d="M0 3 C-6 -2 -4 -7 0 -4 C4 -7 6 -2 0 3 Z" fill="${ZONE_COLORS[zone - 1]}"><animateTransform attributeName="transform" type="scale" values="1;1.45;1;1.25;1" keyTimes="0;0.15;0.3;0.45;1" dur="${zone >= 4 ? 0.6 : 1}s" repeatCount="indefinite"/></path></g>`
  return svg(h, body)
}

/** Lines added, climbing commit by commit across the elapsed time. */
export function elevationSvg(commits: Commit[], startedAt: number, now: number): string {
  const h = 110, top = 12, bottom = h - 16, left = 4, right = W - 4
  const span = Math.max(1, now - startedAt)
  const xOf = (t: number) => left + ((t - startedAt) / span) * (right - left)
  const gain = commits.reduce((n, c) => n + c.added, 0)
  const yOf = (v: number) => bottom - (v / Math.max(gain, 1)) * (bottom - top)
  let body = `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${GRID}"/>`
  if (!commits.length) return svg(h, body + text((left + right) / 2, h / 2, 'Flat so far: commit to climb', 'text-anchor="middle"'))
  // ramps rather than cliffs: each commit's climb starts where the last one landed
  const pts: [number, number][] = [[left, bottom]]
  let acc = 0
  for (const c of commits) {
    acc += c.added
    pts.push([xOf(c.t), yOf(acc)])
  }
  pts.push([right, yOf(acc)])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p[0])} ${r1(p[1])}`).join(' ')
  body +=
    `<defs><linearGradient id="el" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ORANGE}" stop-opacity="0.55"/><stop offset="1" stop-color="${ORANGE}" stop-opacity="0.04"/></linearGradient>${reveal('elclip', h, 1.8)}</defs>` +
    `<g clip-path="url(#elclip)"><path d="${line} L${right} ${bottom} L${left} ${bottom} Z" fill="url(#el)"/><path d="${line}" fill="none" stroke="${ORANGE}" stroke-width="2" stroke-linejoin="round"/></g>`
  acc = 0
  body += commits.map((c, i) => {
    acc += c.added
    const x = xOf(c.t), y = yOf(acc)
    const at = r1(1.8 * ((x - left) / (right - left)))
    return `<circle cx="${r1(x)}" cy="${r1(y)}" r="3.5" fill="white" stroke="${ORANGE_DEEP}" stroke-width="2" opacity="1">${grow('opacity', 0, 1, 0.25, at)}${grow('r', 0, 3.5, 0.35, at)}<title>Commit ${i + 1}: +${c.added} −${c.removed}</title></circle>`
  }).join('')
  return svg(h, body)
}

/** One bar per commit lap; the fastest lap glows. */
export function splitsSvg(laps: number[]): string {
  const rows = laps.slice(-8)
  const first = laps.length - rows.length
  const rowH = 18, h = Math.max(1, rows.length) * rowH + 6
  if (!rows.length) return svg(28, text(4, 18, 'No laps yet: every commit is a split'))
  const best = Math.min(...rows), worst = Math.max(...rows)
  const barMax = W - 90
  return svg(h, rows.map((ms, i) => {
    const y = 4 + i * rowH
    const w = Math.max(6, (ms / worst) * barMax)
    const fast = ms === best
    const s = Math.round(ms / 1000)
    return text(4, y + 11, `${first + i + 1}`, 'font-weight="600"') +
      `<rect x="22" y="${y + 1}" width="${r1(w)}" height="12" rx="3" fill="${ORANGE}" opacity="${fast ? 1 : 0.42}">${grow('width', 0, w, 0.7, i * 0.12)}</rect>` +
      text(26 + w + 6, y + 11, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${fast ? '  ★' : ''}`, fast ? `font-weight="700" fill="${ORANGE_DEEP}"` : '')
  }).join(''))
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** Moving minutes for the last seven days; today in orange. */
export function weekSvg(days: Day[]): string {
  const h = 104, bottom = h - 16, top = 16
  const max = Math.max(30 * MIN, ...days.map((d) => d.movingMs))
  const slot = W / days.length, bw = Math.min(26, slot * 0.55)
  return svg(h, days.map((d, i) => {
    const x = i * slot + (slot - bw) / 2
    const bh = Math.max(d.movingMs ? 3 : 1.5, (d.movingMs / max) * (bottom - top))
    const today = i === days.length - 1
    const [yy, mm, dd] = d.day.split('-').map(Number)
    const wd = WEEKDAYS[new Date(yy!, mm! - 1, dd!).getDay()]!
    const mins = Math.round(d.movingMs / MIN)
    return `<rect x="${r1(x)}" y="${r1(bottom - bh)}" width="${r1(bw)}" height="${r1(bh)}" rx="4" fill="${today ? ORANGE : INK}" opacity="${today ? 1 : 0.35}">` +
      `${grow('height', 0, bh, 0.6, i * 0.08)}${grow('y', bottom, bottom - bh, 0.6, i * 0.08)}<title>${d.day}: ${mins} min moving</title></rect>` +
      text(x + bw / 2, h - 3, wd, `text-anchor="middle"${today ? ` font-weight="700" fill="${ORANGE_DEEP}"` : ''}`) +
      (mins ? text(x + bw / 2, bottom - bh - 4, `${mins}m`, `text-anchor="middle" font-size="9"`) : '')
  }).join(''))
}

const SPARKS = '▁▂▃▄▅▆▇█'
/** Block sparkline for the terminal, which draws no Svg. */
export function sparkline(values: number[], width = 24): string {
  const v = values.slice(-width)
  const max = Math.max(...v, 1)
  return v.map((n) => SPARKS[Math.min(7, Math.round((n / max) * 7))]).join('')
}
