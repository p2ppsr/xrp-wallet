import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import BabbageGo from '@babbage/go'
import { WalletClient, type WalletInterface } from '@bsv/sdk'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeDollarSign,
  Building2,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Landmark,
  Loader2,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Stamp,
  Volume2,
  VolumeX,
  Wallet,
  Waves,
  Zap
} from 'lucide-react'
import {
  assertXrpCryptoRuntime,
  deriveXrpIdentity,
  formatDrops,
  signXrpTransaction,
  type SignedXrpTransaction,
  type XrpIdentity
} from './xrp'
import {
  fetchXrpAccountState,
  prepareXrpPayment,
  submitXrpTransaction,
  subscribeToXrpAccount,
  xrplExplorerTxUrl,
  type LedgerConnectionStatus,
  type PaymentPreview,
  type XrpAccountState
} from './xrpl-client'
import { playSfx } from './sfx'

type Mode = 'send' | 'receive'
type StatusKind = 'info' | 'success' | 'error'

interface StatusMessage {
  kind: StatusKind
  text: string
}

interface SendFormState {
  destination: string
  destinationTag: string
  amount: string
}

const initialForm: SendFormState = { destination: '', destinationTag: '', amount: '' }
const cryptoRuntimeReady = assertXrpCryptoRuntime()

const truncate = (value: string, left = 8, right = 8): string => {
  if (value.length <= left + right + 3) return value
  return `${value.slice(0, left)}…${value.slice(-right)}`
}

const connectionLabel = (status: LedgerConnectionStatus | 'idle'): string => {
  switch (status) {
    case 'live': return 'Validated live'
    case 'connecting': return 'Calling liquidity desk'
    case 'reconnecting': return 'Reopening branch'
    case 'offline': return 'Bank holiday'
    default: return 'Not connected'
  }
}

const formatDate = (date?: string): string => {
  if (!date) return 'Validated ledger'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(new Date(date))
}

