/**
 * @jest-environment jsdom
 */
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import {
  attemptCancelled,
  attemptConsumed,
  CHAIN_ID,
  CLAIM_BLOCK,
  claimElsewhere,
  consume,
  elapse,
  executionOf,
  hashElsewhere,
  held,
  landedReceipt,
  minedAndReverted,
  mountWait,
  mountWaitInAnotherPage,
  moveDeviceClock,
  openWorld,
  OTHER_REQUEST,
  OTHER_TX_HASH,
  replacedByAnother,
  START_BLOCK,
  t,
  tick,
  TX_HASH,
  useWaitClock
} from '@web/modules/social-recovery/recovery/wait/__tests__/harness'
import type { Mounted, World } from '@web/modules/social-recovery/recovery/wait/__tests__/harness'
import type { Hex, Notification } from '@web/modules/social-recovery/sdk-interfaces'
import type { ProviderTransactionReceipt } from '@web/modules/social-recovery/shared/client'
import { recordKeys } from '@web/modules/social-recovery/shared/records'

const POLL_MS = 30_000
const REREAD_MS = 5_000
const CLAIM_AGE_MS = 10 * 60_000
/** The block the execution's own claim reads before it, as the fake chain answers it. */
const OWN_CLAIM_BLOCK = START_BLOCK + 8

const donePath = (world: World) =>
  `/${WEB_ROUTES.socialRecoveryRecoveryDone}?account=${world.account}`

/** Holds the execution's receipt until the test releases or fails it. */
const holdReceipt = (world: World) => {
  const receipt = held<ProviderTransactionReceipt>()
  world.kit.receipts.wait.mockImplementation(() => receipt.promise)
  return receipt
}

/** Holds the wallet's window on the send until the test answers its hash or refuses it. */
const holdSend = (world: World) => {
  const hash = held<Hex>()
  world.port.send.mockImplementation(() => hash.promise)
  return hash
}

/** The manager's events from the claim's block answer `fromClaim`; the poll's range reads the chain's events. */
const eventsFromClaim = (world: World, fromClaim: () => Promise<Notification[]>) => {
  world.kit.fetch.mockImplementation(async (_filter: unknown, range: { from: number }) =>
    range.from === CLAIM_BLOCK ? fromClaim() : world.kit.chain.events
  )
}

const claimRangeReads = (world: World) =>
  world.kit.fetch.mock.calls.filter(([, range]) => range.from === CLAIM_BLOCK)

