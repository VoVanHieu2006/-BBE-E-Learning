/**
 * High-performance Web Audio API Sound Synthesizer
 * Generates sparkling bell chime arpeggios directly in the browser (0ms lag, 0 external assets).
 */

class SoundSynthesizer {
  private ctx: AudioContext | null = null

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  /**
   * Plays a celebratory Golden Star Chime (Major Chord Arpeggio: C5 -> E5 -> G5 -> C6)
   * with natural bell decay and harmonic shimmer.
   */
  playStarChime() {
    try {
      const ctx = this.getContext()
      if (!ctx) return

      const now = ctx.currentTime
      // Notes: C5, E5, G5, C6 (Major triad arpeggio + octave)
      const notes = [
        { freq: 523.25, time: 0.00, gain: 0.35, duration: 0.8 },
        { freq: 659.25, time: 0.08, gain: 0.38, duration: 0.9 },
        { freq: 783.99, time: 0.16, gain: 0.42, duration: 1.1 },
        { freq: 1046.50, time: 0.24, gain: 0.50, duration: 1.4 },
      ]

      // Master gain
      const master = ctx.createGain()
      master.gain.setValueAtTime(0.7, now)
      master.connect(ctx.destination)

      notes.forEach(({ freq, time, gain, duration }) => {
        const noteStart = now + time

        // Fundamental tone (Triangle wave for warmth)
        const osc1 = ctx.createOscillator()
        osc1.type = 'triangle'
        osc1.frequency.setValueAtTime(freq, noteStart)

        // Shimmer overtone (Sine wave 1 octave up for crystalline sparkle)
        const osc2 = ctx.createOscillator()
        osc2.type = 'sine'
        osc2.frequency.setValueAtTime(freq * 2, noteStart)

        // Envelope generator
        const noteGain = ctx.createGain()
        noteGain.gain.setValueAtTime(0.0001, noteStart)
        noteGain.gain.exponentialRampToValueAtTime(gain, noteStart + 0.02)
        noteGain.gain.exponentialRampToValueAtTime(0.0001, noteStart + duration)

        const shimmerGain = ctx.createGain()
        shimmerGain.gain.setValueAtTime(0.0001, noteStart)
        shimmerGain.gain.exponentialRampToValueAtTime(gain * 0.4, noteStart + 0.015)
        shimmerGain.gain.exponentialRampToValueAtTime(0.0001, noteStart + duration * 0.7)

        osc1.connect(noteGain)
        noteGain.connect(master)

        osc2.connect(shimmerGain)
        shimmerGain.connect(master)

        osc1.start(noteStart)
        osc1.stop(noteStart + duration)

        osc2.start(noteStart)
        osc2.stop(noteStart + duration)
      })
    } catch {
      // Audio autoplay policy fallback
    }
  }
}

export const soundEffects = new SoundSynthesizer()
