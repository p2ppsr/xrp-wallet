import {
  Client,
  rippleTimeToISOTime,
  type Payment,
  type Transaction,
  type TransactionMetadata
} from 'xrpl'
import {
  MAX_FEE_DROPS,
  formatDrops,
  parseXrpToDrops,
  resolveXrpDestination,
  type ResolvedDestination
} from './xrp'

const XRPL_SERVERS = [
  'wss://xrplcluster.com',
  'wss://s1.ripple.com'
]

export type LedgerConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

export interface XrpActivity {
  hash: string
  direction: 'received' | 'sent'
  amount: bigint | null
  counterparty: string
  ledgerIndex: number
  date?: string
  result: string
  validated: boolean
}

export interface XrpAccountState {
  address: string
  funded: boolean
  balance: bigint
  reserve: bigint
  spendable: bigint
  ownerCount: number
  ledgerIndex: number
  baseReserve: bigint
  ownerReserve: bigint
  openLedgerFee: bigint
  server: string
  transactions: XrpActivity[]
}

export interface PaymentPreview {
  transaction: Payment
  destination: ResolvedDestination
  amount: bigint
  fee: bigint
  ledgerIndex: number
}

export interface SubmissionResult {
  txid: string
  result: string
  validated: boolean
}

let client: Client | null = null
let connecting: Promise<Client> | null = null

const toBigInt = (value: unknown): bigint => {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value)
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  return 0n
}

const xrpNumberToDrops = (value: unknown): bigint => {
  const numeric = typeof value === 'number' ? value.toFixed(6) : String(value ?? '0')
  const [whole, fractional = ''] = numeric.split('.')
  return BigInt(whole || '0') * 1_000_000n + BigInt(fractional.padEnd(6, '0').slice(0, 6))
}

export const getXrplClient = async (): Promise<Client> => {
  if (client?.isConnected()) return client
  if (connecting != null) return connecting

  connecting = (async () => {
    let lastError: unknown
    for (const server of XRPL_SERVERS) {
      const candidate = new Client(server, { timeout: 20_000, maxFeeXRP: '0.1' })
      try {
        await candidate.connect()
        client = candidate
        return candidate
      } catch (error) {
        lastError = error
        try {
          await candidate.disconnect()
        } catch {
          // Nothing to clean up after a failed handshake.
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('No public XRPL server answered')
  })()

  try {
    return await connecting
  } finally {
    connecting = null
  }
}

const transactionResult = (meta: string | TransactionMetadata | undefined): string => {
  if (typeof meta === 'object' && meta != null && 'TransactionResult' in meta) {
    return String(meta.TransactionResult)
  }
  return typeof meta === 'string' ? meta : 'unknown'
}

const mapActivity = (entry: any, account: string): XrpActivity | null => {
  const tx = (entry.tx_json ?? entry.tx) as (Transaction & { hash?: string; date?: number }) | undefined
  if (tx == null || tx.TransactionType !== 'Payment') return null
  const hash = String(entry.hash ?? tx.hash ?? '')
  if (!hash) return null
  const sent = tx.Account === account
  const destination = 'Destination' in tx ? String(tx.Destination ?? '') : ''
  const amount = 'Amount' in tx && typeof tx.Amount === 'string' ? toBigInt(tx.Amount) : null
  return {
    hash,
    direction: sent ? 'sent' : 'received',
    amount,
    counterparty: sent ? destination : tx.Account,
    ledgerIndex: Number(entry.ledger_index ?? 0),
    date: typeof tx.date === 'number' ? rippleTimeToISOTime(tx.date) : undefined,
    result: transactionResult(entry.meta),
    validated: Boolean(entry.validated)
  }
}

export const fetchXrpAccountState = async (address: string): Promise<XrpAccountState> => {
  const activeClient = await getXrplClient()
  const [serverInfo, fee] = await Promise.all([
    activeClient.request({ command: 'server_info' }),
    activeClient.request({ command: 'fee' })
  ])
  const validated = serverInfo.result.info.validated_ledger
  if (validated == null) throw new Error('XRPL server has no validated ledger')

  const baseReserve = xrpNumberToDrops(validated.reserve_base_xrp)
  const ownerReserve = xrpNumberToDrops(validated.reserve_inc_xrp)
  const ledgerIndex = Number(validated.seq)
  const openLedgerFee = toBigInt(fee.result.drops.open_ledger_fee)

  let balance = 0n
  let ownerCount = 0
  let funded = true
  try {
    const accountInfo = await activeClient.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated'
    })
    balance = toBigInt(accountInfo.result.account_data.Balance)
    ownerCount = Number(accountInfo.result.account_data.OwnerCount ?? 0)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/actNotFound|Account not found/i.test(message)) funded = false
    else throw error
  }

  let transactions: XrpActivity[] = []
  if (funded) {
    const accountTx = await activeClient.request({
      command: 'account_tx',
      account: address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 50,
      forward: false
    })
    transactions = accountTx.result.transactions
      .map(entry => mapActivity(entry, address))
      .filter((entry): entry is XrpActivity => entry != null)
  }

  const reserve = funded ? baseReserve + ownerReserve * BigInt(ownerCount) : baseReserve
  return {
    address,
    funded,
    balance,
    reserve,
    spendable: balance > reserve ? balance - reserve : 0n,
    ownerCount,
    ledgerIndex,
    baseReserve,
    ownerReserve,
    openLedgerFee,
    server: activeClient.url,
    transactions
  }
}

