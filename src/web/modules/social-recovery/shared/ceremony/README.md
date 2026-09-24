# shared/ceremony

- PT-041 The ceremony tab and the method hosts

The full tab every ceremony that dies on focus loss runs in, and the hosts that drive a method's four calls: enroll, test access, create claim and health check (`docs/social-recovery/design/ux-interfaces.md` D-372, `ux.md` D-316). Every enrollment row of D-305 and every checklist row of D-392 opens its ceremony through this module.

## Files

| File | Holds |
| --- | --- |
| `verdicts.ts` | The closed outcome vocabulary: the four calls, the four verdicts, the two dismissal notes, the causes, and the mapping of a method's answer, a thrown error and the local check to one outcome. The chip, note and line keys each outcome renders. |
| `kindLine.ts` | The kind line's provider and device names, from the AAGUID and the platform. |
| `webauthn.ts` | The pure passkey rules: the relying party, the rp id hash, the authenticator data flags, the synced or device-bound kind, DER and the high-s rule, and the reading of the browser's own errors. |
| `visibility.ts` | The visibility gate of D-316. |
| `device.ts` | The device-call interface a host runs between the method's options and its packaging, and the device for material the caller already holds. |
| `passkeyDevice.ts` | The passkey device over an injected `navigator.credentials`. |
| `hosts.ts` | `enrollHost`, `testAccessHost`, `createClaimHost` and the `healthCheckHost` shell. |
| `request.ts` | The route's search params: parse, build, and the caller's path. |
| `channel.ts` | The return channel: the report the tab writes and the caller reads. |
| `run.ts` | `runCeremony`, which picks the host of a call, and the two gates: a full tab only, and passkeys only on a Chromium extension origin. |
| `index.ts` | The pure entry: everything above. No React, no `navigator`, no storage. |
| `screen/` | The tab screen (`CeremonyScreen`), the injected source (`CeremonySourceProvider`) and the browser's defaults (`browserDefaults.ts`). |

## The outcome vocabulary

Every host returns exactly one `CeremonyOutcome`:

| Outcome | Retry | When |
| --- | --- | --- |
| `passed` | no | The method produced its config or reply, and the local check (test access) answered satisfied. |
| `failed` with a cause | yes | The method's typed failure `material-rejected`, its `device-refused` for every binding but `external-app`, a thrown refusal (`thrown`), the check's `rejected` (`check-rejected`), a relying party the extension does not serve (`relying-party-mismatch`), or the browser's own error at a test or a claim (`browser-error`, its name in `detail`). UXC-13: never `notTested`. |
| `unavailable` with a cause | yes | `device-unavailable`, a node or a service that did not answer (`service-unanswered`, a resolver that failed among them), a phone hand-off that never connected (`unreachable`), or a check the local verifier cannot judge (`not-judged`). |
| `notSupported` | no | `method-unsupported`, `version-unread`, or no implementation or device in this build (`no-implementation`). |
| `dismissed` with `cancelled` or `refused` | yes | The browser's `NotAllowedError` at enrollment; `AbortError`, `InvalidStateError`, `ConstraintError` and `NotSupportedError` at every call. Each is read before the method runs. The one exception is an `external-app` method's `device-refused`, the refused note, since its device call runs inside `replyFrom`. A `browser-authenticator` method's refusal before the method is already the browser's error; a `device-refused` the method returns after it ran is a verdict, failed with that cause (UXC-13). |

"Before the method runs" means before its packaging, `configFrom` or `replyFrom`. The options calls `enrollInput` and `signingInput` run first, since the device needs their output, and act on nothing (sdk.md D-206).

### `NotAllowedError`, the coordinator's ruling

- At enrollment (`navigator.credentials.create`) it is the cancelled note, read before the method runs; an unfocused page or a permission policy reads the refused note.
- At a test or a claim (`navigator.credentials.get`) it is `failed` with the cause `browser-error` and the name `NotAllowedError`, as frame C-05 draws it ("Test failed · NotAllowedError · no credential available on this device"): the browser cannot tell a dismissed prompt from a missing credential.
- During a phone hand-off, at or past the prompt's timeout (180 seconds), it is `unavailable` with the cause `unreachable` at either call.

### What a row renders, by call

The chip, the note and the line depend on the call that ran: `chipOfOutcome(outcome, call)`, `noteKeyOfOutcome(outcome, call)` and `lineKeyOfOutcome(outcome, call)`. The test chips and the test lines apply to test access alone.

