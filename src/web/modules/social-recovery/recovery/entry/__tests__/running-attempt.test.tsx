/**
 * @jest-environment jsdom
 *
 * The band of an attempt already running against the looked-up account, on
 * the account step after the confirmation. The registry's reads are a fake
 * the page opens in place of its own provider; every other edge is the
 * harness's.
 */
import type {
  ActionState,
  Address,
  BlockHeader,
  Handover,
  Hex
} from '@web/modules/social-recovery/sdk-interfaces'
import type { AttemptEvents, AttemptScan } from '@web/modules/social-recovery/shared/client'
import {
  BASIC,
  CHAIN_ID,
  confirmLost,
  DAILY,
  DESCRIPTOR,
  gatheringFor,
  keyOf,
  kit,
  LOST,
  LOST_KEY,
  mountAccountStep,
  navigate,
  outside,
  records,
  resetEdges,
  searchOf,
  setupStateOf,
  setWallet,
  smartAccount,
  SMART_KEY,
  storedEntry,
  t,
  VAULT
} from '@web/modules/social-recovery/recovery/entry/__tests__/harness'
import type { Mounted } from '@web/modules/social-recovery/recovery/entry/__tests__/harness'
import { deferred } from '@web/modules/social-recovery/shared/chrome/__fixtures__/deferred'

// Loaded after the harness, which gives jsdom the `TextEncoder` viem reads when it loads.
/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const { getAddress, keccak256 }: typeof import('viem') = require('viem')
const {
  cancelPathOf
}: typeof import('@web/modules/social-recovery/cancel') = require('@web/modules/social-recovery/cancel')
const {
  waitPathOf
}: typeof import('@web/modules/social-recovery/recovery/checklist/search') = require('@web/modules/social-recovery/recovery/checklist/search')
const {
  renderDateTimeInZone
}: typeof import('@web/modules/social-recovery/shared/display') = require('@web/modules/social-recovery/shared/display')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

/** The registry's reads the page opens, one mock each, so a test scripts each call. */
interface FakeAttemptReads {
  latestBlock: jest.Mock<Promise<BlockHeader>, []>
  stateOf: jest.Mock<Promise<ActionState>, [Address, number]>
  attemptEventsOf: jest.Mock<Promise<AttemptEvents>, [Address, bigint, AttemptScan]>
  blockTime: jest.Mock<Promise<number>, [number]>
  handoverOf: jest.Mock<Handover | undefined, [Hex]>
}

const mockReads: FakeAttemptReads = {
  latestBlock: jest.fn(),
  stateOf: jest.fn(),
  attemptEventsOf: jest.fn(),
  blockTime: jest.fn(),
  handoverOf: jest.fn()
}
const mockClose = jest.fn()

jest.mock('@web/modules/social-recovery/shared/client/watcher-reads', () => ({
  ...jest.requireActual('@web/modules/social-recovery/shared/client/watcher-reads'),
  // The page only asks whether the build reads a deployed registry; the connection below is the fake.
  watchedDeploymentOf: () => ({}),
  watcherConnectionFor: () => ({
    reads: {
      latestBlock: () => mockReads.latestBlock(),
      stateOf: (account: Address, block: number) => mockReads.stateOf(account, block),
      attemptEventsOf: (account: Address, attemptId: bigint, scan: AttemptScan) =>
        mockReads.attemptEventsOf(account, attemptId, scan),
      blockTime: (block: number) => mockReads.blockTime(block),
      handoverOf: (payload: Hex) => mockReads.handoverOf(payload)
    },
    providerKey: 'sepolia',
    destroy: () => mockClose()
  })
}))
jest.mock('@web/modules/social-recovery/shared/client/extension-provider', () => ({
  ...jest.requireActual('@web/modules/social-recovery/shared/client/extension-provider'),
  networkOf: () => ({ chainId: 11155111n, name: 'Sepolia', rpcUrls: ['https://rpc.test'] }),
  providerKeyOf: () => 'sepolia'
}))

