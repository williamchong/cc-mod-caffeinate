import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

function fakeEngine(on: On, exitCode?: number) {
  const calls = { spawned: 0, killed: 0, status: undefined as string | undefined, argv: [] as string[] }
  on('process.spawn', async function* (_$, e) {
    calls.spawned++
    calls.argv = [...e.argv]
    if (exitCode !== undefined) return { value: { code: exitCode, signal: null } }
    try {
      // a caffeinate that runs until it is killed
      while (true) yield { stream: 'stdout' as const, text: '.' }
    } finally {
      calls.killed++
    }
  })
  on('ui.status', (_$, e) => {
    calls.status = e.text
    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  return calls
}

// Releases are not awaited by the mod; let the killed child's cleanup run.
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

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
