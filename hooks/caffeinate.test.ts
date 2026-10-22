import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

function fakeEngine(on: On, exitCode?: number) {
  const calls = { spawned: 0, killed: 0, statusCalls: 0, status: undefined as string | undefined, argv: [] as string[], now: 0, expire: () => {} }
  let isExpired = false
  // ends the running caffeinate as its -t timeout would
  calls.expire = () => { isExpired = true }
  on('process.spawn', async function* (_$, e) {
    calls.spawned++
    isExpired = false
    calls.argv = [...e.argv]
    if (exitCode !== undefined) return { value: { code: exitCode, signal: null } }
    try {
      // a caffeinate that runs until it is killed
      while (!isExpired) yield { stream: 'stdout' as const, text: '.' }
      return { value: { code: 0, signal: null } }
    } finally {
      calls.killed++
    }
  })
  // mock.clock would wait for the event loop to settle, which the child above never lets it do
  on('clock.now', () => ({ value: calls.now }))
  on('state.set', (_$, e, next) => {
    calls.statusCalls++
    calls.status = e.value ? '☕' : undefined
    return next(e)
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.Stop', () => ({}))
  on('session.end', () => ({ sessionId: 's1' }))
  on('classic.Notification', () => ({}))
  return calls
}

// Releases are not awaited by the mod; let the killed child's cleanup run.
async function settle(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve()
}

// A renewal reads the clock and spawns through the engine: many microtask turns.
const RENEWAL_TICKS = 2000

const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
const toolDone = { tool_name: 'Bash', tool_input: {}, tool_response: '', tool_use_id: 'u1' } as never
const askPermission = { tool_name: 'Bash', tool_input: { command: 'ls' } }

test('holds caffeinate only while a turn runs and is not waiting', async ($, on) => {
  const calls = fakeEngine(on)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(calls.spawned).toBe(1)
  expect(calls.status).toBe('☕')

  await $.classic.PermissionRequest(askPermission)
  await settle()
  expect(calls.status).toBe(undefined)
  expect(calls.killed).toBe(1)

  await $.classic.PostToolUse(toolDone)
  expect(calls.spawned).toBe(2)
  expect(calls.status).toBe('☕')

  await $.turn.complete({ ...done, agentId: 'sub' })
  expect(calls.status).toBe('☕')

  await $.turn.complete(done)
  await settle()
  expect(calls.status).toBe(undefined)
  expect(calls.killed).toBe(2)
})

test('a quick release and re-hold leaves no caffeinate behind', async ($, on) => {
  const calls = fakeEngine(on)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.classic.PermissionRequest(askPermission)
  await $.classic.PostToolUse(toolDone)
  await $.classic.PermissionRequest(askPermission)
  await $.classic.PostToolUse(toolDone)
  await $.turn.complete(done)
  await settle()

  expect(calls.spawned).toBe(3)
  expect(calls.killed).toBe(3)
})

test('a caffeinate that fails is not respawned in a loop', async ($, on) => {
  const calls = fakeEngine(on, 1)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await settle()

  expect(calls.spawned).toBe(1)
})

test('holds only the display and idle sleep by default', async ($, on) => {
  const calls = fakeEngine(on)

  await $.turn.start({ text: 'hi', turnId: 't1' })

  await $.turn.complete(done)
  expect(calls.argv).toEqual(['/usr/bin/caffeinate', '-d', '-i', '-t', '300'])
})

test('also holds lid-closed sleep when keepAwakeLidClosed is on', { options: { keepAwakeLidClosed: true } }, async ($, on) => {
  const calls = fakeEngine(on)

  await $.turn.start({ text: 'hi', turnId: 't1' })

  await $.turn.complete(done)
  expect(calls.argv).toEqual(['/usr/bin/caffeinate', '-d', '-i', '-s', '-t', '300'])
})

test('adds ☕ to the prompt footer modes only while holding', async ($, on) => {
  // a caffeinate that fails at once: a running one never lets mount settle
  fakeEngine(on, 1)
  // stands for the engine's footer, drawing the modes it is handed
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: (e.props as { modes: string[] }).modes.join(' & ') }))
  const footer = { plugin: 'cc-mod-caffeinate', component: 'SessionMode', props: { modes: ['focus'] } } as const

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.turn.start({ text: 'hi', turnId: 't1' })
    let ui = await $.ui.mount({ ...footer, surface })
    expect((await ui.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus & ☕')
    await ui.unmount()

    await $.turn.complete(done)
    await settle()
    ui = await $.ui.mount({ ...footer, surface })
    expect((await ui.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus')
    await ui.unmount()
  }
})

test('shows no ☕ when showStatus is off', { options: { showStatus: false } }, async ($, on) => {
  const calls = fakeEngine(on)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete(done)
  await settle()

  expect(calls.spawned).toBe(1)
  expect(calls.statusCalls).toBe(0)
})

const stopWith = (...tasks: { type: string; command?: string }[]) =>
  ({ stop_hook_active: false, background_tasks: tasks.map((t, i) => ({ id: `b${i}`, status: 'running', description: '', ...t })) }) as never

test('keeps holding after the turn while a background job runs', async ($, on) => {
  const calls = fakeEngine(on)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.classic.Stop(stopWith({ type: 'shell', command: 'pnpm dev' }, { type: 'subagent' }, { type: 'shell', command: 'npm test' }))
  await $.turn.complete(done)
  await settle()
  expect(calls.status).toBe('☕')
  expect(calls.killed).toBe(0)

  // the job's notification wakes the session; nothing is left when it stops
  await $.turn.start({ text: '', turnId: 't2' })
  await $.classic.Stop(stopWith())
  await $.turn.complete({ ...done, turnId: 't2' })
  await settle()
  expect(calls.status).toBe(undefined)
  expect(calls.killed).toBe(1)
})

test('does not hold for a background server or watcher', async ($, on) => {
  const calls = fakeEngine(on)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.classic.Stop(stopWith(
    { type: 'shell', command: 'pnpm run dev' },
    { type: 'shell', command: 'python3 -m http.server 8000' },
    { type: 'shell', command: 'tail -f log.txt' },
    { type: 'shell', command: 'npm run test:watch' },
    { type: 'shell', command: 'bash -c "npm run dev"' },
    { type: 'monitor' },
  ))
  await $.turn.complete(done)
  await settle()
  expect(calls.status).toBe(undefined)
  expect(calls.killed).toBe(1)
})

test('lets a background hold go once the limit passes', async ($, on) => {
  const calls = fakeEngine(on)
  const start = 1_000_000
  calls.now = start

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.classic.Stop(stopWith({ type: 'shell', command: './run.sh' }))
  await $.turn.complete(done)

  calls.now = start + 59 * 60_000
  calls.expire()
  await settle(RENEWAL_TICKS)
  expect(calls.spawned).toBe(2)
  expect(calls.status).toBe('☕')

  calls.now = start + 60 * 60_000
  calls.expire()
  await settle(RENEWAL_TICKS)
  const [spawned, status] = [calls.spawned, calls.status]
  await $.session.end({ reason: 'other' } as never)
  await settle()
  expect(spawned).toBe(2)
  expect(status).toBe(undefined)
})

test('holds for background jobs without a limit when backgroundHoldMinutes is 0', { options: { backgroundHoldMinutes: 0 } }, async ($, on) => {
  const calls = fakeEngine(on)
  const start = 1_000_000
  calls.now = start

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.classic.Stop(stopWith({ type: 'shell', command: './run.sh' }))
  await $.turn.complete(done)

  calls.now = start + 24 * 60 * 60_000
  calls.expire()
  await settle(RENEWAL_TICKS)
  expect(calls.spawned).toBe(2)
  expect(calls.status).toBe('☕')

  await $.session.end({ reason: 'other' } as never)
  await settle()
})

test('never lets go of a running turn when the limit has passed', async ($, on) => {
  const calls = fakeEngine(on)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.classic.Stop(stopWith({ type: 'shell', command: './run.sh' }))
  await $.turn.complete(done)
  await $.turn.start({ text: '', turnId: 't2' })

  calls.now = 2 * 60 * 60_000
  calls.expire()
  await settle(RENEWAL_TICKS)
  const [spawned, status] = [calls.spawned, calls.status]
  await $.session.end({ reason: 'other' } as never)
  await settle()
  expect(spawned).toBe(2)
  expect(status).toBe('☕')
})

test('keeps a background hold when the prompt goes idle', async ($, on) => {
  const calls = fakeEngine(on)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.classic.Stop(stopWith({ type: 'subagent' }))
  await $.turn.complete(done)
  await $.classic.Notification({ message: '', notification_type: 'idle_prompt' } as never)
  await settle()
  const [killed, status] = [calls.killed, calls.status]
  await $.session.end({ reason: 'other' } as never)
  await settle()
  expect(killed).toBe(0)
  expect(status).toBe('☕')
})

test('a background subagent turn does not keep the hold past the limit', async ($, on) => {
  const calls = fakeEngine(on)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.classic.Stop(stopWith({ type: 'subagent' }))
  await $.turn.complete(done)
  await $.turn.start({ text: 'go', turnId: 's1', agentId: 'sub' })

  calls.now = 2 * 60 * 60_000
  calls.expire()
  await settle(RENEWAL_TICKS)
  const [spawned, status] = [calls.spawned, calls.status]
  await $.session.end({ reason: 'other' } as never)
  await settle()
  expect(spawned).toBe(1)
  expect(status).toBe(undefined)
})
