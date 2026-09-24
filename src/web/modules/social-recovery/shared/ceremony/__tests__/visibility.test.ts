/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "chrome-extension://cgjhdpkjghcgpplimocodhjgcceglpoj/tab.html#/social-recovery/ceremony"}
 */
/**
 * PT-041 done entry and ux.md D-316: a hidden tab dispatches nothing to the
 * background until it is shown again, and a hand-off to a phone reports its
 * result when the tab returns. The brief: with `document.visibilityState ===
 * 'hidden'` no dispatch happens, and it resumes when visible. The task body: a
 * hand-off that never connects reads unreachable (en.json
 * `socialRecovery.ceremony.unreachableNote`, "the phone never connected · Try
 * again").
 *
 * The lane's dispatch is the report the tab writes to the extension's storage
 * through its visibility gate (README, "The return channel").
 */
import {
  backgroundGate,
  ceremony,
  fakeAssertion,
  fakeMethod,
  fakeOrchestrator,
  flush,
  hosts,
  installCredentials,
  methodRunCount,
  noteKeyOf,
  notAllowedError,
  resetVisibility,
  setVisibility
} from './harness'

afterEach(() => {
  resetVisibility()
  jest.restoreAllMocks()
})

describe('the dispatch to the background', () => {
  it('sends at once from a visible tab', async () => {
    setVisibility('visible', false)
    const send = jest.fn()
    backgroundGate(send)({ kind: 'verdict', verdict: 'passed' })
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ kind: 'verdict', verdict: 'passed' })
  })

  it('sends nothing while the tab is hidden, however long it stays hidden', async () => {
    jest.useFakeTimers()
    try {
      setVisibility('hidden', false)
      const send = jest.fn()
      const dispatch = backgroundGate(send)
      dispatch({ kind: 'verdict', verdict: 'passed' })
      await flush()
      jest.advanceTimersByTime(10 * 60 * 1000)
      await flush()
      expect(send).not.toHaveBeenCalled()
      expect(dispatch.gate.pending()).toBe(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('sends what it held once the tab is shown again', async () => {
    setVisibility('hidden', false)
    const send = jest.fn()
    backgroundGate(send)({ kind: 'verdict', verdict: 'passed' })
    await flush()
    expect(send).not.toHaveBeenCalled()
    setVisibility('visible')
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ kind: 'verdict', verdict: 'passed' })
  })

  it('keeps holding through a visibilitychange that leaves the tab hidden', async () => {
    setVisibility('hidden', false)
    const send = jest.fn()
    backgroundGate(send)('held')
    setVisibility('hidden')
    await flush()
    expect(send).not.toHaveBeenCalled()
  })

  it('treats prerender as not shown', async () => {
    setVisibility('prerender' as DocumentVisibilityState, false)
    const send = jest.fn()
    backgroundGate(send)('held')
    await flush()
    expect(send).not.toHaveBeenCalled()
  })

  it('sends each held message once and in order, and holds again when hidden', async () => {
    setVisibility('hidden', false)
    const send = jest.fn()
    const dispatch = backgroundGate(send)
    dispatch('first')
    dispatch('second')
    setVisibility('visible')
    await flush()
    expect(send.mock.calls).toEqual([['first'], ['second']])

    setVisibility('visible')
    await flush()
    expect(send).toHaveBeenCalledTimes(2)

    setVisibility('hidden')
    dispatch('third')
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
    setVisibility('visible')
    await flush()
    expect(send.mock.calls).toEqual([['first'], ['second'], ['third']])
  })

  it('starts no ceremony prompt before the tab is visible', async () => {
    setVisibility('hidden', false)
    const shown = jest.fn()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    ceremony().whenVisible(document).then(shown)
    await flush()
    expect(shown).not.toHaveBeenCalled()
    setVisibility('visible')
    await flush()
    expect(shown).toHaveBeenCalledTimes(1)
  })
})

describe('the report the tab writes', () => {
  const fakeStore = () => ({
    get: jest.fn(async () => null),
    set: jest.fn(async () => null),
    remove: jest.fn(async () => null)
  })

  it('writes nothing to the extension storage while hidden, and writes once shown', async () => {
    const { ceremonyReport, ceremonyResultKey, createVisibilityGate, passed, sendCeremonyReport } =
      ceremony()
    setVisibility('hidden', false)
    const store = fakeStore()
    const gate = createVisibilityGate(document)
    const report = ceremonyReport(
      { id: 'req-1', call: 'testAccess', method: 'passkey' },
      passed({ proof: '0x01' }),
      1
    )
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    sendCeremonyReport(report, { store, gate })
    await flush()
    expect(store.set).not.toHaveBeenCalled()

    setVisibility('visible')
    await flush()
    expect(store.set).toHaveBeenCalledTimes(1)
    expect(store.set).toHaveBeenCalledWith(ceremonyResultKey('req-1'), report)
    gate.dispose()
  })
})

