/**
 * PT-039, done entries 2 and 3, through the real en.json: the step names the
 * sending key's address, the amount and the network; it says a transfer out
 * of the account the key operates is itself an operation that key must pay
 * for; the recovery call's step says the execution after the waiting period
 * is a second funding asked for again at the fee of that day and promises
 * nowhere that one funding covers both; no string names a faucet; no string
 * carries a banned word of ux-copy.md.
 *
 * The strings are the ones the two views lay out: `renderWriteState` and
 * `renderDepositStep` answer them and `WriteStateView` and `DepositStepView`
 * show every field (views.test.ts). Jest here does not transform JSX, so the
 * views themselves are read, not mounted.
 *
 * Sources: docs/social-recovery/tasks/PT-039-the-shared-write-states-and-the-gas-step.md
 * ("Done", "Body"), briefs/PT-039.md ("Test expectations"), design/ux.md
 * D-303 and D-393 (the second funding), D-312 (no faucet link), D-319 and
 * D-307 (the blocker's two routes and the transfer sentence),
 * design/ux-interfaces.md D-373, design/ux-copy.md.
 */
import {
  ACCOUNT_REF,
  ATTEMPT_ENDS,
  banHits,
  collectStrings,
  CONTROLLER,
  copyOfBlocker,
  copyOfState,
  copyOfStep,
  depositStepFor,
  failBeforeHash,
  failThrown,
  failWithReceipt,
  GWEI,
  KEY,
  kitError,
  LANE,
  minedAndReverted,
  NETWORK,
  ONE_FUNDING_COVERS_BOTH,
  renderGasAmount,
  STEP_CASES,
  submittingFor,
  text,
  UNRESOLVED,
  userRejected,
  WRITE_KINDS
} from './harness'

const TRANSFER_IS_AN_OPERATION =
  /\ba transfer out of the account (?:the|that) key operates is itself an operation that key must (?:send and )?pay for\b/i