const LOGGED_IN = searchOf('logged-in', BASIC)
const FRESH_INSTALL = searchOf('fresh-install', BASIC)

/** A key neither this wallet nor its fast track holds. */
const STRANGER: Address = getAddress('0x5e7a000000000000000000000000000000000031')

const PAYLOAD: Hex = '0x1234'
const ATTEMPT_ID = 7n
const SETUP_NONCE = 1n
const CONSUMABLE_AFTER = 1_800_432_000
const OPENED_AT = 1_800_000_000
const OPENING_BLOCK = 250

const waitingState = (): ActionState => ({
  setupCommitment: `0x${'ab'.repeat(32)}`,
  setupNonce: SETUP_NONCE,
  nextAttemptId: ATTEMPT_ID + 1n,
  setupCommittedAtBlock: 100,
  attempt: {
    state: 'Waiting',
    attemptId: ATTEMPT_ID,
    setupNonce: SETUP_NONCE,
    consumableAfter: CONSUMABLE_AFTER,
    payloadHash: keccak256(PAYLOAD),
    order: { token: LOST_KEY, amount: 0n, payee: LOST_KEY },
    usedMethods: [],
    ignoresPause: false
  }
})

const opening = (): AttemptEvents => ({
  started: {
    kind: 'attempt-started',
    account: LOST,
    action: DESCRIPTOR.action,
    attemptId: ATTEMPT_ID,
    setupNonce: SETUP_NONCE,
    setupBody: '0x00',
    usedPlaces: [],
    usedMethods: [],
    payload: PAYLOAD,
    order: { token: LOST_KEY, amount: 0n, payee: LOST_KEY },
    consumableAfter: CONSUMABLE_AFTER,
    at: {
      blockNumber: OPENING_BLOCK,
      blockHash: `0x${'01'.repeat(32)}`,
      logIndex: 0,
      transactionHash: `0x${'02'.repeat(32)}`,
      removed: false
    }
  }
})

/** The registry answers an attempt waiting whose opening hands the account to the key. */
const attemptTo = (newKey: Address) => {
  mockReads.latestBlock.mockImplementation(async () => ({
    number: 300,
    timestamp: OPENED_AT + 100,
    hash: `0x${'cd'.repeat(32)}`
  }))
  mockReads.stateOf.mockImplementation(async () => waitingState())
  mockReads.attemptEventsOf.mockImplementation(async () => opening())
  mockReads.blockTime.mockImplementation(async () => OPENED_AT)
  mockReads.handoverOf.mockImplementation(() => ({
    newAuthority: newKey,
    removedAuthority: LOST_KEY
  }))
}

const finishes = () => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const { date } = renderDateTimeInZone(CONSUMABLE_AFTER * 1000, timeZone)
  return t('socialRecovery.entry.runningAttempt.lead', { date })
}

/** Opens the account step, looks up the lost account with an attempt running, and confirms it. */
const openRunning = async (search: string = LOGGED_IN): Promise<Mounted> => {
  kit.setupState.mockImplementation(async () => setupStateOf({ attemptActive: true }))
  const page = await mountAccountStep(search)
  await confirmLost(page)
  return page
}

beforeEach(() => {
  resetEdges()
  Object.values(mockReads).forEach((read) => read.mockReset())
  mockClose.mockReset()
  attemptTo(STRANGER)
})

