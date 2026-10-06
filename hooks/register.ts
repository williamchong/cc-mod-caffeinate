import type { EngineInterface, Register } from 'claude-code'

// Each session holds its own `caffeinate` while it works. macOS keeps the
// display awake while any process holds an assertion, so several sessions
// combine on their own: the screen may sleep only once none is working.

// A bounded lease, renewed while active, so a session that dies without
// unloading never leaves an orphan caffeinate holding the screen for long.
const LEASE_SECONDS = 300

const WAITING_NOTIFICATION = /permission|elicitation|idle/

let isTurnRunning = false
let isWaiting = false
let lease: AsyncGenerator<unknown, unknown> | undefined

function shouldHold() {
  return isTurnRunning && !isWaiting
}

async function hold($: EngineInterface) {
  while (shouldHold()) {
    let child: ReturnType<EngineInterface['process']['spawn']> | undefined
    let code: number | null = null
    try {
      child = $.process.spawn({
        argv: ['/usr/bin/caffeinate', '-d', '-i', '-t', String(LEASE_SECONDS)],
      })
      lease = child
      for await (const _ of child) {
        // caffeinate writes nothing; the loop lasts the child's life
      }
      code = (await child.result).code
    } catch {
      // could not start, or killed by a release
    }
    if (lease !== child) return // released, or a newer hold took over
    // Only a lease that ran out is renewed; any other end would respawn in a spin.
    if (code !== 0) {
      lease = undefined
      return
    }
  }
}

function sync($: EngineInterface) {
  const isHolding = shouldHold()
  $.ui.status(isHolding ? '☕' : undefined)
  if (isHolding && !lease) void hold($)
  if (!isHolding && lease) {
    // Not awaited: a pending pull on a silent child may hold return() back.
    void lease.return(undefined).catch(() => {})
    lease = undefined
  }
}

function setRunning($: EngineInterface, value: boolean) {
  isTurnRunning = value
  isWaiting = false
  sync($)
}

function setWaiting($: EngineInterface, value: boolean) {
  if (isWaiting === value) return
  isWaiting = value
  sync($)
}

export const register: Register = on => {
  on('turn.start', ($, e, next) => {
    setRunning($, true)
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    // A subagent's turn ending is not the session going idle.
    if (e.agentId === undefined) setRunning($, false)
    return next(e)
  })

  on('session.end', ($, e, next) => {
    setRunning($, false)
    return next(e)
  })

  on('classic.PermissionRequest', ($, e, next) => {
    setWaiting($, true)
    return next(e)
  })

  on('classic.Elicitation', ($, e, next) => {
    setWaiting($, true)
    return next(e)
  })

  on('classic.Notification', ($, e, next) => {
    if (WAITING_NOTIFICATION.test(e.notification_type)) setWaiting($, true)
    return next(e)
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    setWaiting($, true)
    try {
      return await next(e)
    } finally {
      setWaiting($, false)
    }
  })

  // No event says a permission prompt was answered; these are the first
  // signs that the turn went on after one.
  on('classic.PostToolUse', ($, e, next) => {
    setWaiting($, false)
    return next(e)
  })

  on('classic.PostToolUseFailure', ($, e, next) => {
    setWaiting($, false)
    return next(e)
  })

  on('classic.PermissionDenied', ($, e, next) => {
    setWaiting($, false)
    return next(e)
  })

  on('classic.ElicitationResult', ($, e, next) => {
    setWaiting($, false)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    setWaiting($, false)
    return yield* next(e)
  })
}
