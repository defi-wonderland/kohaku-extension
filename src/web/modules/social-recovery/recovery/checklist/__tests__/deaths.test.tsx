/**
 * @jest-environment jsdom
 *
 * The three ways a request dies while the checklist is open, on Jest's fake
 * clock: the deadline passes, another attempt opens on the account, or the
 * setup changes. Each is one wipe through the records with its reason, the
 * checklist renders the wiped state from that reason, and the wipe leaves no
 * reply, no attempt id and no ceremony request or report of the account in
 * storage. The rows stay held while the wipe is being written, and no row's
 * outcome and no undelivered claim of the dead request reaches the next
 * gathering.
 */
import type { Configuration, Gathering } from '@web/modules/social-recovery/sdk-interfaces'

import type {
  FakeDeps,
  FakeKit,
  Mounted,
  TestRecords
} from '@web/modules/social-recovery/recovery/checklist/__tests__/harness'
import {
  ACCOUNT,
  CHAIN_ID,
  configurationOf,
  DAY_SECONDS,
  depsOf,
  fakeKit,
  gatheringOf,
  GUARDIANS,
  guardianCredential,
  MIXED_PATH,
  mountChecklist,
  NOW,
  outside,
  passkeyCredential,
  PASSWORD,
  recoveryStateOf,
  replyOf,
  requestOf,
  SECOND_ACCOUNT,
  seedCache,
  seedEntry,
  seedSession,
  settle,
  storedSession,
  t,
  testRecords,
  withReplies
} from '@web/modules/social-recovery/recovery/checklist/__tests__/harness'

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const {
  WEB_ROUTES
}: typeof import('@common/modules/router/constants/common') = require('@common/modules/router/constants/common')
const {
  ceremonyResultKey,
  failed,
  passed
}: typeof import('@web/modules/social-recovery/shared/ceremony') = require('@web/modules/social-recovery/shared/ceremony')
const {
  stringify
}: typeof import('@ambire-common/libs/richJson/richJson') = require('@ambire-common/libs/richJson/richJson')
const {
  CHECKLIST_POLL_MS
}: typeof import('@web/modules/social-recovery/recovery/checklist/constants') = require('@web/modules/social-recovery/recovery/checklist/constants')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const DEATHS = 'socialRecovery.checklist.deaths'
const RECORDS = 'socialRecovery.records'

const TWO_ROWS: Configuration = configurationOf([
  { threshold: 1, credentials: [passkeyCredential('Laptop passkey')] },
  { threshold: 1, credentials: [guardianCredential(GUARDIANS[0], 'Alice')] }
])

/** Past the deadline of every gathering the harness opens at the fixed clock. */
const PAST_DEADLINE = NOW + (DAY_SECONDS + 1) * 1000

