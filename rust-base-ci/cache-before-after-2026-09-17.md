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
| v3 | [`35170879552`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35170879552) / job `105042072798`（2026-09-17 01:31、PR #1990 2 回目 push。§6-2） | 100 MB (104356387 B) | 4秒（`Cache hit for: ...-test-v3-e7fa89ec...`、01:31:29〜01:31:32） | 4m31s | **4m58s** |

### 2-2. prefix フォールバック（`restore-keys` 経由）

| バージョン | run / job | 復元元 blob | 復元 | コンパイル | test ジョブ合計 |
|---|---|---|---|---|---|
| v1 | 未計測（#131 は exact hit 11 件のみ採取） | - | - | - | - |
| v2 | [`35139303905`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35139303905) / job `104939510927`（2026-09-16 19:14, PR） | v2 の別キー blob（3940 MB） | 2m57s（download 38秒 + 展開 2m19秒） | 2m26s | 9m54s |
| v3（`v2` → `v3` 保存） | [`35170065578`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35170065578) / job `105039623501`（2026-09-17 01:19、PR #1990 1 回目 push。§6-2） | v2 blob（3940 MB、`Cache hit for restore-key: ...-test-v2-e7fa89ec...`） | 1m45s（`Restore cargo cache` ステップ。download 約31秒 + 展開 約1m13秒） | 5m41s | 7m56s（prune 16秒〈1432 エントリ削除〉・保存 6秒〈`Sent 104356387 of 104356387`〉を含む） |

### 2-3. cold（`Cache not found`）

| バージョン | run / job | 復元 | コンパイル | 保存 | test ジョブ合計 |
|---|---|---|---|---|---|
| v1 | 未計測（#131 は exact hit 11 件のみ採取） | - | - | - | - |
| v2（PR） | [`35135521345`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35135521345) / job `104926790709`（2026-09-16 18:37） | `Cache not found` | 2m05s | 約63秒 | 7m02s |
| v2（main） | [`35136578966`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35136578966) / job `104930351128`（2026-09-16 18:47） | `Cache not found` | 2m01s | 約62秒 | 7m34s |
| v2（main、10GB 上限 evict 後） | [`35142396152`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35142396152) attempt 1 / job `104949874123`（2026-09-16 19:44） | `Cache not found`（19:23 の PR ref 保存が main の v2 blob を evict） | 2m07s | あり（`v2-e7fa...`、4131166571 B、19:52） | 7m34s |
| v3 | 未計測（`Cargo.lock` 変更 push が未発生。§6-2 の 2 run はいずれも `Cache not found` にならず、1 回目は v2 からの prefix フォールバック〈§2-2〉だった） | - | - | - | - |

## 3. 非後退判定（同一ケース同士の比較。exact hit を主系列とする）

**非後退・短縮を確認（2026-09-17 追記）**。v1 exact hit（test ジョブ合計 7m41s、n=11 中央値）に対し v3 exact hit（§2-1、run `35170879552`）は **4m58s**（−2m43s、約 35% 短縮）。blob は 3165 MB → 100 MB、復元は 66.7秒 → 4秒。内訳を同じ計測区間（ジョブのステップ時間。`gh api repos/Fandhe-AI/fandhe-ai/actions/jobs/<id>` の `steps[]`）で比較すると、v1 代表 run [`35103799823`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35103799823) / job `104819663547` は `Restore cargo cache` 1m10s・`cargo test --workspace --all-features` 6m22s、v3 exact hit は同 4秒・4m31s（＋prune 12秒）であり、復元・`cargo test` ステップの両方が短縮している。§2-1 v1 行の「コンパイル 2m31s」は `cache-breakdown-2026-09-17.md` §4 のコンパイルのみの値でステップ全体（テスト実行込み）ではないため、v3 の 4m31s と直接比較しない。`cargo test` ステップ短縮の原因（prune 後の deps 再解決・incremental 抑止の影響等）は本ドキュメントでは推定せず観測のみを記録する（判定は計画どおり test ジョブ合計で行う）。v3 の exact hit サンプルは 1 件（n=1）であり、v1 の n=11 中央値との比較である点に留意する。以下は本ラウンド（2026-09-17 00:xx 時点）の記述をそのまま残す。

（当初記述）**保留（未達ではなく、v3 の実測データが未取得のため判定不能）**。

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

**2026-09-17 追記**: v3 workflow 定義で実行された PR #1990 の 2 run（§6-2）で、`fmt`（0m17s／0m13s）・`clippy`（0m59s／0m52s）・`test`（7m56s／4m58s）・`deny`（2m30s／2m15s）と集約ジョブ `rust-base-ci-complete` がいずれも `success` であることを確認した。`clippy` / `test` の prune ステップも両 run で実行された（test: 1432 エントリ削除）。

（当初記述）v3 workflow 定義での実行そのものが未取得のため（§6）、v3 版での 4 ジョブ green は
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

つまり `gh run rerun --job`（特定ジョブのみを対象とする再実行）は、対象 run が
最初にトリガーされた時点で解決された reusable workflow の参照（`@latest` が指していた
コミット）をそのまま再実行し、**`@latest` を rerun 時点で再解決しない**。この run は
元々 2026-09-16T19:44 にトリガーされており、`latest` タグの付替え（20:22）より前のため、
rerun でも v2 のコミットのまま実行された。これは計画（§3-4「v3 データ欠落時の方針」）が
想定していなかった挙動である。

