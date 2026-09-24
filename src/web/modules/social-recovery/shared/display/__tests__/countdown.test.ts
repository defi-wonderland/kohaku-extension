/**
 * PT-036: a running attempt's countdown in its four K-09 forms (D-302).
 *
 * Sources: docs/social-recovery/design/ux.md D-302 (an attempt's countdown
 * reads waiting or execution due, and stopped from the second release),
 * docs/social-recovery/design/live-frame-strings.md K-09 ("47:12:06 · waiting",
 * "Execution due", "47:12:06 · stopped", "Execution due · stopped").
 */
import { renderCountdown } from '..'

const REMAINING = (47 * 3600 + 12 * 60 + 6) * 1000 // 47:12:06

describe('attempt countdown (K-09)', () => {
  it('renders the waiting form', () => {
    expect(renderCountdown({ state: 'waiting', remainingMs: REMAINING })).toBe('47:12:06 · waiting')
  })

  it('renders the execution due form', () => {
    expect(renderCountdown({ state: 'executionDue', remainingMs: 0 })).toBe('Execution due')
  })

  it('renders the stopped form', () => {
    expect(renderCountdown({ state: 'waiting', remainingMs: REMAINING, stopped: true })).toBe(
      '47:12:06 · stopped'
    )
  })

  it('renders the execution due and stopped form', () => {
    expect(renderCountdown({ state: 'executionDue', remainingMs: 0, stopped: true })).toBe(
      'Execution due · stopped'
    )
  })

  it('pads hours, minutes and seconds to two digits', () => {
    expect(renderCountdown({ state: 'waiting', remainingMs: 1000 })).toBe('00:00:01 · waiting')
  })

  it('renders execution due when a waiting countdown reaches zero or less', () => {
    expect(renderCountdown({ state: 'waiting', remainingMs: 0 })).toBe('Execution due')
    expect(renderCountdown({ state: 'waiting', remainingMs: -5000 })).toBe('Execution due')
  })

  it('renders execution due and stopped when a stopped countdown reaches zero', () => {
    expect(renderCountdown({ state: 'waiting', remainingMs: 0, stopped: true })).toBe(
      'Execution due · stopped'
    )
  })
})
