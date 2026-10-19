/**
 * @jest-environment jsdom
 *
 * Two tabs of this device on the same clear of the overview, each with its
 * own run over the records both read: the first claims and sends, the second
 * loses the claim and follows the first's write to its landing, and only one
 * transaction goes out.
 */
import type { Account } from '@ambire-common/interfaces/account'
import type { KeyHandle } from '@web/modules/social-recovery/shared/client'

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const harness: typeof import('@web/modules/social-recovery/management/overview/__fixtures__/harness') = require('@web/modules/social-recovery/management/overview/__fixtures__/harness')
const armHarness: typeof import('@web/modules/social-recovery/setup/arm/__tests__/harness') = require('@web/modules/social-recovery/setup/arm/__tests__/harness')
const {
  overviewStepsOf
}: typeof import('@web/modules/social-recovery/management/overview/writeSteps') = require('@web/modules/social-recovery/management/overview/writeSteps')
const {
  REMOVAL_DRAFT
}: typeof import('@web/modules/social-recovery/management/overview/constants') = require('@web/modules/social-recovery/management/overview/constants')
const {
  createArmStore,
  isSaved,
  startSave
}: typeof import('@web/modules/social-recovery/setup/arm') = require('@web/modules/social-recovery/setup/arm')
const {
  deferred
}: typeof import('@web/modules/social-recovery/shared/chrome/__fixtures__/deferred') = require('@web/modules/social-recovery/shared/chrome/__fixtures__/deferred')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const { worldAt, receiptsOver, sendPortOver, GAS_READS, CHAIN_ID } = harness

let account: Account
let key: KeyHandle
let address: `0x${string}`

beforeAll(async () => {
  ;({ account, key } = await armHarness.keyedAccount(0x7ab))
  address = account.addr as `0x${string}`
})

/** One tab's run of the clear: its own store, send port and receipt waits, over the shared records. */
const tabOver = (world: Awaited<ReturnType<typeof worldAt>>) => {
  const port = sendPortOver()
  const receipts = receiptsOver()
  const steps = overviewStepsOf({
    intent: 'clear',
    client: world.client,
    reads: GAS_READS,
    receipts,
    port,
    requests: armHarness.requestsFake(),
    records: world.records,
    chainId: CHAIN_ID,
    account: address,
    facts: armHarness.factsOf(account, { key }),
    key,
    draft: REMOVAL_DRAFT,
    password: undefined,
    onAttemptOpen: () => {}
  })
  return { port, receipts, steps, store: createArmStore('ownerWrite') }
}

describe('two tabs on the same clear', () => {
  it('sends once: the second tab follows the write of the first to its landing', async () => {
    const world = await worldAt('public', address)
    world.chain.setAuthorized(false)
    const landing = deferred<ReturnType<typeof armHarness.landedReceipt>>()
    const first = tabOver(world)
    first.receipts.wait.mockImplementation(() => landing.promise)
    const second = tabOver(world)
    second.receipts.wait.mockImplementation(() => landing.promise)

    const firstRun = startSave(first.store, first.steps)
    await harness.settle()
    expect(first.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    const held = await world.records.saveInFlight(CHAIN_ID, address).read()
    expect(held.status).toBe('present')

    const secondRun = startSave(second.store, second.steps)
    await harness.settle()
    expect(second.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(second.receipts.wait).toHaveBeenCalledWith(armHarness.TX_HASH, armHarness.START_BLOCK)

    world.chain.clearSetup()
    landing.resolve(armHarness.landedReceipt(armHarness.TX_HASH))
    await Promise.all([firstRun, secondRun])

    expect(isSaved(first.store.state())).toBe(true)
    expect(isSaved(second.store.state())).toBe(true)
    expect(first.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(second.port.sendAccountBatch).not.toHaveBeenCalled()
    expect((await world.records.saveInFlight(CHAIN_ID, address).read()).status).toBe('absent')
  })
})
