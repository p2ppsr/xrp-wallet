import {
  Hash,
  PublicKey,
  Signature,
  Utils,
  type WalletInterface,
  type WalletProtocol
} from '@bsv/sdk'
import {
  deriveAddress,
  encode,
  encodeForSigning,
  hashes,
  isValidClassicAddress,
  isValidXAddress,
  verifySignature,
  xAddressToClassicAddress,
  type Payment
} from 'xrpl'

export const XRP_PROTOCOL_ID: WalletProtocol = [1, 'xrp wallet']
export const XRP_KEY_ID = '1'
export const DROPS_PER_XRP = 1_000_000n
export const MAX_FEE_DROPS = 100_000n

export interface XrpIdentity {
  publicKey: string
  publicKeyBytes: number[]
  address: string
}

export interface ResolvedDestination {
  classicAddress: string
  tag?: number
  source: 'classic' | 'x-address'
}

export interface SignedXrpTransaction {
  blob: string
  txid: string
  transaction: Payment
  signingHash: number[]
}

const bytesToHex = (bytes: number[] | Uint8Array): string =>
  Utils.toHex(Array.from(bytes)).toUpperCase()

const hexToBytes = (hex: string): number[] => {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error('XRPL signing payload is not valid hex')
  }
  return Utils.toArray(hex, 'hex')
}

const EMPTY_SHA512_HALF = 'CF83E1357EEFB8BDF1542850D66D8007D620E4050B5715DC83F4A921D36CE9CE'

export const assertXrpCryptoRuntime = (): true => {
  if (bytesToHex(sha512Half([])) !== EMPTY_SHA512_HALF) {
    throw new Error('Browser SHA-512 implementation failed the XRPL startup self-test')
  }
  return true
}

export const parseXrpToDrops = (amount: string): bigint => {
  const normalized = amount.trim()
  if (!/^\d+(\.\d{0,6})?$/.test(normalized)) {
    throw new Error('Enter an XRP amount with up to 6 decimal places')
  }
  const [whole, fractional = ''] = normalized.split('.')
  const drops = BigInt(whole) * DROPS_PER_XRP + BigInt(fractional.padEnd(6, '0'))
  if (drops <= 0n) throw new Error('Amount must be greater than zero')
  return drops
}

export const formatDrops = (drops: bigint, maxDecimals = 6): string => {
  const sign = drops < 0n ? '-' : ''
  const absolute = drops < 0n ? -drops : drops
  const whole = absolute / DROPS_PER_XRP
  const fraction = (absolute % DROPS_PER_XRP).toString().padStart(6, '0')
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, '')
  return `${sign}${whole.toString()}${trimmed ? `.${trimmed}` : ''}`
}

export const publicKeyToXrpIdentity = (publicKey: string): XrpIdentity => {
  const publicKeyBytes = PublicKey.fromString(publicKey).toDER() as number[]
  if (publicKeyBytes.length !== 33) {
    throw new Error('The Metanet wallet did not return a compressed secp256k1 public key')
  }
  const normalizedPublicKey = bytesToHex(publicKeyBytes)
  return {
    publicKey: normalizedPublicKey,
    publicKeyBytes,
    address: deriveAddress(normalizedPublicKey)
  }
}

export const deriveXrpIdentity = async (wallet: WalletInterface): Promise<XrpIdentity> => {
  const { publicKey } = await wallet.getPublicKey({
    protocolID: XRP_PROTOCOL_ID,
    keyID: XRP_KEY_ID,
    counterparty: 'self'
  })
  return publicKeyToXrpIdentity(publicKey)
}

export const parseDestinationTag = (value: string): number | undefined => {
  const normalized = value.trim()
  if (normalized.length === 0) return undefined
  if (!/^\d+$/.test(normalized)) throw new Error('Destination tag must be a whole number')
  const tag = Number(normalized)
  if (!Number.isSafeInteger(tag) || tag < 0 || tag > 0xffffffff) {
    throw new Error('Destination tag must be between 0 and 4,294,967,295')
  }
  return tag
}

export const resolveXrpDestination = (address: string, tagInput = ''): ResolvedDestination => {
  const normalized = address.trim()
  const explicitTag = parseDestinationTag(tagInput)

  if (isValidXAddress(normalized)) {
    const decoded = xAddressToClassicAddress(normalized)
    if (decoded.test) throw new Error('Testnet X-addresses cannot receive mainnet XRP')
    if (explicitTag !== undefined && decoded.tag !== false && explicitTag !== decoded.tag) {
      throw new Error('The X-address already contains a different destination tag')
    }
    return {
      classicAddress: decoded.classicAddress,
      tag: decoded.tag === false ? explicitTag : decoded.tag,
      source: 'x-address'
    }
  }

  if (!isValidClassicAddress(normalized)) {
    throw new Error('Enter a valid mainnet XRP classic address or X-address')
  }

  return {
    classicAddress: normalized,
    tag: explicitTag,
    source: 'classic'
  }
}

export const sha512Half = (payload: number[]): number[] =>
  (Hash.sha512(payload) as number[]).slice(0, 32)

export const signXrpTransaction = async (params: {
  wallet: WalletInterface
  publicKey: string
  transaction: Payment
}): Promise<SignedXrpTransaction> => {
  const identity = publicKeyToXrpIdentity(params.publicKey)
  if (params.transaction.Account !== identity.address) {
    throw new Error('Transaction account does not match the BRC100 signing key')
  }
  if (params.transaction.TransactionType !== 'Payment') {
    throw new Error('Second Bailout Wallet only signs XRP Payment transactions')
  }
  if (typeof params.transaction.Amount !== 'string') {
    throw new Error('Only native XRP payments are supported')
  }
  if (BigInt(params.transaction.Fee ?? '0') > MAX_FEE_DROPS) {
    throw new Error(`Network fee exceeds the ${formatDrops(MAX_FEE_DROPS)} XRP safety cap`)
  }

  const unsigned: Payment = {
    ...params.transaction,
    SigningPubKey: identity.publicKey
  }
  delete unsigned.TxnSignature

  const signingPayload = hexToBytes(encodeForSigning(unsigned))
  const signingHash = sha512Half(signingPayload)
  const { signature } = await params.wallet.createSignature({
    hashToDirectlySign: signingHash,
    protocolID: XRP_PROTOCOL_ID,
    keyID: XRP_KEY_ID,
    counterparty: 'self'
  })

  // Parsing rejects malformed DER before it reaches an XRPL server.
  Signature.fromDER(signature)
  const transaction: Payment = {
    ...unsigned,
    TxnSignature: bytesToHex(signature)
  }
  const blob = encode(transaction)
  if (!verifySignature(blob, identity.publicKey)) {
    throw new Error('The XRPL signature did not verify locally; nothing was submitted')
  }

  return {
    blob,
    txid: hashes.hashSignedTx(blob),
    transaction,
    signingHash
  }
}
