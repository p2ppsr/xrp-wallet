import { Client } from 'xrpl'

const server = process.env.XRPL_SERVER || 'wss://xrplcluster.com'
const knownFundedAccount = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const client = new Client(server, { timeout: 20_000, maxFeeXRP: '0.1' })

try {
  await client.connect()
  const [serverInfo, fee, accountInfo, accountTx] = await Promise.all([
    client.request({ command: 'server_info' }),
    client.request({ command: 'fee' }),
    client.request({ command: 'account_info', account: knownFundedAccount, ledger_index: 'validated' }),
    client.request({ command: 'account_tx', account: knownFundedAccount, ledger_index_min: -1, ledger_index_max: -1, limit: 1 })
  ])
  const ledger = serverInfo.result.info.validated_ledger
  if (ledger == null || accountInfo.result.account_data.Account !== knownFundedAccount) {
    throw new Error('XRPL smoke response was incomplete')
  }
  console.log(JSON.stringify({
    server,
    ledgerIndex: ledger.seq,
    reserveBaseXrp: ledger.reserve_base_xrp,
    reserveOwnerXrp: ledger.reserve_inc_xrp,
    openLedgerFeeDrops: fee.result.drops.open_ledger_fee,
    knownAccountSequence: accountInfo.result.account_data.Sequence,
    recentTransactionCount: accountTx.result.transactions.length
  }))
} finally {
  if (client.isConnected()) await client.disconnect()
}