describe('the claim of the execution', () => {
  useWaitClock()
  const views: Mounted[] = []
  const mount = async (mounting: Promise<Mounted>) => {
    const view = await mounting
    views.push(view)
    return view
  }

  afterEach(() => {
    views.splice(0).forEach((view) => view.unmount())
  })

  it('writes the claim on the countdown before the send, with its request id and the block read before it, and the hash after', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdReceipt(world)
    let atSend: Awaited<ReturnType<typeof executionOf>>
    world.port.send.mockImplementation(async () => {
      atSend = await executionOf(world.records, world.account)
      return TX_HASH
    })
    const pressedAt = Date.now()
    const view = await mount(mountWait(world.account))

    await view.press('wait-execute')
    expect(world.port.send).toHaveBeenCalledTimes(1)
    expect(atSend).toEqual({
      requestId: expect.any(String),
      startBlock: OWN_CLAIM_BLOCK,
      claimedAt: pressedAt
    })
    expect(await executionOf(world.records, world.account)).toEqual({
      requestId: atSend?.requestId,
      startBlock: OWN_CLAIM_BLOCK,
      claimedAt: pressedAt,
      transactionHash: TX_HASH
    })
  })

  it("sends a smart account's batch under the claim's own request id", async () => {
    const world = await openWorld({ receiving: 'smart' })
    elapse(world.kit)
    holdReceipt(world)
    const view = await mount(mountWait(world.account))

    await view.press('wait-execute')
    const claim = await executionOf(world.records, world.account)
    expect(world.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(world.port.sendAccountBatch.mock.calls[0][4]).toBe(claim?.requestId)
    expect(claim?.transactionHash).toBe(TX_HASH)
  })

  it('claims over a fresh read where another page moved the countdown between the read and the claim', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdReceipt(world)
    const key = recordKeys.recoverySession(CHAIN_ID, world.account)
    const { get, set } = world.storage
    let moveNextRead = false
    world.storage.get = async (name, fallback) => {
      const stored = await get(name, fallback)
      if (moveNextRead && name === key) {
        moveNextRead = false
        await set(key, { ...(stored as object), revision: '0x0123456789abcdef01234567' })
      }
      return stored
    }
    // The block read comes right before the claim reads the countdown.
    world.kit.receipts.blockNumber.mockImplementationOnce(async () => {
      moveNextRead = true
      return OWN_CLAIM_BLOCK
    })
    const view = await mount(mountWait(world.account))

    await view.press('wait-execute')
    expect(moveNextRead).toBe(false)
    expect(world.port.send).toHaveBeenCalledTimes(1)
    expect((await executionOf(world.records, world.account))?.transactionHash).toBe(TX_HASH)
  })

  it('lets a second page follow the claim with nothing sent, then wait on the hash the first page writes', async () => {
    const world = await openWorld()
    elapse(world.kit)
    const hash = holdSend(world)
    const receipt = holdReceipt(world)
    const first = await mount(mountWait(world.account))
    await first.press('wait-execute')
    expect(world.port.send).toHaveBeenCalledTimes(1)

    const second = await mount(mountWaitInAnotherPage(world.account))
    expect(second.byTestId('wait-execute-submitting')).not.toBeNull()
    expect(second.byTestId('wait-execute')).toBeNull()
    expect(second.text()).toContain(t('socialRecovery.wait.executionDue.executing'))

    hash.release(TX_HASH)
    await tick(0)
    expect(world.kit.receipts.wait).toHaveBeenCalledTimes(1)
    await tick(REREAD_MS)
    expect(world.kit.receipts.wait).toHaveBeenCalledTimes(2)
    expect(world.kit.receipts.wait).toHaveBeenLastCalledWith(TX_HASH, OWN_CLAIM_BLOCK)

    receipt.release(landedReceipt())
    consume(world.kit, world.account)
    await tick(POLL_MS)
    // Both pages navigate through the one wallet: each goes on to the done screen once.
    expect(second.paths()).toEqual([donePath(world), donePath(world)])
    expect(world.port.send).toHaveBeenCalledTimes(1)
    expect(world.kit.prepareExecuteHandover).toHaveBeenCalledTimes(1)
  })

  it('follows a claim another page wrote after this page offered execute, and prepares and sends nothing on a press', async () => {
    const world = await openWorld()
    elapse(world.kit)
    const view = await mount(mountWait(world.account))
    expect(view.isDisabled('wait-execute')).toBe(false)

    await claimElsewhere(world.records, world.account)
    await view.press('wait-execute')
    expect(view.byTestId('wait-execute-submitting')).not.toBeNull()
    expect(world.kit.prepareExecuteHandover).not.toHaveBeenCalled()
    expect(world.port.send).not.toHaveBeenCalled()
  })

  it('follows the claim another page wrote while this page checked the gas, and sends nothing', async () => {
    const world = await openWorld()
    elapse(world.kit)
    const estimate = held<bigint>()
    world.kit.reads.estimateGas.mockImplementation(() => estimate.promise)
    const view = await mount(mountWait(world.account))
    await view.press('wait-execute')

    await claimElsewhere(world.records, world.account)
    estimate.release(300_000n)
    await tick(0)
    expect(world.port.send).not.toHaveBeenCalled()
    expect(view.byTestId('wait-execute-submitting')).not.toBeNull()
    expect(view.byTestId('wait-execute')).toBeNull()
    expect((await executionOf(world.records, world.account))?.requestId).toBe(OTHER_REQUEST)
  })

  it('follows a hash the other page writes on its claim meanwhile, and waits on its receipt from the claim block', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdReceipt(world)
    await claimElsewhere(world.records, world.account)
    const view = await mount(mountWait(world.account))
    expect(view.byTestId('wait-execute-submitting')).not.toBeNull()
    expect(world.kit.receipts.wait).not.toHaveBeenCalled()

    await hashElsewhere(world.records, world.account)
    await tick(REREAD_MS)
    expect(world.kit.receipts.wait).toHaveBeenCalledWith(OTHER_TX_HASH, CLAIM_BLOCK)
    expect(view.byTestId('wait-execute')).toBeNull()
    expect(world.port.send).not.toHaveBeenCalled()
    expect(world.kit.prepareExecuteHandover).not.toHaveBeenCalled()
  })

  it('releases the claim where the wallet refused the send, and the retry claims again', async () => {
    const world = await openWorld()
    elapse(world.kit)
    world.refusing.refusing = true
    const view = await mount(mountWait(world.account))

    await view.press('wait-execute')
    expect(view.byTestId('wait-execute-failedNotSent')).not.toBeNull()
    expect(await executionOf(world.records, world.account)).toBeUndefined()

    world.refusing.refusing = false
    holdReceipt(world)
    await view.pressText(t('socialRecovery.writes.tryAgain'))
    expect(world.port.send).toHaveBeenCalledTimes(2)
    expect((await executionOf(world.records, world.account))?.transactionHash).toBe(TX_HASH)
  })

  it('releases the claim where another transaction of the key replaced the send', async () => {
    const world = await openWorld()
    elapse(world.kit)
    world.kit.receipts.wait.mockRejectedValue(replacedByAnother())
    const view = await mount(mountWait(world.account))

    await view.press('wait-execute')
    expect(view.byTestId('wait-execute-failedNotSent')).not.toBeNull()
    expect(await executionOf(world.records, world.account)).toBeUndefined()
  })

  it('releases the claim where the execution reverted', async () => {
    const world = await openWorld()
    elapse(world.kit)
    world.kit.receipts.wait.mockRejectedValue(minedAndReverted())
    const view = await mount(mountWait(world.account))

    await view.press('wait-execute')
    expect(view.byTestId('wait-execute-failedReverted')).not.toBeNull()
    expect(await executionOf(world.records, world.account)).toBeUndefined()
  })

  it('keeps the claim while the send is on its way', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdReceipt(world)
    const view = await mount(mountWait(world.account))

    await view.press('wait-execute')
    await tick(POLL_MS)
    expect(view.byTestId('wait-execute-submitting')).not.toBeNull()
    expect((await executionOf(world.records, world.account))?.transactionHash).toBe(TX_HASH)
  })

  it('writes the claim back with its hash where another page released it while the wallet held the send', async () => {
    const world = await openWorld()
    elapse(world.kit)
    const hash = holdSend(world)
    holdReceipt(world)
    const view = await mount(mountWait(world.account))
    await view.press('wait-execute')
    const claim = await executionOf(world.records, world.account)
    if (!claim) {
      throw new Error('no claim')
    }

    const countdown = world.records.countdown(CHAIN_ID, world.account)
    const read = await countdown.read()
    await countdown.releaseExecution(
      claim.requestId,
      read.status === 'present' ? read.revision : null
    )
    expect(await executionOf(world.records, world.account)).toBeUndefined()

    hash.release(TX_HASH)
    await tick(0)
    expect(await executionOf(world.records, world.account)).toEqual({
      ...claim,
      transactionHash: TX_HASH
    })
  })

  it('ends the countdown from a fresh read after a claim moved it, where the attempt was cancelled', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdReceipt(world)
    const view = await mount(mountWait(world.account))
    await view.press('wait-execute')
    expect((await executionOf(world.records, world.account))?.transactionHash).toBe(TX_HASH)

    const { chain } = world.kit
    chain.attempt = { ...chain.attempt, state: 'Cancelled' }
    chain.events = [...chain.events, attemptCancelled(world.account, 'cancelByOwner')]
    await tick(POLL_MS)
    await view.press('wait-cancelled-action')
    expect(view.byTestId('wait-leave-failed')).toBeNull()
    expect(view.paths()).toEqual([`/${WEB_ROUTES.socialRecoveryRecovery}`])
    expect((await world.records.countdown(CHAIN_ID, world.account).read()).status).toBe('absent')
    expect((await world.records.recoveryEntry(CHAIN_ID, world.account).read()).status).toBe(
      'absent'
    )
  })
})

