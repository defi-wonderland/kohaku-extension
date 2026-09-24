/**
 * The UI's own port to the sign-message flow, for `createSignerFacade`: the
 * dispatch of `useBackgroundService`, the `signMessage` controller state the
 * background pushes over the event bus, and the accounts the wallet lists
 * (`useAccountsControllerState().accounts`).
 */
import eventBus from '@web/extension-services/event/eventBus'

import type {
  ListedAccount,
  SignMessageFlowAction,
  SignMessageFlowPort,
  SignMessageFlowState
} from './signer'

export const signMessageFlowPort = (
  dispatch: (action: SignMessageFlowAction) => void,
  accounts: () => readonly ListedAccount[] | undefined
): SignMessageFlowPort => ({
  dispatch,
  subscribe(listener) {
    const onUpdate = (state?: SignMessageFlowState) => listener(state ?? {})
    eventBus.addEventListener('signMessage', onUpdate)
    return () => eventBus.removeEventListener('signMessage', onUpdate)
  },
  accounts: () => accounts() ?? []
})