export const prepareXrpPayment = async (params: {
  account: string
  destination: string
  destinationTag?: string
  amount: string
}): Promise<PaymentPreview> => {
  const amount = parseXrpToDrops(params.amount)
  const destination = resolveXrpDestination(params.destination, params.destinationTag)
  if (destination.classicAddress === params.account) {
    throw new Error('Sending XRP back to the same address would be an unusually pure bailout')
  }

  const activeClient = await getXrplClient()
  const payment: Payment = {
    TransactionType: 'Payment',
    Account: params.account,
    Destination: destination.classicAddress,
    Amount: amount.toString()
  }
  if (destination.tag !== undefined) payment.DestinationTag = destination.tag

  const transaction = await activeClient.autofill(payment)
  const fee = toBigInt(transaction.Fee)
  if (fee > MAX_FEE_DROPS) {
    throw new Error(`XRPL proposed a ${formatDrops(fee)} XRP fee, above the wallet safety cap`)
  }
  return {
    transaction,
    destination,
    amount,
    fee,
    ledgerIndex: await activeClient.getLedgerIndex()
  }
}

export const submitXrpTransaction = async (blob: string, expectedTxid: string): Promise<SubmissionResult> => {
  const activeClient = await getXrplClient()
  const response = await activeClient.submitAndWait(blob, { failHard: true })
  const result = transactionResult(response.result.meta)
  if (result !== 'tesSUCCESS') throw new Error(`XRPL rejected the payment: ${result}`)
  return {
    txid: String(response.result.hash ?? expectedTxid),
    result,
    validated: Boolean(response.result.validated)
  }
}

export const xrplExplorerTxUrl = (txid: string): string =>
  `https://livenet.xrpl.org/transactions/${encodeURIComponent(txid)}`

export const subscribeToXrpAccount = async (
  address: string,
  handlers: {
    onStatus: (status: LedgerConnectionStatus) => void
    onTransaction: () => void
  }
): Promise<() => void> => {
  handlers.onStatus('connecting')
  const activeClient = await getXrplClient()
  await activeClient.request({ command: 'subscribe', accounts: [address] })
  handlers.onStatus('live')

  const transactionListener = (event: any) => {
    const tx = event?.transaction
    if (tx?.Account === address || tx?.Destination === address) handlers.onTransaction()
  }
  const disconnectedListener = () => handlers.onStatus('reconnecting')
  const errorListener = () => handlers.onStatus('offline')
  activeClient.on('transaction', transactionListener)
  activeClient.on('disconnected', disconnectedListener)
  activeClient.on('error', errorListener)

  return () => {
    activeClient.off('transaction', transactionListener)
    activeClient.off('disconnected', disconnectedListener)
    activeClient.off('error', errorListener)
    if (activeClient.isConnected()) {
      void activeClient.request({ command: 'unsubscribe', accounts: [address] }).catch(() => undefined)
    }
  }
}
