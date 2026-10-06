/**
 * @jest-environment jsdom
 */
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import {
  attemptOf,
  attemptStarted,
  CHAIN_ID,
  CHAIN_TIME,
  consume,
  elapse,
  held,
  landCountdown,
  landedReceipt,
  MIXED_PATH,
  minedAndReverted,
  moveDeviceClock,
  mountWait,
  openWorld,
  PAYLOAD,
  t,
  tick,
  TX_HASH,
  useWaitClock
} from '@web/modules/social-recovery/recovery/wait/__tests__/harness'
import type { Mounted, World } from '@web/modules/social-recovery/recovery/wait/__tests__/harness'
import type { ProviderTransactionReceipt } from '@web/modules/social-recovery/shared/client'

const POLL_MS = 30_000
const DUE = 'socialRecovery.wait.executionDue'

const donePath = (world: World) =>
  `/${WEB_ROUTES.socialRecoveryRecoveryDone}?account=${world.account}`

/** Holds the execution's receipt until the test releases or fails it. */
const holdReceipt = (world: World) => {
  const receipt = held<ProviderTransactionReceipt>()
  world.kit.receipts.wait.mockImplementation(() => receipt.promise)
  return receipt
}

describe('execution due', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  it('renders execution due once the wait elapsed and every check passes', async () => {
    const world = await openWorld()
    elapse(world.kit)
    view = await mountWait(world.account)

    expect(view.textOf('wait-chip')).toBe(t('socialRecovery.status.attempt.executionDue'))
    expect(view.textOf('wait-execution-due-lead')).toBe(t(`${DUE}.lead`))
    expect(view.text()).toContain(t(`${DUE}.secondTransaction`))
    expect(view.textOf('wait-execute')).toBe(t(`${DUE}.action`))
    expect(view.isDisabled('wait-execute')).toBe(false)
    expect(view.byTestId('wait-can-close')).toBeNull()
  })

  it('asks the chain at once when the countdown reaches its end, without waiting for the next poll', async () => {
    const world = await openWorld()
    world.kit.chain.attempt = attemptOf(world.account, { consumableAfter: CHAIN_TIME + 10 })
    view = await mountWait(world.account)
    expect(view.byTestId('wait-execute')).toBeNull()

    world.kit.chain.blockTime = CHAIN_TIME + 10
    await tick(10_000)
    expect(world.kit.recoveryState).toHaveBeenCalledTimes(2)
    expect(view.byTestId('wait-execute')).not.toBeNull()
  })

  it('does not offer execute now before the chain says the wait elapsed', async () => {
    const world = await openWorld()
    world.kit.chain.attempt = attemptOf(world.account, { consumableAfter: CHAIN_TIME + 10 })
    view = await mountWait(world.account)

    await tick(10_000)
    expect(world.kit.recoveryState).toHaveBeenCalledTimes(2)
    expect(view.byTestId('wait-execute')).toBeNull()
    expect(view.byTestId('wait-can-close')).not.toBeNull()
  })
})