| Call | Passed | Failed | Unavailable | Not supported | Dismissed |
| --- | --- | --- | --- | --- | --- |
| `enroll` | chip `notTested` (a row reads not tested until its test runs, D-305, frame C-05h), no note; the kind line and its loss line | the row keeps its chip; `failedNote`, or `providerRefused` for a relying-party mismatch | the row keeps its chip; `unreachableNote` or `testUnavailableLine` | the row keeps its chip; `notSupportedNote` | the row keeps its chip; `cancelledNote` or `refusedNote` |
| `testAccess` | chip `tested`; `passedNote` with the proof's hash | chip `testFailed`; no note (frame C-05), or `relyingPartyMismatch` for a mismatch; line `testFailedLine`, or `testFailedNoMatch` for `check-rejected` | chip `testUnavailable`; `unreachableNote` or `testUnavailableLine`, shown once | chip `notSupported`; `notSupportedNote`; line `notSupportedLine` | as enroll |
| `createClaim` | chip `complete` of the checklist set (D-392); `passedNote` with the proof's hash | the row keeps its chip; `failedNote` or `relyingPartyMismatch`; no test line (frame D-07b) | as enroll | as enroll | as enroll |
| `healthCheck` | never | never | never | no chip; `notSupportedNote` | never |

### Causes on the screen

A screen shows no raw cause slug and no English message: each cause renders through the note or the line above. The one raw text is the browser's own error name, beside the note, as frame C-05 draws it (`browserErrorNameOf`).

| Cause | Renders as |
| --- | --- |
| `browser-error` | the error name, for example `NotAllowedError` |
| `relying-party-mismatch` | `providerRefused` at enrollment, `relyingPartyMismatch` at a test or a claim |
| `check-rejected` | `testFailedNoMatch` |
| `unreachable` | `unreachableNote` |
| `device-unavailable`, `service-unanswered`, `not-judged` | `testUnavailableLine` |
| `method-unsupported`, `version-unread`, `no-implementation` | `notSupportedNote` |
| `device-refused` | `refusedNote` for an `external-app` method; for any other binding a failed verdict, `failedNote` (at a test, the chip and `testFailedLine`) |
| `material-rejected`, `thrown` | `failedNote` (at a test, the chip and `testFailedLine`); no key names these causes yet, a gap reported to the coordinator |

## The passkey ceremony

- The extension calls the authenticator itself: `navigator.credentials.create` at enrollment, `navigator.credentials.get` at a test and a claim (D-372).
- `rp.id` and `rpId` are the extension's origin host, read at runtime from `window.location`; the lane commits to no extension id (open question 13).
- The lane owns the relying party id. For a `browser-authenticator` method the host sets `params.relyingPartyId` to the page's full origin string, `relyingPartyOf(location).relyingPartyId`, and replaces any value the caller passed. The device accepts only that full origin string back in the method's options: the bare id, an empty string or no value is a relying-party mismatch (D-314, D-372). The passkey device puts the host in the WebAuthn options and keeps every other member the method set.
- A `browser-authenticator` method always runs the page's own passkey device, never a device a caller's record supplies, so the rp id hash check and the high-s normalization always run.
- The rp id hash is `sha256("chrome-extension://<id>")`, never the hash of the bare id (D-314). The device compares the hash in the credential's own authenticator data against it and reports a mismatch before the method runs, at enrollment and at a claim.
- The kind is read from the ceremony's own flags: backup eligible (BE) is synced, otherwise device-bound. `backedUp` (BS), the attachment, the transports and the AAGUID are kept as facts; the place (this device, phone, security key) comes from the attachment and the transports. The kind and the provider are never read from the operating system (D-305); the device name of a device-bound passkey comes from the platform, as the table below states.
- The kind line (`kindLine.ts`) reads "Synced passkey · {{provider}}" or "Device-bound passkey · {{device}}", with the names of `socialRecovery.ceremony.providers` and `.devices`. The mapping:

  | Kind | Read from | Name |
  | --- | --- | --- |
  | synced | AAGUID `ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4` (Google Password Manager) | `providers.google` |
  | synced | AAGUID `fbfc3007-154e-4ecc-8c0b-6e020557d7bd` or `dd4ec289-e01d-41c9-bb89-70fa845d4bf2` (iCloud Keychain) | `providers.apple` |
  | synced | any other AAGUID, a zeroed one or none | `providers.passwordManager` |
  | device-bound | place `phone` (a phone over the hybrid route) | `devices.thisPhone` |
  | device-bound | place `this-device` on macOS | `devices.thisMac` |
  | device-bound | place `this-device` on Android or iOS | `devices.thisPhone` |
  | device-bound | place `this-device` elsewhere, a security key, or an unknown place | `devices.thisDevice` |

  The provider comes from the authenticator's own facts, the AAGUID, and never from the operating system (D-305). The device comes from the platform: `navigator.userAgentData.platform` where the browser has it, `navigator.platform` and the user agent otherwise. The AAGUIDs are those of the community list `passkeydeveloper/passkey-authenticator-aaguids`; the manual run confirms what Chrome returns under attestation `none`.
