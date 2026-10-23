import { expect, mock, test } from 'claude-code/testing'

import { mascotSvg } from '../hooks/charts'
import { emptyActivity, movingMs, parseCommits, splits } from '../hooks/stats'

const MIN = 60e3

const PANE = {
  plugin: 'stravibe-live',
  component: 'Pane',
  requestId: 'stravibe',
  props: {
    title: 'Stravibe',
    isFocused: false,
    bodyColumns: 52,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('moving time counts short gaps and auto-pauses long ones', async () => {
  const a = emptyActivity(0)
  a.turns = [
    { t: 2 * MIN, ms: 2 * MIN, tokens: 0, isAborted: false, tools: 0, edits: 0 }, // 0-2
    { t: 6 * MIN, ms: 1 * MIN, tokens: 0, isAborted: false, tools: 0, edits: 0 }, // 5-6, gap 3 counts
    { t: 20 * MIN, ms: 2 * MIN, tokens: 0, isAborted: false, tools: 0, edits: 0 }, // 18-20, gap 12 pauses
  ]
  expect(movingMs(a, 20 * MIN)).toBe(8 * MIN)
  a.commits = [{ t: 6 * MIN, added: 10, removed: 0 }, { t: 19 * MIN, added: 5, removed: 0 }]
  expect(splits(a, 20 * MIN)).toEqual([6 * MIN, 1 * MIN])
})

test('every pace has its own tap animation, in stepped frames only', async () => {
  const states: [number | null, string][] = [[null, 'warm'], [1, 'jog'], [2, 'run'], [3, 'sprint'], [0, 'asleep']]
  const drawn = states.map(([level, name]) => {
    const svg = mascotSvg(level)
    expect(svg).toContain(`id="tap-${name}"`)
    expect(svg).toContain('id="hit"')
    expect(svg).toContain('begin="hit.click"')
    // game-y framing: poses swap whole, nothing glides
    expect(svg).not.toContain('animateTransform')
    for (const anim of svg.match(/<animate [^>]*>/g) ?? []) expect(anim).toContain('calcMode="discrete"')
    return svg
  })
  expect(new Set(drawn).size).toBe(states.length)
})

test('the text card is hidden and redirected in the app, and left alone in the CLI', async ($, on) => {
  let surfaces: ('terminal' | 'desktop')[] = ['desktop']
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.describe', (_, e) => ({ description: e.description, isHidden: false }))
  on('command.run', () => ({ text: 'the card' }))
  const describe = (command: string) =>
    $.command.describe({ command, description: 'card', isHidden: false, immediate: false, provider: { plugin: 'stravibe', tier: 'user' } })
  const run = (command: string) => $.command.run({ command, args: '', origin: { kind: 'composer' } as never, presentation: {} as never })

  // in the app: out of the menus, and a typed run points at the pane
  expect((await describe('stravibe:activity')).isHidden).toBe(true)
  expect((await run('stravibe:activity')).text).toContain('/stravibe')

  // other commands, the mod's own included, are untouched
  expect((await describe('stravibe')).isHidden).toBe(false)
  expect((await describe('compact')).isHidden).toBe(false)

  // in a terminal: the card shows and runs as before
  surfaces = ['terminal']
  expect((await describe('stravibe:activity')).isHidden).toBe(false)
  expect((await run('stravibe:activity')).text).toBe('the card')

  // the terminal with the app attached alongside counts as the app
  surfaces = ['terminal', 'desktop']
  expect((await describe('stravibe:activity')).isHidden).toBe(true)
})

test('commits: own, in the window, lockfiles left out, small ones dropped', async () => {
  const log = [
    '\0aaa\t100\tme@x.dev\n\n10\t2\tsrc/a.ts\n500\t0\tpackage-lock.json',
    '\0bbb\t200\tother@x.dev\n\n50\t0\tsrc/b.ts',
    '\0ccc\t300\tME@x.dev\n\n2\t1\tsrc/c.ts',
    '\0ddd\t50\tme@x.dev\n\n40\t0\tsrc/d.ts',
  ].join('\n')
  expect(parseCommits(log, 'me@x.dev', 90e3, 400e3)).toEqual([{ t: 100e3, added: 10, removed: 2 }])
})

test('the route is a usage road: a toggle between track and marathon, a new road on /stravibe', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  mock.store(on)
  mock.env(on, {})
  const resets = new Date(clock.now() + 2 * 3600e3).toISOString()
  on('session.usage', () => ({
    value: {
      startedAt: clock.now(),
      context: {} as never,
      rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: resets }, { kind: 'seven_day', percentUsed: 18 }],
    },
  }))
  on('session.id', () => ({ value: 'sid-2' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { command: 'stravibe' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const routeOf = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
    String((await ui.findAll({ type: 'Svg' })).map((el) => String(el.props.source)).find((s) => s.includes('ROUTE')))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const track = await routeOf(ui)
  expect(track).toContain('5-HOUR TRACK')
  expect(track).toContain('42% used')
  // the 5-hour window is 3 of its 5 hours in: the even-pace marker says 60%
  expect(track).toContain('Even pace: 60%')

  await ui.press({ key: 'seven_day' })
  const marathon = await routeOf(ui)
  expect(marathon).toContain('WEEKLY MARATHON')
  expect(marathon).toContain('18% used')
  expect(marathon).toContain('FINISH')
  await ui.unmount()

  await $.command.run({ command: 'stravibe', args: '', origin: { kind: 'composer' } as never, presentation: {} as never })
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const rerolled = await routeOf(again)
  expect(rerolled).toContain('WEEKLY MARATHON')
  expect(rerolled).not.toBe(marathon)
  await again.unmount()
})

test('the pane draws a live activity, on desktop and in the terminal', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  mock.store(on)
  mock.env(on, {})
  const started = clock.now()
  // the pane reads startedAt alone
  on('session.usage', () => ({ value: { startedAt: started, context: {} as never, rateLimits: [] } }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { command: 'stravibe' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'that is wrong, fix the parser', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(3 * MIN)
  await $.turn.complete({
    answer: '', durationMs: 3 * MIN, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 3000, model: 'claude-opus-5-5' },
  })

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /S T R A V I B E/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /--:--/ })).toBeDefined()
  await term.unmount()

  // on desktop every word sits in an Svg, set in Claude's font
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
  const svgs = await ui.findAll({ type: 'Svg' })
  // 52 cells across: every card takes the pane's width less its gutter, and a height that
  // keeps its own proportions, so all are drawn at one scale (no frame left at its 150px default)
  for (const el of svgs) {
    const source = String(el.props.source)
    const w = Number(/width="([\d.]+)"/.exec(source)?.[1]), h = Number(/height="([\d.]+)"/.exec(source)?.[1])
    expect(el.props.width).toBe(Math.round(52 * 7.8) - 28)
    expect(el.props.height).toBe(Math.round((Number(el.props.width) * h) / w))
  }
  const cards = svgs.map((el) => String(el.props.source))
  // the header, then one window each: overview, route, heart rate, elevation, splits, week
  expect(cards.length).toBe(7)
  for (const card of cards) expect(card).toContain("font-family=\"'Anthropic Serif'")
  const all = cards.join('\n')
  // the one prompt was a correction, so rage reads Meltdown
  for (const shown of ['S T R A V I B E', '--:--', '>Meltdown<', '6k tokens', 'opus-5-5']) expect(all).toContain(shown)
  // a repeated attribute makes the SVG unreadable to a strict parser
  for (const card of cards) for (const tag of card.match(/<[a-z][^>]*>/gi) ?? []) {
    const names = [...tag.matchAll(/\s([a-z-]+)=/gi)].map((m) => m[1])
    expect(new Set(names).size).toBe(names.length)
  }
  await ui.unmount()
})
