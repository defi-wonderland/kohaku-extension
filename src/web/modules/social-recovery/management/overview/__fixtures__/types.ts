import type { OverviewIntent } from '@web/modules/social-recovery/management/overview/types'
import type { RecoveryKitClient } from '@web/modules/social-recovery/shared/client'
import type { sdkStandIn as StandIn } from '@web/modules/social-recovery/shared/client/stand-in'
import type { RecoveryClientState } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import type { ChainId, WalletRecords } from '@web/modules/social-recovery/shared/records'

/** The client state the screen's hook hands back, with its retry. */
export type ClientState = RecoveryClientState & { retry: () => void }

/** A setup committed on the stand-in's chain, the client built over it and records in memory. */
export interface World {
  chain: ReturnType<typeof StandIn.chainFor>
  client: RecoveryKitClient
  records: WalletRecords
}

export interface ReadsProbeProps {
  client: ClientState
  records: WalletRecords
  chainId: ChainId
  onOpen: (intent: OverviewIntent) => void
}