describe('the request dies', () => {
  let view: Mounted | undefined
  let world: TestRecords
  let kit: FakeKit
  let deps: FakeDeps
  let wipe: jest.SpyInstance

  const open = async (
    configuration: Configuration,
    gathering: Gathering,
    overrides: Partial<FakeDeps> = {}
  ) => {
    await seedCache(world.records, configuration)
    const seeded = await seedSession(world.records, gathering)
    kit = fakeKit(configuration)
    deps = depsOf({ now: () => Date.now(), ...overrides })
    view = await mountChecklist({ records: world.records, client: kit.state, deps })
    return seeded
  }

  /** Every value the extension's storage holds, as one text. */
  const rawStorage = async () => stringify(await world.storage.getAll())

  /** What a wipe may leave in storage: no reply, no proof and no attempt id. */
  const expectNoApprovalLeft = async (gathering: Gathering) => {
    const raw = await rawStorage()
    expect(raw).not.toContain('recovery-proof-reply')
    expect(raw).not.toContain('attemptId')
    gathering.replies.forEach((reply) => {
      expect(raw).not.toContain(reply.proof)
      expect(raw).not.toContain(reply.digest)
    })
  }

  beforeEach(async () => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
    world = testRecords()
    await seedEntry(world.records)
    wipe = jest.spyOn(world.records, 'wipeRecoverySession')
  })

  afterEach(() => {
    view?.unmount()
    view = undefined
    jest.useRealTimers()
  })

  describe('the deadline passes', () => {
    it('wipes the session with the deadline reason in one records call and offers to gather the whole set again', async () => {
      const gathering = withReplies(gatheringOf(MIXED_PATH), [1, 2])
      const seeded = await open(MIXED_PATH, gathering)
      expect(view?.byTestId('checklist-rows')).not.toBeNull()

      jest.setSystemTime(PAST_DEADLINE)
      await settle(CHECKLIST_POLL_MS)
      await settle(CHECKLIST_POLL_MS)

      expect(wipe).toHaveBeenCalledTimes(1)
      expect(wipe).toHaveBeenCalledWith(CHAIN_ID, ACCOUNT, 'deadline-passed', seeded.revision)
      expect(view?.byTestId('checklist-rows')).toBeNull()
      expect(view?.byTestId('checklist-wiped-title')?.textContent).toBe(
        t(`${RECORDS}.expiredTitle`)
      )
      expect(view?.byTestId('checklist-expired-regather')?.textContent).toBe(
        t(`${DEATHS}.expiredRegather`)
      )
      expect(view?.byTestId('checklist-expired-afresh')).toBeNull()
      expect(view?.byTestId('checklist-gather-again')?.textContent).toBe(t(`${DEATHS}.gatherAgain`))
      expect((await storedSession(world.records))?.value).toMatchObject({
        state: 'wiped',
        reason: 'deadline-passed'
      })
      await expectNoApprovalLeft(gathering)
    })

    it('says the request starts afresh where no approval was given, and starting a new request opens a new gathering', async () => {
      await open(MIXED_PATH, gatheringOf(MIXED_PATH))

      jest.setSystemTime(PAST_DEADLINE)
      await settle(CHECKLIST_POLL_MS)

      expect(view?.byTestId('checklist-expired-afresh')?.textContent).toBe(
        t(`${DEATHS}.expiredNoApproval`)
      )
      expect(view?.byTestId('checklist-expired-regather')).toBeNull()
      expect(view?.byTestId('checklist-gather-again')?.textContent).toBe(
        t(`${DEATHS}.startNewRequest`)
      )

      // The new gathering's window starts at the clock it opens under.
      const fresh = gatheringOf(MIXED_PATH, 2)
      const reopened: Gathering = {
        ...fresh,
        request: {
          ...fresh.request,
          validUntil: String(Math.floor(PAST_DEADLINE / 1000) + DAY_SECONDS)
        }
      }
      kit.initRecoveryGathering.mockResolvedValueOnce(reopened)
      await view?.press('checklist-gather-again')
      await settle()

      expect(kit.initRecoveryGathering).toHaveBeenCalledTimes(1)
      expect((await storedSession(world.records))?.value).toEqual({
        state: 'live',
        gathering: reopened
      })
      expect(view?.byTestId('checklist-wiped')).toBeNull()
      expect(view?.byTestId('checklist-row-0')).not.toBeNull()
    })

    it('wipes on the clock alone, even where the chain read fails', async () => {
      await open(MIXED_PATH, gatheringOf(MIXED_PATH))
      kit.recoveryState.mockRejectedValue(new Error('node unavailable'))

      jest.setSystemTime(PAST_DEADLINE)
      await settle(CHECKLIST_POLL_MS)

      expect(wipe).toHaveBeenCalledWith(CHAIN_ID, ACCOUNT, 'deadline-passed', expect.anything())
      expect(view?.byTestId('checklist-wiped-title')?.textContent).toBe(
        t(`${RECORDS}.expiredTitle`)
      )
    })
  })

  describe('another attempt opens on the account', () => {
    it('wipes the session and names the slot that attempt holds, with no new gathering offered', async () => {
      const gathering = withReplies(gatheringOf(MIXED_PATH), [0, 1])
      const seeded = await open(MIXED_PATH, gathering)
      kit.recoveryState.mockResolvedValue(
        recoveryStateOf({ state: 'Waiting', attemptId: BigInt(5), nextAttemptId: BigInt(6) })
      )

      await settle(CHECKLIST_POLL_MS)

      expect(wipe).toHaveBeenCalledTimes(1)
      expect(wipe).toHaveBeenCalledWith(
        CHAIN_ID,
        ACCOUNT,
        'another-attempt-opened',
        seeded.revision
      )
      expect(view?.byTestId('checklist-rows')).toBeNull()
      expect(view?.byTestId('checklist-wiped-title')?.textContent).toBe(t(`${RECORDS}.voidTitle`))
      expect(view?.byTestId('checklist-void-slot')?.textContent).toBe(t(`${DEATHS}.voidSlot`))
      expect(view?.byTestId('checklist-void-cannot-submit')?.textContent).toBe(
        t(`${DEATHS}.voidCannotSubmit`)
      )
      expect(view?.byTestId('checklist-void-reopen')?.textContent).toBe(t(`${DEATHS}.voidReopen`))
      expect(view?.byTestId('checklist-gather-again')).toBeNull()
      await expectNoApprovalLeft(gathering)

      // The slot stays held while that attempt waits.
      await settle(CHECKLIST_POLL_MS)
      expect(view?.byTestId('checklist-gather-again')).toBeNull()
      expect(wipe).toHaveBeenCalledTimes(1)
    })

    it('renders the slot free with gather again once a later poll reads no waiting attempt', async () => {
      await open(MIXED_PATH, gatheringOf(MIXED_PATH))
      kit.recoveryState.mockResolvedValue(
        recoveryStateOf({ state: 'Waiting', attemptId: BigInt(5), nextAttemptId: BigInt(6) })
      )
      await settle(CHECKLIST_POLL_MS)
      expect(view?.byTestId('checklist-gather-again')).toBeNull()

      kit.recoveryState.mockResolvedValue(
        recoveryStateOf({ state: 'Cancelled', attemptId: BigInt(5), nextAttemptId: BigInt(6) })
      )
      await settle(CHECKLIST_POLL_MS)

      expect(view?.byTestId('checklist-wiped-title')?.textContent).toBe(
        t(`${DEATHS}.slotFreeTitle`)
      )
      expect(view?.byTestId('checklist-slot-free')?.textContent).toBe(t(`${DEATHS}.slotFreeBody`))
      expect(view?.byTestId('checklist-void-slot')).toBeNull()
      expect(view?.byTestId('checklist-gather-again')?.textContent).toBe(t(`${DEATHS}.gatherAgain`))

      // The new gathering names the attempt the account opens next.
      kit.initRecoveryGathering.mockResolvedValueOnce(gatheringOf(MIXED_PATH, 6))
      await view?.press('checklist-gather-again')
      await settle(CHECKLIST_POLL_MS)
      expect(kit.initRecoveryGathering).toHaveBeenCalledTimes(1)
      expect((await storedSession(world.records))?.value).toEqual({
        state: 'live',
        gathering: gatheringOf(MIXED_PATH, 6)
      })
      expect(view?.byTestId('checklist-row-0')).not.toBeNull()
    })

    it('renders the failed read on a voided session whose poll fails, still with no new gathering', async () => {
      await open(MIXED_PATH, gatheringOf(MIXED_PATH))
      kit.recoveryState.mockResolvedValue(
        recoveryStateOf({ state: 'Waiting', attemptId: BigInt(5), nextAttemptId: BigInt(6) })
      )
      await settle(CHECKLIST_POLL_MS)
      expect(view?.byTestId('checklist-void-slot')).not.toBeNull()
      expect(view?.byTestId('checklist-poll-failed')).toBeNull()

      kit.recoveryState.mockRejectedValue(new Error('node unavailable'))
      await settle(CHECKLIST_POLL_MS)

      expect(view?.byTestId('checklist-poll-failed')).not.toBeNull()
      expect(view?.byTestId('checklist-poll-retry')).not.toBeNull()
      expect(view?.byTestId('checklist-gather-again')).toBeNull()
    })

    it('wipes where another attempt waits though the counter still names this request', async () => {
      await open(MIXED_PATH, gatheringOf(MIXED_PATH, 3))
      kit.recoveryState.mockResolvedValue(
        recoveryStateOf({ state: 'Waiting', attemptId: BigInt(2), nextAttemptId: BigInt(3) })
      )

      await settle(CHECKLIST_POLL_MS)

      expect(wipe).toHaveBeenCalledWith(
        CHAIN_ID,
        ACCOUNT,
        'another-attempt-opened',
        expect.anything()
      )
      expect(view?.byTestId('checklist-void-slot')).not.toBeNull()
    })

    it('wipes where the attempt counter moved past the request though no attempt waits', async () => {
      await open(MIXED_PATH, gatheringOf(MIXED_PATH))
      kit.recoveryState.mockResolvedValue(
        recoveryStateOf({ state: 'Cancelled', attemptId: BigInt(1), nextAttemptId: BigInt(2) })
      )

      await settle(CHECKLIST_POLL_MS)

      expect(wipe).toHaveBeenCalledWith(
        CHAIN_ID,
        ACCOUNT,
        'another-attempt-opened',
        expect.anything()
      )
    })

    it('wipes nothing while the account holds no attempt and the counter waits on this request', async () => {
      await open(MIXED_PATH, withReplies(gatheringOf(MIXED_PATH), [1]))

      await settle(3 * CHECKLIST_POLL_MS)

      expect(wipe).not.toHaveBeenCalled()
      expect((await storedSession(world.records))?.value.state).toBe('live')
      expect(view?.byTestId('checklist-rows')).not.toBeNull()
    })
  })

  describe('the setup changes', () => {
    it('wipes the session with the setup reason and reads the setup again at the readout', async () => {
      const gathering = withReplies(gatheringOf(MIXED_PATH), [1])
      const forgetPassword = jest.fn()
      const seeded = await open(MIXED_PATH, gathering, {
        forgetPassword,
        readPassword: () => PASSWORD
      })
      kit.recoveryState.mockResolvedValue(recoveryStateOf({ setupNonce: BigInt(2) }))

      await settle(CHECKLIST_POLL_MS)

      expect(wipe).toHaveBeenCalledTimes(1)
      expect(wipe).toHaveBeenCalledWith(CHAIN_ID, ACCOUNT, 'setup-changed', seeded.revision)
      expect(view?.byTestId('checklist-wiped-title')?.textContent).toBe(
        t(`${RECORDS}.setupChangedTitle`)
      )
      expect(view?.byTestId('checklist-gather-again')).toBeNull()
      expect(view?.byTestId('checklist-read-setup-again')?.textContent).toBe(
        t(`${DEATHS}.readSetupAgain`)
      )
      await expectNoApprovalLeft(gathering)

      await view?.press('checklist-read-setup-again')

      expect(forgetPassword).toHaveBeenCalledWith(CHAIN_ID, ACCOUNT)
      const cache = await world.records.decryptedSetupCache(CHAIN_ID, ACCOUNT).read()
      expect(cache.status).not.toBe('present')
      expect(await storedSession(world.records)).toBeNull()
      expect(view?.lastPath()).toBe(
        `/${WEB_ROUTES.socialRecoveryRecoveryReadout}?account=${ACCOUNT}`
      )
    })
  })

  describe('the ceremonies of a dead request', () => {
    it('removes the claim request and its report, a report that lands after the wipe included', async () => {
      const gathering = gatheringOf(TWO_ROWS)
      await open(TWO_ROWS, gathering)
      await view?.press('checklist-row-0-phone')
      const [id] = deps.requestIds
      expect((await world.records.ceremonyRequest(id).read()).status).toBe('present')

      // The holder returns from the ceremony tab before its report is written.
      view?.unmount()
      view = await mountChecklist({
        records: world.records,
        client: kit.state,
        deps,
        search: { account: ACCOUNT, ceremony: id }
      })
      kit.recoveryState.mockResolvedValue(recoveryStateOf({ setupNonce: BigInt(2) }))
      await settle(CHECKLIST_POLL_MS)

      expect(view.byTestId('checklist-wiped-title')?.textContent).toBe(
        t(`${RECORDS}.setupChangedTitle`)
      )
      expect((await world.records.ceremonyRequest(id).read()).status).not.toBe('present')

      await outside(() =>
        deps.channel.report(id, 'createClaim', passed({ reply: replyOf(gathering, 0) }))
      )
      await settle()

      expect(await deps.reportStore.get(ceremonyResultKey(id), undefined)).toBeUndefined()
      expect(kit.addApproverReply).not.toHaveBeenCalled()
      await expectNoApprovalLeft(gathering)
    })
  })

  describe('the setup is read again', () => {
    it('keeps the wiped line and the password where the cache cannot be wiped, and a retry reads the setup again', async () => {
      const forgetPassword = jest.fn()
      await open(MIXED_PATH, withReplies(gatheringOf(MIXED_PATH), [1]), {
        forgetPassword,
        readPassword: () => PASSWORD
      })
      kit.recoveryState.mockResolvedValue(recoveryStateOf({ setupNonce: BigInt(2) }))
      await settle(CHECKLIST_POLL_MS)
      expect(view?.byTestId('checklist-read-setup-again')).not.toBeNull()

      const cacheOf = world.records.decryptedSetupCache
      jest
        .spyOn(world.records, 'decryptedSetupCache')
        .mockImplementationOnce((chainId, account) => ({
          ...cacheOf(chainId, account),
          wipe: () => Promise.reject(new Error('storage unavailable'))
        }))
      await view?.press('checklist-read-setup-again')

      expect(view?.byTestId('checklist-gather-again-failed')?.textContent).toContain(
        t('socialRecovery.client.unavailableTitle')
      )
      expect(view?.byTestId('checklist-read-setup-again')).not.toBeNull()
      expect((await storedSession(world.records))?.value).toMatchObject({
        state: 'wiped',
        reason: 'setup-changed'
      })
      expect(forgetPassword).not.toHaveBeenCalled()
      expect(view?.lastPath()).not.toBe(
        `/${WEB_ROUTES.socialRecoveryRecoveryReadout}?account=${ACCOUNT}`
      )

      await view?.press('checklist-read-setup-again')

      expect(forgetPassword).toHaveBeenCalledWith(CHAIN_ID, ACCOUNT)
      expect((await world.records.decryptedSetupCache(CHAIN_ID, ACCOUNT).read()).status).not.toBe(
        'present'
      )
      expect(await storedSession(world.records)).toBeNull()
      expect(view?.lastPath()).toBe(
        `/${WEB_ROUTES.socialRecoveryRecoveryReadout}?account=${ACCOUNT}`
      )
    })
  })

  describe('the stored ceremonies of a dead request', () => {
    /** A claim request another visit of the checklist stored, under an id this tab never held. */
    const storedClaim = (attempt: number, account = ACCOUNT) => ({
      call: 'createClaim' as const,
      method: 'passkey',
      account,
      chainId: CHAIN_ID,
      request: requestOf(gatheringOf(TWO_ROWS, attempt, account), 0),
      params: { handOff: false }
    })

    it('removes every claim request of the dead request with its report, and keeps those of another request', async () => {
      await open(TWO_ROWS, gatheringOf(TWO_ROWS), {
        storedEntries: () => world.storage.getAll()
      })
      const claims = {
        'dead-one': storedClaim(1),
        'dead-two': storedClaim(1),
        'other-attempt': storedClaim(7),
        'other-account': storedClaim(1, SECOND_ACCOUNT)
      }
      await outside(() =>
        Promise.all(
          Object.entries(claims).map(async ([id, claim]) => {
            await world.records.ceremonyRequest(id).write(claim)
            await deps.channel.report(id, 'createClaim', failed('browser-error', 'NotAllowedError'))
          })
        )
      )
      const present = async (id: string) =>
        (await world.records.ceremonyRequest(id).read()).status === 'present'
      const reported = async (id: string) =>
        (await deps.reportStore.get(ceremonyResultKey(id), undefined)) !== undefined

      kit.recoveryState.mockResolvedValue(recoveryStateOf({ setupNonce: BigInt(2) }))
      await settle(CHECKLIST_POLL_MS)
      await settle()

      expect(view?.byTestId('checklist-wiped-title')?.textContent).toBe(
        t(`${RECORDS}.setupChangedTitle`)
      )
      expect(await present('dead-one')).toBe(false)
      expect(await present('dead-two')).toBe(false)
      expect(await reported('dead-one')).toBe(false)
      expect(await reported('dead-two')).toBe(false)
      expect(await present('other-attempt')).toBe(true)
      expect(await reported('other-attempt')).toBe(true)
      expect(await present('other-account')).toBe(true)
      expect(await reported('other-account')).toBe(true)
    })
  })

  describe('the rows while a death is being written', () => {
    it('holds every launch and row action until the wipe returns', async () => {
      await open(MIXED_PATH, gatheringOf(MIXED_PATH))
      const actions = [
        'checklist-row-0-answer-here',
        'checklist-row-0-phone',
        'checklist-row-1-mark-declined'
      ]
      actions.forEach((id) => expect(view?.isDisabled(id)).toBe(false))

      const release = world.storage.hold('recoverySession')
      kit.recoveryState.mockResolvedValue(recoveryStateOf({ setupNonce: BigInt(2) }))
      await settle(CHECKLIST_POLL_MS)

      expect(wipe).toHaveBeenCalledTimes(1)
      expect(view?.byTestId('checklist-rows')).not.toBeNull()
      actions.forEach((id) => expect(view?.isDisabled(id)).toBe(true))

      release()
      await settle()

      expect(view?.byTestId('checklist-wiped-title')?.textContent).toBe(
        t(`${RECORDS}.setupChangedTitle`)
      )
    })

    it('holds continue on a satisfied path until the wipe returns', async () => {
      await open(MIXED_PATH, withReplies(gatheringOf(MIXED_PATH), [0, 1, 2, 3]))
      expect(view?.isDisabled('checklist-continue')).toBe(false)

      const release = world.storage.hold('recoverySession')
      kit.recoveryState.mockResolvedValue(
        recoveryStateOf({ state: 'Waiting', attemptId: BigInt(5), nextAttemptId: BigInt(6) })
      )
      await settle(CHECKLIST_POLL_MS)

      expect(wipe).toHaveBeenCalledTimes(1)
      expect(view?.byTestId('checklist-satisfied')).not.toBeNull()
      expect(view?.isDisabled('checklist-continue')).toBe(true)

      release()
      await settle()

      expect(view?.byTestId('checklist-void-slot')).not.toBeNull()
    })
  })

  describe('the outcomes of a dead request', () => {
    const chipOf = (place: number) => view?.byTestId(`checklist-row-${place}-chip`)?.textContent
    const chip = (name: string) => t(`socialRecovery.status.collection.${name}`)

    /** The holder comes back from the ceremony tab under the claim's id. */
    const returnTo = async (id: string) => {
      view?.unmount()
      view = await mountChecklist({
        records: world.records,
        client: kit.state,
        deps,
        search: { account: ACCOUNT, ceremony: id }
      })
    }

    /** A new request opens past the deadline that killed the last one. */
    const gatherAgainPastDeadline = async () => {
      const fresh = gatheringOf(TWO_ROWS, 2)
      kit.initRecoveryGathering.mockResolvedValueOnce({
        ...fresh,
        request: {
          ...fresh.request,
          validUntil: String(Math.floor(PAST_DEADLINE / 1000) + DAY_SECONDS)
        }
      })
      await view?.press('checklist-gather-again')
      await settle()
      expect(view?.byTestId('checklist-row-0')).not.toBeNull()
    }

    it('reads a required row that did not answer as not asked on the next gathering, with abandon', async () => {
      await open(TWO_ROWS, gatheringOf(TWO_ROWS))
      await view?.press('checklist-row-0-phone')
      const [id] = deps.requestIds
      await deps.channel.report(id, 'createClaim', failed('browser-error', 'NotAllowedError'))
      await returnTo(id)
      expect(chipOf(0)).toBe(chip('didNotAnswer'))
      expect(view?.byTestId('checklist-cannot-complete')).toBeNull()

      jest.setSystemTime(PAST_DEADLINE)
      await settle(CHECKLIST_POLL_MS)
      expect(view?.byTestId('checklist-wiped-title')?.textContent).toBe(
        t(`${RECORDS}.expiredTitle`)
      )
      await gatherAgainPastDeadline()

      expect(chipOf(0)).toBe(chip('notAsked'))
      expect(view?.byTestId('checklist-unsatisfied-didNotAnswer')).toBeNull()
      expect(view?.byTestId('checklist-cannot-complete')).not.toBeNull()
    })

    it('keeps no outcome from a failed report that lands after the wipe', async () => {
      await open(TWO_ROWS, gatheringOf(TWO_ROWS))
      await view?.press('checklist-row-0-phone')
      const [id] = deps.requestIds
      await returnTo(id)
      expect(view?.byTestId('checklist-undelivered')).not.toBeNull()

      kit.recoveryState.mockResolvedValue(
        recoveryStateOf({ state: 'Waiting', attemptId: BigInt(5), nextAttemptId: BigInt(6) })
      )
      await settle(CHECKLIST_POLL_MS)
      expect(view?.byTestId('checklist-void-slot')).not.toBeNull()

      await outside(() =>
        deps.channel.report(id, 'createClaim', failed('browser-error', 'NotAllowedError'))
      )
      await settle()
      expect(await deps.reportStore.get(ceremonyResultKey(id), undefined)).toBeUndefined()

      // The slot frees, and the next request names the attempt the account opens next.
      kit.recoveryState.mockResolvedValue(
        recoveryStateOf({ state: 'Cancelled', attemptId: BigInt(5), nextAttemptId: BigInt(6) })
      )
      await settle(CHECKLIST_POLL_MS)
      kit.initRecoveryGathering.mockResolvedValueOnce(gatheringOf(TWO_ROWS, 6))
      kit.recoveryState.mockResolvedValue(recoveryStateOf({ nextAttemptId: BigInt(6) }))
      await view?.press('checklist-gather-again')
      await settle()
      expect(view?.byTestId('checklist-row-0')).not.toBeNull()

      expect(chipOf(0)).toBe(chip('notAsked'))
      expect(view?.byTestId('checklist-unsatisfied-didNotAnswer')).toBeNull()
      expect(view?.byTestId('checklist-cannot-complete')).not.toBeNull()
    })

    it('keeps no undelivered claim of the dead request on the next gathering, and launches none with it', async () => {
      await open(TWO_ROWS, gatheringOf(TWO_ROWS))
      await view?.press('checklist-row-0-phone')
      const [id] = deps.requestIds
      await returnTo(id)
      expect(view?.byTestId('checklist-undelivered')).not.toBeNull()
      expect(chipOf(0)).toBe(chip('waiting'))

      // The report never comes, and the deadline ends the request.
      jest.setSystemTime(PAST_DEADLINE)
      await settle(CHECKLIST_POLL_MS)
      expect(view?.byTestId('checklist-wiped-title')?.textContent).toBe(
        t(`${RECORDS}.expiredTitle`)
      )
      await gatherAgainPastDeadline()

      expect(chipOf(0)).toBe(chip('notAsked'))
      expect(view?.byTestId('checklist-undelivered')).toBeNull()
      expect(view?.byTestId('checklist-undelivered-retry')).toBeNull()
      expect(deps.requestIds).toEqual([id])
      expect((await world.records.ceremonyRequest(id).read()).status).not.toBe('present')

      // A claim on the new gathering asks for the new request.
      await view?.press('checklist-row-0-phone')
      expect(deps.requestIds).toHaveLength(2)
      const launched = await world.records.ceremonyRequest(deps.requestIds[1]).read()
      expect(
        launched.status === 'present' &&
          launched.value.call === 'createClaim' &&
          launched.value.request.attemptId
      ).toBe('2')
    })
  })
})
