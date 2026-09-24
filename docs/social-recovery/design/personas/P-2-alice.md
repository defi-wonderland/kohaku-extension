# Alice, three of five paper guardians

Alice routes everything through Tor, has not used a web2 account in years, and treats Apple and Google as part of her threat model, while she accepts that the extension itself reaches her through a browser one of them ships. She holds a large amount of ETH and keeps a small amount on a hot key outside the account for fees.

Operational complexity does not deter her as long as no third party sits in the path, and she accepts the node her wallet reads through, a light client with its prover, as the one party every wallet has. She is technical and patient, and she wants the threshold on rescue rather than on her everyday spending. A delayed recovery that no ordinary transaction pays for brings her here, although D-0 counts her class as served elsewhere.

She holds five keys she generated offline on an air-gapped machine, each written on paper and stored in a separate place: home, a relative's house in another city, a bank box, a colleague, a place only she knows. They are her guardians in the kit's sense, five wallet credentials she controls herself. She stands to lose the account if she loses her signing key and cannot reach three of the five papers, or if she loses her card and forgets the password, and she accepts both.

## Journey, setup

Alice dismisses the nudge (B-01, second release; in the first release she opens account recovery from settings) and opens the presets (C-01). She picks guardians only, adds two members in the editor to reach five addresses and sets the threshold to three (C-04e, C-05f), running each row's access test through the same offline block the approval page has and signing the challenge with the paper key on her air-gapped machine, so that each row reads tested and tells her that a recovery which uses that address puts it on chain in the clear and that even unused anyone who can guess it can find it, and that if the address is a smart account whoever controls it can approve for it.

She reads the line to keep the credentials of a path in different places, which she already does. She raises the waiting period to 72 hours (C-06c). She keeps the default privacy level and sets the recovery password, since the card is the only thing she will carry across devices (C-06e).

The review leads with one group, any three of five, the line that any three of these five recover this account and losing more than two locks you out, the line that these members fail together if their kind does, the waiting period, and the line that a first-release recovery is paid by her own key and costs the account nothing (C-07d). Under verify the details every row reads audited, with no outside party and the word that nobody can stop the wallet method, the node her wallet reads through is named by kind, the security stop block renders and reads that the wallet method is not stopped, that this release ignores stops, and that a stop on a method will not stop her recoveries and will not stop a forged one against her either, and the publication disclosure appears as it does on every guardian row (C-07d).

The save passes the fit check and she saves (C-07e) and prints the Recovery Card (C-08). She never enrolls a passkey and never sees an identity method.

## Journey, recovery

Alice loses her signing key. On a fresh install she takes the fast track and creates the key that will control the account, a hot key like the one she lost, since the wallet must sign for the account afterwards and the fast track takes no pasted address (A-00 to A1-03). She pastes the account address from her card (D-02b), confirms the account (D-04d) and enters the recovery password.

The readout shows the group, any three of five (D-06f, D-06d). The gas step asks her to fund the key that sends the recovery, and she sends fees from her hot key (A1-04). The first row shows how long the request is valid, the wallet's own default of 24 hours, with the line that every approval dies together, drawn on D-07 and running on her path too by D-07f's own note (D-07, D-07f).

The checklist shows one row per guardian under the group header, every member listed, each reading as any guardian row (D-07f). Each of the three papers signs on her air-gapped machine, the payload carried there by QR from the approval page's offline block and the signature carried back, and she pastes each approval back, the checklist counting each on paste and verifying it (D-07f, D-07i, E1-04b). The group header counts three of three.

She meets no gas step before the submission, since the key she funded at A1-04 holds enough for it, reads the confirmation, the new key, the key being removed and the words no payment (D-11), and sends the request from her new key (D-11b), no third party in the path beyond the node the review named.

She waits 72 hours (D-13), the countdown reads execution due, she executes from the same key after the second gas check, and she finishes on the done screen without a cleanup list, since no passkey is in her setup, reading that the three addresses that approved are published and every guardian of her path is now discoverable, and that reconfiguring with a changed rule and changed members makes the next setup unlinkable while nothing unpublishes the past (D-15c).
