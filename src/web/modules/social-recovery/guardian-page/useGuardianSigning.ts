/**
 * The page's signing: the wallet's own key signs the typed data in the
 * wallet's sign window, or a signature made off this device is pasted back;
 * either way the approving side packages it into the reply and judges it
 * before the page keeps the approval line. One signing runs at a time, so a
 * second press while one runs does nothing, and nothing runs once the
 * approval exists. The state belongs to the request the page shows: another
 * link opened in the same tab starts with none, and an answer for the
 * request it replaced is dropped. Nothing here holds a key.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ApproverRequest, Hex } from '@web/modules/social-recovery/sdk-interfaces'
import { replyLineOf } from '@web/modules/social-recovery/recovery/checklist'
import type { KeyHandle, TypedDataToSign } from '@web/modules/social-recovery/shared/client'

import {
  offlineVerdictFailure,
  pastedSignatureOf,
  signingFailureOf,
  walletVerdictFailure
} from './signing'
import type {
  ApprovalOutcome,
  GuardianSigning,
  GuardianSigningInput,
  OfflineFailure,
  SignedApproval,
  SigningFailure,
  SigningState
} from './types'

const idleFor = (request: ApproverRequest | null): SigningState => ({
  request,
  busy: false,
  failure: null,
  offlineFailure: null,
  approval: null
})

const useGuardianSigning = ({
  approving,
  request,
  signTypedData
}: GuardianSigningInput): GuardianSigning => {
  const [state, setState] = useState<SigningState>(() => idleFor(request))
  const current = state.request === request ? state : idleFor(request)
  const requestRef = useRef(request)
  requestRef.current = request
  // The request whose signing runs, and the request that has its approval.
  const running = useRef<ApproverRequest | null>(null)
  const approved = useRef<ApproverRequest | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // A signing's answer counts only while the page still shows its request.
  const update = useCallback((owner: ApproverRequest, change: Partial<SigningState>) => {
    if (!mounted.current || requestRef.current !== owner) {
      return
    }
    setState((prev) => ({ ...(prev.request === owner ? prev : idleFor(owner)), ...change }))
  }, [])

  // The reply the approving side packages from a signature, judged for the
  // request's own place.
  const outcomeOf = useCallback(
    async (
      owner: ApproverRequest,
      typedData: TypedDataToSign,
      signature: Hex
    ): Promise<ApprovalOutcome> => {
      if (!approving) {
        return 'unpackaged'
      }
      const reply = await approving.replyFrom(owner, typedData, { signature })
      if (reply.kind === 'reply-failure') {
        return 'unpackaged'
      }
      const verdict = await approving.verify(owner, owner.place, reply.proof)
      return { approval: { line: replyLineOf(reply), proof: reply.proof }, verdict }
    },
    [approving]
  )

  // Runs one signing to its end: the approval is kept, a failure is shown.
  const runOnce = useCallback(
    <F extends string>(
      owner: ApproverRequest,
      work: () => Promise<F | SignedApproval>,
      failureOf: (f: F) => Partial<SigningState>
    ) => {
      running.current = owner
      update(owner, { busy: true })
      work()
        .then((result) => {
          if (requestRef.current !== owner) {
            return
          }
          if (typeof result === 'string') {
            update(owner, failureOf(result))
          } else {
            approved.current = owner
            update(owner, { approval: result })
          }
        })
        .finally(() => {
          if (running.current === owner) {
            running.current = null
          }
          update(owner, { busy: false })
        })
    },
    [update]
  )

  const idle = useCallback(
    (owner: ApproverRequest | null): owner is ApproverRequest =>
      !!owner && running.current !== owner && approved.current !== owner,
    []
  )

  const sign = useCallback(
    (key: KeyHandle, typedData: TypedDataToSign) => {
      const owner = requestRef.current
      if (!idle(owner)) {
        return
      }
      update(owner, { failure: null })
      runOnce<SigningFailure>(
        owner,
        async () => {
          let signature: Hex
          try {
            signature = await signTypedData(key, typedData)
          } catch (error: unknown) {
            return signingFailureOf(error)
          }
          try {
            const outcome = await outcomeOf(owner, typedData, signature)
            if (outcome === 'unpackaged') {
              return 'failed'
            }
            return walletVerdictFailure(outcome.verdict) ?? outcome.approval
          } catch {
            return 'failed'
          }
        },
        (failure) => ({ failure })
      )
    },
    [idle, update, signTypedData, outcomeOf, runOnce]
  )

  const addSignature = useCallback(
    (typedData: TypedDataToSign, text: string) => {
      const owner = requestRef.current
      if (!idle(owner)) {
        return
      }
      const signature = pastedSignatureOf(text)
      if (!signature) {
        update(owner, { offlineFailure: 'notASignature' })
        return
      }
      update(owner, { offlineFailure: null })
      runOnce<OfflineFailure>(
        owner,
        async () => {
          try {
            const outcome = await outcomeOf(owner, typedData, signature)
            if (outcome === 'unpackaged') {
              return 'notASignature'
            }
            return offlineVerdictFailure(outcome.verdict) ?? outcome.approval
          } catch {
            return 'notASignature'
          }
        },
        (offlineFailure) => ({ offlineFailure })
      )
    },
    [idle, update, outcomeOf, runOnce]
  )

  const { busy, failure, offlineFailure, approval } = current
  return { busy, failure, offlineFailure, approval, sign, addSignature }
}

export default useGuardianSigning
