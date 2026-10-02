/**
 * The save on arrival and the pure readings the view lays out: which arrival
 * lets the save start, the block each of the review's reads raises, the
 * account's facts, the screen each run state shows, the cost line, the save's
 * own words over the shared write states, and where the saved screen leads.
 */
import type { Account } from '@ambire-common/interfaces/account'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import { levelFromSearch } from '@web/modules/social-recovery/setup/card'
import { initialWriteState, writeReducer } from '@web/modules/social-recovery/shared/writes'
import type { WriteEvent, WriteState } from '@web/modules/social-recovery/shared/writes'

import {
  armReducer,
  armScreenOf,
  arrivalOf,
  cardPathOf,
  costLineKeyOf,
  disagreedLineKeyOf,
  explorerTransactionUrlOf,
  initialArmState,
  saveWriteKeysOf
} from '@web/modules/social-recovery/setup/arm'
import type { ArmEvent, ArmState } from '@web/modules/social-recovery/setup/arm'

import {
  arrivalFor,
  CLIENT_CASES,
  COMMIT,
  crossProduct,
  draftOf,
  factsReadingFor,
  FACTS_CASES,
  GATE_CASES,
  gateFor,
  loadedOf,
  smartAccount,
  TX_HASH
} from './harness'
import type { ArrivalCase } from './harness'

let account: Account

beforeAll(async () => {
  account = await smartAccount()
})

const READY: ArrivalCase = { gate: 'passes', facts: 'ready', client: 'ready', passwordHeld: true }

describe('the arrival', () => {
  it('lets the save start only where the gate passes, the facts are ready with a key, the client is ready and the password is held', () => {
    const ready = crossProduct({
      gate: GATE_CASES,
      facts: FACTS_CASES,
      client: CLIENT_CASES,
      passwordHeld: [true, false]
    }).filter((input) => arrivalFor(input, account).kind === 'ready')
    expect(ready).toEqual([READY])
  })
  ;(
    [
      ['unavailable', { kind: 'unavailable' }],
      ['removed-key-unreadable', { kind: 'removed-key-unreadable' }],
      ['does-not-fit', { kind: 'cannot-recover', reason: 'not-supported' }],
      ['key-count', { kind: 'cannot-recover', reason: 'key-count', count: 2 }],
      ['several-keys', { kind: 'cannot-recover', reason: 'key-count' }],
      ['already-set-up', { kind: 'already-set-up' }],
      ['empty-slot', { kind: 'empty-slot' }],
      ['password-not-set', { kind: 'password-missing' }]
    ] as const
  ).forEach(([gate, block]) =>
    it(`blocks with the review gate block raised by ${gate}`, () => {
      expect(arrivalFor({ ...READY, gate }, account)).toEqual({ kind: 'blocked', block })
    })
  )

  it('sends an encrypted save whose recovery password is no longer in memory back to the privacy step', () => {
    expect(arrivalFor({ ...READY, passwordHeld: false }, account)).toEqual({
      kind: 'blocked',
      block: { kind: 'password-missing' }
    })
  })
  ;(['clear', 'empty'] as const).forEach((backup) =>
    it(`needs no recovery password in memory at a ${backup} backup`, () => {
      expect(
        arrivalOf({
          facts: factsReadingFor('ready', account),
          client: 'ready',
          load: loadedOf(draftOf(backup)),
          gate: gateFor('passes'),
          passwordHeld: false
        })
      ).toEqual({ kind: 'ready' })
    })
  )
  ;(
    [
      ['loading', { kind: 'loading' }],
      ['not-listed', { kind: 'unavailable', retry: null }],
      ['no-network', { kind: 'unavailable', retry: null }],
      ['state-unread', { kind: 'unavailable', retry: 'facts' }],
      ['view-only', { kind: 'unavailable', retry: null }]
    ] as const
  ).forEach(([facts, arrival]) =>
    it(`reads the account facts ${facts} as not ready`, () => {
      expect(arrivalFor({ ...READY, facts }, account)).toEqual(arrival)
    })
  )

  it('reads a facts reading before the gate, so a view-only account never shows the gate block', () => {
    expect(arrivalFor({ ...READY, facts: 'view-only', gate: 'already-set-up' }, account)).toEqual({
      kind: 'unavailable',
      retry: null
    })
  })
  ;(
    [
      ['loading', { kind: 'loading' }],
      ['update-the-wallet', { kind: 'update-the-wallet' }],
      ['failed', { kind: 'unavailable', retry: 'client' }]
    ] as const
  ).forEach(([client, arrival]) =>
    it(`reads a client ${client} as not ready`, () => {
      expect(arrivalFor({ ...READY, client }, account)).toEqual(arrival)
    })
  )

  it('reads records that could not load as their own failure, and records still loading as loading', () => {
    const base = {
      facts: factsReadingFor('ready', account),
      client: 'ready' as const,
      gate: gateFor('passes'),
      passwordHeld: true
    }
    expect(arrivalOf({ ...base, load: { status: 'failed' } })).toEqual({ kind: 'load-failed' })
    expect(arrivalOf({ ...base, load: { status: 'loading' } })).toEqual({ kind: 'loading' })
  })

  it('waits while a read of the gate has not come back, with no block shown', () => {
    expect(
      arrivalOf({
        facts: factsReadingFor('ready', account),
        client: 'ready',
        load: loadedOf(draftOf()),
        gate: { canSave: false, blocked: null, notTested: false },
        passwordHeld: true
      })
    ).toEqual({ kind: 'loading' })
  })
})

