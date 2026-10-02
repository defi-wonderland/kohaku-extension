/**
 * One table over every combination of the save's inputs: how the arrival
 * reads (the review's gate, the account's facts, the client, the recovery
 * password in memory) and, where the arrival lets the save start, how each
 * edge of the run answers (authorized before or not, the account's code, the
 * prepare, the gas check, the send, the receipt and the check after it).
 *
 * The rows are the cross product with two rules that prune what cannot
 * happen or cannot be read:
 *
 * 1. A save that never starts reads none of the run's edges, so an arrival
 *    other than ready takes one row, with every edge set to answer as a
 *    successful save would, so a save that started anyway would show.
 * 2. A refused send leaves no transaction, so no receipt and no check follow
 *    it; a reverted or replaced transaction leaves nothing to check. The
 *    receipt is crossed only with a sent batch, and the check only with a
 *    landed receipt.
 *
 * The save starts on a ready arrival alone, as the screen starts it; the
 * screen's own test checks that it does. After the run, the table also tries
 * the moves the screen offers short of a fresh save (the gas check again from
 * the deposit blocker, the check again where it did not answer).
 *
 * For every row: the save reads as saved, the saved screen shows and the six
 * records are wiped once if and only if the receipt landed and the check read
 * the setup landed and authorized. Nothing is sent unless the arrival was
 * ready, the prepare answered and the gas check answered enough; what is sent
 * is the prepared calls in order, with the recovery kit's mark.
 */
import type { Account } from '@ambire-common/interfaces/account'
import { recoveryKitMarkOf, SEND_REFUSAL_REASONS } from '@web/modules/social-recovery/shared/client'

import {
  armScreenOf,
  callsOf,
  createArmStore,
  isSaved,
  recheckGas,
  rereadConfirmation
} from '@web/modules/social-recovery/setup/arm'

import {
  arrivalFor,
  CLIENT_CASES,
  CONFIRM_CASES,
  confirmAgrees,
  crossProduct,
  DESCRIPTOR,
  FACTS_CASES,
  GAS_CASES,
  GATE_CASES,
  HAPPY,
  runSave,
  SHORT_TIMEOUT_MS,
  smartAccount,
  wireSave
} from './harness'
import type { ArrivalCase, SaveScript } from './harness'

/** The send, the receipt and the check, pruned by the second rule. */
const AFTER_GAS: Pick<SaveScript, 'send' | 'receipt' | 'confirm'>[] = [
  ...SEND_REFUSAL_REASONS.map((send) => ({
    send,
    receipt: 'landed' as const,
    confirm: 'agreed' as const
  })),
  { send: 'sent', receipt: 'reverted', confirm: 'agreed' },
  { send: 'sent', receipt: 'replaced', confirm: 'agreed' },
  ...CONFIRM_CASES.map((confirm) => ({
    send: 'sent' as const,
    receipt: 'landed' as const,
    confirm
  }))
]

const READY: ArrivalCase = { gate: 'passes', facts: 'ready', client: 'ready', passwordHeld: true }

const ARRIVALS = crossProduct({
  gate: GATE_CASES,
  facts: FACTS_CASES,
  client: CLIENT_CASES,
  passwordHeld: [true, false]
})

const RUNS: SaveScript[] = crossProduct({
  authorized: [false, true],
  deployed: [true, false],
  prepare: ['answers', 'refuses'] as const,
  gas: GAS_CASES,
  after: AFTER_GAS
}).map(({ after, ...rest }) => ({ ...rest, ...after }))

const sameArrival = (one: ArrivalCase, other: ArrivalCase) =>
  one.gate === other.gate &&
  one.facts === other.facts &&
  one.client === other.client &&
  one.passwordHeld === other.passwordHeld

interface Row {
  arrival: ArrivalCase
  script: SaveScript
}

const ROWS: Row[] = [
  ...ARRIVALS.filter((arrival) => !sameArrival(arrival, READY)).map((arrival) => ({
    arrival,
    script: { ...HAPPY, authorized: false, deployed: true }
  })),
  ...RUNS.map((script) => ({ arrival: READY, script }))
]

