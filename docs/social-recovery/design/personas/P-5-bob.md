# Bob, two of three with distinct trust roots

Bob works in product at a software company and uses DeFi on weekends. He trusts iCloud with his data and wants recovery to be straightforward but under his own control. He has an iPhone on iCloud, a hardware wallet for his portfolio, and a biometric passport. He is technical enough to build his own path, and he runs the extension on two machines with different accounts, each of which has sent transactions before.

He holds three credentials the design touches, each behind a different party: a synced passkey behind Apple, a hardware wallet key behind nobody, and a passport zkPassport proves. Any two recover, so any single failure is survivable. He stands to lose the account only if two fail together, and he stands to have a recovery run against him if the bag he loses holds two of his three credentials and his card.

## Journey, setup

Bob opens the presets (C-01) and goes to the advanced builder (C-10, second release; in the first release he chooses start from scratch and builds the same path in the blank editor, C-04f). He adds the three members through the member picker, which refuses the same credential twice (C-10b; in the first release the blank editor's picker, C-04f), and builds one group of any two of three, no required row, running the hardware wallet row's access test and signing its challenge with the hardware wallet, so that row reads tested.

The other tests are offered and he skips them, so the passkey and the passport rows read not tested (C-07). He reads the line to keep the credentials of a path in different places. He keeps the 48 hour waiting period, keeps the default privacy level and sets the recovery password, the three controls inline in the advanced builder (C-10, second release; in the first release they are the editor route's own screens, C-06 and C-06e).

He reviews the path, the line that any two of these three recover this account and losing more than one locks you out, the waiting period of 48 hours he keeps, and the cost line that a first-release recovery is paid by his own key, and under verify the details the hardware wallet row reading tested, the passport's admin named as a party that could approve for that method and its pause holder as the one who can stop it, and the line that this release ignores stops, that a stop on a method will not stop his recoveries and will not stop a forged one against him either (C-07), the not tested lines sitting in the review's lead rather than under that expander.

He saves the path with one confirmation (C-10c, second release; C-07e in the first), and prints the Recovery Card, which he keeps in his bag (C-08), against the card screen's own line to keep the card away from the device that holds the wallet. That step is Bob's mistake rather than a step the design endorses, and the attack journey below turns on it. He reads the path on the management overview (G-01).

## Journey, recovery

Bob loses his laptop, whose extension held the account's key and whose seed he never wrote down, but still has an extension logged in on another machine, whose settings overview offers recover an account. From settings he taps recover an account (D-01), passes the condensed warning, picks which of his accounts receives control and sees the address of the key it will install, and identifies the lost account (D-02, D-04c).

The readout is locked until he enters the recovery password from his card, then shows the group (D-06c). The first row shows how long the request is valid, the wallet's own default of 24 hours (D-07g). He completes the passport row (D-07e), opens the approval page from his row's link and signs with his hardware wallet, which shows him two hashes as the page said it would (D-07g, E1-04), pastes the approval, which the checklist counts on paste and verifies (D-07j), and passes the gas check, his logged-in account's key paying after a one-step transfer from the smart account (D-09).

He reads the confirmation, which leads with the new key and the key being removed and says under the details that after recovery this key controls two accounts, links them publicly and shares one fate (D-11), submits (D-11b), waits 48 hours (D-13), executes at execution due, and finishes on the done screen, which names the shared key, says that his synced passkey still follows his Apple account, states the repair order, and offers to edit or replace his recovery path (D-15d, the first release's terminal with its repair order; the cleanup screen D-15 ships in the third release, and until then the done screen's sentence is the only trace).

The recovered account joins that machine's accounts with the shared key as its signer.

## Journey, attack

After that recovery, the bag that held the lost laptop, signed in to his Apple account, his hardware wallet and his Recovery Card turns out to be in a thief's hands. His passport stays at home. Whoever holds the bag reads the setup with the card and the chain, satisfies two rows with the synced passkey and the hardware wallet, and starts a recovery. The thief acts first, before Bob changes the recovery password.

The done screen asked him for that change, since the card was in the bag with the laptop, and he makes it after the attack. Bob's other machine, which holds the recovered account with a signer, shows the persistent banner naming the attempt and the new key in full, with the countdown and cancel as its primary action, and, since the wallet offers the owner's cancel alone, the banner says that only his key can stop it (D2-01).

He cancels with his key within the 48 hours, the cancel passing its own gas check. In the third release the triage screen names the two rows the attacker satisfied and asks no recovery password, since this machine holds the cache the completed recovery left (D2-02). In the first release the cancelled terminal points him at the editor and at moving funds instead.

He secures his Apple account first by signing the lost laptop out, adds a fresh passkey on a device that does not sync to it and a replacement hardware key, then removes the old passkey row and the hardware wallet row, adding the replacements first since removing both from a group of three would leave one member as the whole rule (G-05), and the overview then shows the path those replacements make (G-01b, first release).
