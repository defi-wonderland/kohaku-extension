/**
 * The warning's pure parts and its types, loadable in a Node test. The
 * components import React Native and the extension's contexts, so each is
 * imported by its own path: `onboarding/recover/RecoverScreen` for the route,
 * `onboarding/recover/WarningGate` for the warning in any form, and
 * `onboarding/recover/ResetEntryGate` for an entry that mounts behind it.
 */
export { FAST_TRACK_STEP_COUNTER_KEY, FAST_TRACK_STEPS, WARNING_STEP } from './constants'
export { warningCopyOf } from './copy'
export type {
  CondensedWarningProps,
  RecoverWarningProps,
  ResetEntryGateProps,
  ResetWarningProps,
  WarningCopy,
  WarningForm,
  WarningGateProps,
  WarningPointer
} from './types'