describe('the screen a save shows', () => {
  const apply = (events: ArmEvent[], from: ArmState = initialArmState()) =>
    events.reduce(armReducer, from)
  const write = (event: WriteEvent): ArmEvent => ({ type: 'write', event })
  const ENOUGH = {
    kind: 'enough' as const,
    write: 'save' as const,
    key: COMMIT.target,
    estimate: { gas: 1n, gasPrice: 1n, cost: 1n, required: 1n },
    balance: 1n
  }
  const landed = apply([
    write({ type: 'start' }),
    write({ type: 'gasChecked', run: 1, check: ENOUGH }),
    write({ type: 'sent', run: 1, transactionHash: TX_HASH }),
    write({ type: 'receipt', run: 1, receipt: { transactionHash: TX_HASH, status: 1 } })
  ])

  it('shows the arrival before any run, and the run once it started, whatever it reads', () => {
    expect(armScreenOf(initialArmState())).toBe('arrival')
    expect(armScreenOf(apply([write({ type: 'start' })]))).toBe('run')
    expect(armScreenOf(landed)).toBe('run')
  })

  it('shows the check running, then saved only after the wipe, or the disagreement, or the unanswered check', () => {
    const confirming = apply([{ type: 'confirming', run: 1 }], landed)
    expect(armScreenOf(confirming)).toBe('confirming')
    const saving = apply([{ type: 'confirmed', run: 1, outcome: { kind: 'agreed' } }], confirming)
    expect(armScreenOf(saving)).toBe('confirming')
    expect(armScreenOf(apply([{ type: 'wiped', run: 1 }], saving))).toBe('saved')
    expect(
      armScreenOf(
        apply(
          [{ type: 'confirmed', run: 1, outcome: { kind: 'disagreed', check: 'mismatch' } }],
          confirming
        )
      )
    ).toBe('disagreed')
    expect(
      armScreenOf(apply([{ type: 'confirmed', run: 1, outcome: { kind: 'unread' } }], confirming))
    ).toBe('unread')
  })
})

describe('the lines the view reads', () => {
  it('names the deployment in the cost line only for an account with no code', () => {
    expect(costLineKeyOf(true)).toBe('socialRecovery.costLines.save')
    expect(costLineKeyOf(false)).toBe('socialRecovery.costLines.saveDeploys')
  })

  it("sets the save's own title and sentence over the shared write states", () => {
    const states: WriteState[] = [
      { status: 'submitting', write: 'save' },
      { status: 'failedNotSent', write: 'save', error: new Error('refused') },
      {
        status: 'failedNotSent',
        write: 'save',
        error: new Error('replaced'),
        replaced: 'replaced'
      },
      {
        status: 'failedReverted',
        write: 'save',
        transactionHash: TX_HASH,
        receipt: { transactionHash: TX_HASH, status: 0 },
        cause: { kind: 'unnamed' }
      },
      writeReducer(initialWriteState('save'), { type: 'start' })
    ]
    expect(states.map(saveWriteKeysOf)).toEqual([
      { note: 'socialRecovery.review.after.submitting' },
      {
        title: 'socialRecovery.review.after.failedTitle',
        note: 'socialRecovery.review.after.notSent'
      },
      { title: 'socialRecovery.review.after.failedTitle' },
      { title: 'socialRecovery.review.after.failedTitle' },
      {}
    ])
  })

  it('names the check that disagreed', () => {
    expect(disagreedLineKeyOf('mismatch')).toBe('socialRecovery.arm.disagreed.mismatch')
    expect(disagreedLineKeyOf('authorization')).toBe(
      'socialRecovery.arm.disagreed.authorizationUnrecognized'
    )
  })

  it('leads Continue to the card with the level it shows, which the card reads back', () => {
    const hidden = cardPathOf('hidden')
    const shown = cardPathOf('public')
    expect(hidden.startsWith(`/${WEB_ROUTES.socialRecoverySetupCard}?`)).toBe(true)
    expect(levelFromSearch(hidden.slice(hidden.indexOf('?')))).toBe('hidden')
    expect(levelFromSearch(shown.slice(shown.indexOf('?')))).toBe('public')
  })

  it("opens the transaction on the recovery chain's explorer", () => {
    expect(explorerTransactionUrlOf('sepolia', TX_HASH)).toBe(
      `https://sepolia.etherscan.io/tx/${TX_HASH}`
    )
    expect(explorerTransactionUrlOf('mainnet', TX_HASH)).toBe(`https://etherscan.io/tx/${TX_HASH}`)
  })
})
