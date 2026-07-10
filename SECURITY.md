# Security Notes

Second Bailout Wallet is a static frontend with a BRC100-backed secp256k1 key model.

- No XRP seed, family seed, mnemonic, or private key is accepted, generated, exported, or stored.
- The BRC100 wallet derives the chain-specific key and signs only a 32-byte XRPL SHA-512Half supplied through `hashToDirectlySign`.
- The app supports only native XRP `Payment` transactions. It does not enable partial payments, issued currencies, trust lines, account configuration, regular keys, or multisigning.
- The account must match the address derived from the signing public key.
- Fees above 0.1 XRP are rejected before signing.
- `LastLedgerSequence` is populated by the live XRPL server so a stale payment cannot remain valid forever.
- Mainnet X-addresses are decoded locally; testnet X-addresses and conflicting destination tags are rejected.
- Every DER signature and complete signed transaction is independently verified locally before submission.
- Balance, history, reserves, fees, sequence, and ledger status come from public XRPL servers and should be independently checked for high-value use.
- This code is not a substitute for audited hardware-wallet or institutional custody software.

## Operational Tradeoffs

- Public XRPL WebSocket availability affects read and broadcast service.
- A malicious or incorrect server can lie about balances or propose an unusual fee, though the transaction preview, account binding, signature verification, last-ledger limit, and fee cap reduce the signing risk.
- Classic addresses do not carry destination tags. Exchanges commonly require a tag; omitting it can require manual recovery by the recipient.
- An unfunded account must receive at least the current network base reserve before it exists on-ledger.
