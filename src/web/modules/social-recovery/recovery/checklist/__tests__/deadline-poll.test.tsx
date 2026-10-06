/**
 * @jest-environment jsdom
 *
 * The request's deadline and the poll of the account's recovery state, on
 * Jest's fake clock: the deadline line ticks every minute and says every
 * approval dies together unless one approval is the whole request; the poll
 * reads at once, on every period and when the tab returns to view; a poll
 * that throws or runs past its limit holds every add, launch and continue
 * under the failed read with a retry, and the rows never render from a poll
 * that has not returned since open. An account that no longer authorizes the
 * action reads as dormant and keeps every approval.
 */
import type { Configuration } from '@web/modules/social-recovery/sdk-interfaces'

import type {
  FakeKit,
  FakeVisibility,
  Mounted,
  TestRecords
} from '@web/modules/social-recovery/recovery/checklist/__tests__/harness'
import {
  configurationOf,
  depsOf,
  fakeKit,
  gatheringOf,
  GUARDIANS,
  guardianCredential,
  MIXED_PATH,
  mountChecklist,
  NOW,
  NOW_SECONDS,
  passkeyCredential,
  recoveryStateOf,
  seedCache,
  seedEntry,
  seedSession,
  settle,
  storedSession,
  t,
  testRecords,
  visibilitySource,
  withReplies
} from '@web/modules/social-recovery/recovery/checklist/__tests__/harness'

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const {
  CHECKLIST_POLL_MS,
  POLL_LIMIT_MS
}: typeof import('@web/modules/social-recovery/recovery/checklist/constants') = require('@web/modules/social-recovery/recovery/checklist/constants')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const CHECKLIST = 'socialRecovery.checklist'
const MINUTE_MS = 60_000

const ONE_ROW: Configuration = configurationOf([
  { threshold: 1, credentials: [passkeyCredential('Laptop passkey')] }
])
const TWO_ROWS: Configuration = configurationOf([
  { threshold: 1, credentials: [passkeyCredential('Laptop passkey')] },
  { threshold: 1, credentials: [guardianCredential(GUARDIANS[0], 'Alice')] }
])

/** A gathering whose deadline is `seconds` after the fixed clock. */
const closingIn = (configuration: Configuration, seconds: number) => {
  const gathering = gatheringOf(configuration)
  return {
    ...gathering,
    request: { ...gathering.request, validUntil: String(NOW_SECONDS + seconds) }
  }
}

