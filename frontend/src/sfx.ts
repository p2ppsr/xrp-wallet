type SfxKind =
  | 'connect'
  | 'copy'
  | 'refresh'
  | 'review'
  | 'send'
  | 'receive'
  | 'error'
  | 'toggle'

let audioContext: AudioContext | null = null

const getContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (Ctor == null) return null
  if (audioContext == null) audioContext = new Ctor()
  if (audioContext.state === 'suspended') void audioContext.resume()
  return audioContext
}
const beep = (
  context: AudioContext,
  start: number,
  duration: number,
  frequency: number,
  type: OscillatorType,
  gainValue = 0.05
) => {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

export const playSfx = (kind: SfxKind, enabled: boolean): void => {
  if (!enabled) return
  try {
    const context = getContext()
    if (context == null) return
    const now = context.currentTime
    switch (kind) {
      case 'connect':
        beep(context, now, 0.09, 440, 'triangle')
        beep(context, now + 0.08, 0.13, 660, 'triangle')
        break
      case 'copy':
        beep(context, now, 0.06, 900, 'sine')
        beep(context, now + 0.045, 0.08, 1200, 'sine')
        break
      case 'refresh':
        beep(context, now, 0.06, 520, 'square', 0.025)
        break
      case 'review':
        beep(context, now, 0.08, 330, 'triangle')
        beep(context, now + 0.08, 0.08, 495, 'triangle')
        break
      case 'send':
        beep(context, now, 0.08, 740, 'sawtooth', 0.035)
        beep(context, now + 0.07, 0.12, 980, 'triangle')
        break
      case 'receive':
        beep(context, now, 0.05, 360, 'triangle')
        beep(context, now + 0.05, 0.08, 720, 'triangle')
        beep(context, now + 0.12, 0.1, 1080, 'sine')
        break
      case 'error':
        beep(context, now, 0.12, 160, 'sawtooth', 0.04)
        break
      case 'toggle':
        beep(context, now, 0.05, 620, 'sine', 0.025)
        break
      default:
        break
    }
  } catch {
    // Audio is decorative. Wallet actions must not fail because sound failed.
  }
}
