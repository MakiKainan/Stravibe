// The route card: a randomly generated road whose distance is a usage limit.
// 'five_hour' is a closed circuit (the track), 'seven_day' a winding point-to-point road (the marathon).
// Pure strings and numbers; the same seed always draws the same road.
import type { Limit, TrackMode } from '../types'

export const TRACK_W = 340
const H = { five_hour: 196, seven_day: 212 }
const PAD = 20
const ORANGE = '#D97757'
const ORANGE_DEEP = '#C2410C'
const INK = '#8B8B8B'
const ASPHALT = '#5B5B5B'
const EDGE = '#E8E6E1'
const CENTER = '#F2CC60'
const CURB_RED = '#D64541'
const GRASS = 'rgba(63,185,80,0.10)'
const TREE = 'rgba(46,125,50,0.38)'
const ROAD_W = 12
const SAMPLES_PER_LEG = 14
const CURB_TURN = 0.32 // radians of heading change over CURB_SPAN samples that earns a curb
const CURB_SPAN = 3
const TREES = 16
const DRAW_S = 2
const WINDOW_MS = { five_hour: 5 * 3600e3, seven_day: 7 * 24 * 3600e3 }
const MARATHON_KM = 42.195
const FONT = "'Anthropic Serif', Copernicus, 'Tiempos Text', Georgia, serif"

