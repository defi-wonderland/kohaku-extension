# M-12 walk, part B (2026-10-22): the Aadhaar identity on Sepolia against the test-only method

The real Anon Aadhaar prover ran in the extension page, against the real Sepolia contracts through the owner's gateway. Every Sign press was the owner's. This report holds no seed, password, key, address or RPC URL. The throwaway wallet files `wallet-1.env` and `wallet-2.env` are in this folder at mode 600.

## Build

- The worktree: `m12-walk` at ddf2468058 (`walk/m12-b`).
- The command: `yarn build:web:webkit > walk/b/build.log 2>&1`.
- Build 1: exit 0, 139 s, at 2026-10-22 about 14:05 UTC.
- Build 2: after the coordinator added `SOCIAL_RECOVERY_WAIT_FLOOR_MINUTES=5` to the worktree's `.env`. Exit 0, 137 s. Its log is `build-2.log`.
- `build/webkit-prod/manifest.json` sha256: 5bf7dd404efe6aa7d3b6e8c6c075b0010cd12a05ad7d5dd49713fd81ff022ab8. Both builds give this value, the same as part A (the manifest carries no env value).
- The extension id: limpbjkfopfcbfekngcglncigokbmnli.

## Profiles, daemons, ports

- profile-1, wallet 1, the holder: port 9483.
- profile-2, wallet 2, the recoverer: port 9484.
- Both daemons ran headed with `walk/daemon.js` and Chromium 1193.
- First start: pids 74085 and 74452. Both Chromium windows were gone when the walk resumed after HB-1, although the daemons still ran. Second start (detached in their own session): pids 74885 and 74886. These ignored TERM and needed kill -9. Third start, after build 2: pids 75767 and 75768, stopped by pid at the end.
- After each restart the wallet needed an unlock through `#/keystore-unlock`.
- Both basic keys were funded by the coordinator with 0.003 ETH each (blocks 11970079 and 11970080).

## Transactions

