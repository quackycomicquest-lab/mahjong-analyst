"""
点数計算のゴールデンデータ生成（仕様 §10：点数計算の正確性）

Python `mahjong`（MIT, 天鳳の和了牌譜で検証済み）を正解として、
ランダムに組み立てた和了形の 翻・符・役・支払い を JSON に書き出す。

ルール設定は TypeScript 側の STANDARD_RULES と揃える:
  喰いタンあり / 赤ドラあり / ダブル役満あり / 数え役満あり / 切り上げ満貫なし

実行: npm run golden:score
"""

import json
import random
import sys

from mahjong.hand_calculating.hand import HandCalculator
from mahjong.hand_calculating.hand_config import HandConfig, OptionalRules
from mahjong.meld import Meld

SEED = 20261105
N_CASES = 10000
rng = random.Random(SEED)
calc = HandCalculator()
OPTIONS = OptionalRules(
    has_open_tanyao=True,
    has_aka_dora=True,
    has_double_yakuman=True,
    kazoe_limit=HandConfig.KAZOE_LIMITED,
    kiriage=False,
    fu_for_open_pinfu=True,
    fu_for_pinfu_tsumo=False,
)

YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]


class Pool:
    """136枚から個体IDを払い出す（赤5は copy0 = id 16/52/88）"""

    def __init__(self):
        self.free = {k: [k * 4 + c for c in range(4)] for k in range(34)}
        for k in self.free:
            rng.shuffle(self.free[k])

    def available(self, k):
        return len(self.free[k])

    def take(self, k):
        return self.free[k].pop()


def pick_kind(style):
    if style == "honitsu":
        return rng.choice(list(range(style_suit * 9, style_suit * 9 + 9)) + list(range(27, 34)))
    if style == "chinitsu":
        return style_suit * 9 + rng.randrange(9)
    if style == "tanyao":
        return rng.randrange(3) * 9 + 1 + rng.randrange(7)
    if style == "yaochu":
        return rng.choice(YAOCHU)
    if style == "honors":
        return 27 + rng.randrange(7)
    if style == "green":
        return rng.choice([19, 20, 21, 23, 25, 32])
    return rng.randrange(34)


style_suit = 0


def template_blocks():
    """出にくい役の形を狙って作るための固定面子（残りはランダム）"""
    s = rng.randrange(3) * 9
    r = rng.randrange(7)
    t = rng.choice(["ittsu", "sanshoku", "doukou", "pinfu", "junchan", "ryanpeikou", "green", "chinroutou", "kans"])
    if t == "ittsu":
        return [("seq", s), ("seq", s + 3), ("seq", s + 6)], None, "any"
    if t == "sanshoku":
        return [("seq", r), ("seq", r + 9), ("seq", r + 18)], None, "any"
    if t == "doukou":
        r9 = rng.randrange(9)
        return [("tri", r9), ("tri", r9 + 9), ("tri", r9 + 18)], None, "any"
    if t == "pinfu":
        return [("seq", rng.randrange(3) * 9 + rng.randrange(7)) for _ in range(4)], rng.randrange(27), "any"
    if t == "junchan":
        return [("seq", s + rng.choice([0, 6])), ("seq", rng.randrange(3) * 9 + 6)], rng.choice([0, 8, 9, 17, 18, 26]), "yaochu"
    if t == "ryanpeikou":
        a, b = s + r, rng.randrange(3) * 9 + rng.randrange(7)
        return [("seq", a), ("seq", a), ("seq", b), ("seq", b)], None, "any"
    if t == "green":
        return [("seq", 19), rng.choice([("tri", 23), ("tri", 25), ("tri", 32), ("seq", 19)])], rng.choice([20, 21, 25, 32]), "green"
    if t == "chinroutou":
        return [("tri", k) for k in rng.sample([0, 8, 9, 17, 18, 26], 4)], None, "any"
    return [("tri", rng.randrange(34)) for _ in range(3)], None, "kans"


