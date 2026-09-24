/**
 * The wallet's own reads, the cut-q-22 seam of PT-035 under the name screens
 * use.
 *
 * Three reads the ux chapter asks for are not SDK members (sdk.md D-201;
 * docs/social-recovery/tasks/README.md, open question 4): the verify per
 * pasted reply (ux-interfaces.md D-373, D-374), the key a recovery would
 * remove (D-371, ux.md D-319) and the fit check against the code the account
 * will carry (D-371, D-319). The doubles script them as `IWalletReadsDouble`;
 * this lane hands them to screens as `WalletReads`, so no screen imports the
 * doubles' name and the real implementation replaces the double here alone.
 * Each read throws when it could not be made and never answers empty.
 */
import type {
  FitCheckReading,
  IWalletReadsDouble,
  RemovedKeyReading,
  RemovedKeyUnavailableCause
} from '@web/modules/social-recovery/sdk-doubles'

export { REMOVED_KEY_UNAVAILABLE_CAUSES } from '@web/modules/social-recovery/sdk-doubles'

export type WalletReads = IWalletReadsDouble
export type { FitCheckReading, RemovedKeyReading, RemovedKeyUnavailableCause }
