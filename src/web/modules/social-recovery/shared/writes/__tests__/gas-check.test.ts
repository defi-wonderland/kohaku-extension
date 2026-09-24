/**
 * PT-039, done entry 2: the gas step estimates the transaction's own gas
 * through the extension's provider, names the sending key's address, the
 * amount and the network, and offers a transfer from another account this
 * wallet holds and a deposit from outside. The step is skipped when the key
 * already holds enough.
 *
 * Sources: docs/social-recovery/tasks/PT-039-the-shared-write-states-and-the-gas-step.md
 * ("Done", "Body"), briefs/PT-039.md ("Shape", "Test expectations"),
 * design/ux-interfaces.md D-373 (the SDK estimates nothing; the extension's
 * provider estimates and reads the balance), design/ux.md D-303, D-319, D-307,
 * D-393 (on the logged-in route the step offers both routes).
 */
import {
  ACCOUNT,
  CHAPTER_WRITES,
  EXECUTION,
  GWEI,
  KEY,
  mockReads,
  NETWORK,
  OTHER_KEY,
  ownerTransaction,
  readingOf,
  runGasCheck,
  stateAfterGasCheck,
  stepOf,
  SUBMISSION,
  WRITE_KINDS,
  writeReducer,
  initialWriteState
} from './harness'

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