- A high `s` is lowered before the method receives the assertion: the DER signature is parsed, `s > n/2` becomes `n - s` over the P-256 order, and the signature is re-encoded. The method receives a field-by-field copy of the `PublicKeyCredential` with the lowered signature (`NormalizedAssertion`).
- The phone hand-off asks for a cross-platform authenticator with the `hybrid` hint. A `NotAllowedError` that arrives at or past the prompt's timeout (180 seconds) during a hand-off reads unreachable; before it, the ruling above applies.
- A page that is not a Chromium extension origin gets no passkey device: the host reports `notSupported` and the screen draws `chromeOnly`.

## The tab

The route is `WEB_ROUTES.socialRecoveryCeremony`, `tab.html#/social-recovery/ceremony?call=<call>&method=<kind>&id=<request id>[&handOff=phone][&returnTo=<path>]`. `ceremonyPath(params)` builds it. A caller in a tab navigates there in the same tab; TabOnlyRoute moves an open from the popup to a tab, and the screen itself refuses to run outside a full tab, since TabOnlyRoute keeps an action window that holds a current action.

The route mounts in the open group of `routes/SocialRecoveryRoutes.tsx`. The callers are the enrollment rows (D-305, the owner) and the checklist rows (D-392), and the fast track reaches the checklist from a fresh install (D-303), so the tab must not depend on a selected account. The tab reads no keystore and holds no signer. A guard would also send a tab that waits on a phone hand-off to the unlock screen on auto-lock and drop the result D-316 says arrives when the tab returns.

The screen:

1. parses the search params, and shows "nothing to run" on a malformed one; sweeps the reports past their expiry from storage;
2. waits until the tab is visible: a hidden tab dispatches nothing, the resolve included (D-316);
3. resolves the ceremony through `CeremonySourceProvider`'s `resolve(params)`; `null` means nothing waits under that id, a resolver that throws reads `unavailable` with retry, and no provider at all reports `notSupported` with the cause `no-implementation`;
4. runs `runCeremony` once the tab is visible, with the page's own passkey device for the `browser-authenticator` binding and an abort;
5. renders progress (the `inProgress` chip, or the phone hand-off copy), the abort, and the outcome by call;
6. reports the outcome through the return channel, then navigates to `returnTo` where the caller named one.

## The return channel

The tab writes one `CeremonyReport` (`{ id, call, method, outcome, reportedAt, expiresAt }`) under `socialRecoveryCeremonyResult:<request id>` in the extension's local storage (`storage` of `@web/extension-services/background/webapi/storage`, D-310). No background controller is involved.

The write goes through the visibility gate: while `document.visibilityState` is not `visible`, nothing is written; the held report is written, in order, when the tab is shown again (D-316). A tab closed while hidden drops its report, and the caller's row stays unchanged.

A passed claim's report carries the reply and its proof, approval material that must not outlive its use (D-310, I-38). So a report lives only until it is taken and never past its expiry, ten minutes from `reportedAt` (`CEREMONY_REPORT_TTL_MS`):

- `takeCeremonyReport({ id, call, method }, store)` delivers the report only where its id, call and method are the ones the caller expects and `reportedAt` is within the expiry, and removes it. An expired report is removed and reads null.
- `listenForCeremonyReport({ id, call, method }, subscribe, store, onReport)` delivers under the same checks, then removes the report.
- `readCeremonyReport` makes the same checks and removes nothing.
- `sweepCeremonyReports(store, keys)` removes every report past its expiry and every malformed one; the tab runs it on mount with `browserReportKeys()`.

The caller, the checklist row for a claim, files the reply into PT-040's session record at once, where I-38's wipe governs it, and keeps no copy of the report.

## The SDK doubles and the client

The ESLint fence forbids importing `sdk-doubles` anywhere outside `shared/client`, this lane and its tests included. The hosts and the tab therefore take the `IMethodsOrchestrator` and the `IRecoveryMethod` as injected parameters typed by `sdk-interfaces`, and never import the doubles. The screen reads them from `CeremonySourceProvider`, whose `resolve` returns a `ResolvedCeremony`. A test passes PT-035's doubles through `shared/client` or its own fakes.

Follow-up for PT-038: provide the resolver over the client and PT-040's records, mounted above the route, so the tab finds the orchestrator, the implementation and the inputs a request id names. Until then the tab runs nothing and reports `notSupported`.

## The health check

`healthCheckHost` is a shell (`HEALTH_CHECK_IS_SHELL`): the health check is a third-release feature (D-313), so the host answers `notSupported` with no retry and asks nothing of the method or the device. Replace it when the management surfaces that carry it land.

## Not claimed

- The iPhone hybrid routes were not run by the proof of concept; nothing here claims them.
- The flows of the external app (zkPassport) and the in-page prover (Aadhaar) run through a `device` the caller passes (`providedMaterialDevice` or its own); this lane builds the passkey device alone.
