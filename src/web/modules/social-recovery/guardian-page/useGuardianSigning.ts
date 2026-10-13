/**
 * The page's signing: the wallet's own key signs the typed data in the
 * wallet's sign window, or a signature made off this device is pasted back;
 * either way the approving side packages it into the reply and judges it
 * before the page keeps the approval line. One signing runs at a time, so a
 * second press while one runs does nothing, and nothing runs once the
 * approval exists. Nothing here holds a key.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'
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
  SigningFailure
} from './types'

const useGuardianSigning = ({
  approving,
  request,
  signTypedData
}: GuardianSigningInput): GuardianSigning => {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<SigningFailure | null>(null)
  const [offlineFailure, setOfflineFailure] = useState<OfflineFailure | null>(null)
  const [approval, setApproval] = useState<SignedApproval | null>(null)
  const running = useRef(false)
  const approved = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The reply the approving side packages from a signature, judged for the
  // request's own place.
  const outcomeOf = useCallback(
    async (typedData: TypedDataToSign, signature: Hex): Promise<ApprovalOutcome> => {
      if (!approving || !request) {
        return 'unpackaged'
      }
      const reply = await approving.replyFrom(request, typedData, { signature })
      if (reply.kind === 'reply-failure') {
        return 'unpackaged'
      }
      const verdict = await approving.verify(request, request.place, reply.proof)
      return { approval: { line: replyLineOf(reply), proof: reply.proof }, verdict }
    },
    [approving, request]
  )

  // Runs one signing to its end: the approval is kept, a failure is shown.
  const runOnce = useCallback(
    <F extends string>(work: () => Promise<F | SignedApproval>, onFailure: (f: F) => void) => {
      running.current = true
      setBusy(true)
      work()
        .then((result) => {
          if (!mounted.current) {
            return
          }
          if (typeof result === 'string') {
            onFailure(result)
          } else {
            approved.current = true
            setApproval(result)
          }
        })
        .finally(() => {
          running.current = false
          if (mounted.current) {
            setBusy(false)
          }
        })
    },
    []
  )

  const sign = useCallback(
    (key: KeyHandle, typedData: TypedDataToSign) => {
      if (running.current || approved.current) {
        return
      }
      setFailure(null)
      runOnce<SigningFailure>(async () => {
        let signature: Hex
        try {
          signature = await signTypedData(key, typedData)
        } catch (error: unknown) {
          return signingFailureOf(error)
        }
        try {
          const outcome = await outcomeOf(typedData, signature)
          if (outcome === 'unpackaged') {
            return 'failed'
          }
          return walletVerdictFailure(outcome.verdict) ?? outcome.approval
        } catch {
          return 'failed'
        }
      }, setFailure)
    },
    [signTypedData, outcomeOf, runOnce]
  )

  const addSignature = useCallback(
    (typedData: TypedDataToSign, text: string) => {
      if (running.current || approved.current) {
        return
      }
      const signature = pastedSignatureOf(text)
      if (!signature) {
        setOfflineFailure('notASignature')
        return
      }
      setOfflineFailure(null)
      runOnce<OfflineFailure>(async () => {
        try {
          const outcome = await outcomeOf(typedData, signature)
          if (outcome === 'unpackaged') {
            return 'notASignature'
          }
          return offlineVerdictFailure(outcome.verdict) ?? outcome.approval
        } catch {
          return 'notASignature'
        }
      }, setOfflineFailure)
    },
    [outcomeOf, runOnce]
  )

  return { busy, failure, offlineFailure, approval, sign, addSignature }
}

export default useGuardianSigning
