/**
 * AIプレイヤーの設定（仕様 §2-4）
 *
 * 「性格（打ち筋）」と「強さ」を別々に設定する。
 * 性格は判断方針の重みで表し、ランダムに打たせることで個性を出すことはしない。
 */

export interface Personality {
  /** 押し引きの攻撃性 0〜1（高いほど他家の立直に押す） */
  aggression: number
  /** 鳴きやすさ 0〜1 */
  callTendency: number
  /** 打点志向 0〜1（高いほどドラ・役牌・染め手を残し、高い手を狙う） */
  valueFocus: number
  /** 立直志向 0〜1（低いと役ありの聴牌でダマを選びやすい） */
  riichiTendency: number
}

/**
 * 強さ
 * 1 初級: 受け入れ枚数を見ない／安全牌は現物だけ／役なしで鳴くことがある／判断にばらつき
 * 2 中級: 受け入れ枚数（見えている牌を考慮）／スジ・字牌の枚数で守備／役のない鳴きはしない
 * 3 上級: 中級に加えて壁・ワンチャンス、聴牌時は打点も比較、立直とダマを打点で判断、ばらつきなし
 */
export type Strength = 1 | 2 | 3

export interface AiProfile {
  id: string
  name: string
  description: string
  personality: Personality
  strength: Strength
}

export const PERSONALITIES = {
  speed: {
    label: '速攻型',
    description: '鳴きを多用して速さ重視。押し気味。',
    personality: { aggression: 0.75, callTendency: 0.85, valueFocus: 0.15, riichiTendency: 0.6 },
  },
  defense: {
    label: '守備型',
    description: '門前中心で、他家の立直には早めに降りる。',
    personality: { aggression: 0.15, callTendency: 0.2, valueFocus: 0.4, riichiTendency: 0.7 },
  },
  value: {
    label: '打点型',
    description: 'ドラ・役牌・染め手を活かして高い手を狙う。立直は積極的。',
    personality: { aggression: 0.5, callTendency: 0.45, valueFocus: 0.9, riichiTendency: 0.9 },
  },
} as const satisfies Record<string, { label: string; description: string; personality: Personality }>

export type PersonalityId = keyof typeof PERSONALITIES

export function makeProfile(personality: PersonalityId, strength: Strength, name?: string): AiProfile {
  const p = PERSONALITIES[personality]
  return {
    id: `${personality}-${strength}`,
    name: name ?? p.label,
    description: p.description,
    personality: { ...p.personality },
    strength,
  }
}

/** 既定の対戦相手3人（全員中級。強さは設定で変えられる） */
export const DEFAULT_OPPONENTS: [AiProfile, AiProfile, AiProfile] = [
  makeProfile('speed', 2),
  makeProfile('defense', 2),
  makeProfile('value', 2),
]