describe('the gas check', () => {
  it('runs for every write the chapter names: the setup save, the submission, the execution, the cancel', () => {
    expect(WRITE_KINDS).toEqual(expect.arrayContaining(CHAPTER_WRITES))
  })

  WRITE_KINDS.forEach((write) =>
    describe(write, () => {
      describe('a key that holds less than the estimate', () => {
        const short = () => mockReads({ balance: 0n, gas: 180_000n, price: 3n * GWEI })

        it('yields the deposit step, not enough', async () => {
          const check = await runGasCheck({ write, reads: short() })
          expect(check.kind).toBe('deposit')
        })

        it("names the sending key's address", async () => {
          expect(same(stepOf(await runGasCheck({ write, reads: short() })).key, KEY.addr)).toBe(
            true
          )
          const other = stepOf(await runGasCheck({ write, key: OTHER_KEY, reads: short() }))
          expect(same(other.key, OTHER_KEY.addr)).toBe(true)
        })

        it('carries the estimated amount: at least the estimate times the gas price', async () => {
          const step = stepOf(await runGasCheck({ write, reads: short() }))
          expect(step.estimate.gas).toBe(180_000n)
          expect(step.estimate.cost).toBe(180_000n * 3n * GWEI)
          expect(step.shortfall).toBeGreaterThanOrEqual(step.estimate.cost)
          step.routes.forEach((route) =>
            expect(route.amount).toBeGreaterThanOrEqual(step.shortfall)
          )
        })

        it('names the network the key must be funded on', async () => {
          const step = stepOf(await runGasCheck({ write, reads: short() }))
          expect(step.network.name).toBe(NETWORK.name)
        })

        it('offers both routes: a transfer from the account this wallet holds and a deposit from outside', async () => {
          const step = stepOf(await runGasCheck({ write, reads: short() }))
          expect(step.routes.map((route) => route.kind).sort()).toEqual(['outside', 'transfer'])
          step.routes.forEach((route) => expect(same(route.to, KEY.addr)).toBe(true))
          const transfer = step.routes.find((route) => route.kind === 'transfer')
          expect(transfer?.kind === 'transfer' && same(transfer.from.address, ACCOUNT)).toBe(true)
        })

        it('a key with some balance, still short, yields the step for what it lacks', async () => {
          const step = stepOf(
            await runGasCheck({
              write,
              reads: mockReads({ balance: 100_000n * GWEI, gas: 180_000n, price: 3n * GWEI })
            })
          )
          expect(step.balance).toBe(100_000n * GWEI)
          expect(step.shortfall).toBe(step.estimate.required - step.balance)
        })

        it('goes to the deposit step rather than to submitting', async () => {
          const state = stateAfterGasCheck(await runGasCheck({ write, reads: short() }))
          expect(state.status).toBe('needsDeposit')
        })
      })

      describe('a key that holds enough', () => {
        const rich = () => mockReads({ balance: 10n ** 18n, gas: 180_000n, price: 3n * GWEI })

        it('yields enough', async () => {
          expect((await runGasCheck({ write, reads: rich() })).kind).toBe('enough')
        })

        it('skips the step: the write goes on to submitting', async () => {
          const state = stateAfterGasCheck(await runGasCheck({ write, reads: rich() }))
          expect(state.status).toBe('submitting')
        })
      })
    })
  )

  describe('the fast track (D-303)', () => {
    ;(['submission', 'execution'] as const).forEach((write) =>
      it(`${write}: the step names the sending key and offers the deposit from outside into its address`, async () => {
        const step = stepOf(
          await runGasCheck({
            write,
            fastTrack: true,
            reads: mockReads({ balance: 0n, gas: 90_000n })
          })
        )
        expect(step.fastTrack).toBe(true)
        expect(same(step.key, KEY.addr)).toBe(true)
        expect(step.network.name).toBe(NETWORK.name)
        const outside = step.routes.find((route) => route.kind === 'outside')
        expect(outside && same(outside.to, KEY.addr)).toBe(true)
      })
    )
  })

  describe('the estimate is for that transaction, through the provider (D-373)', () => {
    it("asks the provider's estimate for the submission as prepared, sent from the sending key", async () => {
      const reads = mockReads({ balance: 0n, gas: 180_000n })
      await runGasCheck({ write: 'submission', reads })

      expect(reads.estimateGas).toHaveBeenCalledTimes(1)
      const [call] = reads.estimateGas.mock.calls[0]
      expect(same(call.from, KEY.addr)).toBe(true)
      expect(same(call.to, SUBMISSION.target)).toBe(true)
      expect(call.data).toBe(SUBMISSION.data)
    })

    it('another transaction gets its own estimate', async () => {
      const reads = mockReads({ balance: 0n, gas: 180_000n })
      await runGasCheck({ write: 'execution', reads })

      const [call] = reads.estimateGas.mock.calls[0]
      expect(same(call.to, EXECUTION.target)).toBe(true)
      expect(call.data).toBe(EXECUTION.data)
    })
    ;(['save', 'ownerWrite', 'cancel'] as const).forEach((write) =>
      it(`${write}: asks the estimate for the transaction the key sends for that write`, async () => {
        const reads = mockReads({ balance: 0n, gas: 180_000n })
        await runGasCheck({ write, reads })

        expect(reads.estimateGas).toHaveBeenCalledTimes(1)
        expect(reads.estimateGas.mock.calls[0][0]).toEqual(ownerTransaction(write))
      })
    )

    it("reads the sending key's balance through the provider", async () => {
      const reads = mockReads({ balance: 0n, gas: 180_000n })
      await runGasCheck({ write: 'submission', key: OTHER_KEY, reads })

      expect(reads.nativeBalance).toHaveBeenCalled()
      const addresses = reads.nativeBalance.mock.calls.map(([address]) => String(address))
      expect(addresses.every((address) => same(address, OTHER_KEY.addr))).toBe(true)
    })

    it('the amount follows the estimate of each transaction, not a constant', async () => {
      const perCall = (call: { data: string }) =>
        call.data === SUBMISSION.data ? 150_000n : 450_000n
      const submission = stepOf(
        await runGasCheck({ write: 'submission', reads: mockReads({ balance: 0n, gas: perCall }) })
      )
      const execution = stepOf(
        await runGasCheck({ write: 'execution', reads: mockReads({ balance: 0n, gas: perCall }) })
      )
      expect(submission.estimate.gas).toBe(150_000n)
      expect(execution.estimate.gas).toBe(450_000n)
      expect(execution.shortfall).toBeGreaterThan(submission.shortfall)
    })

    it('a larger estimate or a higher fee on the same transaction asks for more', async () => {
      const at = async (gas: bigint, price: bigint) =>
        stepOf(
          await runGasCheck({ write: 'submission', reads: mockReads({ balance: 0n, gas, price }) })
        )
      const base = await at(60_000n, GWEI)
      expect((await at(600_000n, GWEI)).shortfall).toBeGreaterThan(base.shortfall)
      expect((await at(60_000n, 30n * GWEI)).shortfall).toBeGreaterThan(base.shortfall)
    })

    it('the same balance is enough for a small estimate and short for a large one', async () => {
      const balance = 800_000n * GWEI
      const small = await runGasCheck({
        write: 'submission',
        reads: mockReads({ balance, gas: 21_000n, price: 2n * GWEI })
      })
      const large = await runGasCheck({
        write: 'submission',
        reads: mockReads({ balance, gas: 5_000_000n, price: 2n * GWEI })
      })
      expect(small.kind).toBe('enough')
      expect(large.kind).toBe('deposit')
    })

    it('a read that fails leaves the write in the first reading: nothing was sent', async () => {
      const reads = mockReads({ balance: 0n, gas: 1n })
      reads.estimateGas.mockRejectedValueOnce(new Error('node down'))
      const checking = writeReducer(initialWriteState('submission'), { type: 'start' })
      const failure = await runGasCheck({ write: 'submission', reads }).catch((error) => error)
      expect(failure).toBeInstanceOf(Error)
      expect(readingOf(writeReducer(checking, { type: 'error', error: failure }))).toBe('notSent')
    })
  })
})
