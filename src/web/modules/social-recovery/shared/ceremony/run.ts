/**
 * The ceremony a tab runs, from its params and what the caller's record
 * resolves to, and the two gates the tab keeps before it runs anything.
 * Pure: no React, no `navigator`, no storage.
 */
import type {
  Address,
  ApproverRequest,
  DeviceBinding,
  IMethodsOrchestrator,
  IRecoveryMethod
} from '@web/modules/social-recovery/sdk-interfaces'

import type { CeremonyDevice, CeremonyStep } from './device'
import { createClaimHost, enrollHost, healthCheckHost, testAccessHost } from './hosts'
import type { CeremonyParams } from './request'
import { CeremonyOutcome, failed } from './verdicts'

/**
 * What the caller's record resolves to: the injected orchestrator and method
 * implementation (typed by `sdk-interfaces`, never the doubles), and the
 * inputs of the call. Enroll needs `methodAddress` and `params`; test access
 * and create claim need `request`. A method whose material the caller already
 * holds (a guardian's address or signature, a zkPassport result, an Aadhaar
 * QR) passes its own `device`.
 */
export interface ResolvedCeremony {
  orchestrator: IMethodsOrchestrator
  method: IRecoveryMethod
  methodAddress?: Address
  params?: unknown
  request?: ApproverRequest
  device?: CeremonyDevice
}

/** Finds the ceremony a request id names; null where nothing waits under it. */
export type CeremonyResolver = (params: CeremonyParams) => Promise<ResolvedCeremony | null>

export interface RunDeps {
  devices?: Partial<Record<DeviceBinding, CeremonyDevice>>
  signal?: AbortSignal
  onStep?: (step: CeremonyStep) => void
}

/** Runs the host of `params.call` and returns its one outcome. */
export const runCeremony = async (
  params: CeremonyParams,
  resolved: ResolvedCeremony,
  deps: RunDeps = {}
): Promise<CeremonyOutcome<unknown>> => {
  const context = {
    orchestrator: resolved.orchestrator,
    method: resolved.method,
    device: resolved.device,
    devices: deps.devices,
    handOff: params.handOff,
    signal: deps.signal,
    onStep: deps.onStep
  }
  switch (params.call) {
    case 'enroll':
      if (!resolved.methodAddress) return failed('thrown', 'The ceremony names no method address.')
      return enrollHost({
        ...context,
        methodAddress: resolved.methodAddress,
        params: resolved.params
      })
    case 'testAccess':
      if (!resolved.request) return failed('thrown', 'The ceremony names no request.')
      return testAccessHost({ ...context, request: resolved.request, params: resolved.params })
    case 'createClaim':
      if (!resolved.request) return failed('thrown', 'The ceremony names no request.')
      return createClaimHost({ ...context, request: resolved.request, params: resolved.params })
    case 'healthCheck':
    default:
      return healthCheckHost(context)
  }
}

/**
 * Whether this surface may run a ceremony: a full tab, never the action popup
 * and never the action window (D-316). TabOnlyRoute already moves the popup to
 * a tab; it keeps an action window that holds a current action, so the screen
 * keeps this gate too.
 */
export const ceremonyMayRun = (ui: {
  isTab: boolean
  isPopup: boolean
  isActionWindow: boolean
}): boolean => ui.isTab && !ui.isPopup && !ui.isActionWindow

/**
 * Whether this page can serve a passkey: a Chromium extension origin with a
 * credentials container (D-314, D-305). Any other build draws the one state
 * "passkeys need Kohaku on Chrome" and runs no passkey ceremony.
 */
export const passkeysServed = (page: { protocol: string; hasCredentials: boolean }): boolean =>
  page.protocol === 'chrome-extension:' && page.hasCredentials