def build_regular(pool, style, fixed=(), fixed_pair=None):
    """雀頭＋4面子を作る。失敗したら None。"""
    blocks = []
    for kind_type, k in fixed:
        ks = [k, k + 1, k + 2] if kind_type == "seq" else [k, k, k]
        if any(pool.available(x) < ks.count(x) for x in set(ks)):
            return None
        blocks.append((kind_type, k, [pool.take(x) for x in ks]))
    pair = None
    if fixed_pair is not None:
        if pool.available(fixed_pair) < 2:
            return None
        pair = [pool.take(fixed_pair), pool.take(fixed_pair)]
    for _ in range(40):
        if len(blocks) == 4:
            break
        k = pick_kind(style)
        seq = k < 27 and rng.random() < (0.35 if style in ("honors", "yaochu") else 0.6)
        if seq:
            start = k - (k % 9) + min(k % 9, 6)
            if style == "yaochu":
                start = k - (k % 9) + rng.choice([0, 6])
            if style == "green":
                start = 19
            ks = [start, start + 1, start + 2]
            if all(pool.available(x) >= 1 for x in ks):
                blocks.append(("seq", start, [pool.take(x) for x in ks]))
        else:
            if pool.available(k) >= 3:
                blocks.append(("tri", k, [pool.take(k) for _ in range(3)]))
    if len(blocks) < 4:
        return None
    if pair is not None:
        return blocks, pair
    for _ in range(40):
        k = pick_kind(style)
        if pool.available(k) >= 2:
            return blocks, [pool.take(k), pool.take(k)]
    return None