describe('a reloaded page', () => {
  useWaitClock()
  const views: Mounted[] = []
  const mount = async (mounting: Promise<Mounted>) => {
    const view = await mounting
    views.push(view)
    return view
  }

  afterEach(() => {
    views.splice(0).forEach((view) => view.unmount())
  })

  it('follows its own claim the wallet still holds, and sends nothing', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdSend(world)
    const before = await mountWait(world.account)
    await before.press('wait-execute')
    before.unmount()

    const after = await mount(mountWaitInAnotherPage(world.account))
    expect(after.byTestId('wait-execute-submitting')).not.toBeNull()
    expect(after.byTestId('wait-execute')).toBeNull()
    await tick(POLL_MS)
    expect(world.port.send).toHaveBeenCalledTimes(1)
    expect(world.kit.prepareExecuteHandover).toHaveBeenCalledTimes(1)
  })

  it('waits on the receipt of the hash its own claim carries, and reaches the done screen with nothing sent again', async () => {
    const world = await openWorld()
    elapse(world.kit)
    const receipt = holdReceipt(world)
    const before = await mountWait(world.account)
    await before.press('wait-execute')
    before.unmount()
    world.kit.receipts.wait.mockClear()

    const after = await mount(mountWaitInAnotherPage(world.account))
    expect(world.kit.receipts.wait).toHaveBeenCalledWith(TX_HASH, OWN_CLAIM_BLOCK)
    expect(after.byTestId('wait-execute')).toBeNull()

    receipt.release(landedReceipt())
    consume(world.kit, world.account)
    await tick(POLL_MS)
    expect(after.paths()).toEqual([donePath(world)])
    expect(world.port.send).toHaveBeenCalledTimes(1)
  })
})

