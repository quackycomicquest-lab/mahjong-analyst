/**
 * 効果音と発声
 *
 * - 打牌音：Web Audio で合成する（牌どうしが当たる短い「カチッ」）。音源ファイルは使わない
 * - 発声（リーチ・ポン・チー・カン・ロン・ツモ）：端末の日本語音声合成（speechSynthesis）で読み上げる。
 *   誰の発声か分かるよう、席ごとに声の高さを変える
 * iPhone の Safari は、画面をタップした操作の中で一度音を鳴らすまで音が出ないので、
 * 対局開始・打牌などの操作のたびに unlockAudio() を呼ぶ。
 */
import type { Action, Seat } from '../engine/game/types'

export type SoundSetting = 'all' | 'se' | 'off'

export const SOUND_LABELS: [SoundSetting, string][] = [
  ['all', '効果音＋発声'],
  ['se', '効果音だけ'],
  ['off', 'なし'],
]

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null
let speechUnlocked = false

function audio(): AudioContext | null {
  if (ctx) return ctx
  const AC = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined
  if (!AC) return null
  try {
    ctx = new AC()
  } catch {
    ctx = null
  }
  return ctx
}

/** 操作の中で呼ぶ：音声の再生を許可させる（何度呼んでもよい） */
export function unlockAudio(): void {
  const c = audio()
  if (c && c.state === 'suspended') void c.resume().catch(() => {})
  if (!speechUnlocked && typeof speechSynthesis !== 'undefined') {
    speechUnlocked = true
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    speechSynthesis.speak(u)
  }
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise) return noise
  const len = Math.floor(c.sampleRate * 0.08)
  noise = c.createBuffer(1, len, c.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
  return noise
}

/** 打牌音（strong：立直の宣言牌は少し強く） */
export function playDiscard(strong = false): void {
  const c = audio()
  if (!c || c.state !== 'running') return
  const t = c.currentTime
  // 硬い当たりの音：高めの帯域に絞った短いノイズ
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c)
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = strong ? 2400 : 3000
  band.Q.value = 1.2
  const g = c.createGain()
  g.gain.setValueAtTime(strong ? 0.9 : 0.6, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07)
  src.connect(band).connect(g).connect(c.destination)
  src.start(t)
  // 卓に置いたときの低い響き
  const osc = c.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(strong ? 180 : 220, t)
  osc.frequency.exponentialRampToValueAtTime(90, t + 0.06)
  const g2 = c.createGain()
  g2.gain.setValueAtTime(strong ? 0.35 : 0.2, t)
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
  osc.connect(g2).connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.1)
}

/** 席ごとの声の高さ（自分・下家・対面・上家） */
const PITCH = [1.0, 1.35, 0.8, 1.15]
let jaVoice: SpeechSynthesisVoice | null | undefined

function japaneseVoice(): SpeechSynthesisVoice | null {
  if (jaVoice !== undefined && jaVoice !== null) return jaVoice
  const voices = speechSynthesis.getVoices()
  jaVoice = voices.find((v) => v.lang === 'ja-JP' && v.localService) ?? voices.find((v) => v.lang.startsWith('ja')) ?? null
  return jaVoice
}

/** 発声（リーチ・ポン など） */
export function speak(text: string, seat: Seat): void {
  if (typeof speechSynthesis === 'undefined') return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ja-JP'
  const v = japaneseVoice()
  if (v) u.voice = v
  u.rate = 1.15
  u.pitch = PITCH[seat] ?? 1
  // 前の発声が残っていれば打ち切って、今の行動に合わせる
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

/** 行動の発声の言葉（なければ null） */
export function callWord(action: Action): string | null {
  switch (action.type) {
    case 'discard':
      return action.riichi ? 'リーチ' : null
    case 'pon':
      return 'ポン'
    case 'chi':
      return 'チー'
    case 'ankan':
    case 'kakan':
    case 'daiminkan':
      return 'カン'
    case 'ron':
      return 'ロン'
    case 'tsumo':
      return 'ツモ'
    case 'kyuushu':
      return '九種九牌'
    default:
      return null
  }
}

/** 行動に合わせて音を鳴らす */
export function playActionSound(action: Action, setting: SoundSetting = 'all'): void {
  if (setting === 'off' || action.type === 'nextRound' || action.type === 'pass') return
  const word = callWord(action)
  if (word && setting === 'all') speak(word, action.seat)
  if (action.type === 'discard') playDiscard(!!action.riichi)
}
