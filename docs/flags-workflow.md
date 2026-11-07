# 要検証の判断をエンジンに反映する流れ

対局中・復習中に「⚑ 要検証」の印をつけた判断を Mac に送り、Claude に「要検証を反映して」と頼むと、
再評価・原因の分析・評価エンジンの修正までを行う。

## iPhone（アプリ）

1. 弱点分析の画面の「⚑ 要検証の判断」で **「Mac へ送る（JSON）」** を押す。
2. 共有シートで **「"ファイル"に保存」** → **iCloud Drive の `MahjongAnalyst` フォルダ** を選んで保存する
   （最初の 1 回だけフォルダを作る。2 回目からは前に選んだフォルダが出る）。フォルダを選ばずに iCloud Drive の一番上に保存しても、Mac 側はそこも探す。
3. 毎回、その時点の印を全部入れたファイル（`mahjong-flags-日付-時刻.json`）を保存する。前のファイルは消さなくてよい（Mac では最新だけを読む）。

Mac のブラウザで使っているときは、共有シートの代わりに「ダウンロード」フォルダに保存される。Mac 側はそこも探す。

## Mac（Claude）

「要検証を反映して」と頼むと、プロジェクトの手順（`.claude/skills/apply-flags/SKILL.md`）で次を行う。

1. `npx tsx bench/flags-inbox.ts`：最新のファイルから、**まだ分析していない判断**と、**理由・メモを書き換えた判断**だけを取り出す。
   分析済みの記録は `local-data/flags-ledger.json`。
2. `npx tsx bench/verify-flags.ts local-data/flags-inbox/pending.json 2000`：試行を増やし、乱数を変えて再評価する。
3. 判断ごとに「変わらない」「試行のぶれ」「評価方法の問題」に分け、評価方法の問題だけ局面まで見て原因を調べ、直す。
4. テスト・何切る問題との照合（`local-data/nnkr/`）・処理時間で、直したことの副作用がないか確かめる。
5. 結果を [flags-review.md](flags-review.md) に書き、`npx tsx bench/flags-inbox.ts --mark` で分析済みにする。

直したらエンジンのバージョンが上がるので、アプリでは要検証の判断が「未検証」に戻る。「まとめて再評価」で新しいエンジンの評価になる。

## データの置き場所

`local-data/` は git に入れない（`.gitignore`）。

| 場所 | 中身 |
|---|---|
| `local-data/flags-ledger.json` | 分析済みの判断（印の中身・その時のエンジン・日時） |
| `local-data/flags-inbox/pending.json` | 今回分析する判断 |
| `local-data/nnkr/` | 何切る問題との照合（他サイトの問題データと照合スクリプト、前のエンジンの結果） |

アプリから Mac へ自動では送らない。アプリは GitHub Pages の静的なページでサーバーがなく、GitHub などへ直接送るには
iPhone に認証キーを置く必要があり、対局データも公開の場所に入るため。
