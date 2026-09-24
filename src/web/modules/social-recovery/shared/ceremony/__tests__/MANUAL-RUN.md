# PT-041 manual run in a Chrome profile

The Jest tests in this folder mock `navigator.credentials`, so no test here reaches a real authenticator. The passkey ceremony needs one, and the brief sets no Playwright run for this task. The coordinator lists every item below as untested in the pull request until someone runs it and records the result.

## Before the run is possible

The tab resolves its ceremony through `CeremonySourceProvider`. No provider is mounted until PT-038's follow-up wires a resolver over the client and PT-040's records, and without one the tab reports not supported (`no-implementation`) for every call. A run before that needs a development-only provider mounted above the route that hands the tab an orchestrator, a passkey method and a request. Record which one the run used.

## Set-up

- Build a holder-facing build (`yarn build:web:webkit`) whose manifest carries the one public key every holder-facing build carries (D-314). Write down the extension id Chrome shows.
- Load it unpacked in a Chrome profile that has no other Kohaku build loaded (dev and prod share one extension id). Keep exactly one Kohaku tab open.
- Compute `sha256("chrome-extension://<id>")` outside the extension, for example `printf 'chrome-extension://<id>' | shasum -a 256`, to compare against the committed hash.
- Have at hand: a platform authenticator that syncs (Touch ID with iCloud Keychain), a device-bound authenticator (a hardware security key with no sync), and an Android phone with Google Password Manager for the hybrid QR hand-off. 1Password on a phone is optional, for the refusal note.

## What the run must cover

1. Full tab, never the popup: open the ceremony from the action popup. It must redirect to `tab.html#/social-recovery/ceremony` and the popup must close. The ceremony must never start inside the popup or inside an action window.
2. Enroll in the tab, synced: create a passkey with iCloud Keychain. The tab reports passed and the kind line reads "Synced passkey · Apple". Record the AAGUID Chrome returned under attestation `none`: a zeroed AAGUID makes the line read "your password manager" instead, which the tests cannot see. Check that the credential's authenticator data carries BE, and that its rp id hash equals the hash from the set-up, not `sha256("<id>")`.
3. Enroll in the tab, device bound: create a passkey on the hardware key. The kind line reads "Device-bound passkey · this device". Where a platform authenticator on the Mac gives a device-bound passkey, the line reads "this Mac". The kind follows the BE flag alone.
4. Test access in the tab: run the test for the credential of item 2. The tab reports passed. Run it again with the other credential's record, so the check does not match. The tab reports test failed with its cause, never not tested.
5. Create claim in the tab: produce a claim for one place of a request. The assertion's `rpId` is the extension id. The method receives the signature.
6. High `s`: repeat item 5 with the Google Password Manager passkey over hybrid until an assertion comes back with `s > n/2` (the proof of concept saw one). The signature the method receives has `s = n - s`, and a verifier that rejects high `s` accepts it.
7. Dismiss: start each of enroll, test access and create claim, then cancel the browser's prompt. The row shows the cancelled note, the row is unchanged, and the method never ran (no enrollment failure, no failed verdict).
8. Refusal: let the browser refuse the ceremony (for example, cancel the security key's PIN prompt, or deny the platform prompt). The row shows the cancelled or refused note, never failed. Record which error name Chrome gave.
9. Hand-off to a phone: start test access with the phone hand-off, scan the QR code, and switch to another tab before approving on the phone. Nothing is written to the extension storage (`socialRecoveryCeremonyResult:<id>`) while the ceremony tab is hidden. Return to the tab: the report is written then.
10. Hand-off that never connects: start the hand-off and never scan the code. Once the prompt's 180 seconds run out, the row reads unreachable with Try again, not cancelled. Close the prompt early instead and the row reads cancelled. Try again starts a new hand-off.
11. Provider refusal: create the passkey in 1Password over hybrid. The lane reads a `SecurityError` as the provider-refused note that points at the browser's own passkey store. Record the error name Chrome gives for 1Password: a `NotAllowedError` would read cancelled instead.
12. Relying-party mismatch: enroll with one build, then load a build signed with another manifest key (a different extension id) and run test access with the stored record. The passkey must not answer, and the row must never read passed. Where the authenticator data carries a hash other than this origin's, the host reports the relying-party mismatch before the method runs. Record what the row showed.
13. Health check: open the health-check host. It reports not supported with no retry, and no authenticator prompt appears.

## Not covered by the proof of concept

- The iPhone hybrid routes. The proof of concept did not run them, so a run that skips them records them as untested and does not claim them.
- A second Apple device asserting the iCloud Keychain passkey.
- Safari and Firefox. The first release supports passkeys on Chromium alone (D-314); on another build the tab draws "Passkeys need Kohaku on Chrome".
