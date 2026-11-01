// バニラのエフェクトの日本語名と効果。Mod のエフェクトは載っていないので ID のまま出す。
// 新しめのエフェクト（1.21 以降）は公式の訳名を確かめていないので、意味が伝わる名前にしている。

export type EffectKind = 'good' | 'bad' | 'neutral'

export interface EffectInfo {
  name: string
  desc: string
  kind: EffectKind
}

export const EFFECTS: Record<string, EffectInfo> = {
  'minecraft:speed': { name: '移動速度上昇', desc: '歩く・走る速さが上がる。レベル 1 ごとに 20%', kind: 'good' },
  'minecraft:slowness': { name: '移動速度低下', desc: '歩く・走る速さが下がる。レベル 1 ごとに 15%', kind: 'bad' },
  'minecraft:haste': { name: '採掘速度上昇', desc: 'ブロックを壊す速さと攻撃の速さが上がる', kind: 'good' },
  'minecraft:mining_fatigue': { name: '採掘速度低下', desc: 'ブロックを壊す速さと攻撃の速さが大きく下がる', kind: 'bad' },
  'minecraft:strength': { name: '攻撃力上昇', desc: '近接攻撃のダメージが増える。レベル 1 ごとに +3', kind: 'good' },
  'minecraft:instant_health': { name: '即時回復', desc: 'すぐに体力が回復する（アンデッドには逆にダメージ）', kind: 'good' },
  'minecraft:instant_damage': { name: '即時ダメージ', desc: 'すぐにダメージを受ける（アンデッドには逆に回復）', kind: 'bad' },
  'minecraft:jump_boost': { name: '跳躍力上昇', desc: '高く跳べる。落下ダメージも少し減る', kind: 'good' },
  'minecraft:nausea': { name: '吐き気', desc: '画面がゆがんで揺れる', kind: 'bad' },
  'minecraft:regeneration': { name: '再生能力', desc: '体力が少しずつ回復する', kind: 'good' },
  'minecraft:resistance': { name: '耐性', desc: '受けるダメージが減る。レベル 1 ごとに 20%（レベル 5 で無敵）', kind: 'good' },
  'minecraft:fire_resistance': { name: '火炎耐性', desc: '火・溶岩・マグマブロックのダメージを受けない', kind: 'good' },
  'minecraft:water_breathing': { name: '水中呼吸', desc: '水中で息が減らない', kind: 'good' },
  'minecraft:invisibility': { name: '透明化', desc: '姿が見えなくなる（防具と持ち物は見える）。モブに気づかれにくい', kind: 'good' },
  'minecraft:blindness': { name: '盲目', desc: '視界が暗く狭くなり、走れなくなる', kind: 'bad' },
  'minecraft:night_vision': { name: '暗視', desc: '暗い場所や水中が明るく見える', kind: 'good' },
  'minecraft:hunger': { name: '空腹', desc: '満腹度が早く減る', kind: 'bad' },
  'minecraft:weakness': { name: '弱体化', desc: '近接攻撃のダメージが減る。レベル 1 ごとに -4', kind: 'bad' },
  'minecraft:poison': { name: '毒', desc: '体力が少しずつ減る（体力 1 までで止まる）', kind: 'bad' },
  'minecraft:wither': { name: '衰弱', desc: '体力が少しずつ減り、死ぬこともある', kind: 'bad' },
  'minecraft:health_boost': { name: '体力増強', desc: '最大体力が増える。レベル 1 ごとにハート 2 個', kind: 'good' },
  'minecraft:absorption': { name: '衝撃吸収', desc: 'ダメージを肩代わりする黄色いハートが付く。レベル 1 ごとに 2 個', kind: 'good' },
  'minecraft:saturation': { name: '満腹度回復', desc: '満腹度と隠し満腹度がすぐに回復する', kind: 'good' },
  'minecraft:glowing': { name: '発光', desc: '壁越しでも輪郭が光って見える', kind: 'neutral' },
  'minecraft:levitation': { name: '浮遊', desc: '勝手に上へ浮き上がっていく', kind: 'bad' },
  'minecraft:luck': { name: '幸運', desc: '釣りやチェストの中身で良いものが出やすくなる', kind: 'good' },
  'minecraft:unluck': { name: '不運', desc: '釣りやチェストの中身で良いものが出にくくなる', kind: 'bad' },
  'minecraft:slow_falling': { name: '落下速度低下', desc: 'ゆっくり落ちるようになり、落下ダメージを受けない', kind: 'good' },
  'minecraft:conduit_power': { name: 'コンジットパワー', desc: '水中で息が減らず、明るく見え、採掘も速くなる', kind: 'good' },
  'minecraft:dolphins_grace': { name: 'イルカの好意', desc: '泳ぐ速さが大きく上がる', kind: 'good' },
  'minecraft:bad_omen': { name: '不吉な予感', desc: '村に入ると襲撃（レイド）の予兆が始まる', kind: 'neutral' },
  'minecraft:hero_of_the_village': { name: '村の英雄', desc: '村人との取引が安くなり、贈り物をもらえる', kind: 'good' },
  'minecraft:darkness': { name: '暗闇', desc: '視界が暗くなったり明るくなったりを繰り返す', kind: 'bad' },
  'minecraft:trial_omen': { name: '試練の予感', desc: '試練の間のスポナーが強い「不吉な試練」になる', kind: 'neutral' },
  'minecraft:raid_omen': { name: '襲撃の予感', desc: 'しばらくすると、その場所で襲撃（レイド）が始まる', kind: 'neutral' },
  'minecraft:wind_charged': { name: '風の力（死ぬと突風）', desc: '倒れたときに突風が起きて周りを吹き飛ばす', kind: 'bad' },
  'minecraft:weaving': { name: '糸張り（死ぬとクモの巣）', desc: '倒れたときに周りにクモの巣ができる。クモの巣の中を速く動ける', kind: 'bad' },
  'minecraft:oozing': { name: 'スライム化（死ぬとスライム）', desc: '倒れたときにスライムが 2 匹出てくる', kind: 'bad' },
  'minecraft:infested': { name: '虫まみれ（シルバーフィッシュ）', desc: 'ダメージを受けるとシルバーフィッシュが出てくることがある', kind: 'bad' },
  'minecraft:breath_of_the_nautilus': { name: 'ノーチラスの息', desc: '水中で息ができる。ノーチラスに乗っているあいだ付く', kind: 'good' },
}

export function effectInfo(id: string): EffectInfo | undefined {
  return EFFECTS[id.includes(':') ? id : `minecraft:${id}`]
}

/** 「移動速度上昇」、知らないエフェクトは ID のまま */
export function effectName(id: string): string {
  return effectInfo(id)?.name ?? id.replace(/^minecraft:/, '')
}

export const KIND_LABEL: Record<EffectKind, string> = {
  good: '良い効果',
  bad: '悪い効果',
  neutral: 'どちらでもない',
}
