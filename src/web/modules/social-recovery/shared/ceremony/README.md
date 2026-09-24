# shared/ceremony

- PT-041 The ceremony tab and the method hosts

The full tab every ceremony that dies on focus loss runs in, and the hosts that drive a method's four calls: enroll, test access, create claim and health check (`docs/social-recovery/design/ux-interfaces.md` D-372, `ux.md` D-316). Every enrollment row of D-305 and every checklist row of D-392 opens its ceremony through this module.

## Files

| File | Holds |
| --- | --- |
| `verdicts.ts` | The closed outcome vocabulary: the four calls, the four verdicts, the two dismissal notes, the causes, and the mapping of a method's answer, a thrown error and the local check to one outcome. The chip, note and line keys each outcome renders. |
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

| Outcome | Chip (PT-036) | Retry | When |
| --- | --- | --- | --- |
| `passed` | `tested` | no | The method produced its config or reply, and the local check (test access) answered satisfied. |
| `failed` with a cause | `testFailed` | yes | The method's typed failure `material-rejected`, a thrown refusal (`thrown`), the check's `rejected` (`check-rejected`), or a relying party the extension does not serve (`relying-party-mismatch`). UXC-13: never `notTested`. |
| `unavailable` with a cause | `testUnavailable` | yes | `device-unavailable`, a node or a service that did not answer (`service-unanswered`), a phone hand-off that never connected (`unreachable`), or a check the local verifier cannot judge (`not-judged`). |
| `notSupported` | `notSupported` | no | `method-unsupported`, `version-unread`, or no implementation or device in this build (`no-implementation`). |
| `dismissed` with `cancelled` or `refused` | none, the row keeps its chip | yes | The browser's own error before the method runs: `NotAllowedError` and `AbortError` read cancelled (an unfocused page or a permission policy reads refused); `InvalidStateError`, `ConstraintError` and `NotSupportedError` read refused. The method's own `device-refused` reads refused too. |

"Before the method runs" means before its packaging, `configFrom` or `replyFrom`. The options calls `enrollInput` and `signingInput` run first, since the device needs their output, and act on nothing (sdk.md D-206).

`noteKeyOfOutcome` and `lineKeyOfOutcome` give the `socialRecovery.ceremony.*` note and line a row renders. A relying-party mismatch reads `providerRefused` at enrollment and `relyingPartyMismatch` at a test or a claim.

## The passkey ceremony

- The extension calls the authenticator itself: `navigator.credentials.create` at enrollment, `navigator.credentials.get` at a test and a claim (D-372).
- `rp.id` and `rpId` are the extension's origin host, read at runtime from `window.location`; the lane commits to no extension id (open question 13).
- The method receives the full origin string `chrome-extension://<id>` as its relying party id (D-372). The passkey device replaces it with the host in the WebAuthn options and keeps every other member the method set.
- The rp id hash is `sha256("chrome-extension://<id>")`, never the hash of the bare id (D-314). The device compares the hash in the credential's own authenticator data against it and reports a mismatch before the method runs, at enrollment and at a claim.
- The kind is read from the ceremony's own flags: backup eligible (BE) is synced, otherwise device-bound. `backedUp` (BS), the attachment, the transports and the AAGUID are kept as facts; the place (this device, phone, security key) comes from the attachment and the transports. Nothing is read from the operating system (D-305).
- A high `s` is lowered before the method receives the assertion: the DER signature is parsed, `s > n/2` becomes `n - s` over the P-256 order, and the signature is re-encoded. The method receives a field-by-field copy of the `PublicKeyCredential` with the lowered signature (`NormalizedAssertion`).
- The phone hand-off asks for a cross-platform authenticator with the `hybrid` hint. A `NotAllowedError` that arrives at or past the prompt's timeout (180 seconds) during a hand-off reads unreachable; before it, cancelled.
- A page that is not a Chromium extension origin gets no passkey device: the host reports `notSupported` and the screen draws `chromeOnly`.

## The tab

The route is `WEB_ROUTES.socialRecoveryCeremony`, `tab.html#/social-recovery/ceremony?call=<call>&method=<kind>&id=<request id>[&handOff=phone][&returnTo=<path>]`. `ceremonyPath(params)` builds it. A caller in a tab navigates there in the same tab; TabOnlyRoute moves an open from the popup to a tab, and the screen itself refuses to run outside a full tab, since TabOnlyRoute keeps an action window that holds a current action.

The route mounts in the open group of `routes/SocialRecoveryRoutes.tsx`. The callers are the enrollment rows (D-305, the owner) and the checklist rows (D-392), and the fast track reaches the checklist from a fresh install (D-303), so the tab must not depend on a selected account. The tab reads no keystore and holds no signer. A guard would also send a tab that waits on a phone hand-off to the unlock screen on auto-lock and drop the result D-316 says arrives when the tab returns.

The screen:

1. parses the search params, and shows "nothing to run" on a malformed one;
2. resolves the ceremony through `CeremonySourceProvider`'s `resolve(params)`; `null` means nothing waits under that id, and no provider at all reports `notSupported` with the cause `no-implementation`;
3. waits until the tab is visible, since the browser refuses a prompt without focus, then runs `runCeremony` with the passkey device for the `browser-authenticator` binding and an abort;
4. renders progress (the `inProgress` chip, or the phone hand-off copy), the abort, and the outcome;
5. reports the outcome through the return channel, then navigates to `returnTo` where the caller named one.

## The return channel

The tab writes one `CeremonyReport` (`{ id, call, method, outcome, reportedAt }`) under `socialRecoveryCeremonyResult:<request id>` in the extension's local storage (`storage` of `@web/extension-services/background/webapi/storage`, D-310). No background controller is involved.

The write goes through the visibility gate: while `document.visibilityState` is not `visible`, nothing is written; the held report is written, in order, when the tab is shown again (D-316). A tab closed while hidden drops its report, and the caller's row stays unchanged.

The caller reads the report when it mounts again with `takeCeremonyReport(id, store)`, which removes it so an outcome applies once, or listens with `listenForCeremonyReport(id, subscribe, onReport)` and `browserReportSubscribe` from `screen/`.

## The SDK doubles and the client

The ESLint fence forbids importing `sdk-doubles` anywhere outside `shared/client`, this lane and its tests included. The hosts and the tab therefore take the `IMethodsOrchestrator` and the `IRecoveryMethod` as injected parameters typed by `sdk-interfaces`, and never import the doubles. The screen reads them from `CeremonySourceProvider`, whose `resolve` returns a `ResolvedCeremony`. A test passes PT-035's doubles through `shared/client` or its own fakes.

Follow-up for PT-038: provide the resolver over the client and PT-040's records, mounted above the route, so the tab finds the orchestrator, the implementation and the inputs a request id names. Until then the tab runs nothing and reports `notSupported`.

## The health check

`healthCheckHost` is a shell (`HEALTH_CHECK_IS_SHELL`): the health check is a third-release feature (D-313), so the host answers `notSupported` with no retry and asks nothing of the method or the device. Replace it when the management surfaces that carry it land.

## Not claimed

- The iPhone hybrid routes were not run by the proof of concept; nothing here claims them.
- The flows of the external app (zkPassport) and the in-page prover (Aadhaar) run through a `device` the caller passes (`providedMaterialDevice` or its own); this lane builds the passkey device alone.
