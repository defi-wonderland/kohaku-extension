# Passkey relying-party proof of concept, 2026-09-23

The build-poc that answers cut-q-24 of arc/R-17 and the first-day test D-314 owes. Built and run on 2026-09-23 in the Kohaku extension repository on the branch `feat/passkey-rp-poc`, five commits from 72922ab25 to 3af7f66b4, under `src/web/poc/passkey-rp/`. The README of that folder follows verbatim; the raw results of every run, automated and manual, stand beside this note as `passkey-rp-poc-2026-09-23-results.json`. What became of the findings is recorded by the ux round that consumes this note.

---

# Passkey relying party PoC

Development-only extension pages that answer the first-day questions of the social recovery passkey design (D-314, relying party choice; D-305, guardian approval route). They are not part of the product and do not ship in store builds.

## Pages

| Page | Question |
| --- | --- |
| `extension-rp.html` | Can the extension create and assert a resident ES256 passkey with `rp.id = chrome.runtime.id`, and what rp id hash does the authenticator commit? |
| `domain-rp.html` | Can the extension origin use a domain it controls as `rp.id` (the D-314 fallback), and what makes the origin eligible? |
| `injected-provider.html` | Does another wallet's provider reach a page served from Kohaku's own `chrome-extension://` origin? |

Each ceremony page shows the rp id hash candidates, the fixed challenge (`sha256("kohaku/passkey-rp-poc/fixed-challenge/v1")`), and the client capabilities. Results carry a `checks` object that the page computes itself: which preimage the `rpIdHash` in the authenticator data matches, whether the COSE key matches the SPKI, ES256, user verification, backup state, and a WebCrypto verification of the assertion signature. "Copy records as JSON" exports the public key record so an assertion made in another install can be verified by pasting that record.

## How to open them

webpack copies this folder to `poc/passkey-rp` in development builds, or in any build with `KOHAKU_PASSKEY_POC=true`:

```bash
KOHAKU_PASSKEY_POC=true npm run build:web:webkit
```

Load the unpacked build and open `chrome-extension://<extension id>/poc/passkey-rp/index.html`. The extension id comes from `BROWSER_EXTENSION_PUBLIC_KEY` in the `.env` of whoever builds, so two builders can get two different ids, and so two different relying parties.

## Findings (2026-09-23)

The raw output of every run, automated and manual, is in [results-2026-09-23.json](results-2026-09-23.json).

Two environments, both with a production build with `KOHAKU_PASSKEY_POC=true` and extension id `cgjhdpkjghcgpplimocodhjgcceglpoj`:

- Automated: Playwright Chromium 140 (headless) with a CDP virtual authenticator (CTAP 2.1, internal transport, resident keys, user verification, backup eligible).
- Manual: Chrome 151 on macOS, with Touch ID and iCloud Keychain (the Passwords app), and an Android phone with Google Password Manager over hybrid transport. Signatures from the manual runs were verified again outside the page with Node's crypto.

### Relying party = extension id

- Create, assert with the stored credential id, and a discoverable assert with an empty allow list after the local record was forgotten all succeed. The assertion signature verifies against the public key from creation.
- The authenticator data commits `sha256("chrome-extension://<id>")`, not `sha256("<id>")`. Chromium passes the page origin to the authenticator as the rp id, and the virtual authenticator stores the credential under `rpId = chrome-extension://<id>`. Any on-chain or off-chain verifier that pins the rp id hash must pin the hash of the full origin string.
- Real authenticators behave the same way:

  | Authenticator | Create | Assert | Notes |
  | --- | --- | --- | --- |
  | Touch ID, iCloud Keychain (Passwords app) | OK | OK | Platform attachment, 20-byte credential id, backup eligible and backed up. The assertion also works from a second Chrome profile on the same Mac, with an empty allow list and the pasted record. |
  | Phone over hybrid, Google Password Manager | OK | OK | Cross-platform attachment, AAGUID `ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4`. |
  | Phone over hybrid, 1Password (mobile app) | Refused | n/a | "Unable to create passkey. The website or service failed to send required details to 1Password." Probably because the rp id is not a domain; not confirmed. |

