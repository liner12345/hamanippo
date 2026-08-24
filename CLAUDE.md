@AGENTS.md

<!-- 先頭行の @AGENTS.md は Claude Code のインポート構文。消さない。
     AGENTS.md がこのプロジェクトの SSoT。このファイルには AGENTS.md に無い、
     Claude Code が作業するときに必要な差分だけを書く（差分ドキュメント方式）。 -->

# CLAUDE.md — Claude Code 向け補足

AGENTS.md の指示にすべて従う。ここに書くのは AGENTS.md に無い事項だけ。

## 優先順位（記述が食い違ったとき）

コードの実挙動 ＞ AGENTS.md ＞ README.md ＞ このファイル。
食い違いを見つけたら黙って片方に合わせず、「ファイル:行」を添えて報告する。

## 作業の進め方

- 着手前に「変更するファイル・関数」「データ構造への影響（`migrate()` が要るか）」「README / AGENTS.md の更新要否」「`sw.js` の `CACHE` 更新要否」を箇条書きで示し、承認を待つ。`freshDB()` / `migrate()` に触る変更は plan mode で進める。
- 依頼された範囲の外を触らない。整形・リネーム・リファクタ・コメント追加を抱き合わせない。
- 完了報告は「変えた点」「確認した点（コマンドと結果）」「実機でしか確認できない点」の3項目。確認していないことを確認済みと書かない。推測は「推測」と明記する。
- 報告・コミットメッセージ・ドキュメントは日本語。識別子・コードは英語。
- `git commit` / `git push` は指示があるまでしない。コミットメッセージは提案として示す。

## 確認コマンド（ビルド・テスト基盤は無い）

- 構文: `node --check app.js && node --check sw.js`
- ローカル起動: `python -m http.server 8000`（Windows は `py -m http.server 8000`）→ `http://localhost:8000/`
  - `file://` で直接開くと localStorage が使えない環境があり、その場合は memoryOnly（保存されない）で動く。保存まわりの確認は http で行う。
  - Service Worker は `location.protocol === 'https:'` のときだけ登録される（`app.js` 末尾）。SW・オフライン・キャッシュ更新の確認は GitHub Pages 上でしかできない。ローカルで「SW を確認した」とは書かない。
- 自動テストは無い。AGENTS.md §4-10 の手順が受け入れ基準。Claude Code からは iOS 実機を操作できないので、タップ領域・safe-area・タブバー下の隙間などは「要実機確認」として明示する。

## app.js の書き方（既存に合わせる）

- 全体が `'use strict'` の IIFE。新しい関数もその中に置く。グローバルを増やさない。
- 構文は `var` / `function` 式で統一されている（`const` / `let` / アロー関数 / テンプレートリテラル / `class` / ES modules は使っていない）。`sw.js` は既存どおり ES2015 でよい。1ファイルの中で混ぜない。
- 12 のセクション（`/* ═══ N. 見出し ═══ */`）に分かれている。新しいコードは該当セクションに足す。
- 画面は文字列連結 + `innerHTML`。利用者由来の文字列（配送先名・メモ・住所・ページ名・コース名・カテゴリ名）は本文でも属性値でも必ず `esc()` を通す。
- 動的に描画したボタンのクリックは、§11 冒頭の document 委譲ハンドラ（`closest('[data-tab],[data-menu],…')`）で受ける。新しい `data-xxx` を足すときは (1) セレクタ一覧への追加 (2) 分岐の追加 の2箇所が必要。片方だけだと反応しない（過去にクリアボタンで発生）。静的な要素は `$('#id').addEventListener` で直接。
- `data-page="0"` のように 0 や空文字を取り得る値は `!= null` / `hasAttribute()` で判定する。真偽値判定だと落ちる。
- DB を変えたら `save()` → 再描画（`renderToday()` / `render()`）の順。
- 破壊的操作は `confirm()`、結果通知は `toast()`。取り消し可能にするときは `undoSnapshot` + `toast(msg, '取り消す', undoApply)` の既存パターン。
- シートは `openSheet(id, backTo)` / `closeSheet()`。同時に開くのは1枚。`index.html` の `.sheet` 構造（grip / head / body / foot）を踏襲する。
- `report(k)` は get-or-create。`DB.reports[k]` が存在しても「記録がある」とは限らない（履歴タブは stops が空のページを出さない）。

## データの不変条件（壊すと利用者のデータが消える）

- localStorage のキー `nippou.v1` は変えない。データは必ずこの1キーの中に置く。別キーを増やすとバックアップに含まれない。
- バックアップ JSON は `DB` そのもの。読み込み時は `obj.destinations` の有無で判定してから `migrate()` に通す。
- スキーマを変えるときは `freshDB().v` を上げ、`migrate()` に `if (db.v < N)` ブロックを足す（現在 v6）。
- ID 接頭辞: `d-` 配送先 / `c-` カテゴリ（既定は固定 `c-base`）/ `k-` コース / `g-` ページ / `s-` 行。
- 配送先は削除しない。`archived: true` で隠す。過去の日報が ID で参照している。
- `stops[].from` は「引き取った行の ID」であって配送先 ID ではない。
- `destinations[].uses` はピッカーの「よく使う」（上位5件）の根拠。
- 1日のページは最大 12（`addPage()` / `duplicatePage()`）。
- ページを複製するときは `stops[].id` を振り直し、`from` を複製先の新しい ID に張り替える（`duplicatePage()`）。張り替えを忘れると転送が別ページの行を指す。
- 全ページが空で名前も無い日付は、起動時に `migrate()` が捨てる。行かページ名があるものは残る。

## CSS

- 色・寸法は `:root` の CSS 変数（`--hi` `--tap` `--safe` `--r` `--transfer` `--danger` など）を使う。ダークモードは変数の差し替えで実現しているので、色を直書きしない。
- 新しいタップ要素は `min-height:var(--tap)`（52px）か、最低でも 44px。
- `hidden` 属性は、その要素に `display:` を指定していると効かない。`hidden` で出し入れする要素には `.xxx[hidden]{display:none}` を必ず併記する（既存の `.sheet[hidden]` などと同じ）。

## リリース

- `index.html` / `styles.css` / `app.js` を変えたら `sw.js` の `CACHE`（現在 `nippou-v24`）を +1。静的ファイルを新しく足したら `SHELL` にも追加する。
- 利用者に見える挙動や出力形式を変えたら、README.md の該当節（§3 使い方 / §4 設定）を同じ変更に含める。新しい不変条件が生まれたら AGENTS.md §4 に追記する。
- コミットメッセージは `feat: …` / `fix: …` + 日本語の要約1行（既存ログに合わせる）。main への push がそのままデプロイ。

## やらないこと

- package.json / npm / bundler / TypeScript / フレームワーク / テストランナーの導入
- `<script type="module">` 化（`file://` で CORS に引っかかる）
- 外部 CDN の読み込み（オフラインで壊れる）
- `nippou.v1` 以外のストレージ、Cookie、外部送信