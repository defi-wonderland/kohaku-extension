/**
 * @jest-environment jsdom
 *
 * The gas check on the sending key before the submission: a key that holds
 * too little gets the deposit step, which reads the balance again by itself
 * and goes on to the send once the key holds enough. The clock is Jest's.
 */
import type { Mounted, World } from '@web/modules/social-recovery/recovery/submit/__tests__/harness'
import {
  mountSubmit,
  openWorld,
  providerReadFailure,
  t,
  tick
} from '@web/modules/social-recovery/recovery/submit/__tests__/harness'

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const { getAddress }: typeof import('viem') = require('viem')
const {
  BALANCE_POLL_MS
}: typeof import('@web/modules/social-recovery/recovery/submit') = require('@web/modules/social-recovery/recovery/submit')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const GAS = 'socialRecovery.writes.gas'
/** The estimate with its headroom the step asks for at a balance of zero: 300000 gas at 2 gwei, plus 20%. */
const OUTSIDE_AMOUNT = '0.00072 ETH'

describe('the deposit step', () => {
  let view: Mounted | undefined

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    view?.unmount()
    view = undefined
    jest.useRealTimers()
  })

  /** Opens the confirmation with the sending key empty and presses Start recovery. */
  const startEmpty = async (world: World) => {
    world.kit.reads.nativeBalance.mockResolvedValue(0n)
    view = await mountSubmit(world.account, { useTimers: true })
    await view.press('submit-action')
    return view
  }

  it('shows the sending key in full and the amount, with both routes on the logged-in route', async () => {
    const world = await openWorld({ route: 'logged-in', receiving: 'smart' })
    const mounted = await startEmpty(world)
    const step = mounted.textOf('submit-gas-step')
    expect(step).toContain(getAddress(world.sendingKey))
    expect(step).toContain(t(`${GAS}.outsideRoute`, { amount: OUTSIDE_AMOUNT }))
    expect(step).toContain('Transfer ')
    expect(step).toContain(`from ${world.receiving.preferences.label} to its key`)
    expect(world.kit.reads.nativeBalance).toHaveBeenCalledWith(world.sendingKey)
    expect(world.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('offers the deposit from outside alone on the fresh install', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    const mounted = await startEmpty(world)
    const step = mounted.textOf('submit-gas-step')
    expect(step).toContain(getAddress(world.sendingKey))
    expect(step).toContain(t(`${GAS}.submissionAmount`, { amount: OUTSIDE_AMOUNT }))
    expect(step).not.toContain('Transfer ')
    expect(step).not.toContain(t(`${GAS}.outsideRoute`, { amount: OUTSIDE_AMOUNT }))
    expect(world.kit.reads.nativeBalance).toHaveBeenCalledWith(world.sendingKey)
    expect(world.port.send).not.toHaveBeenCalled()
  })

  it('reads the balance again by itself and goes on to the send once the key holds enough', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    const mounted = await startEmpty(world)
    const reads = world.kit.reads.nativeBalance.mock.calls.length

    await tick(BALANCE_POLL_MS)
    expect(world.kit.reads.nativeBalance.mock.calls.length).toBe(reads + 1)
    expect(mounted.byTestId('submit-gas-step')).not.toBeNull()
    expect(world.port.send).not.toHaveBeenCalled()

    world.kit.reads.nativeBalance.mockResolvedValue(10n ** 18n)
    await tick(BALANCE_POLL_MS)
    expect(world.port.send).toHaveBeenCalledTimes(1)
    expect(world.port.send.mock.calls[0][0].addr).toBe(world.sendingKey)
    expect(mounted.byTestId('submit-gas-step')).toBeNull()
  })

  it('renders failed with a retry where a balance read fails, and sends nothing', async () => {
    const world = await openWorld()
    const mounted = await startEmpty(world)
    world.kit.reads.nativeBalance.mockRejectedValue(
      providerReadFailure('nativeBalance', new Error('node down'))
    )
    await tick(BALANCE_POLL_MS)
    expect(mounted.byTestId('submit-gas-step')).toBeNull()
    expect(mounted.text()).toContain(t('socialRecovery.writes.gasCheckFailed'))
    expect(world.port.sendAccountBatch).not.toHaveBeenCalled()

    world.kit.reads.nativeBalance.mockResolvedValue(10n ** 18n)
    await mounted.pressText(t('socialRecovery.writes.tryAgain'))
    expect(world.port.sendAccountBatch).toHaveBeenCalledTimes(1)
  })

  it('sends at once, with no step, where the key already holds enough', async () => {
    const world = await openWorld()
    view = await mountSubmit(world.account, { useTimers: true })
    await view.press('submit-action')
    expect(view.byTestId('submit-gas-step')).toBeNull()
    expect(world.port.sendAccountBatch).toHaveBeenCalledTimes(1)
  })
})