describe('a claim with no hash that grew old', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  it('is followed while it is younger than the claim age, and released once it is older with no consume event since its block', async () => {
    const world = await openWorld()
    elapse(world.kit)
    await claimElsewhere(world.records, world.account)
    view = await mountWait(world.account)

    await tick(REREAD_MS)
    await tick(REREAD_MS)
    expect(view.byTestId('wait-execute-submitting')).not.toBeNull()
    expect(claimRangeReads(world)).toEqual([])
    expect((await executionOf(world.records, world.account))?.requestId).toBe(OTHER_REQUEST)

    moveDeviceClock(CLAIM_AGE_MS)
    await tick(REREAD_MS)
    expect(claimRangeReads(world)).toEqual([
      [expect.anything(), { from: CLAIM_BLOCK, to: world.kit.chain.blockNumber }]
    ])
    expect(await executionOf(world.records, world.account)).toBeUndefined()
    expect(view.byTestId('wait-execute-submitting')).toBeNull()
    expect(view.isDisabled('wait-execute')).toBe(false)
    expect(world.port.send).not.toHaveBeenCalled()
  })

  it('is kept where a consume event of the attempt exists from its block, and the next poll opens the done screen', async () => {
    const world = await openWorld()
    elapse(world.kit)
    await claimElsewhere(world.records, world.account, { claimedAt: Date.now() - CLAIM_AGE_MS })
    eventsFromClaim(world, async () => [...world.kit.chain.events, attemptConsumed(world.account)])
    view = await mountWait(world.account)

    await tick(REREAD_MS)
    expect(claimRangeReads(world).length).toBeGreaterThan(0)
    expect((await executionOf(world.records, world.account))?.requestId).toBe(OTHER_REQUEST)
    expect(view.byTestId('wait-execute')).toBeNull()
    expect(view.paths()).toEqual([])
    expect(world.port.send).not.toHaveBeenCalled()

    consume(world.kit, world.account)
    await tick(POLL_MS)
    expect(view.paths()).toEqual([donePath(world)])
    expect(world.port.send).not.toHaveBeenCalled()
  })

  it('is followed under the hash the other page wrote while its events were read, never released', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdReceipt(world)
    await claimElsewhere(world.records, world.account, { claimedAt: Date.now() - CLAIM_AGE_MS })
    eventsFromClaim(world, async () => {
      await hashElsewhere(world.records, world.account)
      return world.kit.chain.events
    })
    view = await mountWait(world.account)
    await tick(0)

    expect(claimRangeReads(world).length).toBeGreaterThan(0)
    expect(await executionOf(world.records, world.account)).toEqual({
      requestId: OTHER_REQUEST,
      startBlock: CLAIM_BLOCK,
      claimedAt: Date.now() - CLAIM_AGE_MS,
      transactionHash: OTHER_TX_HASH
    })
    expect(world.kit.receipts.wait).toHaveBeenCalledWith(OTHER_TX_HASH, CLAIM_BLOCK)
    expect(view.byTestId('wait-execute')).toBeNull()
    expect(world.port.send).not.toHaveBeenCalled()
  })
})