describe('a hand-off to a phone', () => {
  let creds: ReturnType<typeof installCredentials>

  afterEach(() => creds.restore())

  it('asks the browser for the phone route', async () => {
    creds = installCredentials({
      get: async () => fakeAssertion({ r: BigInt(5), s: BigInt(6) }).credential
    })
    const method = fakeMethod()
    await hosts.testAccess({ method, orchestrator: fakeOrchestrator(method), handOff: true })
    const options = creds.get.mock.calls[0][0] as { publicKey?: { hints?: string[] } }
    expect(options.publicKey?.hints).toContain('hybrid')
  })

  it('reports a result that arrived while the tab was hidden only when the tab returns', async () => {
    const { ceremonyReport, createVisibilityGate, sendCeremonyReport } = ceremony()
    setVisibility('visible', false)
    // The holder switches away; the phone answers while the tab is hidden.
    creds = installCredentials({
      get: async () => {
        setVisibility('hidden')
        return fakeAssertion({ r: BigInt(5), s: BigInt(6) }).credential
      }
    })
    const method = fakeMethod()
    const outcome = await hosts.testAccess({
      method,
      orchestrator: fakeOrchestrator(method),
      handOff: true
    })
    expect(outcome).toMatchObject({ type: 'verdict', verdict: 'passed' })
    expect(document.visibilityState).toBe('hidden')

    const store = { get: jest.fn(), set: jest.fn(async () => null), remove: jest.fn() }
    const gate = createVisibilityGate(document)
    const report = ceremonyReport(
      { id: 'req-1', call: 'testAccess', method: 'passkey' },
      outcome.raw as Parameters<typeof ceremonyReport>[1],
      1
    )
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    sendCeremonyReport(report, { store, gate })
    await flush()
    expect(store.set).not.toHaveBeenCalled()

    setVisibility('visible')
    await flush()
    expect(store.set).toHaveBeenCalledTimes(1)
    gate.dispose()
  })

  it('reads unreachable, with a retry, when the phone never connects', async () => {
    const { CEREMONY_TIMEOUT_MS } = ceremony()
    let clock = 1_000_000
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    // The browser's prompt waits out its whole timeout, then refuses.
    creds = installCredentials({
      get: async () => {
        clock += CEREMONY_TIMEOUT_MS
        throw notAllowedError()
      }
    })
    const method = fakeMethod()
    const orchestrator = fakeOrchestrator(method)
    const outcome = await hosts.testAccess({ method, orchestrator, handOff: true })
    expect(outcome).toMatchObject({ type: 'verdict', verdict: 'unavailable', retry: true })
    if (outcome.type === 'verdict') expect(outcome.cause).toContain('unreachable')
    expect(noteKeyOf(outcome, 'testAccess')).toBe('socialRecovery.ceremony.unreachableNote')
    expect(methodRunCount(method, orchestrator)).toBe(0)
  })

  it('reads unreachable at enrollment too when the phone never connects', async () => {
    const { CEREMONY_TIMEOUT_MS } = ceremony()
    let clock = 1_000_000
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    creds = installCredentials({
      create: async () => {
        clock += CEREMONY_TIMEOUT_MS
        throw notAllowedError()
      }
    })
    const method = fakeMethod()
    const orchestrator = fakeOrchestrator(method)
    const outcome = await hosts.enroll({ method, orchestrator, handOff: true })
    expect(outcome).toMatchObject({ type: 'verdict', verdict: 'unavailable', retry: true })
    expect(noteKeyOf(outcome, 'enroll')).toBe('socialRecovery.ceremony.unreachableNote')
    expect(methodRunCount(method, orchestrator)).toBe(0)
  })

  it('reads cancelled, not unreachable, when the holder closes the enrollment prompt early', async () => {
    let clock = 1_000_000
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    creds = installCredentials({
      create: async () => {
        clock += 5_000
        throw notAllowedError()
      }
    })
    const method = fakeMethod()
    const outcome = await hosts.enroll({
      method,
      orchestrator: fakeOrchestrator(method),
      handOff: true
    })
    expect(outcome).toMatchObject({ type: 'note', note: 'cancelled' })
  })

  it('reads test failed, not unreachable, when the test prompt closes early (frame C-05)', async () => {
    let clock = 1_000_000
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    creds = installCredentials({
      get: async () => {
        clock += 5_000
        throw notAllowedError()
      }
    })
    const method = fakeMethod()
    const outcome = await hosts.testAccess({
      method,
      orchestrator: fakeOrchestrator(method),
      handOff: true
    })
    expect(outcome).toMatchObject({ type: 'verdict', verdict: 'failed' })
    if (outcome.type === 'verdict') expect(outcome.cause).toContain('NotAllowedError')
  })
})
