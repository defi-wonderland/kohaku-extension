/**
 * PT-036: the deadline renders as a date and time in the reader's zone, the
 * zone named, with a countdown beside it (D-302), for a fixed now.
 */
import { renderDeadline } from '..'

const NOW = new Date('2026-09-24T10:00:00Z')
const DEADLINE = new Date('2026-09-26T12:30:00Z') // 50 hours 30 minutes later

describe('deadline (D-302)', () => {
  it('renders the time in Europe/Berlin with the zone named and a countdown', () => {
    const out = renderDeadline({ deadline: DEADLINE, now: NOW, timeZone: 'Europe/Berlin' })
    expect(out.passed).toBe(false)
    expect(out.date).toMatch(/26/)
    expect(out.date).toMatch(/14:30/)
    expect(out.zone).toMatch(/^(CEST|GMT\+2)$/)
    expect(out.date).toContain(out.zone)
    expect(out.remaining).toBe('50 hours')
    expect(out.line).toBe(`Valid until ${out.date} · 50 hours left`)
  })

  it('renders the same instant in America/New_York with its own time and zone', () => {
    const out = renderDeadline({ deadline: DEADLINE, now: NOW, timeZone: 'America/New_York' })
    expect(out.date).toMatch(/08:30/)
    expect(out.zone).toMatch(/^(EDT|GMT-4)$/)
    expect(out.date).toContain(out.zone)
    expect(out.line).toContain(out.zone)
    expect(out.remaining).toBe('50 hours')
  })

  it('is deterministic for a fixed now', () => {
    const a = renderDeadline({ deadline: DEADLINE, now: NOW, timeZone: 'Europe/Berlin' })
    const b = renderDeadline({ deadline: DEADLINE, now: new Date(NOW), timeZone: 'Europe/Berlin' })
    expect(a).toEqual(b)
  })

  it('shortens the countdown as now advances', () => {
    const later = new Date('2026-09-26T11:00:00Z')
    expect(
      renderDeadline({ deadline: DEADLINE, now: later, timeZone: 'Europe/Berlin' }).remaining
    ).toBe('1 hour')
    const last = new Date('2026-09-26T12:10:00Z')
    expect(
      renderDeadline({ deadline: DEADLINE, now: last, timeZone: 'Europe/Berlin' }).remaining
    ).toBe('20 minutes')
  })

  it('renders no countdown once the deadline has passed', () => {
    const out = renderDeadline({ deadline: DEADLINE, now: DEADLINE, timeZone: 'Europe/Berlin' })
    expect(out.passed).toBe(true)
    expect(out.remaining).toBeNull()
  })
})
