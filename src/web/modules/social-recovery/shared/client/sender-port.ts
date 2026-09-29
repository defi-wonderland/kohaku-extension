/**
 * The UI's own port to the request queue and the activity, for
 * `createSendPort`: the dispatch and the window id of `useBackgroundService`,
 * the `requests`, `activity`, `main` and `signAccountOp` controller states the
 * background pushes over the event bus, and the accounts the wallet lists
 * (`useAccountsControllerState().accounts`). The background pushes a null
 * `signAccountOp` state once the sign screen closes.
 */
import eventBus from '@web/extension-services/event/eventBus'

import type {
  ActivityState,
  ListedAccount,
  MainStatusState,
  SendQueueState,
  SendRequestAction,
  SendRequestPort,
  SignAccountOpState
} from './types'

export const sendRequestPort = (
  dispatch: (action: SendRequestAction) => void,
  accounts: () => readonly ListedAccount[] | undefined,
  windowId?: number
): SendRequestPort => ({
  dispatch,
  subscribe(listener) {
    const onRequests = (state?: SendQueueState) =>
      listener({ controller: 'requests', state: state ?? {} })
    const onActivity = (state?: ActivityState) =>
      listener({ controller: 'activity', state: state ?? {} })
    const onMain = (state?: MainStatusState) => listener({ controller: 'main', state: state ?? {} })
    const onSignAccountOp = (state?: SignAccountOpState | null) =>
      listener({ controller: 'signAccountOp', state: state ?? {} })
    eventBus.addEventListener('requests', onRequests)
    eventBus.addEventListener('activity', onActivity)
    eventBus.addEventListener('main', onMain)
    eventBus.addEventListener('signAccountOp', onSignAccountOp)
    return () => {
      eventBus.removeEventListener('requests', onRequests)
      eventBus.removeEventListener('activity', onActivity)
      eventBus.removeEventListener('main', onMain)
      eventBus.removeEventListener('signAccountOp', onSignAccountOp)
    }
  },
  accounts: () => accounts() ?? [],
  windowId: () => windowId
})