**この結論はジョブ単位の再実行（`gh run rerun --job <job-id>` や失敗ジョブのみの
再実行）に限定される点に注意する**。GitHub 公式ドキュメント（Re-running workflows and
jobs）では、run 内の**全ジョブを対象とする再実行**（`gh run rerun`（`--job` を指定しない
形）や UI の「Re-run all jobs」）は、再実行時点で解決された参照（`latest` タグ付替え後の
最新コミットを含む）を使うと明記されている。今回観測した「参照を再解決しない」挙動は
ジョブ単位の再実行に固有のものであり、「公式ドキュメントにも明記が無い」という記述は
不正確だったため訂正する。

この結果、**`gh run rerun --job` によるジョブ単位の再実行では v3 データを取得できない**
ことが判明した。`gh cache delete` で人為的に cold を作らない方針（OWASP A01 相当・
計画§7）は維持しつつ、v3 データの取得には以下のいずれかが必要:

1. `Fandhe-AI/fandhe-ai` に対する新規の push または PR（`Cargo.lock` 変更が無くても
   `ci.yml` の `pull_request` / `push` トリガーを満たす変更であれば良い）が発生し、
   その run のログから §2-1〜2-3 の v3 行を採取する
2. 採取コマンド: `gh run list -R Fandhe-AI/fandhe-ai --workflow ci.yml --created ">2026-09-16T20:22:34Z"`
   で対象 run を特定し、`gh run view --job <job-id> --log` から
   `Cache hit for restore-key:` / `Cache hit for:`（exact hit の場合）/
   `Cache not found`・`prune 完了: N エントリ`・`Cache saved with key: ...-v3-...` を抽出する
3. `gh cache list -R Fandhe-AI/fandhe-ai` で `...-test-v3-...` キーの blob サイズを確認する
4. 得られた値で本ドキュメント §2-1〜2-3 の v3 行・§3 の判定・§5 を更新する
5. （補完手順）対象 run に対して `gh run rerun`（`--job` を指定しない全ジョブ再実行）や
   UI の「Re-run all jobs」を使う。公式ドキュメント通りであれば `latest` 付替え後の
   参照が再解決されるため、latest 付替え後にこの操作を行えば同一 run の全ジョブ再実行
   でも v3 データを取得できる可能性がある（本ドキュメント作成時点では未検証。実施した
   場合は結果を §2-1〜2-3・本節へ追記すること）

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

### 6-2. 補完結果（2026-09-17。§6-1 手順 1〜4 を実施）

`Fandhe-AI/fandhe-ai` で docs PR [#1990](https://github.com/Fandhe-AI/fandhe-ai/pull/1990)（`.claude/rules/ci.md` のみ変更。`Cargo.lock` 不変・ハッシュ `e7fa89ec...`）を 2 回 push し、`rust-ci / cargo test` を 2 run 採取した。

| push | run / job | 復元 | 保存 | test ジョブ合計 |
|---|---|---|---|---|
| 1 回目（01:18 UTC） | [`35170065578`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35170065578) / `105039623501` | `Cache hit for restore-key: ...-test-v2-e7fa89ec...`（3940 MB、1m45s） | `Cache saved with key: ...-test-v3-e7fa89ec...`（104356387 B、`refs/pull/1990/merge`） | 7m56s（§2-2） |
| 2 回目（01:31 UTC） | [`35170879552`](https://github.com/Fandhe-AI/fandhe-ai/actions/runs/35170879552) / `105042072798` | `Cache hit for: ...-test-v3-e7fa89ec...`（100 MB、4秒） | `Cache hit occurred on the primary key ..., not saving cache.` | 4m58s（§2-1） |

- §6-1 の「最初の自然 run は v2 からの prefix フォールバックになる」という予測どおりの順序で観測された。1 回目で保存した v3 blob は 2 回目まで evict されなかった
- v3 blob は PR ref（`refs/pull/1990/merge`）に保存されたため main からは不可視。PR #1990 の squash マージ後の main 初回 run は再度 v2 からのフォールバックとなり、その run が main ref の v3 blob を保存する（§4-2）
- §6-1 手順 5（`gh run rerun` 全ジョブ再実行による `latest` 再解決）は、自然 run が発生したため未検証のまま
- 採取: `gh run view -R Fandhe-AI/fandhe-ai <run> --json jobs`（ジョブ時間）・`gh run view --job <id> --log`（復元・保存行）・`gh api repos/Fandhe-AI/fandhe-ai/actions/jobs/<id>`（ステップ時間）・`gh cache list -R Fandhe-AI/fandhe-ai`
- 利用側の記録: Fandhe-AI/fandhe-ai#1918（同内容のコメント）。本結果により #130 はクローズ済み

## 参考

- 内訳計測（#131）: [`rust-base-ci/cache-breakdown-2026-09-17.md`](./cache-breakdown-2026-09-17.md)
- `CARGO_INCREMENTAL=0` + キー `v2`: #132
- 保存前 prune + キー `v3`: #133
