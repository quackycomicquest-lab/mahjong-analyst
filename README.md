# MAHJONG ANALYST

自分で考えて打ち、打牌のあとに AI の答え合わせを受ける、個人用の麻雀トレーニングアプリ（四人打ち・日本式リーチ麻雀、Mac / iPhone 向け PWA）。

基準文書：[docs/SPEC.md](docs/SPEC.md)

## 起動

```bash
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開く。iPhone で試すときは、同じネットワークから `npm run dev -- --host` で表示されたアドレスを開く。

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド（型チェック込み・Service Worker 生成） |
| `npx vite preview` | 本番ビルドの確認（オフライン動作の確認用） |
| `npm test` | テスト一式 |
| `npm run bench` | シャンテン数・牌効率の速度計測 |
| `npm run league -- 40` | AI同士のリーグ戦（打ち筋と強さの比較） |
| `npm run eval-demo` | 打牌評価の例 |
| `npm run eval-timing` | 打牌評価の処理時間 |
| `npm run calibrate` | AI 同士の大量対局で評価の定数を実測（`GAMES=1000` で 8,000 半荘） |
| `npm run validate -- 40` | 評価の予測と実際の結果の比較 |
| `npm run golden:shanten` / `npm run golden:score` | 正解データの再生成（Python `mahjong` を使用、要 uv） |

## 構成

| 場所 | 内容 | 資料 |
|---|---|---|
| `src/engine/rules/` | ① ルールエンジン（牌・シャンテン数・和了判定・点数計算） | [phase0-engine-evaluation.md](docs/phase0-engine-evaluation.md) |
| `src/engine/game/` | 対局進行（配牌〜終局、プレイヤー視点） | [SPEC.md §2-1](docs/SPEC.md) |
| `src/engine/ai/` | ② AIプレイヤー（性格×強さ） | [ai-player.md](docs/ai-player.md) |
| `src/engine/evaluator/` | ③ 判断評価エンジン（打牌・鳴き・和了・カン・九種九牌） | [evaluator.md](docs/evaluator.md) |
| `src/engine/calibration/` | 評価・AI の定数（AI 同士の 8,000 半荘で実測） | [calibration.md](docs/calibration.md) |
| `src/engine/coach/` | ④ 弱点分析・復習問題（判断の分類、5 つの能力値、出題間隔） | [coach.md](docs/coach.md) |
| `src/ui/` `src/workers/` | 対局画面・評価パネル・履歴・評価 Web Worker | 下記 |
| `src/storage/` | 対局と打牌評価の保存（IndexedDB） | [storage-and-pwa.md](docs/storage-and-pwa.md) |

## 素材

- 牌画像：`public/tiles/`（利用規約を確認した配布素材の 66×90 立体版。`m1`〜`m9`・`p1`〜`p9`・`s1`〜`s9`・`z1`〜`z7`（東南西北白發中）、赤5は `m0`・`p0`・`s0`）。原本は `asset/`（git 管理外）

## 対局画面の操作

- **Mac**：牌をクリックで打牌。←→ で牌を選び Enter で打牌、Esc で立直の取り消し／鳴きのスキップ。評価パネルは右側。
- **iPhone**：牌を1回タップで選択、もう一度タップで打牌。評価は下部のパネルをタップして開く（自分の番になると自動で閉じる）。
- 立直・カン・九種九牌は確認してから実行。
- 打牌・ポン・チー・カン・スキップ・ロン・ツモ・九種九牌のどれを選んでも、その直前の局面で選べた全ての行動を比較した評価（100点満点・判断損失・良かった点／改善点）が表示される。立直できる場面では「立直／ダマ」の比較も出る。詳細・専門分析はタブで切り替え。
- 対局終了時に、打牌評価の振り返り（平均点・判断損失の合計・評価の低かった打牌）を表示。
- 対局と評価は自動で保存される。アプリを閉じてもタイトルの「続きから」で再開でき、「対局履歴・振り返り」で過去の判断を局面つきで見直せる。
- 「弱点分析・復習問題」：判断を 8 つの分類に分け、5 つの能力値を直近 10 半荘・30 半荘・累計で表示。70 点未満だった判断は復習問題になり、間隔を空けて再出題される。苦手な分類だけの重点練習もできる。

## オフライン・iPhone

公開URL：**https://quackycomicquest-lab.github.io/mahjong-analyst/**（`main` に push すると GitHub Actions がテスト・ビルドして自動で公開）

iPhone の Safari で開き、共有 →「ホーム画面に追加」で、オフラインでも対局と評価ができるアプリとして使える（PWA）。詳しくは [storage-and-pwa.md](docs/storage-and-pwa.md)。