describe('the checklist deadline and poll', () => {
  let view: Mounted | undefined
  let world: TestRecords
  let kit: FakeKit
  let visibility: FakeVisibility

  const open = async (configuration: Configuration, gathering = gatheringOf(configuration)) => {
    await seedCache(world.records, configuration)
    await seedSession(world.records, gathering)
    kit = fakeKit(configuration)
    view = await mountChecklist({
      records: world.records,
      client: kit.state,
      deps: depsOf({ now: () => Date.now(), visibility })
    })
    return view
  }

  beforeEach(async () => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
    world = testRecords()
    visibility = visibilitySource()
    await seedEntry(world.records)
  })

  afterEach(() => {
    view?.unmount()
    view = undefined
    jest.useRealTimers()
  })

  describe('the deadline', () => {
    it('says every approval dies together on a path of two rows, with the submittable line under it', async () => {
      const mounted = await open(TWO_ROWS)

      const line = mounted.byTestId('checklist-deadline')?.textContent ?? ''
      expect(line).toContain(t(`${CHECKLIST}.deadline.diesTogether`))
      expect(mounted.byTestId('checklist-submittable')?.textContent).toBe(
        t(`${CHECKLIST}.submittable`)
      )
      const deadline = mounted.byTestId('checklist-deadline')
      const submittable = mounted.byTestId('checklist-submittable')
      expect(
        deadline &&
          submittable &&
          // eslint-disable-next-line no-bitwise
          deadline.compareDocumentPosition(submittable) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      const rows = mounted.byTestId('checklist-rows')
      expect(
        submittable &&
          rows &&
          // eslint-disable-next-line no-bitwise
          submittable.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it('says no such thing where one approval is the whole request', async () => {
      const mounted = await open(ONE_ROW)

      const line = mounted.byTestId('checklist-deadline')?.textContent ?? ''
      expect(line).not.toBe('')
      expect(line).not.toContain(t(`${CHECKLIST}.deadline.diesTogether`))
      expect(mounted.byTestId('checklist-submittable')).not.toBeNull()
    })

    it('says no such thing for a lone group of threshold one, and says it for a group of two', async () => {
      const loneGroup = configurationOf([
        {
          threshold: 1,
          credentials: [guardianCredential(GUARDIANS[0]), guardianCredential(GUARDIANS[1])]
        }
      ])
      const first = await open(loneGroup)
      expect(first.byTestId('checklist-deadline')?.textContent).not.toContain(
        t(`${CHECKLIST}.deadline.diesTogether`)
      )
      first.unmount()

      world = testRecords()
      await seedEntry(world.records)
      const groupOfTwo = configurationOf([
        {
          threshold: 2,
          credentials: [guardianCredential(GUARDIANS[0]), guardianCredential(GUARDIANS[1])]
        }
      ])
      view = await open(groupOfTwo)
      expect(view.byTestId('checklist-deadline')?.textContent).toContain(
        t(`${CHECKLIST}.deadline.diesTogether`)
      )
    })

    it('renders the time left again every minute from the page clock', async () => {
      const mounted = await open(TWO_ROWS, closingIn(TWO_ROWS, 10 * 60))
      const minutes = (count: number) => t('socialRecovery.display.remainingMinutes', { count })

      expect(mounted.byTestId('checklist-deadline')?.textContent).toContain(minutes(10))

      await settle(MINUTE_MS)
      expect(mounted.byTestId('checklist-deadline')?.textContent).toContain(minutes(9))

      await settle(MINUTE_MS)
      expect(mounted.byTestId('checklist-deadline')?.textContent).toContain(minutes(8))
    })
  })

  describe('the poll', () => {
    it('reads the recovery state and the authorization at once on open', async () => {
      await open(MIXED_PATH)

      expect(kit.recoveryState).toHaveBeenCalledTimes(1)
      expect(kit.isAuthorized).toHaveBeenCalledTimes(1)
    })

    it('reads again on every period', async () => {
      await open(MIXED_PATH)

      await settle(CHECKLIST_POLL_MS - 1)
      expect(kit.recoveryState).toHaveBeenCalledTimes(1)
      await settle(1)
      expect(kit.recoveryState).toHaveBeenCalledTimes(2)
      await settle(CHECKLIST_POLL_MS)
      expect(kit.recoveryState).toHaveBeenCalledTimes(3)
      expect(kit.isAuthorized).toHaveBeenCalledTimes(3)
    })

    it('reads again at once when the tab returns to view, not when it is hidden', async () => {
      await open(MIXED_PATH)

      visibility.turn('hidden')
      await settle()
      expect(kit.recoveryState).toHaveBeenCalledTimes(1)

      visibility.turn('visible')
      await settle()
      expect(kit.recoveryState).toHaveBeenCalledTimes(2)
    })

    it('stops reading once the checklist closes', async () => {
      await open(MIXED_PATH)
      view?.unmount()
      view = undefined

      await settle(3 * CHECKLIST_POLL_MS)
      visibility.turn('visible')
      await settle()
      expect(kit.recoveryState).toHaveBeenCalledTimes(1)
    })

    it('renders the assessment again with the clock read before each poll', async () => {
      await open(MIXED_PATH)
      const firstClock = kit.assess.mock.calls[kit.assess.mock.calls.length - 1][1]
      expect(firstClock).toBe(NOW_SECONDS)

      // The next read answers five seconds after it starts.
      kit.recoveryState.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(recoveryStateOf()), 5000)
          })
      )
      kit.assess.mockClear()
      await settle(CHECKLIST_POLL_MS + 5000)
      expect(kit.assess).toHaveBeenCalled()
      const lastClock = kit.assess.mock.calls[kit.assess.mock.calls.length - 1][1]
      expect(lastClock).toBe(NOW_SECONDS + CHECKLIST_POLL_MS / 1000)
    })

    it('renders no row from a poll that has not returned since open, then the failed read past its limit', async () => {
      await seedCache(world.records, MIXED_PATH)
      await seedSession(world.records, gatheringOf(MIXED_PATH))
      kit = fakeKit(MIXED_PATH)
      kit.recoveryState.mockImplementation(() => new Promise(() => {}))
      view = await mountChecklist({
        records: world.records,
        client: kit.state,
        deps: depsOf({ now: () => Date.now(), visibility })
      })

      expect(view.byTestId('checklist-loading')).not.toBeNull()
      expect(view.byTestId('checklist-rows')).toBeNull()
      expect(view.byTestId('checklist-row-0')).toBeNull()

      await settle(POLL_LIMIT_MS - 1)
      expect(view.byTestId('checklist-rows')).toBeNull()
      expect(view.byTestId('checklist-poll-failed')).toBeNull()

      await settle(1)
      expect(view.byTestId('checklist-poll-failed')).not.toBeNull()
      expect(view.byTestId('checklist-poll-retry')).not.toBeNull()
    })

    it('holds every launch and every row action under a poll that throws, and a retry that succeeds restores them', async () => {
      const mounted = await open(MIXED_PATH)
      const actions = [
        'checklist-row-0-answer-here',
        'checklist-row-0-phone',
        'checklist-row-1-mark-declined'
      ]
      actions.forEach((id) => expect(mounted.isDisabled(id)).toBe(false))

      kit.recoveryState.mockRejectedValue(new Error('node unavailable'))
      await settle(CHECKLIST_POLL_MS)

      expect(mounted.byTestId('checklist-poll-failed')?.textContent).toContain(
        t(`${CHECKLIST}.pollFailed.title`)
      )
      expect(mounted.byTestId('checklist-poll-failed')?.textContent).toContain(
        t(`${CHECKLIST}.pollFailed.body`)
      )
      expect(mounted.byTestId('checklist-poll-held')?.textContent).toBe(
        t(`${CHECKLIST}.pollFailed.held`)
      )
      expect(mounted.byTestId('checklist-rows')).not.toBeNull()
      actions.forEach((id) => expect(mounted.isDisabled(id)).toBe(true))

      kit.recoveryState.mockClear()
      await mounted.press('checklist-poll-retry')
      expect(kit.recoveryState).toHaveBeenCalledTimes(1)
      expect(mounted.byTestId('checklist-poll-failed')).not.toBeNull()

      kit.recoveryState.mockResolvedValue(recoveryStateOf())
      await mounted.press('checklist-poll-retry')

      expect(mounted.byTestId('checklist-poll-failed')).toBeNull()
      actions.forEach((id) => expect(mounted.isDisabled(id)).toBe(false))
    })

    it('holds continue on a satisfied path under a failed poll, and the next period restores it', async () => {
      const mounted = await open(TWO_ROWS, withReplies(gatheringOf(TWO_ROWS), [0, 1]))
      expect(mounted.isDisabled('checklist-continue')).toBe(false)

      kit.recoveryState.mockRejectedValueOnce(new Error('node unavailable'))
      await settle(CHECKLIST_POLL_MS)
      expect(mounted.byTestId('checklist-poll-failed')).not.toBeNull()
      expect(mounted.byTestId('checklist-satisfied')).not.toBeNull()
      expect(mounted.isDisabled('checklist-continue')).toBe(true)

      await settle(CHECKLIST_POLL_MS)
      expect(mounted.byTestId('checklist-poll-failed')).toBeNull()
      expect(mounted.isDisabled('checklist-continue')).toBe(false)
    })

    it('holds the rows where the authorization read throws, and the next period restores them', async () => {
      const mounted = await open(MIXED_PATH)
      kit.isAuthorized.mockRejectedValueOnce(new Error('node unavailable'))

      await settle(CHECKLIST_POLL_MS)
      expect(mounted.byTestId('checklist-poll-failed')).not.toBeNull()
      expect(mounted.isDisabled('checklist-row-0-answer-here')).toBe(true)

      await settle(CHECKLIST_POLL_MS)
      expect(mounted.byTestId('checklist-poll-failed')).toBeNull()
      expect(mounted.isDisabled('checklist-row-0-answer-here')).toBe(false)
    })

    it('holds the rows where a later poll hangs past its limit', async () => {
      const mounted = await open(MIXED_PATH)
      kit.recoveryState.mockImplementationOnce(() => new Promise(() => {}))

      await settle(CHECKLIST_POLL_MS + POLL_LIMIT_MS - 1)
      expect(mounted.byTestId('checklist-poll-failed')).toBeNull()
      await settle(1)
      expect(mounted.byTestId('checklist-poll-failed')).not.toBeNull()
      expect(mounted.isDisabled('checklist-row-0-phone')).toBe(true)
    })
  })

  describe('an account that no longer authorizes the action', () => {
    it('reads as dormant, keeps every approval, holds continue and wipes nothing', async () => {
      const satisfied = withReplies(gatheringOf(TWO_ROWS), [0, 1])
      await seedCache(world.records, TWO_ROWS)
      const seeded = await seedSession(world.records, satisfied)
      kit = fakeKit(TWO_ROWS)
      kit.isAuthorized.mockResolvedValue(false)
      const wipe = jest.spyOn(world.records, 'wipeRecoverySession')
      view = await mountChecklist({
        records: world.records,
        client: kit.state,
        deps: depsOf({ now: () => Date.now(), visibility })
      })
      await settle(CHECKLIST_POLL_MS)

      expect(view.byTestId('checklist-dormant')?.textContent).toContain(
        t('socialRecovery.wait.cannotExecute.notAuthorized')
      )
      expect(view.byTestId('checklist-satisfied')).not.toBeNull()
      expect(view.isDisabled('checklist-continue')).toBe(true)
      expect(view.byTestId('checklist-wiped')).toBeNull()
      expect(wipe).not.toHaveBeenCalled()
      const stored = await storedSession(world.records)
      expect(stored?.revision).toBe(seeded.revision)
      expect(stored?.value).toEqual({ state: 'live', gathering: satisfied })

      kit.isAuthorized.mockResolvedValue(true)
      await settle(CHECKLIST_POLL_MS)
      expect(view.byTestId('checklist-dormant')).toBeNull()
      expect(view.isDisabled('checklist-continue')).toBe(false)
    })
  })
})
