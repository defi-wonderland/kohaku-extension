/**
 * PT-036: the deadline renders as a date and time in the reader's zone, the
 * zone named, with a countdown beside it (D-302), for a fixed now.
 */
import i18n from '@common/config/localization/localization'
import en from '@common/config/localization/translations/en.json'

import { renderDeadline, renderRemaining } from '..'

const NOW = new Date('2026-09-24T10:00:00Z')
const DEADLINE = new Date('2026-09-26T12:30:00Z') // 50 hours 30 minutes later

describe('countdown words come from en.json alone', () => {
  it('en.json registers the hour and minute words with their plurals', () => {
    const { display } = en.socialRecovery
    expect(display.remainingHours).toBe('{{count}} hour')
    expect(display.remainingHours_plural).toBe('{{count}} hours')
    expect(display.remainingMinutes).toBe('{{count}} minute')
    expect(display.remainingMinutes_plural).toBe('{{count}} minutes')
    expect(i18n.exists('socialRecovery.display.remainingHours')).toBe(true)
    expect(i18n.exists('socialRecovery.display.remainingMinutes')).toBe(true)
  })

  it('reads the registered keys with a count and passes no fallback text', () => {
    const calls: [string, Record<string, unknown> | undefined][] = []
    const t = (key: string, options?: Record<string, unknown>) => {
      calls.push([key, options])
      return `<${key}>`
    }
    expect(renderRemaining(50 * 3600 * 1000 + 30 * 60 * 1000, t)).toBe(
      '<socialRecovery.display.remainingHours>'
    )
    expect(renderRemaining(20 * 60 * 1000, t)).toBe('<socialRecovery.display.remainingMinutes>')
    expect(calls).toEqual([
      ['socialRecovery.display.remainingHours', { count: 50 }],
      ['socialRecovery.display.remainingMinutes', { count: 20 }]
    ])
  })
})

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
