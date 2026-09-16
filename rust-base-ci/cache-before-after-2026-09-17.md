# rust-base-ci cache 縮小の before/after 実測（#134）

イシュー #134 の受入条件に対応する実測記録。#131（内訳計測）→ #132（`CARGO_INCREMENTAL=0` +
キー `v2`）→ #133（保存前 prune + キー `v3`）の効果を、`Fandhe-AI/fandhe-ai` の
`rust-ci / cargo test` 実 run から計測した。すべて UTC タイムスタンプで記載する。

## 0. `latest` タグの付替え確認

`refs/tags/latest` は `149e031ee4d62b5452540b4a8c4e403173f6686a`（#133 のマージコミット）を
指している。`move-latest-tag.yml` の run
[`35146174849`](https://github.com/Fandhe-AI/actions/actions/runs/35146174849)
（2026-09-16T20:22:34Z、`conclusion: success`）で付け替え済み。

## 1. 計測環境・対象

- 対象: `Fandhe-AI/fandhe-ai` の `.github/workflows/ci.yml`
  （`uses: Fandhe-AI/actions/.github/workflows/rust-base-ci.yml@latest`、`cache: true`、
  `runner-label: ubuntu-latest`、`test-timeout-minutes: 20`）
- `rust-ci / cargo test` ジョブの GitHub Actions 実ログ（`gh run view --job <id> --log`）と
  `gh run view <run> --json jobs` のタイムスタンプ、`gh cache list` の blob サイズを直接採取
- ログ採取コマンド: `gh run view -R Fandhe-AI/fandhe-ai --job <job-id> --log`
  （`gh api .../actions/jobs/<id>/logs` はリダイレクトを追わず空になるため使わない）
- v1（`CARGO_INCREMENTAL` 抑止なし・prune なし）はキー
  `rust-base-ci-Linux-test-49250d9e13f88f2c5ea947301d918eb3249f6452bd082589071020c27f2bc21f`、
  v2（`CARGO_INCREMENTAL=0` のみ）は `...-test-v2-e7fa89ec...`、
  v3（保存前 prune 追加）は `...-test-v3-e7fa89ec...` のキーで区別する

## 2. before/after 表（3 ケース: exact hit / prefix フォールバック / cold）

「test ジョブ合計」は `rust-ci / cargo test` ジョブの `startedAt`〜`completedAt`。
「復元」は `Cache hit` 系ログ〜`Cache restored successfully` の区間。

### 2-1. exact hit（同一 `Cargo.lock` での再実行。非後退判定の主系列）

| バージョン | run / job | blob サイズ | 復元（download + 展開） | コンパイル | test ジョブ合計 |
|---|---|---|---|---|---|
| v1（n=11 中央値） | 2026-09-16 11:07〜13:43 の 11 run（#131、代表 [`35103799823`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35103799823)） | 3165 MB (3318233612 B、固定) | 66.7秒（download 16.5秒 + 展開 49.0秒、n=11 中央値） | 2m31s（代表 run 実測） | **7m41s**（n=11 中央値） |
| v2 | [`35141396593`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35141396593) / job `104946516703`（2026-09-16 19:34） | 3940 MB (4131177220 B) | 3m10s（download 19.2秒 + 展開 2m50.8秒） | 2m45s | 9m04s |
| v3 | **未計測**（§6 参照） | - | - | - | - |

### 2-2. prefix フォールバック（`restore-keys` 経由）

| バージョン | run / job | 復元元 blob | 復元 | コンパイル | test ジョブ合計 |
|---|---|---|---|---|---|
| v1 | 未計測（#131 は exact hit 11 件のみ採取） | - | - | - | - |
| v2 | [`35139303905`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35139303905) / job `104939510927`（2026-09-16 19:14, PR） | v2 の別キー blob（3940 MB） | 2m57s（download 38秒 + 展開 2m19秒） | 2m26s | 9m54s |
| v3 | **未計測**（§6 参照） | - | - | - | - |

### 2-3. cold（`Cache not found`）

| バージョン | run / job | 復元 | コンパイル | 保存 | test ジョブ合計 |
|---|---|---|---|---|---|
| v1 | 未計測（#131 は exact hit 11 件のみ採取） | - | - | - | - |
| v2（PR） | [`35135521345`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35135521345) / job `104926790709`（2026-09-16 18:37） | `Cache not found` | 2m05s | 約63秒 | 7m02s |
| v2（main） | [`35136578966`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35136578966) / job `104930351128`（2026-09-16 18:47） | `Cache not found` | 2m01s | 約62秒 | 7m34s |
| v2（main、10GB 上限 evict 後） | [`35142396152`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35142396152) attempt 1 / job `104949874123`（2026-09-16 19:44） | `Cache not found`（19:23 の PR ref 保存が main の v2 blob を evict） | 2m07s | あり（`v2-e7fa...`、4131166571 B、19:52） | 7m34s |
| v3 | **未計測**（自然発生する `Cargo.lock` 変更 push を待つ。§6 補完手順を参照） | - | - | - | - |

## 3. 非後退判定（同一ケース同士の比較。exact hit を主系列とする）

**保留（未達ではなく、v3 の実測データが未取得のため判定不能）**。

v1 exact hit（test ジョブ合計 7m41s、n=11 中央値）と比較できる v3 exact hit のサンプルを
本ラウンドでは取得できなかった（理由・経緯は §6 参照）。v2 exact hit（9m04s）は v1 より
明確に後退しているが、v2 と v3 は別の変更（incremental 抑止のみ vs 保存前 prune 追加）で
あり、v2 の後退を v3 の結果とみなすことはできない。

非後退の判定には、`latest` タグ付替え（2026-09-16T20:22:34Z）以降に発生する
`Fandhe-AI/fandhe-ai` の自然な `rust-ci / cargo test` run（同一 `Cargo.lock` での再実行 =
exact hit ケース）を採取し、本ドキュメントの §2-1 v3 行を埋める必要がある。

## 4. 設計判断・記述の是正

### 4-1. `CARGO_INCREMENTAL=0`（v2）は blob 縮小に寄与しなかった

v2 実測では **全指標で v1 exact hit より後退している**: blob 3165 MB → 3940 MB、
exact hit の復元 66.7秒 → 3m10s（展開が 49.0秒 → 2m50.8秒）、exact hit の test ジョブ
合計 7m41s → 9m04s。さらに **cold（7m02s）が v1 exact hit（7m41s）より速い**、つまり
この workspace では依存 crate の cold ビルド（約2分）のほうが数 GB の blob 復元より
安価だった。

README・`rust-base-ci.yml` 冒頭コメントにあった「`target/debug/incremental` は
キャッシュ blob を肥大化させる主因の一つ」という記述は、#131 の生 du 値ベースの推定
（約9.6%）に基づくものだったが、**v2 実測ではその効果は確認できなかった**。blob の
縮小は v3 の保存前 prune に依存する。README の該当記述は本イシューで是正する。

v2 blob（3940 MB）が v1 blob（3165 MB）より大きい理由は未確定である。以下は仮説であり、
事実として断定しない:

- v1 blob は `Cargo.lock` の最終変更（2026-09-14 頃）直後の、より小さい workspace 状態で
  保存されたまま、その後の exact hit では更新されていない可能性がある
- `CARGO_INCREMENTAL=0` によって生成される成果物（非 incremental ビルドの中間ファイル）が
  incremental 成果物の除外分を上回って増加した可能性がある

### 4-2. 10 GB 上限による evict

`gh cache list` 時点（2026-09-16 19:5x）の fandhe-ai cache 総量は約10.2 GB
（`target-build-no-cuda-toolkit-*` 4.85 GB、`rust-base-ci-Linux-test-v2-*` 4.13 GB ほか）で
リポジトリの cache 容量上限（10 GB）に張り付いている。PR ref への保存（19:23）が main の
v2 blob を追い出し、19:44 の main run が cold になった。**prefix フォールバックは上限圧力下
では当てにならない**（`v2` blob が evict されていれば `v3` への prefix フォールバックも
同様に機能しない）。

## 5. `rust-ci` 4 ジョブの green 確認

v3 workflow 定義での実行そのものが未取得のため（§6）、v3 版での 4 ジョブ green は
本ラウンドでは確認できていない。参考として、`v2` workflow 定義（rerun で再実行された
[`35142396152`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35142396152) attempt 2）
では `fmt` / `clippy` / `test` / `deny` の 4 ジョブと集約ジョブ
`rust-ci / rust-base-ci-complete` がいずれも `success`（test ジョブ合計 8m15s、
2026-09-16T20:37:10Z〜20:45:25Z）であることを確認した。ただし `fmt` / `deny` は
v2/v3 間でロジック変更が無い一方、`clippy` / `test` は v3 で保存前 prune ステップが
追加されている（#133、`rust-base-ci.yml` 262・468 行目）。**v3 での `clippy` /
`test` green は本ラウンドでは未確認**であり、§6-1 の v3 run 取得時にあわせて確認する
必要がある。

## 6. 未計測項目と補完手順

### 6-1. v3（exact hit / prefix フォールバック / cold）が未計測の経緯

`latest` タグ付替え（2026-09-16T20:22:34Z）以降、`Fandhe-AI/fandhe-ai` の `ci.yml` を
トリガーする自然な push / PR は発生しなかった（`ci.yml` に `workflow_dispatch` は無く、
実装時点で open PR も無い）。計画で規定した手順に従い、10 GB 上限 evict 後の main cold
run（[`35142396152`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35142396152)、
job `104949874123`）を `gh run rerun --job` で再実行し v3 データの取得を試みた。

**結果、この rerun は v3 ではなく v2 のまま再実行された**（実ログで確認、新規判明事項）:

- 復元ログが `Cache hit for restore-key:`（v2 → v3 プレフィックスフォールバック）では
  なく `Cache hit for: rust-base-ci-Linux-test-v2-e7fa89ec...`（v2 キーへの exact hit）
- 完了後の全ステップ一覧（10 件、`Set up job` 〜 `Complete job`）に
  `workspace メンバー成果物を prune` という名前のステップが存在しない（`skipped` ですら
  なく、そもそも定義されていない）
- ログ末尾が `Cache hit occurred on the primary key ...-v2-e7fa89ec..., not saving cache.`
  （v2 の primary key に対する exact hit として扱われており、`v3` キーでの保存は発生していない）
- `gh cache list` に `...-test-v3-...` キーの blob は増えていない

つまり `gh run rerun` は、対象 run が最初にトリガーされた時点で解決された reusable
workflow の参照（`@latest` が指していたコミット）をそのまま再実行し、**`@latest` を
rerun 時点で再解決しない**。この run は元々 2026-09-16T19:44 にトリガーされており、
`latest` タグの付替え（20:22）より前のため、rerun でも v2 のコミットのまま実行された。
これは計画（§3-4「v3 データ欠落時の方針」）が想定していなかった rerun の挙動であり、
GitHub の公式ドキュメントにも明記が無い点として計画時点で留保されていた通りとなった。

この結果、**`gh run rerun` による同一 run の再実行では v3 データを取得できない**ことが
判明した。`gh cache delete` で人為的に cold を作らない方針（OWASP A01 相当・計画§7）は
維持しつつ、v3 データの取得には以下のいずれかが必要:

1. `Fandhe-AI/fandhe-ai` に対する新規の push または PR（`Cargo.lock` 変更が無くても
   `ci.yml` の `pull_request` / `push` トリガーを満たす変更であれば良い）が発生し、
   その run のログから §2-1〜2-3 の v3 行を採取する
2. 採取コマンド: `gh run list -R Fandhe-AI/fandhe-ai --workflow ci.yml --created ">2026-09-16T20:22:34Z"`
   で対象 run を特定し、`gh run view --job <job-id> --log` から
   `Cache hit for restore-key:` / `Cache hit for:`（exact hit の場合）/
   `Cache not found`・`prune 完了: N エントリ`・`Cache saved with key: ...-v3-...` を抽出する
3. `gh cache list -R Fandhe-AI/fandhe-ai` で `...-test-v3-...` キーの blob サイズを確認する
4. 得られた値で本ドキュメント §2-1〜2-3 の v3 行・§3 の判定・§5 を更新する

**サンプルの順序に注意**: `v3` キーの blob は `latest` 付替え後まだ一度も保存されていない
ため、**最初に発生する自然 run は exact hit にはならず、`v2` からの prefix フォールバック
になる**（`v3` primary key が無い → `restore-keys` で `v2` blob を復元 → prune →
`v3` として保存）。§3 の非後退判定（同一ケース = exact hit 同士の比較）に使えるのは、
同一 `Cargo.lock` で発生する**2 回目以降**の run である。main ref への保存が必要な点
（PR ref への保存は main から不可視、§4-2）と、10 GB 上限により 1 回目で保存した
`v3` blob が 2 回目までに evict される可能性がある点（§4-2）にも留意する。また、
`clippy` / `test` の v3 コンパイル時間は prune によりメンバー crate の再ビルドが
毎回発生するため設計上 v1 の 2m31s 以上になりうる。非後退の判定は compile 単体ではなく
**test ジョブ合計**で行うこと。

- **v1 の cold・prefix フォールバック**: #131 は exact hit 11 件のみを採取しており、
  v1 側の cold・フォールバックのサンプルは存在しない。該当セルは「未計測」のままとし、
  v2 の数値を代用しない
- **v2 blob 増大の仮説検証**: `rust-base-ci-Linux-test-49250d9e...`（v1 キー）を保存した
  run のログ検索により Cargo.lock 変更 push 時点の blob 生成経緯を確認できれば、§4-1 の
  仮説のどちらが妥当か判定できる。本ラウンドでは未実施（次回計測で補完）

## 参考

- 内訳計測（#131）: [`rust-base-ci/cache-breakdown-2026-09-17.md`](./cache-breakdown-2026-09-17.md)
- `CARGO_INCREMENTAL=0` + キー `v2`: #132
- 保存前 prune + キー `v3`: #133