describe('execute now', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  it('prepares the execution for the attempt and its payload, checks the gas, then sends once from the key', async () => {
    const world = await openWorld()
    elapse(world.kit)
    const receipt = holdReceipt(world)
    view = await mountWait(world.account)

    await view.press('wait-execute')
    expect(world.kit.prepareExecuteHandover).toHaveBeenCalledWith(world.kit.chain.attempt, PAYLOAD)
    expect(world.kit.reads.nativeBalance).toHaveBeenCalled()
    expect(world.kit.reads.estimateGas).toHaveBeenCalled()
    expect(world.port.send).toHaveBeenCalledTimes(1)
    expect(world.port.send.mock.calls[0][0].addr).toBe(world.sendingKey)
    expect(world.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(world.kit.reads.estimateGas.mock.invocationCallOrder[0]).toBeLessThan(
      world.port.send.mock.invocationCallOrder[0]
    )
    expect(view.byTestId('wait-execute-submitting')).not.toBeNull()
    expect(view.text()).toContain(t(`${DUE}.executing`))

    receipt.release(landedReceipt())
    await tick(0)
  })

  it("sends a smart account's own batch once on the logged-in route", async () => {
    const world = await openWorld({ receiving: 'smart' })
    elapse(world.kit)
    holdReceipt(world)
    view = await mountWait(world.account)

    await view.press('wait-execute')
    expect(world.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(world.port.sendAccountBatch.mock.calls[0][0]).toBe(world.entry.receivingAccount)
    expect(world.port.send).not.toHaveBeenCalled()
  })

  it("sends from the seed slot's ordinary key on the fresh install, never from the new key", async () => {
    const world = await openWorld({ route: 'fresh-install' })
    elapse(world.kit)
    holdReceipt(world)
    view = await mountWait(world.account)

    await view.press('wait-execute')
    expect(world.port.send).toHaveBeenCalledTimes(1)
    expect(world.port.send.mock.calls[0][0].addr).toBe(world.sendingKey)
    expect(world.sendingKey).not.toBe(world.newKey)
  })

  it('sends nothing more on a second press, a poll or a remount while the first send is on its way', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdReceipt(world)
    view = await mountWait(world.account)

    await view.pressTwice('wait-execute')
    expect(view.byTestId('wait-execute')).toBeNull()
    await tick(POLL_MS)
    view.unmount()
    view = await mountWait(world.account)
    expect(view.byTestId('wait-execute-submitting')).not.toBeNull()
    expect(view.byTestId('wait-execute')).toBeNull()
    expect(world.port.send).toHaveBeenCalledTimes(1)
    expect(world.kit.prepareExecuteHandover).toHaveBeenCalledTimes(1)
  })

  it('goes to the done screen once the attempt reads consumed after the landed receipt', async () => {
    const world = await openWorld()
    elapse(world.kit)
    const receipt = holdReceipt(world)
    view = await mountWait(world.account)
    await view.press('wait-execute')

    const calls = world.kit.recoveryState.mock.calls.length
    receipt.release(landedReceipt())
    await tick(0)
    // The landed receipt asks the chain at once; the attempt still waits there.
    expect(world.kit.recoveryState.mock.calls.length).toBe(calls + 1)
    expect(view.byTestId('wait-execute-confirming')).not.toBeNull()
    expect(view.paths()).toEqual([])

    consume(world.kit, world.account)
    await tick(POLL_MS)
    expect(view.paths()).toEqual([donePath(world)])
    expect(world.port.send).toHaveBeenCalledTimes(1)
  })

  it('reads nothing was sent for a refused send, and the retry sends again', async () => {
    const world = await openWorld()
    elapse(world.kit)
    world.refusing.refusing = true
    view = await mountWait(world.account)

    await view.press('wait-execute')
    expect(view.byTestId('wait-execute-failedNotSent')).not.toBeNull()
    expect(view.text()).toContain(t(`${DUE}.notSent`))
    expect(view.paths()).toEqual([])

    world.refusing.refusing = false
    holdReceipt(world)
    await view.pressText(t('socialRecovery.writes.tryAgain'))
    expect(world.port.send).toHaveBeenCalledTimes(2)
    expect(view.byTestId('wait-execute-submitting')).not.toBeNull()
  })

  it('reads the execution reverted with its cause and the attempt still ready, and offers the retry', async () => {
    const world = await openWorld()
    elapse(world.kit)
    world.kit.receipts.wait.mockRejectedValue(minedAndReverted())
    view = await mountWait(world.account)

    await view.press('wait-execute')
    expect(view.byTestId('wait-execute-failedReverted')).not.toBeNull()
    expect(view.text()).toContain(
      t('socialRecovery.writes.revertedExecute', {
        cause: t('socialRecovery.writes.causes.unnamed')
      })
    )
    expect(view.hasButton(t('socialRecovery.writes.tryAgain'))).toBe(true)
    expect(view.paths()).toEqual([])
  })

  it('shows the deposit step where the key holds too little, sends nothing, and sends once the funds arrive', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdReceipt(world)
    world.kit.reads.nativeBalance.mockResolvedValue(0n)
    view = await mountWait(world.account)

    await view.press('wait-execute')
    expect(view.byTestId('wait-execute-blocker')).not.toBeNull()
    expect(view.text()).toContain(t('socialRecovery.writes.gas.shortfallExecute'))
    expect(view.text()).toContain(world.sendingKey)
    expect(world.port.send).not.toHaveBeenCalled()

    world.kit.reads.nativeBalance.mockResolvedValue(10n ** 18n)
    await tick(5_000)
    expect(world.port.send).toHaveBeenCalledTimes(1)
    expect(view.byTestId('wait-execute-submitting')).not.toBeNull()
  })
})