const json = (value: unknown) =>
  JSON.stringify(value, (_, held) => (typeof held === 'bigint' ? `${held}n` : held))

const describeRow = ({ arrival, script }: Row) => json({ ...arrival, ...script })

let account: Account

beforeAll(async () => {
  account = await smartAccount()
})

describe('every combination of the save inputs', () => {
  it('has one row per arrival that never starts and one per run of a ready arrival', () => {
    expect(ARRIVALS).toHaveLength(9 * 6 * 4 * 2)
    expect(RUNS).toHaveLength(2 * 2 * 2 * 3 * 17)
    expect(ROWS).toHaveLength(431 + 408)
  })

  it('reads saved, shows the saved screen and wipes the records only after a landed, agreed save', async () => {
    const failures: string[] = []
    const fail = (row: Row, what: string) => failures.push(`${what} :: ${describeRow(row)}`)

    const check = async (row: Row) => {
      const { arrival, script } = row
      const wired = wireSave(account, script)
      const store = createArmStore()
      const ready = arrivalFor(arrival, account).kind === 'ready'
      if (ready) {
        await runSave(wired.steps, store)
        await recheckGas(store, wired.steps, { timeoutMs: SHORT_TIMEOUT_MS })
        await rereadConfirmation(store, wired.steps, { timeoutMs: SHORT_TIMEOUT_MS })
      }

      const sends = ready && script.prepare === 'answers' && script.gas === 'enough'
      const landed = sends && script.send === 'sent' && script.receipt === 'landed'
      const saved = landed && confirmAgrees(script.confirm)
      const state = store.state()

      if (ready !== sameArrival(arrival, READY)) fail(row, `the arrival read ready: ${ready}`)
      if (isSaved(state) !== saved) fail(row, `isSaved answered ${isSaved(state)}`)
      if ((armScreenOf(state) === 'saved') !== saved)
        fail(row, `the screen is ${armScreenOf(state)}`)
      if (wired.saveSetup.mock.calls.length !== (saved ? 1 : 0)) {
        fail(row, `the records were wiped ${wired.saveSetup.mock.calls.length} times`)
      }
      if (wired.port.sendAccountBatch.mock.calls.length !== (sends ? 1 : 0)) {
        fail(row, `the batch was sent ${wired.port.sendAccountBatch.mock.calls.length} times`)
      }
      if (wired.port.send.mock.calls.length !== 0) fail(row, 'a key sent a transaction alone')
      if (!ready && wired.prepareCommitSetup.mock.calls.length !== 0) {
        fail(row, 'a save that never started prepared its commit')
      }
      if (sends) {
        const [sentFor, calls, , mark] = wired.port.sendAccountBatch.mock.calls[0]
        if (sentFor !== wired.account) fail(row, 'the batch was sent for another account')
        if (json(calls) !== json(callsOf(wired.prepared))) {
          fail(row, 'the calls sent are not the prepared calls in order')
        }
        if (json(mark) !== json(recoveryKitMarkOf(DESCRIPTOR))) {
          fail(row, 'the batch went without the recovery kit mark')
        }
        const checked = wired.reads.nativeBalance.mock.invocationCallOrder[0]
        if (!(checked < wired.port.sendAccountBatch.mock.invocationCallOrder[0])) {
          fail(row, 'the batch was sent before the gas check read the key')
        }
      }
      if (saved) {
        const lastCheck = Math.max(...wired.confirmSetup.mock.invocationCallOrder)
        if (!(wired.saveSetup.mock.invocationCallOrder[0] > lastCheck)) {
          fail(row, 'the records were wiped before the check answered')
        }
      }
      if (!landed && wired.confirmSetup.mock.calls.length !== 0) {
        fail(row, 'the check ran with no landed receipt')
      }
    }

    await ROWS.reduce(async (before, row) => {
      await before
      await check(row)
    }, Promise.resolve())

    expect(failures).toEqual([])
  })
})
