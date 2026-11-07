---
name: apply-flags
description: アプリで「要検証」の印をつけた判断を Mac で受け取り、再評価して原因を分析し、評価エンジンに反映する。「要検証を反映して」「要検証を見て」と頼まれたときに使う。
---

# 要検証の判断を分析して評価エンジンに反映する

手順の背景と前回の結果は docs/flags-workflow.md と docs/flags-review.md。要検証の JSON とその中身は利用者の対局データなので、
local-data/ の外（リポジトリ・ドキュメント）に局面の生データを置かない。

## 1. 受け取る

```bash
npx tsx bench/flags-inbox.ts
```

- iCloud Drive の MahjongAnalyst フォルダ・iCloud Drive の一番上・~/Downloads にある最新の `mahjong-flags-*.json` を読み、
  分析済み（local-data/flags-ledger.json）でない判断と、理由・メモを書き換えた判断だけを local-data/flags-inbox/pending.json にまとめる。
- ファイルが無い・新しい判断が 0 件なら、利用者にそう伝えて終わる（アプリの「Mac へ送る」→「"ファイル"に保存」→ iCloud Drive の MahjongAnalyst）。

## 2. 再評価する

```bash
npx tsx bench/verify-flags.ts local-data/flags-inbox/pending.json 2000
```

時間がかかるので run_in_background で動かす。元の評価（多くは iPhone の軽量評価）と、試行を増やした再評価（乱数 3 通り）を比べる。

## 3. 分ける

判断ごとに次のどれかに分ける。利用者の理由・メモ（「最善手が疑問」など）は必ず読む。

- **変わらない**：元の点数と再評価がほぼ同じ（±10点程度）で最善手も同じ。そのまま。
- **試行のぶれ**：再評価の 3 回がそろっていて、元の点数だけ離れている。エンジンの直しは不要（件数が多ければ、試行の配分を見直す）。
- **評価方法の問題の疑い**：再評価しても、麻雀として不自然な最善手・点数になっている。または利用者の疑問に理由がある。
  局面（手牌・4人の河・副露・ドラ・点数・残り枚数）まで見る。見方：/private の scratchpad に dump 用のスクリプトを書くか、verify-flags の候補一覧を読む。

## 4. 原因を調べて直す（評価方法の問題だけ）

- 原因は src/engine/evaluator/simulate.ts（シミュレーション内の打ち方）、evaluate.ts（候補・評価点）、ai/danger.ts（危険度）、
  calibration（定数）のどこかにあることが多い。直す前に、同じ局面で原因を確かめる（例：候補ごとの和了率・放銃率・向聴数の差）。
- 直すべきかの判断基準：麻雀の定石・数字（和了率・放銃率・打点）で説明できる誤りだけ直す。評価の通りと判断したものは「直さなかったもの」に理由を書く。
- 直したら：
  - src/engine/evaluator/types.ts の EVALUATOR_VERSION を上げる（アプリの要検証が「未検証」に戻り、まとめて再評価できる）
  - 直した内容のテストを evaluator.test.ts（危険度なら ai/ai.test.ts）に足す。テストの局面は自作する（利用者の局面をそのまま入れない）
  - `npx vitest run`・`npx oxlint src bench`・`npm run build`
  - 何切る問題との照合（データがあれば）：`npx tsx local-data/nnkr/compare.mts 1000 1` と `... 1000 7`。
    local-data/nnkr/baseline-*.json（前のエンジンの結果）と比べ、多数派との一致・70点未満の数が悪くなっていないか見る。
    悪くなった問題は原因を調べる（直したことの副作用なら直し方を変える）。良ければ result-*.json を baseline-*.json に置き換える
  - `npx tsx bench/strategy-check.ts 1000`（定石との照合）で、11 件が合格のままか確かめる
  - `npm run eval-timing` で処理時間を確かめる
- pending.json をもう一度 verify-flags で評価し、直した判断の点数が妥当になったか確かめる。

## 5. 記録する

- docs/flags-review.md に「見つかった問題と修正」「直さなかったもの」「結果」を足す（日付・件数・エンジンのバージョン）。docs/evaluator.md の版の説明も更新。
- `npx tsx bench/flags-inbox.ts --mark` で、今回の判断を分析済みにする。
- 利用者に、分けた結果（変わらない・ぶれ・直したもの・直さなかったもの）と、アプリで「まとめて再評価」すれば新しいエンジンの評価になることを伝える。
  コミット・公開は利用者に頼まれてから。
