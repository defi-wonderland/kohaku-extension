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
 */
import {
  awaitHandOff,
  backgroundGate,
  flush,
  resetVisibility,
  setVisibility,
  toOutcome
} from './harness'

afterEach(() => {
  resetVisibility()
  jest.useRealTimers()
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
    setVisibility('hidden', false)
    const send = jest.fn()
    backgroundGate(send)({ kind: 'verdict', verdict: 'passed' })
    await flush()
    jest.advanceTimersByTime(10 * 60 * 1000)
    await flush()
    expect(send).not.toHaveBeenCalled()
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
})

describe('a hand-off to a phone', () => {
  it('reports a result that arrived while the tab was hidden only when the tab returns', async () => {
    const send = jest.fn()
    const dispatch = backgroundGate(send)
    setVisibility('hidden')
    let phoneAnswers: (value: unknown) => void = () => {}
    const phone = new Promise((resolve) => {
      phoneAnswers = resolve
    })
    // The tab reports whatever the phone returns through the gate.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    phone.then((result) => dispatch(result))
    phoneAnswers({ kind: 'verdict', verdict: 'passed' })
    await flush()
    expect(send).not.toHaveBeenCalled()
    setVisibility('visible')
    await flush()
    expect(send).toHaveBeenCalledWith({ kind: 'verdict', verdict: 'passed' })
  })

  it('reads unreachable, with a retry, when the phone never connects', async () => {
    jest.useFakeTimers()
    const neverConnects = () => new Promise<never>(() => {})
    const pending = awaitHandOff(neverConnects, 60_000)
    jest.advanceTimersByTime(60_000)
    await flush()
    const outcome = toOutcome(await pending)
    expect(outcome).toMatchObject({ type: 'note', note: 'unreachable', retry: true })
  })

  it('does not read unreachable when the phone connects in time', async () => {
    jest.useFakeTimers()
    const connects = () => Promise.resolve({ connected: true })
    const pending = awaitHandOff(connects, 60_000)
    await flush()
    jest.advanceTimersByTime(60_000)
    await flush()
    const result = (await pending) as { note?: string }
    expect(result.note).not.toBe('unreachable')
  })
})
