/**
 * shared/writes (PT-039): the submitting and failed states every write of the
 * chapter shares, and the gas check with its deposit step. See README.md
 * beside this file.
 *
 * The two React components live in `./components`, imported by path, so this
 * module loads in a Node test without the UI.
 */
export {
  WRITE_KINDS,
  OWNER_WRITES,
  RECOVERY_CALLS,
  PAYERS,
  isWriteKind,
  isOwnerWrite,
  isRecoveryCall,
  payerOf,
  assertWriteDoor,
  type WriteKind,
  type OwnerWrite,
  type RecoveryCall,
  type Payer
} from './kinds'
export {
  WRITE_STATUSES,
  FAILED_STATUSES,
  isFailedState,
  canRetry,
  offersMoveFunds,
  type WriteStatus,
  type FailedStatus,
  type IdleState,
  type CheckingGasState,
  type NeedsDepositState,
  type SubmittingState,
  type LandedState,
  type FailedNotSentState,
  type FailedRevertedState,
  type FailedState,
  type WriteState
} from './states'
export {
  ATTEMPT_ENDS,
  REVERT_CAUSE_KINDS,
  receiptOf,
  writeFailureOf,
  revertCauseOf,
  gasSpentOf,
  classifyFailure,
  settleReceipt,
  type WriteReceipt,
  type WriteFailure,
  type AttemptEnd,
  type AttemptAfterCancel,
  type RevertCause,
  type FailureContext
} from './classify'
export { WRITE_EVENT_TYPES, initialWriteState, writeReducer, type WriteEvent } from './machine'
export {
  NATIVE_DECIMALS,
  FEE_HEADROOM_PERCENT,
  GAS_DISPLAY_DECIMALS,
  DEPOSIT_ROUTES,
  roundUpForDisplay,
  roundDownForDisplay,
  gasEstimateOf,
  gasTransactionOf,
  holdsEnough,
  depositStepOf,
  checkGas,
  type GasNetwork,
  type WalletAccountRef,
  type GasEstimate,
  type DepositRouteKind,
  type DepositRoute,
  type DepositStep,
  type GasCheck,
  type GasCheckInput
} from './gas'
export {
  WRITES_KEYS,
  GAS_KEYS,
  REVERTED_KEYS,
  UNNAMED_CAUSE_KEY,
  causeKey,
  cancelGoneRoadKey,
  OWNER_SHORTFALL_KEYS,
  renderGasAmount,
  renderGasBalance,
  renderRevertCause,
  renderWriteState,
  renderDepositStep,
  type RenderedWriteState,
  type RenderedRoute,
  type RenderedDepositStep
} from './copy'
