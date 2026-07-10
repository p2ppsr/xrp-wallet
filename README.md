# Second Bailout Wallet

Native XRP custody through a BRC100 Metanet wallet.

> On 03/Jan/2009 a wise man warned the Chancellor was on the brink of a second bailout. We misunderstood the assignment and switched to XRP.

## What It Does

- Derives one XRPL classic address from a compressed secp256k1 public key returned by BRC100 `getPublicKey`.
- Uses protocol ID `[1, "xrp wallet"]`, key ID `"1"`, and counterparty `"self"`.
- Reads current balance, account reserve, owner reserve, validated ledger, fees, and recent payments from public XRPL WebSocket servers.
- Accepts classic addresses and mainnet X-addresses, including embedded or explicit destination tags.
- Autofills `Fee`, `Sequence`, and `LastLedgerSequence` from the live network.
- Encodes a native XRP `Payment`, computes XRPL SHA-512Half, and signs that exact 32-byte digest through BRC100 `createSignature`.
- Verifies DER, low-S behavior, the signature, and transaction ID locally before submission.
- Submits the signed blob and waits for a validated XRPL result.
- Runs as a frontend-only LARS/CARS/BRC102 project.

The app never asks for, exports, generates, or stores an XRP seed or private key. XRP uses secp256k1, so the BRC100-derived key can sign directly; unlike the Cardano wallet, no encrypted auxiliary-key vault is needed.

## Status

This is experimental wallet software with real mainnet behavior, not audited financial infrastructure. Start with a small amount, verify every address and destination tag, and review the live fee and reserve before signing.

## Local Development

```bash
npm install
npm --prefix frontend install
npm run frontend:dev
```

Or run through LARS:

```bash
npm run lars
npm run start
```

## BRC-116 Permission Manifest

`frontend/public/manifest.json` declares protocol access for `[1, "xrp wallet"]` under `metanet.groupPermissions`, with a mirrored legacy `babbage.groupPermissions` block. There is no basket access or BSV spending authorization because there is no auxiliary key vault.

## Validation

```bash
npm run frontend:test
npm run frontend:build
npm run frontend:qa
npm --prefix frontend run test:live
npm --prefix frontend run test:testnet-proof
```

The unit suite runs against the real `ProtoWallet` and independently checks XRPL encoding/signature acceptance. Responsive Playwright QA covers desktop, tablet, wide-short, and mobile layouts for console errors and horizontal overflow.

`test:testnet-proof` is manual-only: it asks the official XRPL testnet faucet to fund an ephemeral address derived from the same BRC100 namespace, signs a real payment through `ProtoWallet.createSignature`, submits it, and requires a validated `tesSUCCESS`. It never uses production funds or a persistent private key.

## Deployment

Pushes to `master` deploy through CARS. The workflow requires the repository secret `CARS_PRIVATE_KEY`; `CARS_WALLET_STORAGE` is optional.

Production: `https://xrp.metanet.app`

## Documentation

- [Protocol and cryptography](./PROTOCOL.md)
- [Security notes](./SECURITY.md)
- [Open BSV License](./LICENSE.txt)
