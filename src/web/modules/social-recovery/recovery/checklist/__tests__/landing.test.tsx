/**
 * @jest-environment jsdom
 *
 * The request's own submission found on the chain, on Jest's fake clock: the
 * attempt that carries the request's predicted id and the hash of its payload
 * lands the session and the holder goes on to the wait, whatever state that
 * attempt is in. An attempt that differs in either, the id or the payload
 * hash, is another holder's and voids the request.
 */
import type { Gathering, Hex } from '@web/modules/social-recovery/sdk-interfaces'

import type {
  FakeKit,
  Mounted,
  ScriptedRecoveryState,
  TestRecords
} from '@web/modules/social-recovery/recovery/checklist/__tests__/harness'
import {
  ACCOUNT,
  CHAIN_ID,
  depsOf,
  fakeKit,
  gatheringOf,
  MIXED_PATH,
  mountChecklist,
  NOW,
  recoveryStateOf,
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
const { keccak256 }: typeof import('viem') = require('viem')
const {
  WEB_ROUTES
}: typeof import('@common/modules/router/constants/common') = require('@common/modules/router/constants/common')
const {
  CHECKLIST_POLL_MS
}: typeof import('@web/modules/social-recovery/recovery/checklist/constants') = require('@web/modules/social-recovery/recovery/checklist/constants')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const PAYLOAD: Hex = '0xabcdef'
const OTHER_PAYLOAD: Hex = '0x123456'

/** The gathering of attempt one, with the payload its submission would carry. */
const withPayload = (gathering: Gathering, payload: Hex = PAYLOAD): Gathering => ({
  ...gathering,
  request: { ...gathering.request, payload }
})

const WAIT_PATH = `/${WEB_ROUTES.socialRecoveryRecoveryWait}?account=${ACCOUNT}`

describe('the request lands on the chain', () => {
  let view: Mounted | undefined
  let world: TestRecords
  let kit: FakeKit
  let land: jest.SpyInstance
  let wipe: jest.SpyInstance

  const open = async (gathering: Gathering) => {
    await seedCache(world.records, MIXED_PATH)
    const seeded = await seedSession(world.records, gathering)
    kit = fakeKit(MIXED_PATH)
    view = await mountChecklist({
      records: world.records,
      client: kit.state,
      deps: depsOf({ now: () => Date.now() })
    })
    return seeded
  }

  /** The account's attempt as the next poll reads it. */
  const chainReads = (attempt: ScriptedRecoveryState) => {
    kit.recoveryState.mockResolvedValue(recoveryStateOf(attempt))
  }

  beforeEach(async () => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
    world = testRecords()
    await seedEntry(world.records)
    land = jest.spyOn(world.records, 'landSubmission')
    wipe = jest.spyOn(world.records, 'wipeRecoverySession')
  })

  afterEach(() => {
    view?.unmount()
    view = undefined
    jest.useRealTimers()
  })

  const states = ['Waiting', 'Cancelled', 'Consumed'] as const
  states.forEach((state) => {
    it(`lands the session in one records call and goes on to the wait where its own attempt reads ${state}`, async () => {
      const gathering = withPayload(withReplies(gatheringOf(MIXED_PATH), [0, 1, 2, 3]))
      const seeded = await open(gathering)
      expect(view?.byTestId('checklist-rows')).not.toBeNull()

      chainReads({
        state,
        attemptId: BigInt(1),
        nextAttemptId: BigInt(2),
        payloadHash: keccak256(PAYLOAD)
      })
      await settle(CHECKLIST_POLL_MS)

      expect(land).toHaveBeenCalledTimes(1)
      expect(land).toHaveBeenCalledWith(CHAIN_ID, ACCOUNT, seeded.revision)
      expect(wipe).not.toHaveBeenCalled()
      expect((await storedSession(world.records))?.value).toEqual({
        state: 'landed',
        account: ACCOUNT
      })
      expect(view?.navigate).toHaveBeenLastCalledWith(WAIT_PATH, { replace: true })
      expect(view?.byTestId('checklist-rows')).toBeNull()
      expect(view?.byTestId('checklist-wiped')).toBeNull()

      // The landed session is no live one: nothing reads it again or lands it twice.
      kit.recoveryState.mockClear()
      await settle(CHECKLIST_POLL_MS)
      await settle(CHECKLIST_POLL_MS)
      expect(kit.recoveryState).not.toHaveBeenCalled()
      expect(land).toHaveBeenCalledTimes(1)
    })
  })

  it('voids the request where an attempt with its predicted id carries another payload', async () => {
    const seeded = await open(withPayload(gatheringOf(MIXED_PATH)))

    chainReads({
      state: 'Waiting',
      attemptId: BigInt(1),
      nextAttemptId: BigInt(2),
      payloadHash: keccak256(OTHER_PAYLOAD)
    })
    await settle(CHECKLIST_POLL_MS)

    expect(land).not.toHaveBeenCalled()
    expect(wipe).toHaveBeenCalledTimes(1)
    expect(wipe).toHaveBeenCalledWith(CHAIN_ID, ACCOUNT, 'another-attempt-opened', seeded.revision)
    expect(view?.byTestId('checklist-wiped-title')?.textContent).toBe(
      t('socialRecovery.records.voidTitle')
    )
    expect(view?.byTestId('checklist-void-slot')).not.toBeNull()
    expect(view?.navigate).not.toHaveBeenCalledWith(WAIT_PATH, expect.anything())
  })

  it('voids the request where an ended attempt with its predicted id carries another payload', async () => {
    await open(withPayload(gatheringOf(MIXED_PATH)))

    chainReads({
      state: 'Cancelled',
      attemptId: BigInt(1),
      nextAttemptId: BigInt(2),
      payloadHash: keccak256(OTHER_PAYLOAD)
    })
    await settle(CHECKLIST_POLL_MS)

    expect(land).not.toHaveBeenCalled()
    expect(wipe).toHaveBeenCalledWith(
      CHAIN_ID,
      ACCOUNT,
      'another-attempt-opened',
      expect.anything()
    )
  })

  it('voids the request where an attempt of another id carries the same payload', async () => {
    await open(withPayload(gatheringOf(MIXED_PATH)))

    chainReads({
      state: 'Waiting',
      attemptId: BigInt(2),
      nextAttemptId: BigInt(3),
      payloadHash: keccak256(PAYLOAD)
    })
    await settle(CHECKLIST_POLL_MS)

    expect(land).not.toHaveBeenCalled()
    expect(wipe).toHaveBeenCalledWith(
      CHAIN_ID,
      ACCOUNT,
      'another-attempt-opened',
      expect.anything()
    )
    expect(view?.byTestId('checklist-void-slot')).not.toBeNull()
  })

  it('holds continue while the landing is being written, then goes on to the wait', async () => {
    await open(withPayload(withReplies(gatheringOf(MIXED_PATH), [0, 1, 2, 3])))
    expect(view?.byTestId('checklist-satisfied')).not.toBeNull()
    expect(view?.isDisabled('checklist-continue')).toBe(false)

    const release = world.storage.hold('recoverySession')
    chainReads({
      state: 'Waiting',
      attemptId: BigInt(1),
      nextAttemptId: BigInt(2),
      payloadHash: keccak256(PAYLOAD)
    })
    await settle(CHECKLIST_POLL_MS)

    expect(land).toHaveBeenCalledTimes(1)
    expect(view?.byTestId('checklist-rows')).not.toBeNull()
    expect(view?.isDisabled('checklist-continue')).toBe(true)
    expect(view?.navigate).not.toHaveBeenCalledWith(WAIT_PATH, expect.anything())

    release()
    await settle()

    expect(view?.navigate).toHaveBeenLastCalledWith(WAIT_PATH, { replace: true })
    expect((await storedSession(world.records))?.value.state).toBe('landed')
  })
})