export default function App() {
  const walletRef = useRef<WalletInterface | null>(null)
  const [identity, setIdentity] = useState<XrpIdentity | null>(null)
  const [account, setAccount] = useState<XrpAccountState | null>(null)
  const [mode, setMode] = useState<Mode>('send')
  const [form, setForm] = useState<SendFormState>(initialForm)
  const [preview, setPreview] = useState<PaymentPreview | null>(null)
  const [lastSigned, setLastSigned] = useState<SignedXrpTransaction | null>(null)
  const [lastTxid, setLastTxid] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusMessage>({
    kind: 'info',
    text: 'Connect a Metanet wallet. We will misunderstand the assignment from there.'
  })
  const [connection, setConnection] = useState<LedgerConnectionStatus | 'idle'>('idle')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [showAddress, setShowAddress] = useState(true)
  const [sfxEnabled, setSfxEnabled] = useState(() => window.localStorage.getItem('second-bailout:sfx') !== 'off')

  const wallet = useCallback(() => {
    if (walletRef.current == null) {
      walletRef.current = new BabbageGo(new WalletClient(), {
        showModal: true,
        design: {
          preset: 'midnightHalo',
          tokens: {
            accentBackground: '#31d9ff',
            accentText: '#031018',
            accentHoverBackground: '#a8efff',
            accentHoverText: '#031018',
            buttonShape: 'soft',
            cardRadius: '10px'
          }
        },
        walletUnavailable: {
          title: 'Your bailout desk is not staffed',
          message: 'Open this app in Metanet Explorer or install a BRC100 wallet. No XRP seed phrase will be requested here.',
          ctaText: 'Open GetMetanet',
          ctaHref: 'https://getmetanet.com/open'
        }
      }) as WalletInterface
    }
    return walletRef.current
  }, [])

  const refresh = useCallback(async (address: string, withSound = false) => {
    setIsRefreshing(true)
    try {
      const next = await fetchXrpAccountState(address)
      setAccount(next)
      setStatus(next.funded
        ? { kind: 'success', text: `Ledger ${next.ledgerIndex.toLocaleString()} agrees: this institution exists.` }
        : { kind: 'info', text: `Address ready. Fund it with at least ${formatDrops(next.baseReserve)} XRP to activate the account.` })
      if (withSound) playSfx('refresh', sfxEnabled)
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'The liquidity desk did not answer.' })
      playSfx('error', sfxEnabled)
    } finally {
      setIsRefreshing(false)
    }
  }, [sfxEnabled])

  const connectWallet = async () => {
    if (!cryptoRuntimeReady) return
    setIsConnecting(true)
    setStatus({ kind: 'info', text: 'Deriving your XRP account from the BRC100 secp256k1 desk…' })
    try {
      const nextIdentity = await deriveXrpIdentity(wallet())
      setIdentity(nextIdentity)
      playSfx('connect', sfxEnabled)
      await refresh(nextIdentity.address)
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Could not open the bailout window.' })
      playSfx('error', sfxEnabled)
    } finally {
      setIsConnecting(false)
    }
  }

  const copyAddress = async () => {
    if (identity == null) return
    try {
      await navigator.clipboard.writeText(identity.address)
      setStatus({ kind: 'success', text: 'Account copied. Please use the funds systemically.' })
      playSfx('copy', sfxEnabled)
    } catch {
      setStatus({ kind: 'error', text: 'Clipboard access was declined by the board.' })
    }
  }

  const toggleSfx = () => {
    setSfxEnabled(current => {
      const next = !current
      window.localStorage.setItem('second-bailout:sfx', next ? 'on' : 'off')
      playSfx('toggle', true)
      return next
    })
  }

  const reviewSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (identity == null) {
      await connectWallet()
      return
    }
    setIsReviewing(true)
    setPreview(null)
    setLastSigned(null)
    try {
      const next = await prepareXrpPayment({
        account: identity.address,
        destination: form.destination,
        destinationTag: form.destinationTag,
        amount: form.amount
      })
      const liveAccount = account ?? await fetchXrpAccountState(identity.address)
      if (!liveAccount.funded) throw new Error('This XRP account is not funded yet')
      if (next.amount + next.fee > liveAccount.spendable) {
        throw new Error(`Available after reserve: ${formatDrops(liveAccount.spendable)} XRP`)
      }
      setAccount(liveAccount)
      setPreview(next)
      setStatus({ kind: 'info', text: 'The committee has prepared a bounded Payment. Review before signing.' })
      playSfx('review', sfxEnabled)
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Could not structure the bailout.' })
      playSfx('error', sfxEnabled)
    } finally {
      setIsReviewing(false)
    }
  }

  const signAndSubmit = async () => {
    if (identity == null || preview == null) return
    setIsSending(true)
    setStatus({ kind: 'info', text: 'Signing the SHA-512Half with your BRC100 k1 key. No vault, no seed export.' })
    try {
      const signed = await signXrpTransaction({
        wallet: wallet(),
        publicKey: identity.publicKey,
        transaction: preview.transaction
      })
      setLastSigned(signed)
      setStatus({ kind: 'info', text: `Locally verified ${truncate(signed.txid, 10, 10)}. Seeking consensus…` })
      const submitted = await submitXrpTransaction(signed.blob, signed.txid)
      setLastTxid(submitted.txid)
      setPreview(null)
      setForm(initialForm)
      setStatus({ kind: 'success', text: `Bailout validated: ${truncate(submitted.txid, 10, 10)}.` })
      playSfx('send', sfxEnabled)
      await refresh(identity.address)
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'The payment was not validated.' })
      playSfx('error', sfxEnabled)
    } finally {
      setIsSending(false)
    }
  }

  useEffect(() => {
    if (identity == null) return undefined
    let disposed = false
    let stop: (() => void) | undefined
    void subscribeToXrpAccount(identity.address, {
      onStatus: next => !disposed && setConnection(next),
      onTransaction: () => {
        if (disposed) return
        playSfx('receive', sfxEnabled)
        void refresh(identity.address)
      }
    }).then(cleanup => {
      if (disposed) cleanup()
      else stop = cleanup
    }).catch(() => {
      if (!disposed) setConnection('offline')
    })
    return () => {
      disposed = true
      stop?.()
    }
  }, [identity, refresh, sfxEnabled])

  const reserveLabel = useMemo(() => {
    if (account == null) return 'Network-priced'
    return `${formatDrops(account.reserve)} XRP`
  }, [account])

  return (
    <main className="app-shell">
      <section className="hero-band" aria-label="Second Bailout Wallet overview">
        <div className="ledger-sky" aria-hidden="true">
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <div className="ledger-lines" />
        </div>
        <div className="hero-content">
          <div className="brand-row">
            <span className="brand-mark" aria-hidden="true">X</span>
            <span>Second Bailout Wallet</span>
            <span className="uninsured">FDIC-ish</span>
          </div>
          <div className="hero-grid">
            <div>
              <p className="eyebrow">03 / JAN / 2009 · CHANCELLOR DESK</p>
              <h1>Become the<br /><span>Second Bailout.</span></h1>
              <p className="hero-copy">
                A wise man warned the Chancellor was on the brink of a second bailout. We misunderstood the assignment and switched to XRP.
              </p>
              <div className="hero-actions">
                <button className="primary-action" onClick={connectWallet} disabled={isConnecting}>
                  {isConnecting ? <Loader2 className="spin" aria-hidden /> : <Landmark aria-hidden />}
                  Open Bailout Window
                </button>
                <button className="icon-action" onClick={toggleSfx} aria-label={sfxEnabled ? 'Turn sound off' : 'Turn sound on'}>
                  {sfxEnabled ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
                </button>
              </div>
            </div>
            <div className="bailout-note" aria-hidden="true">
              <div className="note-top"><span>LIQUIDITY FACILITY</span><span>№ 0002</span></div>
              <div className="note-seal"><Building2 /><span>TOO DECENTRALIZED<br />TO FAIL</span></div>
              <div className="note-amount">∞</div>
              <div className="note-caption">PAY TO THE ORDER OF<br /><strong>WHOEVER HAS THE KEYS</strong></div>
              <Stamp className="note-stamp" />
              <div className="note-signature">The Internet</div>
            </div>
          </div>
        </div>
      </section>

      <section className="wallet-grid" aria-label="XRP wallet dashboard">
        <div className="balance-panel">
          <div className="panel-topline">
            <span>Systemically important balance</span>
            <span className={`live-pill live-${connection}`}><Radio />{connectionLabel(connection)}</span>
          </div>
          <div className="balance-main">{formatDrops(account?.balance ?? 0n, 6)} <small>XRP</small></div>
          <div className="balance-subgrid">
            <div><span>Available after reserve</span><strong>{formatDrops(account?.spendable ?? 0n)} XRP</strong></div>
            <div><span>Account reserve</span><strong>{reserveLabel}</strong></div>
            <div><span>Validated ledger</span><strong>{account?.ledgerIndex.toLocaleString() ?? 'Waiting'}</strong></div>
          </div>
          <div className={`status-strip status-${status.kind}`}>{status.text}</div>
        </div>

        <div className="address-panel">
          <div className="panel-topline">
            <span>Your institution</span>
            <button className="text-icon-button" onClick={() => setShowAddress(current => !current)}>
              {showAddress ? <EyeOff /> : <Eye />}{showAddress ? 'Redact' : 'Unredact'}
            </button>
          </div>
          <div className="address-box">
            <code>{identity == null ? 'Connect to derive an r-address' : showAddress ? identity.address : 'r••••••••••••••••••••••••••••••••'}</code>
            <button className="icon-action compact" onClick={copyAddress} disabled={identity == null} aria-label="Copy XRP address"><Copy /></button>
          </div>
          <p className="custody-note"><ShieldCheck /> One BRC100 k1 key. No XRP seed phrase. No Cardano-style vault.</p>
        </div>
      </section>

      <section className="action-layout">
        <div className="mode-panel">
          <div className="segmented-control" role="tablist" aria-label="Wallet mode">
            <button className={mode === 'send' ? 'selected' : ''} role="tab" aria-selected={mode === 'send'} onClick={() => setMode('send')}>
              <Send /> Capital injection
            </button>
            <button className={mode === 'receive' ? 'selected' : ''} role="tab" aria-selected={mode === 'receive'} onClick={() => setMode('receive')}>
              <ArrowDownLeft /> Receive facility
            </button>
          </div>

          {mode === 'send' ? (
            <form className="send-form" onSubmit={reviewSend}>
              <label><span>Beneficiary (classic or X-address)</span>
                <input value={form.destination} onChange={event => { setPreview(null); setForm(current => ({ ...current, destination: event.target.value })) }} placeholder="r… or X…" autoComplete="off" />
              </label>
              <div className="form-split">
                <label><span>Amount</span><div className="amount-input"><input value={form.amount} onChange={event => { setPreview(null); setForm(current => ({ ...current, amount: event.target.value })) }} placeholder="0.00" inputMode="decimal" /><strong>XRP</strong></div></label>
                <label><span>Destination tag <em>optional</em></span><input value={form.destinationTag} onChange={event => { setPreview(null); setForm(current => ({ ...current, destinationTag: event.target.value })) }} placeholder="e.g. 12345" inputMode="numeric" /></label>
              </div>
              <div className="fee-note"><Waves /> Fee and last-ledger limit come from the live XRPL. Exchanges often require a destination tag.</div>
              <button className="primary-action full" disabled={isReviewing || isSending}>
                {isReviewing ? <Loader2 className="spin" /> : <Zap />} Convene Committee
              </button>
              {preview != null && (
                <div className="send-preview">
                  <div className="preview-heading"><BadgeDollarSign /><strong>Emergency term sheet</strong></div>
                  <div className="preview-row"><span>Payment</span><strong>{formatDrops(preview.amount)} XRP</strong></div>
                  <div className="preview-row"><span>Network fee</span><strong>{formatDrops(preview.fee)} XRP</strong></div>
                  <div className="preview-row"><span>Beneficiary</span><strong title={preview.destination.classicAddress}>{truncate(preview.destination.classicAddress, 7, 7)}</strong></div>
                  <div className="preview-row"><span>Destination tag</span><strong>{preview.destination.tag ?? 'None'}</strong></div>
                  <button type="button" className="secondary-action" onClick={signAndSubmit} disabled={isSending}>
                    {isSending ? <Loader2 className="spin" /> : <ArrowUpRight />} Sign &amp; Become the Bailout
                  </button>
                </div>
              )}
              {lastSigned != null && preview == null && <div className="local-proof"><Check /> Signature verified locally before submission.</div>}
            </form>
          ) : (
            <div className="receive-panel">
              <div className="qr-shell" aria-label="XRP receive QR code">
                {identity == null ? <div className="qr-placeholder">OPEN<br />WINDOW</div> : <QRCodeSVG value={identity.address} size={320} bgColor="#ffffff" fgColor="#05070b" />}
              </div>
              <p>Share the classic address. For exchange deposits, copy the exact destination tag they assign you; tags route funds inside a shared XRP account.</p>
              <button className="secondary-action" onClick={copyAddress} disabled={identity == null}><Copy /> Copy Institution</button>
            </div>
          )}
        </div>

        <div className="tx-panel">
          <div className="panel-topline">
            <span>Public rescue register</span>
            <button className="text-icon-button" onClick={() => identity != null && refresh(identity.address, true)} disabled={identity == null || isRefreshing}>
              {isRefreshing ? <Loader2 className="spin" /> : <RefreshCw />} Sync
            </button>
          </div>
          {lastTxid != null && <a className="broadcast-link" href={xrplExplorerTxUrl(lastTxid)} target="_blank" rel="noreferrer"><Check /> Last bailout {truncate(lastTxid, 10, 10)} <ExternalLink /></a>}
          <div className="tx-list">
            {(account?.transactions.length ?? 0) === 0 ? (
              <div className="empty-state"><Landmark /><strong>No bailouts on the books.</strong><span>Connect a funded XRP account or receive a payment to populate the public register.</span></div>
            ) : account!.transactions.slice(0, 20).map(transaction => (
              <a className="tx-row" href={xrplExplorerTxUrl(transaction.hash)} target="_blank" rel="noreferrer" key={transaction.hash}>
                <span className={`tx-icon ${transaction.direction}`}>{transaction.direction === 'received' ? <ArrowDownLeft /> : <ArrowUpRight />}</span>
                <span><strong>{transaction.direction === 'received' ? 'Capital received' : 'Liquidity deployed'}</strong><small>{formatDate(transaction.date)} · {truncate(transaction.counterparty, 6, 6)}</small></span>
                <span className="tx-amount">{transaction.direction === 'received' ? '+' : '-'}{transaction.amount == null ? 'IOU' : formatDrops(transaction.amount, 4)}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <footer><span>Second Bailout Wallet</span><span>Native XRPL · BRC100 custody · extremely unofficial monetary policy</span></footer>
    </main>
  )
}
