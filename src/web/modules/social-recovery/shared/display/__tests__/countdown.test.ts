import { countdownStateOf, renderCountdown } from '..'

const REMAINING = (47 * 3600 + 12 * 60 + 6) * 1000 // 47:12:06

describe('attempt countdown', () => {
  it('renders the waiting form while time is left', () => {
    expect(renderCountdown({ remainingMs: REMAINING })).toBe('47:12:06 · waiting')
  })

  it('renders the execution due form once no time is left', () => {
    expect(renderCountdown({ remainingMs: 0 })).toBe('Execution due')
  })

  it('renders the stopped form while time is left', () => {
    expect(renderCountdown({ remainingMs: REMAINING, stopped: true })).toBe('47:12:06 · stopped')
  })

  it('renders the execution due and stopped form once no time is left', () => {
    expect(renderCountdown({ remainingMs: 0, stopped: true })).toBe('Execution due · stopped')
  })

  it('renders stopped: false like no stop at all', () => {
    expect(renderCountdown({ remainingMs: REMAINING, stopped: false })).toBe('47:12:06 · waiting')
    expect(renderCountdown({ remainingMs: 0, stopped: false })).toBe('Execution due')
  })

  it('pads hours, minutes and seconds to two digits', () => {
    expect(renderCountdown({ remainingMs: 1000 })).toBe('00:00:01 · waiting')
  })

  it('renders execution due when the countdown is at zero or less', () => {
    expect(renderCountdown({ remainingMs: 0 })).toBe('Execution due')
    expect(renderCountdown({ remainingMs: -5000 })).toBe('Execution due')
    expect(renderCountdown({ remainingMs: -5000, stopped: true })).toBe('Execution due · stopped')
  })

  it('renders execution due, never 00:00:00 · waiting, with less than one whole second left', () => {
    expect(renderCountdown({ remainingMs: 500 })).toBe('Execution due')
    expect(renderCountdown({ remainingMs: 500 })).not.toBe('00:00:00 · waiting')
    expect(renderCountdown({ remainingMs: 999 })).toBe('Execution due')
    expect(renderCountdown({ remainingMs: 500, stopped: true })).toBe('Execution due · stopped')
  })

  it('derives the state from whole seconds left: waiting from one second, execution due below', () => {
    expect(countdownStateOf(REMAINING)).toBe('waiting')
    expect(countdownStateOf(1000)).toBe('waiting')
    expect(countdownStateOf(999)).toBe('executionDue')
    expect(countdownStateOf(500)).toBe('executionDue')
    expect(countdownStateOf(1)).toBe('executionDue')
    expect(countdownStateOf(0)).toBe('executionDue')
    expect(countdownStateOf(-1)).toBe('executionDue')
  })
})
