/**
 * The browser's own defaults of the ceremony tab: the extension's local
 * storage for the report, its change events for a caller that listens, and the
 * passkey device over `navigator.credentials` at this page's own origin.
 */
import { browser, isExtension } from '@web/constants/browserapi'
import { storage } from '@web/extension-services/background/webapi/storage'

import type { ReportStore, ReportSubscribe } from '../channel'
import type { CeremonyDevice } from '../device'
import { createPasskeyDevice } from '../passkeyDevice'
import { passkeysServed } from '../run'
import { relyingPartyOf } from '../webauthn'

/** The extension's local storage (D-310), the web build's localStorage outside an extension. */
export const browserReportStore: ReportStore = storage

/** Storage change events for one key: `storage.onChanged` in the extension, `storage` events outside. */
export const browserReportSubscribe: ReportSubscribe = (key, onValue) => {
  if (isExtension && browser?.storage?.onChanged) {
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && changes[key] && changes[key].newValue !== undefined) {
        onValue(changes[key].newValue)
      }
    }
    browser.storage.onChanged.addListener(listener)
    return () => browser.storage.onChanged.removeListener(listener)
  }
  const listener = (event: StorageEvent) => {
    if (event.key === key && event.newValue !== null) onValue(event.newValue)
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}

/** Whether this page serves passkeys: a Chromium extension origin with `navigator.credentials`. */
export const pagePasskeysServed = (): boolean =>
  passkeysServed({
    protocol: window.location.protocol,
    hasCredentials: typeof navigator !== 'undefined' && !!navigator.credentials
  })

/**
 * The passkey device of this page, or undefined where the page serves no
 * passkey (a Gecko or Safari build, or the web dev server): the host then
 * reports not supported and the screen draws "passkeys need Kohaku on Chrome".
 */
export const browserPasskeyDevice = (): CeremonyDevice | undefined =>
  pagePasskeysServed()
    ? createPasskeyDevice({
        credentials: navigator.credentials,
        relyingParty: relyingPartyOf(window.location)
      })
    : undefined
