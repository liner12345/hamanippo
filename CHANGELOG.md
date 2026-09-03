# 変更履歴

このリポジトリの変更を [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) 形式で記録する。
記録の単位はコミットではなく作業セッション。見出しは `Added` / `Changed` / `Fixed` / `Removed`。

`index.html` / `styles.css` / `app.js` を変えたら `sw.js` の `CACHE` を上げること（AGENTS.md §4-9）。
その版数もここに書く。

## [Unreleased]

### Fixed

- 記録の無い日に、案内文「この日はまだ記録がありません」が画面の上半分に貼り付き、
  その下に大きな空白ができていた。実測で **270px**（案内の下端 438px / 操作バーの上端 708px、
  iPhone 相当の 390×844）。同じ空白が配送先（430px）・コース（470px）・履歴（554px）にもあった。
  `main` を縦フレックスにして表示中の `.tab` に余りを渡し、空状態の案内をその中央へ置く。
  中身があるときは器に一切触らないので、行の並びは変わらない。
  - `styles.css`: `main` に `display:flex;flex-direction:column`、`.tab` に `flex:1`。
    `#route-empty` と `.is-empty` が付いた器を `flex:1` で中央寄せに。
    `#route-empty` に `display` を指定したので `[hidden]` を効かせ直す指定も足した
  - `app.js`: `markEmpty()` を追加。`innerHTML` を入れ替えたあとに呼び、中身が
    `.empty` 1つだけなら器に `is-empty` を付ける。配送先・コース・履歴の
    5箇所の描画すべてに入れてあるので、中身ができれば自動で外れる
  - `sw.js`: `CACHE` を `nippou-v25` → `nippou-v26`

### Added

- 本ファイル（`CHANGELOG.md`）。ハブリポジトリ `ok-report` の `CLAUDE.md` §0.2 が
  「`apps/hamanippo` には CHANGELOG が無い。同リポジトリを改修するときに新設を提案する」
  としていたため、この改修に合わせて新設した。
