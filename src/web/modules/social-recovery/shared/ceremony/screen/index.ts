/**
 * The ceremony tab screen and the source it reads its ceremony from. Kept
 * apart from the lane's pure entry, since it imports React, the browser and
 * the extension's storage.
 */
import CeremonyScreen from './CeremonyScreen'

export { CeremonySourceProvider, useCeremonySource } from './CeremonySource'
export type { CeremonySource } from './CeremonySource'
export {
  browserPasskeyDevice,
  browserReportStore,
  browserReportSubscribe,
  pagePasskeysServed,
  pagePlatform
} from './browserDefaults'

export default CeremonyScreen