describe('the running attempt band', () => {
  it('names the attempt with its end and its key, and offers no continue to the readout', async () => {
    const page = await openRunning()
    expect(page.textOf('entry-running-title')).toBe(t('socialRecovery.entry.runningAttempt.title'))
    expect(page.textOf('entry-running-lead')).toBe(finishes())
    expect(page.textOf('entry-running-key')).toContain(STRANGER)
    expect(page.has('entry-continue')).toBe(false)
    expect(page.text()).not.toMatch(/guardian/i)
    expect(mockReads.attemptEventsOf).toHaveBeenCalledWith(
      LOST,
      ATTEMPT_ID,
      expect.objectContaining({ from: 100, to: 300, until: 'opening' })
    )
    page.unmount()
    expect(mockClose).toHaveBeenCalled()
  })

  it('reads your own recovery where the new key is one the wallet holds', async () => {
    attemptTo(SMART_KEY)
    const page = await openRunning()
    expect(page.textOf('entry-running-yours')).toBe(
      t('socialRecovery.entry.runningAttempt.yoursWallet')
    )
    expect(page.has('entry-running-continue')).toBe(true)
    expect(page.has('entry-running-not-yours')).toBe(false)
    expect(page.has('entry-running-cancel')).toBe(false)
    page.unmount()
  })

  it('reads your own recovery by the fast track where the new key is the one the fast track made', async () => {
    attemptTo(BASIC)
    const page = await openRunning(FRESH_INSTALL)
    expect(page.textOf('entry-running-yours')).toBe(
      t('socialRecovery.entry.runningAttempt.yoursSeed')
    )
    page.unmount()
  })

  it('reads the key of a logged-in account as the wallet own, not the fast track', async () => {
    attemptTo(BASIC)
    const page = await openRunning(LOGGED_IN)
    expect(page.textOf('entry-running-yours')).toBe(
      t('socialRecovery.entry.runningAttempt.yoursWallet')
    )
    page.unmount()
  })

  it('reads wait it out for a key that is not this wallet and no key of the account is held', async () => {
    const page = await openRunning()
    expect(page.textOf('entry-running-not-yours')).toBe(
      t('socialRecovery.entry.runningAttempt.notYours')
    )
    expect(page.textOf('entry-running-wait-it-out')).toBe(
      t('socialRecovery.entry.runningAttempt.waitItOut')
    )
    expect(page.has('entry-running-cancel')).toBe(false)
    expect(page.has('entry-running-yours')).toBe(false)
    page.unmount()
  })

  it('offers the cancel only where a key the keystore holds is an authority of the account, and opens its tab', async () => {
    setWallet({
      accounts: [DAILY, VAULT, smartAccount(LOST, LOST_KEY, 'Lost')],
      keys: [keyOf(BASIC), keyOf(SMART_KEY), keyOf(LOST_KEY)]
    })
    const page = await openRunning()
    expect(kit.isAuthority).toHaveBeenCalledWith(LOST_KEY)
    expect(page.has('entry-running-wait-it-out')).toBe(false)
    expect(page.textOf('entry-running-cancel-body')).toBe(
      t('socialRecovery.entry.runningAttempt.cancelExitBody')
    )
    await page.press('entry-running-cancel')
    expect(navigate).toHaveBeenCalledWith(cancelPathOf(LOST))
    page.unmount()
  })

  it('offers no cancel where the held key of the account is not an authority', async () => {
    setWallet({
      accounts: [DAILY, VAULT, smartAccount(LOST, LOST_KEY, 'Lost')],
      keys: [keyOf(BASIC), keyOf(SMART_KEY), keyOf(LOST_KEY)]
    })
    kit.isAuthority.mockImplementation(async () => false)
    const page = await openRunning()
    expect(page.has('entry-running-cancel')).toBe(false)
    expect(page.has('entry-running-wait-it-out')).toBe(true)
    page.unmount()
  })

  it('lets the dormant reading win: no band, no own recovery claim and no cancel', async () => {
    attemptTo(SMART_KEY)
    kit.isAuthorized.mockResolvedValueOnce(false)
    const page = await openRunning()
    expect(page.has('entry-dormant-running')).toBe(true)
    expect(page.has('entry-running')).toBe(false)
    expect(page.has('entry-running-yours')).toBe(false)
    expect(page.has('entry-running-cancel')).toBe(false)
    expect(mockReads.stateOf).not.toHaveBeenCalled()
    page.unmount()
  })

  it('draws the end and no key and no claim while the opening has not returned', async () => {
    attemptTo(SMART_KEY)
    const held = deferred<AttemptEvents>()
    mockReads.attemptEventsOf.mockImplementation(() => held.promise)
    const page = await openRunning()
    expect(page.textOf('entry-running-lead')).toBe(finishes())
    expect(page.textOf('entry-running-key-pending')).toBe(
      t('socialRecovery.watcher.banner.newKeyPending')
    )
    expect(page.has('entry-running-key')).toBe(false)
    expect(page.has('entry-running-yours')).toBe(false)
    expect(page.has('entry-running-not-yours')).toBe(false)
    await outside(() => held.resolve(opening()))
    expect(page.has('entry-running-yours')).toBe(true)
    page.unmount()
  })

  it('draws a failed opening read with retry, never a key; the retry that answers names it', async () => {
    mockReads.attemptEventsOf.mockRejectedValueOnce(new Error('rpc down'))
    const page = await openRunning()
    expect(page.textOf('entry-running-lead')).toBe(finishes())
    expect(page.has('entry-running-opening-failed')).toBe(true)
    expect(page.has('entry-running-key')).toBe(false)
    expect(page.has('entry-running-not-yours')).toBe(false)
    await page.press('entry-running-opening-failed-retry')
    expect(page.textOf('entry-running-key')).toContain(STRANGER)
    page.unmount()
  })

  it('names no key for an opening whose payload does not hash to the attempt', async () => {
    mockReads.attemptEventsOf.mockImplementation(async () => {
      const events = opening()
      return events.started ? { started: { ...events.started, payload: '0x99' } } : events
    })
    const page = await openRunning()
    expect(page.has('entry-running-opening-failed')).toBe(true)
    expect(page.has('entry-running-key')).toBe(false)
    page.unmount()
  })

  it('draws a failed registry read with retry, never as no attempt', async () => {
    mockReads.stateOf.mockRejectedValueOnce(new Error('rpc down'))
    const page = await openRunning()
    expect(page.has('entry-running-failed')).toBe(true)
    expect(page.has('entry-running-lead')).toBe(false)
    expect(page.has('entry-continue')).toBe(false)
    await page.press('entry-running-failed-retry')
    expect(page.textOf('entry-running-lead')).toBe(finishes())
    page.unmount()
  })

  it('offers continue to the readout once the registry holds no attempt waiting any more', async () => {
    mockReads.stateOf.mockImplementation(async () => ({
      ...waitingState(),
      attempt: { ...waitingState().attempt, state: 'Cancelled' }
    }))
    const page = await openRunning()
    expect(page.has('entry-running')).toBe(false)
    expect(page.has('entry-continue')).toBe(true)
    page.unmount()
  })

  it('continues with that key: keeps the countdown the chain describes and opens the wait', async () => {
    attemptTo(SMART_KEY)
    const page = await openRunning()
    await page.press('entry-running-continue')
    const countdown = await records().countdown(CHAIN_ID, LOST).read()
    expect(countdown.status === 'present' && countdown.value).toEqual({
      account: LOST,
      attemptId: ATTEMPT_ID.toString(),
      setupNonce: SETUP_NONCE.toString(),
      payloadHash: keccak256(PAYLOAD)
    })
    expect(countdown.status === 'present' && countdown.savedAt).toBe(OPENED_AT * 1000)
    expect(await storedEntry(LOST)).toEqual({
      account: LOST,
      route: 'logged-in',
      receivingAccount: VAULT.addr
    })
    expect(navigate).toHaveBeenCalledWith(waitPathOf(LOST))
    page.unmount()
  })

  it('keeps a live gathering of the account rather than overwriting it, and still opens the wait', async () => {
    attemptTo(SMART_KEY)
    const page = await openRunning()
    await records().recoverySession(CHAIN_ID, LOST).write(gatheringFor(LOST), null)
    await page.press('entry-running-continue')
    const session = await records().recoverySession(CHAIN_ID, LOST).read()
    expect(session.status === 'present' && session.value.state).toBe('live')
    expect(navigate).toHaveBeenCalledWith(waitPathOf(LOST))
    page.unmount()
  })
})