- The rp id hash in every real authenticator's data is `0x6a28d0a23c3534862fbdfb5c1689fc35b89dcd9367cbc2e33d4b0cb2f76c6535`, which is `sha256("chrome-extension://cgjhdpkjghcgpplimocodhjgcceglpoj")`.
- The Google Password Manager assertion came back with a high `s`. Both it and its low-`s` form (`n - s`) verify. Kohaku must normalize `s` before it submits a signature to a verifier that rejects high `s` (for example OpenZeppelin's `P256`); the page reports `sWasHigh` and `sLowNormalized`.
- Some passkey providers may not accept an extension id as the relying party (1Password above). The domain relying party probably avoids this.
- The relying party is tied to the extension id, and the extension id is tied to the manifest `key`. A build signed with a different key (another builder's `.env`, the store key, a fork) cannot use the passkeys of the first build.

### Relying party = a domain

- With the manifest's existing `https://*/*` host permission, `rp.id = example.com` works for create and assert with no `/.well-known/webauthn` file at all. The authenticator data commits `sha256("example.com")`.
- With `host_permissions` removed from the manifest, the same call fails with `SecurityError` ("Public-key credentials are only available to HTTPS origins with valid certificates, ... or pages served from an extension").
- Related origin requests do not help an extension caller. With `example.com` mapped to a local HTTPS server whose `/.well-known/webauthn` lists `chrome-extension://<id>`, the call still fails, and the server log shows that Chromium never requested the file for the ceremony (only the page's own check button fetched it).
- Control: from a plain web origin (`https://caller-site.com`), the same server and file make a cross-site `rp.id = example.com` succeed when the file lists the caller, and fail when it does not. Chromium fetches the file itself in that case. So related origin requests work in this setup, but only for web origins.
- Consequence for D-314: the domain fallback needs a host permission for the rp domain. The current manifest already has `https://*/*`; a manifest that narrows host permissions must keep that domain, or request it as an optional permission before the ceremony.

### Another wallet's provider on a Kohaku page

Tested with MetaMask 13.34.1 (Chrome Web Store build) loaded next to Kohaku: not onboarded in the automated run, onboarded with the Sepolia test wallet in the manual run (Chrome 151).

- `window.ethereum` is absent and no EIP-6963 provider announces itself: wallet content scripts do not run on `chrome-extension://` pages.
- MetaMask's `externally_connectable` (`ids: ["*"]`) port accepts `chrome.runtime.connect("nkbihfbeogaeaoehlefnkodbefgpgknn")` from the Kohaku page. Over the `metamask-provider` substream it answers `metamask_getProviderState` and `eth_chainId` (`0x1`) with no popup.
- With an onboarded, unlocked wallet, "Request accounts and sign" works over the same port: MetaMask opens its connect popup, then its sign popup, and returns the account and a `personal_sign` signature. The signature over the fixed text recovers the account address (EIP-191). So a guardian can approve from a Kohaku page with MetaMask, without WalletConnect.
- MetaMask's sign popup shows "Request from chrome-extension://cgjhdpkjghcgpplimocodhjgcceglpoj": the raw origin, with no name or icon for Kohaku, next to the plain message text. A guardian cannot tell from the popup that the request comes from Kohaku, so the approval page should show the extension id the guardian must expect, and the signed text should name Kohaku and the account under recovery.
- Rabby was not installed in the test profile, so its row only shows that the port does not exist.

## Still open

- An assertion from a second Apple device with the iCloud Keychain passkey. Assumed to work (the passkey is synced and backed up), not tested.
- Why 1Password refuses the extension rp id, and whether other third-party providers (Bitwarden, Dashlane) do the same.
- Safari and Firefox builds: how they treat an extension rp id and a domain rp id.
- Other wallets' `externally_connectable` settings (Rabby was not installed).