def make_case():
    global style_suit
    style_suit = rng.randrange(3)
    pool = Pool()
    r = rng.random()
    melds = []
    if r < 0.08:
        # 七対子
        kinds = rng.sample(range(34), 7)
        concealed = [pool.take(k) for k in kinds for _ in range(2)]
    elif r < 0.10:
        # 国士無双
        extra = rng.choice(YAOCHU)
        concealed = [pool.take(k) for k in YAOCHU] + [pool.take(extra)]
    elif r < 0.12:
        # 九蓮宝燈
        s = rng.randrange(3) * 9
        extra = s + rng.randrange(9)
        kinds = [s] * 3 + [s + i for i in range(1, 8)] + [s + 8] * 3 + [extra]
        concealed = [pool.take(k) for k in kinds]
    else:
        fixed, fixed_pair, style = ((), None, None)
        if rng.random() < 0.35:
            fixed, fixed_pair, style = template_blocks()
        if style in (None, "kans"):
            style_name = rng.choice(["any", "any", "any", "tanyao", "honitsu", "chinitsu", "yaochu", "honors"])
        else:
            style_name = style
        built = build_regular(pool, style_name, fixed, fixed_pair)
        if built is None:
            return None
        blocks, pair = built
        n_melds = rng.choices([0, 1, 2, 3, 4], weights=[45, 22, 16, 10, 7])[0]
        if style == "kans":
            n_melds = max(n_melds, 3)
            blocks = [b for b in blocks if b[0] == "tri"] + [b for b in blocks if b[0] != "tri"]
        concealed = list(pair)
        for i, (kind_type, k, ids) in enumerate(blocks):
            if i < n_melds:
                if kind_type == "seq":
                    melds.append({"type": "chi", "ids": ids})
                else:
                    weights = [10, 30, 30, 30] if style == "kans" else [70, 10, 10, 10]
                    t = rng.choices(["pon", "minkan", "kakan", "ankan"], weights=weights)[0]
                    if t != "pon":
                        if pool.available(k) == 0:
                            t = "pon"
                        else:
                            ids = ids + [pool.take(k)]
                    melds.append({"type": t, "ids": ids})
            else:
                concealed += ids

    win_tile = rng.choice(concealed)
    menzen = all(m["type"] == "ankan" for m in melds)
    has_kan = any(m["type"] in ("minkan", "kakan", "ankan") for m in melds)
    is_tsumo = rng.random() < 0.5
    riichi = "none"
    if menzen and rng.random() < 0.5:
        riichi = "double" if rng.random() < 0.1 else "riichi"
    seat = 27 + rng.randrange(4)
    rnd = 27 + rng.choice([0, 0, 1, 1, 2, 3])
    flags = {
        "isIppatsu": riichi != "none" and rng.random() < 0.2,
        "isHaitei": False,
        "isHoutei": False,
        "isRinshan": False,
        "isChankan": False,
        "isTenhou": False,
        "isChiihou": False,
    }
    if is_tsumo:
        if has_kan and rng.random() < 0.3:
            flags["isRinshan"] = True
        elif rng.random() < 0.05:
            flags["isHaitei"] = True
        if not melds and rng.random() < 0.02:
            if seat == 27:
                flags["isTenhou"] = True
            else:
                flags["isChiihou"] = True
    else:
        if rng.random() < 0.05:
            flags["isHoutei"] = True
        elif rng.random() < 0.03:
            flags["isChankan"] = True

    dora = [rng.randrange(34) for _ in range(rng.choice([1, 1, 1, 2, 3]))]
    ura = [rng.randrange(34) for _ in dora] if riichi != "none" else []
    honba = rng.choice([0, 0, 0, 1, 2, 5])
    kyoutaku = rng.choice([0, 0, 1, 2])

    py_melds = []
    for m in melds:
        if m["type"] == "chi":
            py_melds.append(Meld(Meld.CHI, sorted(m["ids"]), True))
        elif m["type"] == "pon":
            py_melds.append(Meld(Meld.PON, sorted(m["ids"]), True))
        elif m["type"] == "minkan":
            py_melds.append(Meld(Meld.KAN, sorted(m["ids"]), True))
        elif m["type"] == "kakan":
            py_melds.append(Meld(Meld.SHOUMINKAN, sorted(m["ids"]), True))
        else:
            py_melds.append(Meld(Meld.KAN, sorted(m["ids"]), False))

    all_tiles = concealed + [t for m in melds for t in m["ids"]]
    config = HandConfig(
        is_tsumo=is_tsumo,
        is_riichi=riichi == "riichi",
        is_daburu_riichi=riichi == "double",
        player_wind=seat,
        round_wind=rnd,
        tsumi_number=honba,
        kyoutaku_number=kyoutaku,
        options=OPTIONS,
        is_ippatsu=flags["isIppatsu"],
        is_haitei=flags["isHaitei"],
        is_houtei=flags["isHoutei"],
        is_rinshan=flags["isRinshan"],
        is_chankan=flags["isChankan"],
        is_tenhou=flags["isTenhou"],
        is_chiihou=flags["isChiihou"],
    )
    res = calc.estimate_hand_value(
        all_tiles,
        win_tile,
        melds=py_melds,
        dora_indicators=[k * 4 for k in dora],
        ura_dora_indicators=[k * 4 for k in ura],
        config=config,
    )
    expected = {"error": res.error}
    if not res.error:
        expected.update(
            {
                "han": res.han,
                "fu": res.fu,
                "yaku": sorted(y.name for y in res.yaku),
                "cost": {
                    "main": res.cost["main"],
                    "additional": res.cost["additional"],
                    "mainBonus": res.cost["main_bonus"],
                    "additionalBonus": res.cost["additional_bonus"],
                    "kyoutakuBonus": res.cost["kyoutaku_bonus"],
                    "total": res.cost["total"],
                },
            }
        )
    return {
        "input": {
            "hand": concealed,
            "winTile": win_tile,
            "melds": melds,
            "isTsumo": is_tsumo,
            "riichi": riichi,
            **flags,
            "seatWind": seat,
            "roundWind": rnd,
            "doraIndicators": dora,
            "uraDoraIndicators": ura,
            "honba": honba,
            "kyoutaku": kyoutaku,
        },
        "expected": expected,
    }


def main(out_path):
    cases = []
    while len(cases) < N_CASES:
        c = make_case()
        if c is not None:
            cases.append(c)
    with open(out_path, "w") as f:
        json.dump({"seed": SEED, "source": "python mahjong (MIT)", "cases": cases}, f, separators=(",", ":"))
    errors = sum(1 for c in cases if c["expected"]["error"])
    print(f"wrote {len(cases)} cases ({errors} with error) to {out_path}")


if __name__ == "__main__":
    main(sys.argv[1])
