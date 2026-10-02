/**
 * The check after a landed save, read as the save reads it: each answer the
 * client's `confirmSetup` can give, a second read where the first did not find
 * the setup, and a check that throws or never answers.
 */
import {
  COMMITMENT_MISMATCH_CODE,
  CONFIRM_READ_TIMEOUT_MS,
  confirmOutcomeOf,
  outcomeOfConfirmation,
  outcomeOfConfirmFailure
} from '@web/modules/social-recovery/setup/arm'
import type { SetupConfirmation } from '@web/modules/social-recovery/sdk-interfaces'

import { codedError, confirmation } from '@web/modules/social-recovery/setup/arm/__tests__/harness'

const reads = (...answers: (SetupConfirmation | Error | 'never')[]) => {
  let index = 0
  return jest.fn(() => {
    const answer = answers[Math.min(index, answers.length - 1)]
    index += 1
    if (answer === 'never') {
      return new Promise<SetupConfirmation>(() => {})
    }
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  })
}

describe('one answer of the check', () => {
  it('agrees only where the setup landed and the module recognizes the authorization', () => {
    expect(outcomeOfConfirmation(confirmation(true, true))).toEqual({ kind: 'agreed' })
    expect(outcomeOfConfirmation(confirmation(true, false))).toEqual({
      kind: 'disagreed',
      check: 'authorization'
    })
  })

  it('reads a setup the check did not find as not yet decided, whatever the authorization reads', () => {
    expect(outcomeOfConfirmation(confirmation(false, true))).toBeNull()
    expect(outcomeOfConfirmation(confirmation(false, false))).toBeNull()
  })

  it("reads the commitment's coded mismatch as that disagreement, and any other throw as unanswered", () => {
    expect(outcomeOfConfirmFailure(codedError(COMMITMENT_MISMATCH_CODE))).toEqual({
      kind: 'disagreed',
      check: 'mismatch'
    })
    expect(outcomeOfConfirmFailure(codedError('confirm.no-commit-call'))).toEqual({
      kind: 'unread'
    })
    expect(outcomeOfConfirmFailure(new Error(COMMITMENT_MISMATCH_CODE))).toEqual({ kind: 'unread' })
    expect(outcomeOfConfirmFailure(undefined)).toEqual({ kind: 'unread' })
    expect(outcomeOfConfirmFailure('confirm.commitment-mismatch')).toEqual({ kind: 'unread' })
  })
})

describe('the check as the save reads it', () => {
  it('reads once where the first answer decides', async () => {
    const agreed = reads(confirmation(true, true))
    expect(await confirmOutcomeOf(agreed)).toEqual({ kind: 'agreed' })
    expect(agreed).toHaveBeenCalledTimes(1)

    const unauthorized = reads(confirmation(true, false))
    expect(await confirmOutcomeOf(unauthorized)).toEqual({
      kind: 'disagreed',
      check: 'authorization'
    })
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('reads once more where the setup was not found, then reads it as the mismatch', async () => {
    const check = reads(confirmation(false, true))
    expect(await confirmOutcomeOf(check)).toEqual({ kind: 'disagreed', check: 'mismatch' })
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('agrees where the second read finds the setup landed and authorized', async () => {
    const check = reads(confirmation(false, true), confirmation(true, true))
    expect(await confirmOutcomeOf(check)).toEqual({ kind: 'agreed' })
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('reads the authorization disagreement where the second read finds the setup unauthorized', async () => {
    const check = reads(confirmation(false, true), confirmation(true, false))
    expect(await confirmOutcomeOf(check)).toEqual({ kind: 'disagreed', check: 'authorization' })
  })

  it('reads a mismatch thrown at the second read as the mismatch, and another throw as unanswered', async () => {
    expect(
      await confirmOutcomeOf(reads(confirmation(false, true), codedError(COMMITMENT_MISMATCH_CODE)))
    ).toEqual({ kind: 'disagreed', check: 'mismatch' })
    expect(
      await confirmOutcomeOf(reads(confirmation(false, true), new Error('node down')))
    ).toEqual({ kind: 'unread' })
  })

  it('reads a check that throws as unanswered, never as agreed', async () => {
    expect(await confirmOutcomeOf(reads(new Error('node down')))).toEqual({ kind: 'unread' })
    expect(
      await confirmOutcomeOf(() => {
        throw new Error('synchronous')
      })
    ).toEqual({
      kind: 'unread'
    })
  })

  it('reads a check that does not answer in time as unanswered', async () => {
    jest.useFakeTimers()
    try {
      const outcome = confirmOutcomeOf(reads('never'))
      jest.advanceTimersByTime(CONFIRM_READ_TIMEOUT_MS - 1)
      let settled = false
      outcome.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
      await Promise.resolve()
      expect(settled).toBe(false)
      jest.advanceTimersByTime(1)
      expect(await outcome).toEqual({ kind: 'unread' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('gives the second read its own time limit', async () => {
    const check = reads(confirmation(false, true), 'never')
    expect(await confirmOutcomeOf(check, { timeoutMs: 10 })).toEqual({ kind: 'unread' })
    expect(check).toHaveBeenCalledTimes(2)
  })
})
