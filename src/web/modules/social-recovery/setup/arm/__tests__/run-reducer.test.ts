/**
 * The save's reducer on its own, over an alphabet of every event the save
 * takes, each for runs one to three. The walk visits every state any event
 * sequence reaches (a fourth start is left out, so the walk ends), together
 * with the runs its history holds a landed receipt and an agreed check for.
 * A seeded set of long random sequences runs beside it.
 *
 * Saved is never reached without a landed receipt of the run and an agreed
 * check of that same run, and an event of another run never moves the state.
 * A run that found a setup on the account ends there, and nothing moves it
 * after; the sign screen's reading and a stalled receipt wait belong to the
 * run that submits.
 */
import { zeroHash } from 'viem'

import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'
import { accountBatchRefusal } from '@web/modules/social-recovery/shared/client'
import type { DepositStep, GasCheck } from '@web/modules/social-recovery/shared/writes'

import {
  armReducer,
  initialArmState,
  isSaved,
  mayStillLand
} from '@web/modules/social-recovery/setup/arm'
import type { ArmEvent, ArmState, PreparedSave } from '@web/modules/social-recovery/setup/arm'

import { COMMIT, draftOf, feeReading, KEY, nodeError, TX_HASH } from './harness'

const LAST_RUN = 3

const SAVE: PreparedSave = { draft: draftOf(), prepared: COMMIT, calls: [COMMIT] }

const ESTIMATE = { gas: 1n, gasPrice: 1n, cost: 1n, required: 2n }
const ENOUGH: GasCheck = {
  kind: 'enough',
  write: 'save',
  key: KEY.addr,
  estimate: ESTIMATE,
  balance: 5n
}
const STEP: DepositStep = {
  write: 'save',
  payer: 'accountKey',
  fastTrack: false,
  key: KEY.addr,
  network: { name: 'Sepolia', symbol: 'ETH' },
  estimate: ESTIMATE,
  balance: 0n,
  shortfall: 2n,
  routes: [{ kind: 'outside', to: KEY.addr, amount: 2n }]
}
const DEPOSIT: GasCheck = { kind: 'deposit', step: STEP }

const receipt = (run: number, status: 0 | 1, hash: Hex = TX_HASH): ArmEvent => ({
  type: 'write',
  event: { type: 'receipt', run, receipt: { transactionHash: hash, status } }
})

const START: ArmEvent = { type: 'write', event: { type: 'start' } }

const ALPHABET: ArmEvent[] = [
  START,
  { type: 'write', event: { type: 'recheck' } },
  { type: 'write', event: { type: 'reset' } },
  ...Array.from({ length: LAST_RUN }, (_, index) => index + 1).flatMap((run): ArmEvent[] => [
    { type: 'write', event: { type: 'gasChecked', run, check: ENOUGH } },
    { type: 'write', event: { type: 'gasChecked', run, check: DEPOSIT } },
    { type: 'write', event: { type: 'sent', run, transactionHash: TX_HASH } },
    receipt(run, 1),
    receipt(run, 0),
    receipt(run, 1, zeroHash),
    { type: 'write', event: { type: 'error', run, error: new Error('refused') } },
    { type: 'write', event: { type: 'error', run, error: nodeError(), transactionHash: TX_HASH } },
    {
      type: 'write',
      event: { type: 'error', run, error: accountBatchRefusal('not-a-transaction', KEY.addr) }
    },
    { type: 'alreadySetUp', run },
    { type: 'prepared', run, prepared: SAVE },
    { type: 'estimated', run, reading: feeReading({ error: true }) },
    { type: 'waitStalled', run },
    { type: 'waitResumed', run },
    { type: 'confirming', run },
    { type: 'confirmed', run, outcome: { kind: 'agreed' } },
    { type: 'confirmed', run, outcome: { kind: 'disagreed', check: 'mismatch' } },
    { type: 'confirmed', run, outcome: { kind: 'disagreed', check: 'authorization' } },
    { type: 'confirmed', run, outcome: { kind: 'unread' } },
    { type: 'wiped', run }
  ])
]

const runOf = (event: ArmEvent): number | undefined => {
  if (event.type !== 'write') {
    return event.run
  }
  return 'run' in event.event ? event.event.run : undefined
}

const isLandedReceipt = (event: ArmEvent): boolean =>
  event.type === 'write' && event.event.type === 'receipt' && event.event.receipt.status === 1

const isAgreed = (event: ArmEvent): boolean =>
  event.type === 'confirmed' && event.outcome.kind === 'agreed'

const json = (value: unknown) =>
  JSON.stringify(value, (_, held) =>
    typeof held === 'bigint' ? `${held}n` : held instanceof Error ? held.message : held
  )

