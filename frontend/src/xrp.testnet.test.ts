import { describe, expect, it } from 'vitest'
import { KeyDeriver, PrivateKey, ProtoWallet } from '@bsv/sdk'
import { Client, ECDSA as XrplECDSA, Wallet as XrplWallet, type Payment, type TransactionMetadata } from 'xrpl'
import {
  XRP_KEY_ID,
  XRP_PROTOCOL_ID,
  deriveXrpIdentity,
  signXrpTransaction
} from './xrp'

const runProof = process.env.XRPL_TESTNET_PROOF === '1'

describe.skipIf(!runProof)('XRPL testnet BRC100 proof', () => {
  it('funds, signs, submits, and validates an on-ledger native XRP payment', async () => {
    const rootKey = PrivateKey.fromRandom()
    const protoWallet = new ProtoWallet(rootKey)
    const identity = await deriveXrpIdentity(
      protoWallet as unknown as Parameters<typeof deriveXrpIdentity>[0]
    )

    // The private half is derived only to give the official testnet faucet a Wallet
    // object for this ephemeral address. The submitted payment is still signed by
    // signXrpTransaction -> ProtoWallet.createSignature, exactly like production.
    const ephemeralPrivateKey = new KeyDeriver(rootKey).derivePrivateKey(
      XRP_PROTOCOL_ID,
      XRP_KEY_ID,
      'self'
    )
    const faucetWallet = new XrplWallet(
      identity.publicKey,
      `00${ephemeralPrivateKey.toHex().toUpperCase()}`
    )
    expect(faucetWallet.classicAddress).toBe(identity.address)

    const client = new Client('wss://s.altnet.rippletest.net:51233', {
      timeout: 20_000,
      maxFeeXRP: '0.1'
    })
    await client.connect()
    try {
      const funded = await client.fundWallet(faucetWallet, { amount: '20' })
      expect(funded.balance).toBeGreaterThan(1)

      const recipient = XrplWallet.generate(XrplECDSA.secp256k1)
      const payment = await client.autofill<Payment>({
        TransactionType: 'Payment',
        Account: identity.address,
        Destination: recipient.classicAddress,
        Amount: '2000000'
      })
      const signed = await signXrpTransaction({
        wallet: protoWallet as unknown as Parameters<typeof signXrpTransaction>[0]['wallet'],
        publicKey: identity.publicKey,
        transaction: payment
      })
      const response = await client.submitAndWait(signed.blob, { failHard: true })
      const meta = response.result.meta as TransactionMetadata

      expect(response.result.validated).toBe(true)
      expect(meta.TransactionResult).toBe('tesSUCCESS')
      expect(response.result.hash).toBe(signed.txid)
      console.info('XRPL_TESTNET_PROOF', JSON.stringify({
        transaction: signed.txid,
        ledgerIndex: response.result.ledger_index,
        source: identity.address,
        destination: recipient.classicAddress,
        amountDrops: payment.Amount,
        feeDrops: payment.Fee,
        protocolID: XRP_PROTOCOL_ID
      }))
    } finally {
      await client.disconnect()
    }
  }, 90_000)
})