type P = [number, number]
const r1 = (n: number) => Math.round(n * 10) / 10
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** mulberry32: a seed is a road */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Catmull-Rom through the control points, sampled densely so the road can be measured. */
function sample(ctrl: P[], closed: boolean): P[] {
  const n = ctrl.length
  const at = (i: number) => (closed ? ctrl[(i + n) % n]! : ctrl[Math.max(0, Math.min(n - 1, i))]!)
  const out: P[] = []
  const legs = closed ? n : n - 1
  for (let i = 0; i < legs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    for (let k = 0; k < SAMPLES_PER_LEG; k++) {
      const t = k / SAMPLES_PER_LEG, t2 = t * t, t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  if (!closed) out.push(ctrl[n - 1]!)
  return out
}

/** Fits the points into the card, keeping their shape. */
function fit(pts: P[], w: number, h: number): P[] {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const minX = Math.min(...xs), minY = Math.min(...ys)
  const k = Math.min((w - 2 * PAD) / (Math.max(...xs) - minX || 1), (h - 2 * PAD) / (Math.max(...ys) - minY || 1))
  const ox = (w - (Math.max(...xs) - minX) * k) / 2, oy = (h - (Math.max(...ys) - minY) * k) / 2
  return pts.map(([x, y]) => [ox + (x - minX) * k, oy + (y - minY) * k])
}

/** A closed circuit: control points around an ellipse, some pulled in to make hairpins. */
function circuit(rand: () => number, w: number, h: number): P[] {
  const n = 7 + Math.floor(rand() * 5)
  const ctrl: P[] = []
  for (let i = 0; i < n; i++) {
    const a = ((i + (rand() - 0.5) * 0.6) / n) * Math.PI * 2
    const r = rand() < 0.22 ? 0.35 + rand() * 0.15 : 0.62 + rand() * 0.38
    ctrl.push([Math.cos(a) * r * w, Math.sin(a) * r * h])
  }
  const pts = sample(ctrl, true)
  // the start/finish line goes on the straightest stretch, as on a real circuit
  let best = 0, bestTurn = Infinity
  for (let i = 0; i < pts.length; i++) {
    const t = Math.abs(turnAt(pts, i, true, 6))
    if (t < bestTurn) [best, bestTurn] = [i, t]
  }
  const turned = [...pts.slice(best), ...pts.slice(0, best)]
  return fit([...turned, turned[0]!], w, h)
}

/** A point-to-point road that winds back and forth across the card, with rounded hairpins between rows. */
function marathon(rand: () => number, w: number, h: number): P[] {
  const rows = 2 + Math.floor(rand() * 2)
  const ctrl: P[] = []
  const rowH = (h - 2 * PAD) / rows
  for (let r = 0; r < rows; r++) {
    const steps = 4 + Math.floor(rand() * 3)
    const y0 = PAD + rowH * (r + 0.5)
    const row: P[] = []
    for (let s = 0; s <= steps; s++) {
      const x = PAD + 8 + (s / steps) * (w - 2 * PAD - 16)
      row.push([x, y0 + (rand() - 0.5) * rowH * 0.7])
    }
    if (r % 2) row.reverse()
    if (r > 0) {
      // the hairpin swings out past the row ends
      const last = ctrl.at(-1)!, side = last[0] > w / 2 ? w - PAD * 0.8 : PAD * 0.8
      ctrl.push([side, (last[1] + row[0]![1]) / 2])
    }
    ctrl.push(...row)
  }
  return sample(ctrl, false)
}

/** Signed heading change around sample i, over `span` samples each side. */
function turnAt(pts: P[], i: number, closed: boolean, span = CURB_SPAN): number {
  const n = pts.length
  const get = (j: number) => (closed ? pts[(j + n) % n]! : pts[Math.max(0, Math.min(n - 1, j))]!)
  const a = get(i - span), b = get(i), c = get(i + span)
  const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]), h2 = Math.atan2(c[1] - b[1], c[0] - b[0])
  let d = h2 - h1
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

const lengths = (pts: P[]) => {
  const acc = [0]
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
  return acc
}

/** The point a fraction of the way along, the road's heading there, and the road up to it. */
function along(pts: P[], acc: number[], f: number): { p: P; angle: number; upTo: P[] } {
  const target = Math.max(0, Math.min(1, f)) * acc.at(-1)!
  let i = acc.findIndex((d) => d >= target)
  if (i <= 0) i = 1
  const a = pts[i - 1]!, b = pts[i]!
  const k = (target - acc[i - 1]!) / (acc[i]! - acc[i - 1]! || 1)
  const p: P = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
  return { p, angle: Math.atan2(b[1] - a[1], b[0] - a[0]), upTo: [...pts.slice(0, i), p] }
}

const poly = (pts: P[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p[0])} ${r1(p[1])}`).join('')

/** A line across the road at a point, for the start/finish and the sector marks. */
function across(p: P, angle: number, extra: string, half = ROAD_W / 2 + 1) {
  const nx = -Math.sin(angle) * half, ny = Math.cos(angle) * half
  return `<line x1="${r1(p[0] - nx)}" y1="${r1(p[1] - ny)}" x2="${r1(p[0] + nx)}" y2="${r1(p[1] + ny)}" ${extra}/>`
}

/** Black-and-white squares across the road, turned to its heading. */
function checkers(p: P, angle: number) {
  const s = 2.6, rows = Math.round((ROAD_W + 2) / s)
  let cells = ''
  for (let r = 0; r < rows; r++) for (let c = 0; c < 2; c++) {
    cells += `<rect x="${r1(c * s - s)}" y="${r1(r * s - (rows * s) / 2)}" width="${s}" height="${s}" fill="${(r + c) % 2 ? '#111' : '#fff'}"/>`
  }
  return `<g transform="translate(${r1(p[0])} ${r1(p[1])}) rotate(${r1((angle * 180) / Math.PI)})">${cells}</g>`
}

/** Red and white curbs on the outside of every tight corner. */
function curbs(pts: P[], closed: boolean) {
  let out = ''
  let run: P[] = []
  const flush = () => {
    if (run.length > 2) out += `<path d="${poly(run)}" fill="none" stroke="#fff" stroke-width="3"/><path d="${poly(run)}" fill="none" stroke="${CURB_RED}" stroke-width="3" stroke-dasharray="3 3"/>`
    run = []
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const t = turnAt(pts, i, closed)
    if (Math.abs(t) < CURB_TURN) { flush(); continue }
    const a = pts[i - 1]!, b = pts[i + 1]!
    const heading = Math.atan2(b[1] - a[1], b[0] - a[0])
    // outside of the bend: the side away from the way it turns
    const side = t > 0 ? -1 : 1
    const off = ROAD_W / 2 + 1.5
    run.push([pts[i]![0] - Math.sin(heading) * off * side, pts[i]![1] + Math.cos(heading) * off * side])
  }
  flush()
  return out
}

function trees(rand: () => number, pts: P[], w: number, h: number) {
  let out = ''
  for (let tries = 0, placed = 0; tries < 200 && placed < TREES; tries++) {
    const x = 6 + rand() * (w - 12), y = 6 + rand() * (h - 12)
    if (pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < ROAD_W + 6)) continue
    const r = 2.5 + rand() * 2.5
    out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="${TREE}"/>`
    placed++
  }
  return out
}

const text = (x: number, y: number, s: string, extra = '') => {
  const fill = /\bfill=/.test(extra) ? '' : ` fill="${INK}"`
  const size = /\bfont-size=/.test(extra) ? '' : ' font-size="11"'
  return `<text x="${r1(x)}" y="${r1(y)}"${fill}${size} ${extra}>${esc(s)}</text>`
}

/** How far through its window a limit is, by the clock: where an even pace would put you. */
export function timeFraction(limit: Limit | undefined, mode: TrackMode, now: number): number | null {
  if (!limit?.resetsAt) return null
  const left = Date.parse(limit.resetsAt) - now
  return Number.isFinite(left) ? Math.max(0, Math.min(1, 1 - left / WINDOW_MS[mode])) : null
}

