# PT-041 manual run in a Chrome profile

The Jest tests in this folder mock `navigator.credentials`, so no test here reaches a real authenticator. The passkey ceremony needs one, and the brief sets no Playwright run for this task. The coordinator lists every item below as untested in the pull request until someone runs it and records the result.

## Set-up

- Build a holder-facing build (`yarn build:web:webkit`) whose manifest carries the one public key every holder-facing build carries (D-314). Write down the extension id Chrome shows.
- Load it unpacked in a Chrome profile that has no other Kohaku build loaded (dev and prod share one extension id). Keep exactly one Kohaku tab open.
- Compute `sha256("chrome-extension://<id>")` outside the extension, for example `printf 'chrome-extension://<id>' | shasum -a 256`, to compare against the committed hash.
- Have at hand: a platform authenticator that syncs (Touch ID with iCloud Keychain), a device-bound authenticator (a hardware security key with no sync), and an Android phone with Google Password Manager for the hybrid QR hand-off. 1Password on a phone is optional, for the refusal note.

## What the run must cover

1. Full tab, never the popup: open the ceremony from the action popup. It must redirect to `tab.html#/social-recovery/ceremony` and the popup must close. The ceremony must never start inside the popup.
2. Enroll in the tab, synced: create a passkey with iCloud Keychain. The tab reports passed, the kind line reads synced, and the credential's authenticator data carries BE and BS. Check that the rp id hash in the authenticator data equals the hash from the set-up, not `sha256("<id>")`.
3. Enroll in the tab, device bound: create a passkey on the hardware key. The kind line reads device bound. The kind follows the flags, never the browser or the operating system.
4. Test access in the tab: run the test for the credential of item 2. The tab reports passed. Run it again with the other credential's record, so the check does not match. The tab reports test failed with its cause, never not tested.
5. Create claim in the tab: produce a claim for one place of a request. The assertion's `rpId` is the extension id. The method receives the signature.
6. High `s`: repeat item 5 with the Google Password Manager passkey over hybrid until an assertion comes back with `s > n/2` (the proof of concept saw one). The signature the method receives has `s = n - s`, and a verifier that rejects high `s` accepts it.
7. Dismiss: start each of enroll, test access and create claim, then cancel the browser's prompt. The row shows the cancelled note, the row is unchanged, and the method never ran (no enrollment failure, no failed verdict).
8. Refusal: let the browser refuse the ceremony (for example, cancel the security key's PIN prompt, or deny the platform prompt). The row shows the cancelled or refused note, never failed.
9. Hand-off to a phone: start test access, choose the phone, scan the QR code, and switch to another tab before approving on the phone. Nothing reaches the background while the ceremony tab is hidden. Return to the tab: the result appears then.
10. Hand-off that never connects: start the hand-off and never scan the code. After the wait the row reads unreachable with Try again. Try again starts a new hand-off.
11. Provider refusal: create the passkey in 1Password over hybrid. The row shows the provider-refused note that points at the browser's own passkey store, not a generic failure.
12. Relying-party mismatch: enroll with one build, then load a build signed with another manifest key (a different extension id) and run test access with the stored record. The passkey must not answer, and the row must never read passed. Where the lane reads the mismatch (a relying-party hash that differs from the committed one), the host reports it as the method's enrollment failure with the relying-party mismatch copy. Record which of the two the row showed.
13. Health check: open the health-check host. It reports not supported with no retry, and no authenticator prompt appears.

## Not covered by the proof of concept

- The iPhone hybrid routes. The proof of concept did not run them, so a run that skips them records them as untested and does not claim them.
- A second Apple device asserting the iCloud Keychain passkey.
- Safari and Firefox. The first release supports passkeys on Chromium alone (D-314).
