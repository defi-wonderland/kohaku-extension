/**
 * The records' default storage: the extension's own helper over
 * `browser.storage.local` (D-310). No controller and no background message.
 */
import { get, remove, set } from '@web/extension-services/background/webapi/storage'

import type { RecordStorage } from './types'

export const extensionRecordStorage: RecordStorage = { get, set, remove }