const SECOND_FUNDING = /\bsecond (?:funding|transaction)\b/i
const ASKED_AGAIN = /\bagain\b/i
const FEE_OF_THAT_DAY = /\b(?:that day's fee|the fee of that day)\b/i
const CANNOT_PAY_FOR_ITSELF = /\bthe account cannot pay for itself until it is recovered\b/i
const FAUCET = /faucet/i
const LINK = /\bhttps?:\/\/|\bwww\./i

const TRANSFER_CASES = STEP_CASES.filter((c) => !c.fastTrack)
const RECOVERY_CASES = STEP_CASES.filter((c) => c.write === 'submission' || c.write === 'execution')
const FAST_TRACK_CASES = STEP_CASES.filter((c) => c.fastTrack)

/** Every string the lane renders: each variant of the step and its blocker, and every state of every write. */
const everyRenderedString = async (): Promise<string[]> => {
  const steps = await Promise.all(
    STEP_CASES.map(async ({ write, fastTrack }) => {
      const step = await depositStepFor(write, fastTrack)
      return [...copyOfStep(step), ...copyOfBlocker(step)]
    })
  )
  const states = WRITE_KINDS.flatMap((write) => [
    ...copyOfState(submittingFor(write)),
    ...copyOfState(failBeforeHash(write, userRejected())),
    ...copyOfState(failWithReceipt(write, kitError('AttemptAlreadyActive'))),
    ...copyOfState(failWithReceipt(write)),
    ...copyOfState(failThrown(write, minedAndReverted()))
  ])
  const cancels = ATTEMPT_ENDS.flatMap((ended) =>
    copyOfState(
      failWithReceipt('cancel', kitError('NoActiveAttempt'), { ended, controller: CONTROLLER })
    )
  )
  return [...steps.flat(), ...states, ...cancels]
}

describe('the deposit step, rendered through en.json', () => {
  STEP_CASES.forEach(({ name, write, fastTrack }) =>
    describe(name, () => {
      it("shows the sending key's address in full", async () => {
        const rendered = text(copyOfStep(await depositStepFor(write, fastTrack))).toLowerCase()
        expect(rendered).toContain(KEY.addr.toLowerCase())
      })

      it('shows the amount the check estimated, in the native unit', async () => {
        const step = await depositStepFor(write, fastTrack)
        expect(text(copyOfStep(step))).toContain(
          renderGasAmount(step.shortfall, NETWORK.nativeAssetSymbol)
        )
      })

      it('renders a different amount for a different estimate', async () => {
        const low = text(copyOfStep(await depositStepFor(write, fastTrack, 100_000n, GWEI)))
        const high = text(copyOfStep(await depositStepFor(write, fastTrack, 900_000n, 40n * GWEI)))
        expect(low).not.toEqual(high)
      })

      it('names the network the key must be funded on', async () => {
        expect(text(copyOfStep(await depositStepFor(write, fastTrack)))).toContain(NETWORK.name)
      })
    })
  )

  TRANSFER_CASES.forEach(({ name, write }) =>
    describe(`${name}: the two routes`, () => {
      it('says a transfer out of the account the key operates is itself an operation that key must pay for', async () => {
        expect(text(copyOfStep(await depositStepFor(write, false)))).toMatch(
          TRANSFER_IS_AN_OPERATION
        )
      })

      it('offers the transfer from the account this wallet holds and the deposit from outside', async () => {
        const rendered = text(copyOfStep(await depositStepFor(write, false)))
        expect(rendered).toMatch(new RegExp(`\\btransfer\\b.*\\b${ACCOUNT_REF.name}\\b`, 'i'))
        expect(rendered).toMatch(/\bfrom outside\b/i)
      })
    })
  )

  RECOVERY_CASES.forEach(({ name, write, fastTrack }) =>
    describe(`${name}: the second funding (D-303, D-393, D-373)`, () => {
      it('says the execution after the waiting period is a second funding', async () => {
        const rendered = text(copyOfStep(await depositStepFor(write, fastTrack)))
        expect(rendered).toMatch(SECOND_FUNDING)
        expect(rendered).toMatch(/\bwaiting period\b/i)
      })

      it('says the wallet asks for it again at the fee of that day', async () => {
        const rendered = text(copyOfStep(await depositStepFor(write, fastTrack)))
        expect(rendered).toMatch(ASKED_AGAIN)
        expect(rendered).toMatch(FEE_OF_THAT_DAY)
      })
    })
  )

  FAST_TRACK_CASES.forEach(({ name, write }) =>
    describe(`${name} (D-303)`, () => {
      it('names the key as the sending key', async () => {
        expect(text(copyOfStep(await depositStepFor(write, true)))).toMatch(
          /\bthe key that sends\b/i
        )
      })

      it('says the account cannot pay for itself until it is recovered', async () => {
        expect(text(copyOfStep(await depositStepFor(write, true)))).toMatch(CANNOT_PAY_FOR_ITSELF)
      })
    })
  )
})

describe('what no string of the lane says', () => {
  it('no rendered string contains faucet or a link (D-312)', async () => {
    const strings = await everyRenderedString()
    expect(strings.length).toBeGreaterThan(50)
    expect(strings.filter((s) => FAUCET.test(s))).toEqual([])
    expect(strings.filter((s) => LINK.test(s))).toEqual([])
  })

  it('no rendered string says one funding covers both (D-303)', async () => {
    const strings = await everyRenderedString()
    expect(strings.filter((s) => ONE_FUNDING_COVERS_BOTH.test(s))).toEqual([])
  })

  it('no rendered string carries a banned word of ux-copy.md', async () => {
    expect(banHits(await everyRenderedString())).toEqual([])
  })

  it('no exported string of the lane names a faucet, promises one funding or carries a banned word', () => {
    const exported = collectStrings(LANE)
    expect(exported).toEqual(expect.arrayContaining(['submitting', 'failedNotSent']))
    expect(exported.filter((s) => FAUCET.test(s))).toEqual([])
    expect(exported.filter((s) => ONE_FUNDING_COVERS_BOTH.test(s))).toEqual([])
    expect(banHits(exported)).toEqual([])
  })

  it('every rendered string resolves in en.json: no raw key and no unfilled placeholder', async () => {
    const unresolved = Array.from(
      new Set((await everyRenderedString()).filter((s) => UNRESOLVED.test(s)))
    ).sort()
    expect(unresolved).toEqual([])
  })
})