/**
 * The road for one limit. `used` is 0..1 of the limit spent (null: no reading yet),
 * `pace` 0..1 of the window gone by the clock (null: unknown).
 */
export function trackSvg(mode: TrackMode, seed: number, used: number | null, pace: number | null): string {
  const w = TRACK_W, h = H[mode]
  const rand = rng(mode === 'five_hour' ? seed : seed ^ 0x9e3779b9)
  const pts = mode === 'five_hour' ? circuit(rand, w, h) : marathon(rand, w, h)
  const closed = mode === 'five_hour'
  const acc = lengths(pts)
  const d = poly(pts)

  let body = `<rect width="${w}" height="${h}" rx="10" fill="${GRASS}"/>` + trees(rand, pts, w, h)
  // the road: white edge lines under the asphalt, a dashed centre line on top
  body += `<path d="${d}" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="${ROAD_W + 6}" stroke-linejoin="round" stroke-linecap="round"/>`
  body += `<path d="${d}" fill="none" stroke="${EDGE}" stroke-width="${ROAD_W + 2}" stroke-linejoin="round" stroke-linecap="round"/>`
  body += `<path d="${d}" fill="none" stroke="${ASPHALT}" stroke-width="${ROAD_W}" stroke-linejoin="round" stroke-linecap="round"/>`
  body += curbs(pts, closed)
  body += `<path d="${d}" fill="none" stroke="${CENTER}" stroke-width="1" stroke-dasharray="5 5" opacity="0.85"/>`

  // sector marks for the circuit, kilometre marks for the marathon
  const marks: [number, string][] = closed
    ? [[1 / 3, 'S2'], [2 / 3, 'S3']]
    : [[10 / MARATHON_KM, '10K'], [21.0975 / MARATHON_KM, 'HALF'], [30 / MARATHON_KM, '30K']]
  for (const [f, name] of marks) {
    const { p, angle } = along(pts, acc, f)
    body += across(p, angle, `stroke="${EDGE}" stroke-width="2"`)
    const nx = -Math.sin(angle) * (ROAD_W + 6), ny = Math.cos(angle) * (ROAD_W + 6)
    body += text(p[0] + nx, p[1] + ny + 4, name, 'font-size="10" font-weight="700" text-anchor="middle"')
  }
  const start = along(pts, acc, 0)
  body += checkers(start.p, start.angle)
  if (!closed) {
    const end = along(pts, acc, 1)
    body += checkers(end.p, end.angle)
    body += text(start.p[0], start.p[1] - ROAD_W, 'START', 'font-size="9" font-weight="700" text-anchor="middle"')
    body += text(end.p[0], end.p[1] - ROAD_W, 'FINISH', 'font-size="9" font-weight="700" text-anchor="middle"')
  }

  if (pace !== null) {
    // where an even pace would be by now: a hollow marker on the road
    const { p } = along(pts, acc, pace)
    body += `<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="4.5" fill="none" stroke="#fff" stroke-width="2"/><circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="4.5" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="2 2"><title>Even pace: ${Math.round(pace * 100)}% of the window has passed</title></circle>`
  }

  if (used === null) {
    body += text(w / 2, h - 8, 'No usage reading yet: it arrives with the next reply', 'text-anchor="middle"')
  } else {
    const { p, upTo } = along(pts, acc, used)
    if (upTo.length > 1) {
      body += `<path d="${poly(upTo)}" fill="none" stroke="${ORANGE}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0">` +
        `<animate attributeName="stroke-dashoffset" values="1;0" dur="${DRAW_S}s" fill="freeze" calcMode="spline" keySplines="0.25 0.1 0.25 1"/></path>`
    }
    const tag = `${Math.round(used * 100)}%`
    const tagW = tag.length * 7 + 10
    // the tag hangs on whichever side keeps it inside the card
    const tx = p[0] + 8 + tagW > w - 4 ? -8 - tagW : 8, ty = p[1] < 26 ? 6 : -21
    body += `<g transform="translate(${r1(p[0])} ${r1(p[1])})" opacity="1">` +
      `<animate attributeName="opacity" values="0;0;1" keyTimes="0;0.9;1" dur="${DRAW_S + 0.2}s" fill="freeze"/>` +
      `<circle r="6" fill="${ORANGE}" opacity="0.5"><animate attributeName="r" values="6;15" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.55;0" dur="1.6s" repeatCount="indefinite"/></circle>` +
      `<circle r="5.5" fill="${ORANGE}" stroke="#fff" stroke-width="2"/>` +
      `<rect x="${tx}" y="${ty}" width="${tagW}" height="16" rx="8" fill="${ORANGE_DEEP}"/>` +
      text(tx + 5, ty + 12, tag, 'font-size="11" font-weight="700" fill="#fff"') +
      `</g>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}">${body}</svg>`
}
