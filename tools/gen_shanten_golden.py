"""
シャンテン数のゴールデンデータ生成（仕様 §10：ロジックの正確性）

MIT ライセンスの Python `mahjong` ライブラリ（天鳳牌譜で検証済み）を正解として、
ランダム手牌のシャンテン数を JSON に書き出す。TypeScript 実装はこの JSON と照合する。

実行: npm run golden:shanten
"""

import json
import random
import sys

from mahjong.shanten import Shanten

SEED = 20261105
rng = random.Random(SEED)
sh = Shanten()


def wall():
    return [k for k in range(34) for _ in range(4)]


def random_hand(n):
    return rng.sample(wall(), n)


def near_complete_hand(n_mentsu, n_tiles, mutations):
    """面子と雀頭で和了形を組み、いくつか入れ替えて聴牌〜二向聴付近の手を作る"""
    counts = [0] * 34
    hand = []

    def can_add(ks):
        tmp = counts[:]
        for k in ks:
            tmp[k] += 1
            if tmp[k] > 4:
                return False
        return True

    def add(ks):
        for k in ks:
            counts[k] += 1
            hand.append(k)

    while True:
        pair = rng.randrange(34)
        if can_add([pair, pair]):
            add([pair, pair])
            break
    while len(hand) < n_mentsu * 3 + 2:
        if rng.random() < 0.7:
            suit = rng.randrange(3)
            start = suit * 9 + rng.randrange(7)
            ks = [start, start + 1, start + 2]
        else:
            k = rng.randrange(34)
            ks = [k, k, k]
        if can_add(ks):
            add(ks)

    for _ in range(mutations):
        i = rng.randrange(len(hand))
        counts[hand[i]] -= 1
        while True:
            k = rng.randrange(34)
            if counts[k] < 4:
                break
        counts[k] += 1
        hand[i] = k

    rng.shuffle(hand)
    return hand[:n_tiles]


def to34(hand):
    c = [0] * 34
    for k in hand:
        c[k] += 1
    return c


def record(hand, melds):
    c = to34(hand)
    regular = sh.calculate_shanten_for_regular_hand(c)
    if melds == 0:
        chiitoi = sh.calculate_shanten_for_chiitoitsu_hand(c)
        kokushi = sh.calculate_shanten_for_kokushi_hand(c)
        total = sh.calculate_shanten(c)
    else:
        chiitoi = kokushi = None
        total = regular
    return {
        "counts": c,
        "melds": melds,
        "shanten": total,
        "regular": regular,
        "chiitoitsu": chiitoi,
        "kokushi": kokushi,
    }


def main(out_path):
    cases = []
    # 門前のランダム手（13枚・14枚）
    for n in (13, 14):
        for _ in range(1500):
            cases.append(record(random_hand(n), 0))
    # 和了形の近傍（聴牌・一向聴が多くなる）
    for n in (13, 14):
        for m in range(4):
            for _ in range(500):
                cases.append(record(near_complete_hand(4, n, m), 0))
    # 副露あり（手牌側だけを渡す）
    for melds in (1, 2, 3):
        base = (4 - melds) * 3
        for n in (base + 1, base + 2):
            for m in range(3):
                for _ in range(200):
                    cases.append(record(near_complete_hand(4 - melds, n, m), melds))
            for _ in range(200):
                cases.append(record(random_hand(n), melds))
    with open(out_path, "w") as f:
        json.dump({"seed": SEED, "source": "python mahjong (MIT)", "cases": cases}, f, separators=(",", ":"))
    print(f"wrote {len(cases)} cases to {out_path}")


if __name__ == "__main__":
    main(sys.argv[1])
