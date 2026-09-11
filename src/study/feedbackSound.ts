export type StudySound = 'tap' | 'reveal' | 'again' | 'hard' | 'good' | 'easy' | 'complete'

interface Tone {
  frequency: number
  duration: number
  delay?: number
  volume?: number
  endFrequency?: number
  waveform?: OscillatorType
}

interface Voice {
  oscillator: OscillatorNode
  gain: GainNode
}

const patterns: Record<StudySound, readonly Tone[]> = {
  tap: [{ frequency: 340, endFrequency: 220, duration: 0.045, volume: 0.025, waveform: 'triangle' }],
  reveal: [
    { frequency: 440, duration: 0.07, volume: 0.025 },
    { frequency: 587.33, delay: 0.035, duration: 0.09, volume: 0.022 },
  ],
  again: [{ frequency: 293.66, endFrequency: 277.18, duration: 0.1, volume: 0.028 }],
  hard: [{ frequency: 349.23, duration: 0.11, volume: 0.028 }],
  good: [
    { frequency: 392, duration: 0.085, volume: 0.025 },
    { frequency: 523.25, delay: 0.055, duration: 0.11, volume: 0.027 },
  ],
  easy: [
    { frequency: 523.25, duration: 0.08, volume: 0.025 },
    { frequency: 659.25, delay: 0.05, duration: 0.12, volume: 0.025 },
  ],
  complete: [
    { frequency: 523.25, duration: 0.12, volume: 0.024 },
    { frequency: 659.25, delay: 0.065, duration: 0.12, volume: 0.024 },
    { frequency: 783.99, delay: 0.13, duration: 0.17, volume: 0.025 },
  ],
}

const maxVoices = 8
const maxResumeDelayMs = 250
const voices = new Set<Voice>()
let audioContext: AudioContext | undefined
let latestRequest = 0
let lastPlayedAt = -Infinity

function releaseVoice(voice: Voice) {
  if (!voices.delete(voice)) return
  voice.oscillator.onended = null
  try { voice.oscillator.stop() } catch { /* Already stopped. */ }
  voice.oscillator.disconnect()
  voice.gain.disconnect()
}

function playTone(context: AudioContext, tone: Tone) {
  while (voices.size >= maxVoices) {
    const oldest = voices.values().next().value
    if (oldest) releaseVoice(oldest)
  }

  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const voice = { oscillator, gain }
  voices.add(voice)

  try {
    const start = context.currentTime + (tone.delay ?? 0)
    const end = start + tone.duration
    oscillator.type = tone.waveform ?? 'sine'
    oscillator.frequency.setValueAtTime(tone.frequency, start)
    if (tone.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, end)
    }
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(tone.volume ?? 0.025, start + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    gain.gain.setValueAtTime(0, end + 0.005)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.onended = () => releaseVoice(voice)
    oscillator.start(start)
    oscillator.stop(end + 0.01)
  } catch {
    releaseVoice(voice)
  }
}

/** Call only in a click or keyboard handler, after checking the sound preference. */
export function playStudySound(sound: StudySound): void {
  if (typeof window === 'undefined' || document.visibilityState === 'hidden') return
  const requestedAt = performance.now()
  // Ignore accidental duplicate handlers and very fast key repeats.
  if (requestedAt - lastPlayedAt < 28) return
  lastPlayedAt = requestedAt
  const request = ++latestRequest

  try {
    if (!audioContext || audioContext.state === 'closed') {
      const AudioContextConstructor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextConstructor) return
      audioContext = new AudioContextConstructor()
    }
    const context = audioContext
    const play = () => {
      if (request !== latestRequest || context.state !== 'running'
        || document.visibilityState === 'hidden'
        || performance.now() - requestedAt > maxResumeDelayMs) return
      try {
        for (const tone of patterns[sound]) playTone(context, tone)
      } catch { /* Sound must never interrupt a study action. */ }
    }
    if (context.state === 'running') play()
    else void context.resume().then(play).catch(() => undefined)
  } catch { /* Unsupported or blocked audio leaves the interface fully usable. */ }
}

/** Cancel queued resume callbacks as well as sounds already playing. */
export function stopStudySounds(): void {
  latestRequest += 1
  for (const voice of voices) releaseVoice(voice)
}