/** A state the walk reached, the runs its history landed and agreed, and one path to it. */
interface Node {
  state: ArmState
  landed: readonly number[]
  agreed: readonly number[]
  path: readonly ArmEvent[]
}

const withRun = (runs: readonly number[], run: number | undefined, holds: boolean) =>
  holds && run !== undefined && !runs.includes(run) ? [...runs, run].sort() : runs

interface Walk {
  nodes: Node[]
  /** Each step from a reached node: the node, the event and the state it led to. */
  steps: { from: Node; event: ArmEvent; to: Node }[]
}

const walkAll = (): Walk => {
  const seen = new Set<string>()
  const nodes: Node[] = []
  const steps: Walk['steps'] = []
  const queue: Node[] = [{ state: initialArmState(), landed: [], agreed: [], path: [] }]
  while (queue.length > 0) {
    const node = queue.shift() as Node
    const key = json([node.state, node.landed, node.agreed])
    if (!seen.has(key)) {
      seen.add(key)
      nodes.push(node)
      ALPHABET.filter((event) => event !== START || node.state.write.run < LAST_RUN).forEach(
        (event) => {
          const run = runOf(event)
          const to: Node = {
            state: armReducer(node.state, event),
            landed: withRun(node.landed, run, isLandedReceipt(event)),
            agreed: withRun(node.agreed, run, isAgreed(event)),
            path: [...node.path, event]
          }
          steps.push({ from: node, event, to })
          if (to.state !== node.state || to.landed !== node.landed || to.agreed !== node.agreed) {
            queue.push(to)
          }
        }
      )
    }
  }
  return { nodes, steps }
}

const WALK = walkAll()

const savedWithoutWitness = ({ state, landed, agreed }: Node) =>
  isSaved(state) && (!landed.includes(state.write.run) || !agreed.includes(state.write.run))

/** A small seeded generator, so a failing sequence repeats. */
const seeded = (seed: number) => {
  let value = seed
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648
    return value / 2147483648
  }
}