describe('a later recovery of the same account in the same tab', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  /** Ends the first recovery's countdown and lands a second one, whose attempt `2` reached its end. */
  const secondRecovery = async (world: World) => {
    const read = await world.records.countdown(CHAIN_ID, world.account).read()
    if (read.status !== 'present') {
      throw new Error('no countdown')
    }
    await world.records.endCountdown(CHAIN_ID, world.account, read.revision)
    await landCountdown(world.records, world.account, MIXED_PATH)
    const { chain } = world.kit
    chain.attempt = attemptOf(world.account, { attemptId: 2n, consumableAfter: chain.blockTime })
    chain.events = [attemptStarted(world.account, PAYLOAD, 2n)]
  }

  it('offers execute now again after the first execution reached the done screen', async () => {
    const world = await openWorld()
    elapse(world.kit)
    view = await mountWait(world.account)
    await view.press('wait-execute')
    consume(world.kit, world.account)
    await tick(POLL_MS)
    expect(view.paths()).toEqual([donePath(world)])
    view.unmount()

    await secondRecovery(world)
    view = await mountWait(world.account)
    expect(view.byTestId('wait-execute-confirming')).toBeNull()
    expect(view.isDisabled('wait-execute')).toBe(false)

    holdReceipt(world)
    await view.press('wait-execute')
    expect(world.port.send).toHaveBeenCalledTimes(2)
    expect(world.kit.prepareExecuteHandover).toHaveBeenLastCalledWith(
      world.kit.chain.attempt,
      PAYLOAD
    )
  })

  it('offers execute now for the new attempt where the holder left the first one landed before it read consumed', async () => {
    const world = await openWorld()
    elapse(world.kit)
    view = await mountWait(world.account)
    await view.press('wait-execute')
    expect(view.byTestId('wait-execute-confirming')).not.toBeNull()
    view.unmount()

    await secondRecovery(world)
    view = await mountWait(world.account)
    expect(view.byTestId('wait-execute-confirming')).toBeNull()
    expect(view.isDisabled('wait-execute')).toBe(false)
    await view.press('wait-execute')
    expect(world.port.send).toHaveBeenCalledTimes(2)
  })
})

describe('a send no node knows', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  it('keeps the send while it is younger than the dropped age', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdReceipt(world)
    world.kit.receipts.transactionKnown.mockResolvedValue('unknown')
    view = await mountWait(world.account)
    await view.press('wait-execute')

    moveDeviceClock(30 * 60_000)
    await tick(POLL_MS)
    expect(view.byTestId('wait-execute-submitting')).not.toBeNull()
    expect(view.byTestId('wait-execute')).toBeNull()
  })

  it('releases a send past the dropped age that no node knows, and offers execute again', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdReceipt(world)
    world.kit.receipts.transactionKnown.mockResolvedValue('unknown')
    view = await mountWait(world.account)
    await view.press('wait-execute')

    moveDeviceClock(61 * 60_000)
    await tick(POLL_MS)
    expect(world.kit.receipts.transactionKnown).toHaveBeenCalledWith(TX_HASH)
    expect(view.byTestId('wait-execute-submitting')).toBeNull()
    expect(view.byTestId('wait-execute')).not.toBeNull()
  })

  it('keeps a send past the dropped age that a node still knows', async () => {
    const world = await openWorld()
    elapse(world.kit)
    holdReceipt(world)
    view = await mountWait(world.account)
    await view.press('wait-execute')

    moveDeviceClock(61 * 60_000)
    await tick(POLL_MS)
    expect(world.kit.receipts.transactionKnown).toHaveBeenCalled()
    expect(view.byTestId('wait-execute-submitting')).not.toBeNull()
  })
})
