/**
 * PT-036: the deadline renders as a date and time in the reader's zone, the
 * zone named, with a countdown beside it (D-302), for a fixed now.
 */
import { renderDeadline } from '..'

const NOW = new Date('2026-09-24T10:00:00Z')
const DEADLINE = new Date('2026-09-26T12:30:00Z') // 2 days 2 hours 30 minutes later

const zoneNamed = (out: string, names: string[]) => names.some((n) => out.includes(n))

describe('deadline (D-302)', () => {
  it('renders the time in Europe/Berlin, names the zone and a countdown', () => {
    const out = renderDeadline(DEADLINE, { now: NOW, timeZone: 'Europe/Berlin' })
    expect(out).toMatch(/14:30|2:30\s?PM/)
    expect(out).toMatch(/26|Sep/)
    expect(zoneNamed(out, ['Europe/Berlin', 'CEST', 'GMT+2', 'UTC+2', 'Central European'])).toBe(true)
    expect(out).toMatch(/2\s?(d|days?)\b/)
  })

  it('renders the same instant in America/New_York with its own time and zone', () => {
    const out = renderDeadline(DEADLINE, { now: NOW, timeZone: 'America/New_York' })
    expect(out).toMatch(/08:30|8:30\s?AM/)
    expect(zoneNamed(out, ['America/New_York', 'EDT', 'GMT-4', 'UTC-4', 'Eastern'])).toBe(true)
    expect(out).toMatch(/2\s?(d|days?)\b/)
  })

  it('is deterministic for a fixed now', () => {
    const a = renderDeadline(DEADLINE, { now: NOW, timeZone: 'Europe/Berlin' })
    const b = renderDeadline(DEADLINE, { now: new Date(NOW), timeZone: 'Europe/Berlin' })
    expect(a).toBe(b)
  })

  it('shortens the countdown as now advances', () => {
    const later = new Date('2026-09-26T11:00:00Z')
    const out = renderDeadline(DEADLINE, { now: later, timeZone: 'Europe/Berlin' })
    expect(out).not.toMatch(/2\s?(d|days?)\b/)
    expect(out).toMatch(/1\s?(h|hours?)\b/)
  })
})