| What | Hash | Block | Status | Gas used |
|---|---|---|---|---|
| Setup save (wallet 1's key; "Enable recovery module") | 0x9d61abbd0566fb5451f3cf39f47463349f86143a7afa1ff0acd254ef5cda06e9 | 11970166 | 1 | 942607 |
| Recovery submission (wallet 2's key) | 0x0b5cf021b06a63bede0895a7c2566b70bc0a8eda5c222d79230bd5b3b4067ddb | 11970211 (14:43:36 UTC) | 1 | 780748 |
| Execution (wallet 2's key) | 0x13697af0a7bf8f1ddb46a2dbf6146dc60a289018a6e10f8dbe193d61d4ff364a | 11970251 (14:51:36 UTC) | 1 | 231910 |

## Steps

### 1. Build, wallet 1

- The route: `#/get-started`, Create new account, `#/create-new-recovery-phrase` (three tips to tick), `#/backup-recovery-phrase` (no capture of the phrase), `#/keystore-setup` (password plus terms), `#/account-picker`, `#/account-personalize`, `#/wallet-setup-completed`.
- The picker: Account 1 is a Smart Account, and Account 2 is "Controlling key of 0x…. The wallet adds it as an account of its own. Recovery does not cover funds held on it.". Both are on by default.
- "Open dashboard →" does nothing in a tab. I opened `#/dashboard` by URL.
- The basic key's path is m/44'/60'/0'/0/100000, the smart account signer offset. I checked it by derivation.
- Settings › Networks › Sepolia: the RPC is the build's gateway, in the page and in storage. I set nothing. The page also reads "Smart contract wallets are not supported" under Available features.
- Captures: b-1-1 to b-1-9.

### 2. Wallet 2

- The same flow, driven by `create-wallet.body`. The gateway is stored.
- Captures: b-2-1 to b-2-3.

### 3. The setup path (wallet 1)

- `#/social-recovery/manage` reads "This account has no recovery path yet.", "Not set up", "Set up recovery" (b-3-1).
- The presets (b-3-2), then Start from scratch, then the editor (b-3-3), then Add a group (b-3-4).
- The add menu (b-3-5) reads Passkey / Guardian / Passport / Aadhaar identity. Aadhaar is last, with no badge.
- The Passport entry is enabled and carries no line. "This method is not available on this network." shows only on the Passport row once it opens (b-3-6). That row reads "No passport enrolled yet" and has no start control. Back keeps a "Not yet active" Passport member in the group, so I removed it.
- After that removal the threshold stays at 2 with one member: "This wallet cannot save a group that requires more members than it holds. Lower the threshold or add members." (b-3-9).
- Guardian by address (b-3-7, b-3-8): "No contract code at this address today.", "Not derived from your account's recovery phrase.", "Not tested", "Test this key".
- Threshold "Require 1 of 2" (b-3-11): "Either one alone can recover this account. Either one alone can also take it.".
- The wait, build 1 (b-3-12, b-3-13): Custom read "hours" and "At least 24 hours.". I handed back early on this point.
- The wait, build 2: the resumed draft (b-3r-1) read "Resume setup", "Your setup is unfinished. Draft from 22 Oct. …", "1 added, not saved on chain yet", "Not yet active", "Start over discards the draft. Your created passkey is not deleted.". I pressed Start over and redid the path (b-3r-2 to b-3r-4).
- The wait step (b-3r-5 to b-3r-7): the chips still read 24 hours / 48 hours · Default / 72 hours / 7 days. Custom reads "minutes" and "At least 5 minutes.". I set 5.

### 4. The Aadhaar row at enrollment

- Before creation (b-4-1, b-4r-1): title, lead, the takes-time line, "No Aadhaar identity enrolled yet", "A PNG or JPEG that shows the whole QR code.", "Choose the QR image", the identity disclosure, the Aadhaar publication line and the same-QR line. All match en.json.
- The ceremony runs in the same tab at `#/social-recovery/ceremony?call=enroll&method=aadhaar…`.
- Every ceremony first shows "In progress / Cancel" for about 1.3 s, then "Upload the QR image" with its hint and "Choose the image / Cancel".
- After the file is set, "Downloading the check's files… this happens once." shows about 9 to 11 s later, with Stop. Then "Checking the QR code… this takes about a minute." with Stop. A test then shows "Checking the result…" with Stop.
- Enroll with the plan's QR helper (b-4-2-*): the first download took 42 s. The prover then failed at once with "Assert Failed. Error in template AgeExtractor_217 line: 158" (QRDataExtractor_241 line 339, AadhaarQRVerifier_393 line 79). The row read "Failed · Try again" with the button "Try again". The cause is the coordinator's scratch helper, not the extension (see Notes).
- Enroll with the fixed helper (b-4-3; again b-4r-2): passed. The cached download took 0.9 s and proving 16 s. The row reads "Your Aadhaar identity is enrolled. The wallet stores the identifier, never the QR code.", the chip "Not tested", "Access test / Recommended", the test lead, "Run the test / Skip the test", "Save and continue" (enabled) and "Save works with or without the test.".
- Test with a fresh same-identity QR (b-4-4; again b-4r-3): proving 15 s and the chain verify 0.9 s. The row reads "Tested", "The chain confirmed the identifier your Aadhaar produces." and "Run the test again".
- QR of another identity (b-4-5): proving 15 s and no chain read. The row reads "Test failed", "This method may never work.", "The result did not pass the method's own check. Try again with the same document.". The save now reads "Save anyway". See F2.
- Plain PNG (b-4-6, b-4-6-noqr): "No QR code was found in this image. Choose another image.". "Choose the image" re-armed. Cancel then returned "Stopped · you stopped this step, the row is unchanged".
- Stop while proving (b-4-7, b-4-7-before-stop): "Stopped · you stopped this step, the row is unchanged". The row was unchanged.
- Final test (b-4-8): Tested.

### 5. The review and the save

- Privacy (b-5-1, b-5-2): Private, the default, with a recovery password. The aside "What stays hidden" reads "The identifier your Aadhaar produces cannot be guessed at all and loses nothing before a recovery.".
- The review (b-5-3 plus full, b-5-4, b-5-5):
  - Group 1, Require 1 of 2: the guardian "Not tested", and the Aadhaar identity "Tested" with the identity disclosure and the publication line. Part A's F4 is resolved.
  - "Waiting period 5 minutes", "This wallet's minimum is 5 minutes.", "Private · recovery password set".
  - Verify the details: "An untested method is in your path", Guardian, "An untested method may fail on the day it is needed. You can still save.".
  - The aside: "What a recovery publishes" ("The identifier your Aadhaar produces becomes public and permanent, and so does this guardian's address if a recovery uses it. …") and "One comparison".
- The save step (b-5-6) reads "Key a recovery would remove", "Recovery module · published by Ethereum Foundation", "In progress / Submitting / Your key is sending one transaction. Do not close the wallet.".
- The sign window opened at about 14:34:19 UTC. The owner pressed Sign at about 14:34:26, before HB-2 went out. b-5-7 is the action window after signing.

### 6. The save landed

- b-6-1: "Setup saved", "Saved on chain 0x9d61abbd0566…da06e9", "One transaction. Nothing else was sent.". It landed about 15 s after the press.
- The card (b-6-3).
- The overview (b-6-4): "One recovery path is set up for this account.", "Set up", the path, "Waiting period 5 minutes", "Edit path / Remove recovery".

### 7. Wallet 2, the checklist and the claim

- The fresh-install door `#/social-recovery/recover` (b-7-1 to b-7-3): the acknowledge box ticks, but Continue does nothing on a wallet that has a keystore. See F3. I went in through Settings › Account recovery › Recover an account instead.
- Owner stage (b-7-4, b-7-5): "Which of your accounts receives control?". I picked Account 2, wallet 2's basic key.
- Lookup (b-7-6 to b-7-9), then the password readout (b-7-10, b-7-11): "Guardian or Aadhaar", "Waiting period 5 minutes", "The request lasts 24 hours from the moment the checklist opens.".
- The checklist (b-7-12, b-7-13 plus full): the Aadhaar row reads "Not asked", "Make a fresh QR code in the Aadhaar app and upload it here. The check runs here and takes about a minute.", "Choose the QR image", "A QR code older than a day is refused. It must come from the same Aadhaar identity as at setup.". All match en.json.
- The claim (b-7-14-*, b-7-15 plus full):
  - The first download for this profile took 42.2 s. Proving took 17.6 s.
  - Back on the checklist, the row read "Waiting" for 0.9 s, then "Complete". The guardian row read "Not needed".
  - The page read "Every approval is in / Continue to start the recovery. / 1 of 1 done" and "This path is satisfied. The submission uses the smallest set that satisfies the rule, so the other rows are not needed.".
  - No "Checking the result…" line shows during a claim.
- The negative cases on the checklist were not reached. A Complete row has only its kind and its chip, with no retry control.

### 8. The submission

- b-8-1, b-8-2: "Start the recovery", "Keeps this address", New key "The key of Account 2 on this device", Key being removed "As this wallet read it.", "No payment", "Your key 0x… sends this request and pays its gas.", "Checked against the chain".
- Start recovery, then "Submitting the recovery…" (b-8-3). The sign window (`#/sign-account-op`) opened after 4.0 s (b-8-4), showing Fast 0.0006 ETH. The owner signed. Landed: see the table.

### 9. The wait and the execution

- The wait (b-9-2, b-9-3 plus full): "Recovery started", "Recovery in progress", "Started 22 Oct, 11:43 GMT-3", "00:04:37 · waiting", "Can execute from 22 Oct, 11:48 GMT-3", "Guardian or Aadhaar identity, either one", the start hash, and the asides "Where the end comes from", "You can close this", "The owner can still cancel", "Who finishes it".
- The countdown (b-9-6-1 to b-9-6-3): at 14:48:48 UTC the chip read "Execution due". 3 s later the screen read "The waiting period ended", "Nobody has executed yet. Execute now to finish the recovery.", "No deadline runs for the execution.", "Execute now".
- Wallet 1 during the wait: the overview (b-9-5) read "A recovery is running on this account. …", the chip "Recovery in progress", "Editing or removing recovery cancels the recovery in progress.". The dashboard (b-9-4, b-9-8) showed no recovery band. See F4.
- Execute now: "Executing… your key is sending the transaction" (b-9-9). The sign window opened after 2.1 s (b-9-10), showing Fast 0.00018 ETH. The owner signed.
- The done screen (b-9-12 plus full): "The account is yours again", "Control moved to your new key on 22 Oct, 11:51 GMT-3. …", Account 3, the Controlled by and Removed blocks, "Your setup survived the recovery and the wallet refuses a second one. …", "What this recovery did … It used: Aadhaar identity.", and the key-limit line. I did not press Done.
- Wallet 1 after the recovery (b-9-13, b-9-14): "This account is no longer controlled from this device", "Control moved to a new key.", "Your recovery path no longer covers a key this device holds.". The dashboard shows no notice.

## Findings

| # | Severity | Screen | Capture | What shows | Expected |
|---|---|---|---|---|---|
| F1 | Medium | setup editor, add menu | b-3-5, b-3-6 | The Passport entry is enabled with no line, although the deployment names no zkPassport method. "This method is not available on this network." shows only on the Passport row after you choose it, and Back then leaves a "Not yet active" Passport member in the group. | The menu entry reads not available on this network, or cannot be chosen. |
| F2 | Medium | setup enroll, Aadhaar access test with another identity's QR | b-4-5 | "Test failed" with "The result did not pass the method's own check. Try again with the same document." | The no-match cause: "The result did not match the identifier recorded at setup." |
| F3 | Medium | `#/social-recovery/recover` (recover door) on a wallet that has a keystore | b-7-1 to b-7-3 | The checkbox ticks, but Continue does nothing: it navigates to the fast track, which does not open while a keystore exists. The logged-in route works. | Continue leads into the recovery, or the door sends a holder with a wallet to the logged-in route. |
| F4 | Medium | wallet 1 dashboard during the wait and at execution due | b-9-4, b-9-8 | No recovery band, although the overview reads "Recovery in progress". The worker logged no watcher line after the daemon restart at 14:31 UTC. The watcher may only poll at its start; I did not restart to test it. | The banner for a recovery you did not start when the wallet opens during the wait. |
| F5 | Low | setup editor after Remove | b-3-9 | Removing a member leaves the threshold above the member count ("Require 2 of 1"), with the cannot-save line. | The threshold follows the member count down. |
| F6 | Low copy | resumed draft | b-3r-1 | "Start over discards the draft. Your created passkey is not deleted." on a draft with no passkey. | The passkey sentence only when the draft holds a passkey. |
| F7 | Low | Aadhaar row, Tested | b-4-4, b-4-8 | "Access test / Recommended" stays above the passed line. No passed note ("check … · passed just now") shows. | The chapter does not require the note; recorded for the owner. |
| F8 | Low copy | Aadhaar ceremony, Cancel at the upload | b-4-6 | Cancel reads "Stopped · you stopped this step, the row is unchanged". | The cancelled note; the same as part A's F7. |
| F9 | Low | waiting period in a 5-minute test build | b-3r-5 | The chips stay 24 h / 48 h / 72 h / 7 d; only Custom counts minutes. | Recorded only. |

Not findings:
- The wait floor of 24 hours without the env switch is the release behaviour.
- "Smart contract wallets are not supported" on the network page is upstream wallet code.

## Timings

| What | Time |
|---|---|
| Build | 139 s and 137 s |
| Artifacts download, first run per profile | 41.7 s (profile-1), 42.2 s (profile-2) |
| Artifacts download, cached | about 0.9 s |
| From the file set to "Downloading…" | 9 to 11 s, the QR decode |
| Each proof | 14.7 s to 17.6 s (enroll 16.4 and 15.9; tests 15.2, 15.1, 14.7, 14.9; claim 17.6) |
| Each chain verify ("Checking the result…") | about 0.9 s |
| Setup save, press to landed | about 15 s |
| Submission | signed about 14:43:2x, block at 14:43:36 UTC |
| The 5-minute wait | from the block to "Execution due" at 14:48:48 |
| Execution | block at 14:51:36 UTC; the done screen right after |

## Console and network

- Page: the Sentry DSN warnings. 404s on `cena.ambire.com/iconProxy/ethereum-sepolia/…` and `cena.ambire.com/api/v3/contracts/…`.
- Worker:
  - "fetchGasPrices for pimlico failed, fallbacking to getGasPriceRecommendations".
  - "Emitted error in controller MainController Error in main.traceCall" at the save.
  - Repeated "Failed to decode error BundlerError: internal error" (Pimlico, every 30 s on wallet 2).
  - Portfolio and relayer errors after the execution: Velcro hints, Debank, UniV3 positions "Failed to fetch", "relayer error for portfolio additional", "failed to record EOA txn to relayer".
  - At the first start: "The recovery watcher found no account to watch".
- The only error from the Aadhaar prover: the AgeExtractor assert with the plan's QR helper's broken QR.
- No error from the artifacts server or from the gateway.

## Not reached

- The checklist's negative cases on the Aadhaar row (another identity, a plain PNG, Stop): a Complete row offers no retry. The same cases ran against the real chain at enrollment.
- The fresh-install door on wallet 2: see F3.
- The HB-2 hand-back with the window still open: the owner signed first.

## Notes

- The coordinator's `gen-test-qr.js` passes the V2 sample to `createCustomV2TestData` with its `V2\xff` header still on. The helper adds its own header and writes the timestamp at a fixed offset. The result is `V2|V2|3|2<timestamp>7437`: the timestamp is misaligned, and the circuit asserts in AgeExtractor.
- `gen-test-qr-v2.js` passes `decoded.slice(3, …)` and gives `V2|3|2697<timestamp>`. Every QR after the first used it.

## Driver files (this folder)

- `bp.js`: posts a body to a daemon, fills `{{NAME}}` from the wallet files and from GUARDIAN_ADDRESS, and masks the answer.
- `create-wallet.body`, `open.body` (unlock and route), `cut.js`, `tab.body` and `upload.js` (from part A), `cer.sh` (a ceremony with an upload and an optional Stop), `logs.body`, `gen-test-qr-v2.js`.
- The runs' outputs: `b-4-*.out`, `b-7-14.out`, `b-9-6.out`. The working notes: `notes.txt`. The QR files: `qr-*.png` and `qr-*.txt`, test data only.
