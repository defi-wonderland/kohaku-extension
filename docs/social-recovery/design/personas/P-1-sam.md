# Sam, one synced passkey

Sam set up a wallet last month and wants no homework. He is not technical and holds a small portfolio. His only device beyond his laptop is an iPhone signed into iCloud. He has no hardware wallet and nobody in his circle uses crypto, so a guardian is not an option he can take.

He has an account at an exchange, which is where his portfolio came from and where he buys ether when he needs it. He is the mainstream user D-0 names, and his portfolio is small enough that a lockout costs him less than a stolen account would.

He holds one thing the design touches: a synced passkey, created in his iPhone's keychain and backed up through his Apple account. He stands to lose the account if the laptop that runs the extension dies, and he stands to lose the recovery path itself if Apple closes his account or he cannot reach it, which the passkey row tells him at enrollment.

## Journey, setup

Sam opens the dashboard and meets the nudge banner (B-01, second release; in the first release he opens account recovery from settings and reads the honesty note on the presets screen), taps set up recovery, and lands on the presets (C-01). No preset fits one device, and the presets screen tells a holder with one device that start from scratch builds a single-method path, so he chooses guide me (second release; in the first release he chooses start from scratch and enrolls the one method in the blank editor, C-04f).

The wizard explains recovery in three bullets (C-02), asks what he has (C-03b), and he ticks one item, another device. The recommended path is a single passkey with the single-method warning, that if he loses his key this one method is the only way back, and the offer of a second passkey from another device or a hardware key, which would become a group of any one of two with the line that two passkeys behind one platform account share its fate (C-04c; in the first release the blank editor carries the same warning and the same offer).

He enrolls the passkey and runs the offered test on his phone through the QR hand-off (C-05g, C-05n, C-05h, C-05), and the row tells him the passkey is synced, as its backup flags report, that it follows the account that syncs it, for him his Apple account, that whoever holds that account could start a recovery, that an account he cannot reach ends the method, and that it works only from Kohaku on Chrome.

The wizard keeps the 48 hour waiting period (C-06), keeps the default privacy level, and asks him to set and confirm the recovery password (C-06e). The dry run is offered and skipped (C-07h, second release). He reviews one row with the single-method warning, the line that a first-release recovery is paid by his own key and costs the account nothing, and the comparison line that a spare key is the cheaper protection against loss and none against theft (C-07c).

His account has received his portfolio and never sent anything, so the extension prepends the deployment to the save batch and the save is the account's first operation, the cost line naming the deployment's gas. The account's key holds no gas for it, so the review blocks the save and offers both routes it draws, a transfer from another account this wallet holds and a deposit from outside into the key's address.

He sends ether to that address from his exchange account, since a transfer out of the account is an operation the key itself must send and pay for and his key holds nothing (C-07), and he saves with one confirmation (C-07e). He then downloads the Recovery Card with the password printed on it and the line to keep it away from this laptop, and prints it (C-08). He never sees the advanced builder.

## Journey, recovery

Sam's laptop is lost. On a new laptop he installs the extension, taps recover an account (A-00), reads the warning that nobody claiming to be support asked him to do this and the line that a holder who still has their recovery phrase should import it instead (A1-01), sets an extension password (A1-02), and creates the key that will control the recovered account (A1-03). He types the address from his card and confirms the account is his (D-02b, D-04d).

The readout is locked at the default level until he enters the recovery password from the card, then it shows one row, his passkey (D-06f). Only now the gas step asks him to fund the new key, showing its address and the amount the wallet estimates for the submission, and saying that the execution after the waiting period is a second funding it asks for again at execution due at the fee of that day, and he sends it ether (A1-04).

He completes the passkey row from his phone through the QR hand-off (D-07h), meets no gas step before the submission, since the key he funded at A1-04 holds enough for it, reads the confirmation that leads with the account, the new key and the key being removed, with the words no payment under the details (D-11), and sends it from his new key (D-11b).

He waits 48 hours. Closing the laptop loses nothing, since the countdown resumes from the home surface (D-13).

The countdown reads execution due, the gas check runs again, he presses execute now and his key sends it, and he lands on the done screen, which says his account now rests on one fresh key, that his synced passkey may still follow the account that syncs it, for him his Apple account, and the repair order, secure that account first, add a fresh credential that does not sync to it, then remove the old row, which methods the recovery published, and offers to edit or replace his recovery path (D-15d, the first release's terminal with its repair order; the cleanup screen D-15 ships in the third release). He never sees a guardian page.
