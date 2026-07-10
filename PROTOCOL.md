# Second Bailout XRP / BRC100 Protocol

## Namespace

- Protocol ID: `[1, "xrp wallet"]`
- Key ID: `"1"`
- Counterparty: `"self"`

The protocol name is deliberately longer than the obvious `xrp`: the real BSV SDK requires BRC100 protocol names to contain at least five characters and only letters, numbers, and spaces. Security level `1` avoids the wide-open level `0` key namespace.

## Address Derivation

1. Request a public key through BRC100 `getPublicKey`.
2. Parse and re-encode it as a compressed 33-byte secp256k1 public key.
3. Compute `RIPEMD160(SHA256(publicKey))`.
4. Encode the 20-byte account ID with the XRPL classic-address Base58Check alphabet/prefix.

The XRPL library's `deriveAddress` performs steps 3–4. No seed or private key leaves the BRC100 wallet.

## Payment Signing

1. Resolve a mainnet classic address or decode a mainnet X-address and destination tag.
2. Build a native XRP `Payment`; issued-currency amounts and partial-payment flags are not supported.
3. Ask the live XRPL server to fill `Fee`, `Sequence`, and `LastLedgerSequence`.
4. Reject any fee above the wallet's 0.1 XRP safety cap.
5. Set `SigningPubKey` to the compressed BRC100-derived public key and serialize with XRPL `encodeForSigning`.
6. Compute SHA-512 over those signing bytes and keep the first 256 bits (XRPL SHA-512Half).
7. Pass that exact 32-byte digest to BRC100 `createSignature` as `hashToDirectlySign`.
8. Add the canonical DER signature as `TxnSignature`, binary-encode the transaction, verify it locally, and compute the XRPL transaction ID.
9. Submit the blob and wait for a validated `tesSUCCESS` result.

## Exact ECDSA Semantics

The installed BSV SDK's real `ProtoWallet.createSignature` behavior is explicit:

- `data` is SHA-256 hashed once by the wallet;
- `hashToDirectlySign` bypasses that SHA-256 and is passed directly to `ECDSA.sign`;
- `new BigNumber(hashBytes)` interprets the byte array big-endian;
- `ECDSA.sign(..., true)` forces low-S;
- output is strict DER.

Therefore this app—not the wallet—performs XRPL SHA-512Half. There is no extra SHA-256 and no byte reversal. The independent XRPL verifier takes the serialized signing bytes, performs its own SHA-512Half, and accepts the resulting signature. Unit regressions also prove that an accidental second hash or reversed digest fails.

## BRC-116

The manifest declares only protocol permission for `[1, "xrp wallet"]`, mirrored under `metanet` and legacy `babbage` keys. No basket or spending permission exists because this chain uses the same secp256k1 curve and needs no auxiliary-key vault.