describe("the save's reducer", () => {
  it('reaches saved through the one path a save takes, and not without any of its write, check or wipe events', () => {
    const path: ArmEvent[] = [
      START,
      { type: 'prepared', run: 1, prepared: SAVE },
      { type: 'write', event: { type: 'gasChecked', run: 1, check: ENOUGH } },
      { type: 'write', event: { type: 'sent', run: 1, transactionHash: TX_HASH } },
      receipt(1, 1),
      { type: 'confirming', run: 1 },
      { type: 'confirmed', run: 1, outcome: { kind: 'agreed' } },
      { type: 'wiped', run: 1 }
    ]
    expect(isSaved(path.reduce(armReducer, initialArmState()))).toBe(true)
    // The prepared save is the run's to hold; the reducer itself does not wait for it.
    path
      .filter(({ type }) => type !== 'prepared')
      .forEach((skipped) => {
        const without = path.filter((event) => event !== skipped)
        expect(isSaved(without.reduce(armReducer, initialArmState()))).toBe(false)
      })
  })

  it('drops every event of a run other than the current one, from every state a sequence reaches', () => {
    const moved = WALK.steps
      .filter(({ from, event, to }) => {
        const run = runOf(event)
        return run !== undefined && run !== from.state.write.run && to.state !== from.state
      })
      .map(({ event, from }) => `${json(event)} after ${json(from.path)}`)
    expect(WALK.nodes.length).toBeGreaterThan(100)
    expect(moved).toEqual([])
  })

  it('never reads saved without a landed receipt and an agreed check of the same run, over every sequence', () => {
    const saved = WALK.nodes.filter(({ state }) => isSaved(state))
    // Saved is reached, in every run, so the check below is not empty.
    expect(new Set(saved.map(({ state }) => state.write.run))).toEqual(new Set([1, 2, 3]))
    expect(WALK.nodes.filter(savedWithoutWitness).map(({ path }) => json(path))).toEqual([])
  })

  it('never reads saved without a landed receipt and an agreed check of the same run, over long random sequences', () => {
    const random = seeded(51)
    const broken: string[] = []
    let savedSeen = 0
    for (let sequence = 0; sequence < 5_000; sequence += 1) {
      let node: Node = { state: initialArmState(), landed: [], agreed: [], path: [] }
      for (let step = 0; step < 30; step += 1) {
        // Mostly events of the current run, so long sequences reach saved too.
        const currentRun = node.state.write.run
        const current = ALPHABET.filter((held) => {
          const own = runOf(held)
          return own === undefined || own === currentRun
        })
        const pool = random() < 0.85 ? current : ALPHABET
        const event = pool[Math.floor(random() * pool.length)]
        const run = runOf(event)
        node = {
          state: armReducer(node.state, event),
          landed: withRun(node.landed, run, isLandedReceipt(event)),
          agreed: withRun(node.agreed, run, isAgreed(event)),
          path: [...node.path, event]
        }
        if (isSaved(node.state)) {
          savedSeen += 1
        }
        if (savedWithoutWitness(node)) {
          broken.push(json(node.path))
        }
      }
    }
    expect(savedSeen).toBeGreaterThan(0)
    expect(broken).toEqual([])
  })

  it('ends a run as already set up only while it reads the setup before the gas check, or after a refusal that may still land, dropping what it prepared', () => {
    const moved = WALK.steps.filter(
      ({ from, event, to }) => event.type === 'alreadySetUp' && to.state !== from.state
    )
    expect(moved.length).toBeGreaterThan(0)
    // Both readings are reached: the start's read and a refusal that may still land.
    expect(moved.some(({ from }) => mayStillLand(from.state.write))).toBe(true)
    expect(moved.some(({ from }) => from.state.write.status === 'checkingGas')).toBe(true)
    const wrong = moved
      .filter(
        ({ from, to }) =>
          (from.state.write.status !== 'checkingGas' && !mayStillLand(from.state.write)) ||
          to.state.stop !== 'already-set-up' ||
          to.state.write.status !== 'idle' ||
          to.state.prepared !== undefined
      )
      .map(({ from }) => json(from.path))
    expect(wrong).toEqual([])
  })

  it('moves nothing after a run ended as already set up, whatever event arrives', () => {
    const fromStopped = WALK.steps.filter(({ from }) => from.state.stop !== undefined)
    expect(fromStopped.length).toBeGreaterThan(0)
    const moved = fromStopped
      .filter(({ from, to }) => to.state !== from.state)
      .map(({ event, from }) => `${json(event)} after ${json(from.path)}`)
    expect(moved).toEqual([])
    expect(WALK.nodes.filter(({ state }) => state.stop !== undefined && isSaved(state))).toEqual([])
  })

  it("marks a receipt wait stalled only on a run that holds its batch's hash while it submits", () => {
    const stalls = WALK.steps.filter(
      ({ from, event, to }) => event.type === 'waitStalled' && to.state !== from.state
    )
    expect(stalls.length).toBeGreaterThan(0)
    const wrong = stalls
      .filter(
        ({ from, event }) =>
          from.state.write.status !== 'submitting' ||
          !from.state.write.transactionHash ||
          runOf(event) !== from.state.write.run
      )
      .map(({ from }) => json(from.path))
    expect(wrong).toEqual([])
  })

  it('reads no stalled wait once the write left submitting, in every state a sequence reaches', () => {
    expect(WALK.nodes.some(({ state }) => state.stalled === true)).toBe(true)
    expect(
      WALK.nodes
        .filter(({ state }) => state.stalled === true && state.write.status !== 'submitting')
        .map(({ path }) => json(path))
    ).toEqual([])
  })

  it("keeps the sign screen's reading only for the run that submits, and a new run starts with no reading, no stall and nothing prepared", () => {
    const readings = WALK.steps.filter(
      ({ from, event, to }) => event.type === 'estimated' && to.state !== from.state
    )
    expect(readings.length).toBeGreaterThan(0)
    expect(
      readings
        .filter(({ from }) => from.state.write.status !== 'submitting')
        .map(({ from }) => json(from.path))
    ).toEqual([])
    const newRuns = WALK.steps.filter(({ from, to }) => to.state.write.run !== from.state.write.run)
    expect(newRuns.length).toBeGreaterThan(0)
    expect(
      newRuns
        .filter(
          ({ to }) =>
            to.state.estimation !== undefined ||
            to.state.stalled !== undefined ||
            to.state.prepared !== undefined ||
            to.state.after.stage !== 'none'
        )
        .map(({ from }) => json(from.path))
    ).toEqual([])
  })

  it('takes no later check or wipe once the run read disagreed', () => {
    const disagreed = [
      START,
      { type: 'prepared', run: 1, prepared: SAVE },
      { type: 'write', event: { type: 'gasChecked', run: 1, check: ENOUGH } },
      { type: 'write', event: { type: 'sent', run: 1, transactionHash: TX_HASH } },
      receipt(1, 1),
      { type: 'confirming', run: 1 },
      { type: 'confirmed', run: 1, outcome: { kind: 'disagreed', check: 'mismatch' } }
    ].reduce<ArmState>((state, event) => armReducer(state, event as ArmEvent), initialArmState())
    const later: ArmEvent[] = [
      { type: 'confirming', run: 1 },
      { type: 'confirmed', run: 1, outcome: { kind: 'agreed' } },
      { type: 'wiped', run: 1 }
    ]
    expect(later.reduce(armReducer, disagreed)).toBe(disagreed)
  })
})
