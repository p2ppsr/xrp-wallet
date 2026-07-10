import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  BigNumber,
  Curve,
  ECDSA,
  Hash,
  PrivateKey,
  ProtoWallet,
  PublicKey,
  Signature,
  Utils
} from '@bsv/sdk'
import {
  classicAddressToXAddress,
  encodeForSigning,
  verifyKeypairSignature,
  verifySignature,
  type Payment
} from 'xrpl'
import {
  XRP_KEY_ID,
  XRP_PROTOCOL_ID,
  assertXrpCryptoRuntime,
  formatDrops,
  parseXrpToDrops,
  publicKeyToXrpIdentity,
  resolveXrpDestination,
  sha512Half,
  signXrpTransaction
} from './xrp'

const fixturePayment = (account: string): Payment => ({
  TransactionType: 'Payment',
  Account: account,
  Destination: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  Amount: '2500000',
  Fee: '12',
  Sequence: 7,
  LastLedgerSequence: 1000
})

describe('Second Bailout XRP cryptography', () => {
  it('uses a restricted, chain-specific BRC100 namespace', () => {
    expect(XRP_PROTOCOL_ID).toEqual([1, 'xrp wallet'])
    expect(XRP_KEY_ID).toBe('1')
    expect(assertXrpCryptoRuntime()).toBe(true)
  })

  it('formats drops without floating point math', () => {
    expect(parseXrpToDrops('1')).toBe(1_000_000n)
    expect(parseXrpToDrops('0.000001')).toBe(1n)
    expect(parseXrpToDrops('123.456789')).toBe(123_456_789n)
    expect(formatDrops(123_456_789n)).toBe('123.456789')
    expect(() => parseXrpToDrops('0.0000001')).toThrow(/6 decimal/)
  })

  it('derives an XRPL classic address from the exact compressed k1 public key', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex('1'.padStart(64, '0')))
    const { publicKey } = await wallet.getPublicKey({
      protocolID: XRP_PROTOCOL_ID,
      keyID: XRP_KEY_ID,
      counterparty: 'self'
    })
    const identity = publicKeyToXrpIdentity(publicKey)
    expect(identity.publicKey).toMatch(/^(02|03)[0-9A-F]{64}$/)
    expect(identity.publicKeyBytes).toHaveLength(33)
    expect(identity.address).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/)
  })

  it('decodes mainnet X-address tags and rejects tag conflicts', () => {
    const classic = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
    const xAddress = classicAddressToXAddress(classic, 8675309, false)
    expect(resolveXrpDestination(xAddress)).toEqual({
      classicAddress: classic,
      tag: 8675309,
      source: 'x-address'
    })
    expect(() => resolveXrpDestination(xAddress, '42')).toThrow(/different destination tag/)
  })

  it('matches XRPL SHA-512Half exactly and does not hash again inside hashToDirectlySign', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex('2'.padStart(64, '0')))
    const { publicKey } = await wallet.getPublicKey({
      protocolID: XRP_PROTOCOL_ID,
      keyID: XRP_KEY_ID,
      counterparty: 'self'
    })
    const identity = publicKeyToXrpIdentity(publicKey)
    const unsigned = { ...fixturePayment(identity.address), SigningPubKey: identity.publicKey }
    const signingBytes = Utils.toArray(encodeForSigning(unsigned), 'hex')
    const expectedHash = Array.from(createHash('sha512').update(Uint8Array.from(signingBytes)).digest().subarray(0, 32))

    expect(sha512Half(signingBytes)).toEqual(expectedHash)
    expect((Hash.sha512(signingBytes) as number[]).slice(0, 32)).toEqual(expectedHash)

    const { signature } = await wallet.createSignature({
      hashToDirectlySign: expectedHash,
      protocolID: XRP_PROTOCOL_ID,
      keyID: XRP_KEY_ID,
      counterparty: 'self'
    })
    const parsed = Signature.fromDER(signature)
    const publicPoint = PublicKey.fromString(identity.publicKey)

    // BigNumber(number[]) is big-endian; this is the XRPL/SEC1 message representative.
    expect(new BigNumber(expectedHash).toArray('be', 32)).toEqual(expectedHash)
    expect(ECDSA.verify(new BigNumber(expectedHash), parsed, publicPoint)).toBe(true)

    // These regressions prove a second hash or byte reversal would create a different signature domain.
    const accidentalSecondHash = Hash.sha256(expectedHash)
    expect(ECDSA.verify(new BigNumber(accidentalSecondHash), parsed, publicPoint)).toBe(false)
    expect(ECDSA.verify(new BigNumber([...expectedHash].reverse()), parsed, publicPoint)).toBe(false)
  })

  it('produces canonical low-S DER accepted by the independent XRPL verifier', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex('3'.padStart(64, '0')))
    const { publicKey } = await wallet.getPublicKey({
      protocolID: XRP_PROTOCOL_ID,
      keyID: XRP_KEY_ID,
      counterparty: 'self'
    })
    const identity = publicKeyToXrpIdentity(publicKey)
    const signed = await signXrpTransaction({
      wallet: wallet as unknown as Parameters<typeof signXrpTransaction>[0]['wallet'],
      publicKey: identity.publicKey,
      transaction: fixturePayment(identity.address)
    })
    const signature = Signature.fromDER(Utils.toArray(signed.transaction.TxnSignature!, 'hex'))
    const halfOrder = new Curve().n.shrn(1)

    expect(signature.s.cmp(halfOrder)).toBeLessThanOrEqual(0)
    expect(Utils.toHex(signature.toDER() as number[]).toUpperCase()).toBe(signed.transaction.TxnSignature)
    expect(verifySignature(signed.blob, identity.publicKey)).toBe(true)
    expect(verifyKeypairSignature(
      encodeForSigning({ ...signed.transaction, TxnSignature: undefined } as Payment),
      signed.transaction.TxnSignature!,
      identity.publicKey
    )).toBe(true)
    expect(signed.txid).toMatch(/^[0-9A-F]{64}$/)
  })

  it('refuses non-bounded payment fields and missing last-ledger limits', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex('5'.padStart(64, '0')))
    const { publicKey } = await wallet.getPublicKey({
      protocolID: XRP_PROTOCOL_ID,
      keyID: XRP_KEY_ID,
      counterparty: 'self'
    })
    const identity = publicKeyToXrpIdentity(publicKey)
    await expect(signXrpTransaction({
      wallet: wallet as unknown as Parameters<typeof signXrpTransaction>[0]['wallet'],
      publicKey: identity.publicKey,
      transaction: { ...fixturePayment(identity.address), Flags: 0x00020000 }
    })).rejects.toThrow(/Payment flags must be zero/)

    await expect(signXrpTransaction({
      wallet: wallet as unknown as Parameters<typeof signXrpTransaction>[0]['wallet'],
      publicKey: identity.publicKey,
      transaction: { ...fixturePayment(identity.address), NetworkID: 42 }
    })).rejects.toThrow(/NetworkID must be omitted/)

    const withoutLastLedger = fixturePayment(identity.address)
    delete withoutLastLedger.LastLedgerSequence
    await expect(signXrpTransaction({
      wallet: wallet as unknown as Parameters<typeof signXrpTransaction>[0]['wallet'],
      publicKey: identity.publicKey,
      transaction: withoutLastLedger
    })).rejects.toThrow(/last-ledger limit/)
  })
})
