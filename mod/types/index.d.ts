// One finished model turn of the main loop. Numbers only: no prompt or reply text.
export type Turn = {
  /** when the turn ended, epoch ms */
  t: number
  ms: number
  tokens: number
  isAborted: boolean
  tools: number
  edits: number
}

export type Commit = { t: number; added: number; removed: number }

export type Activity = {
  startedAt: number
  turns: Turn[]
  commits: Commit[]
  prompts: number
  rageHits: number
  walls: number
  model: string | null
  /** start of the turn running now, or null while auto-paused */
  openSince: number | null
  toolsInTurn: number
  editsInTurn: number
}

/** Moving time per local day, YYYY-MM-DD */
export type Day = { day: string; movingMs: number }

/** One usage limit window, as the last API response reported it */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** The route card's toggle: the 5-hour window is a track, the weekly limit a marathon */
export type TrackMode = 'five_hour' | 'seven_day'

/** `seed` picks the road; /stravibe draws a new one */
export type Track = { seed: number; mode: TrackMode }

declare module 'claude-code' {
  interface PluginState {
    'stravibe-live': { activity: Activity; week: Day[]; now: number; limits: Limit[]; track: Track }
  }
}
