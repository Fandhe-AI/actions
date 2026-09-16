# rust-base-ci test ジョブ cargo キャッシュ内訳計測（#131）

イシュー #131 の計測結果として issue コメントに投稿した内容をリポジトリに記録したもの
（<https://github.com/Fandhe-AI/actions/issues/131#issuecomment-5700755755>）。
計測専用の事前調査であり、本ドキュメントの追加以外にコード変更は行っていない
（`rust-base-ci.yml` 等は未変更）。削減の実装は #132 / #133 のスコープ。

## 計測環境

- ホスト: macOS (arm64) / Docker Desktop
- コンテナ: `rust:1-slim-bookworm`（公式イメージ）、`--platform linux/arm64`（**ネイティブ arm64**。x86_64 の `ubuntu-latest` runner とはアーキテクチャが異なる点に注意）
- 実解決バージョン: `rustc 1.98.1 (48a229cea 2026-09-01)` / `cargo 1.98.1 (797e8a9bc 2026-08-05)`（`rust-toolchain.toml` の `stable` チャネルをコンテナ内 `rustup default stable` で解決）。実際の CI ログ（run `35103799823`、`cargo deny check` ジョブの toolchain 解決ログ）と突合した結果、`stable-x86_64-unknown-linux-gnu ... rustc 1.98.1 (48a229cea 2026-09-01)` であり、バージョン番号（1.98.1・同一コミットハッシュ）は完全一致。ターゲットトリプルのみ CI が `x86_64`、本計測が `aarch64` で異なる
- clone 対象: `https://github.com/Fandhe-AI/fandhe-ai.git`（`--depth 1`、org 管理下の正規リポジトリであることを確認してから実行）
- 隔離: ホストの `~/.cargo/credentials`・`GH_TOKEN`・SSH 鍵はコンテナへ一切マウント・転送していない
- 実行コマンド: `cargo test --workspace --all-features --no-run`（テストコード自体の実行はせず、`target/` のビルド成果物構成のみを対象化。実行範囲を最小化する目的）
- 既知の差分: amd64 emulation はビルド時間が非現実的に長くなる見込みのため、計画に明記の代替手順に従い arm64 ネイティブで実行した代替値として扱う。CI 実測の「復元・保存時間」は §4 の実ログ値を優先する

## 1. ディレクトリ別 `du -sh`（コンテナ内、cold build 直後）

`actions/cache` の `path:`（`rust-base-ci.yml` test ジョブ）に対応する 4 パス:

| パス | サイズ | 備考 |
|---|---|---|
| `$CARGO_HOME/registry/index` | 12M | |
| `$CARGO_HOME/registry/cache` | 7.0M | |
| `$CARGO_HOME/git/db` | (存在せず) | 本 workspace は git 依存を使わないため生成されない |
| `target` | 27G | 生 du 値。cold build 直後（インクリメンタル蓄積前の 1 回分） |

`target/debug` 内訳（cold build 直後、`target` 全体比）:

| サブディレクトリ | サイズ | target 内割合（概算） |
|---|---|---|
| `deps` | 22G | 約81.5% |
| `incremental` | 2.6G | 約9.6% |
| `examples` | 2.3G | 約8.5% |
| `build` | 87M | 約0.3% |
| `.fingerprint` | 12M | 約0.04% |

（合計は `target` 全体の 27G とおおむね整合。丸め誤差の範囲内）

`$CARGO_HOME` 配下は `/usr/local/cargo`（`rust` 公式イメージの既定値。runner の `~/.cargo` とはパスが異なるのみで対象範囲は同一）。

## 2. `target/debug/incremental` 除外の削減見込み

- 生 du 値: 2.6G（`target` 全体の約9.6%）
- blob 換算（観測圧縮率を適用）: CI 実測の圧縮後 blob サイズ `3318233612 B`（≈3165 MiB / ≈3.09 GiB）に対する生 `target` サイズ（27G）の比から、観測圧縮率 ≈ **11.4%**（`3.09 GiB ÷ 27 GiB`）と算出。これを incremental の生サイズ（2.6G）へ適用すると、削減見込みは **約 305 MiB**（blob 換算。`(2.6 / 27) × 3165 MiB` と `2.6 GiB × 11.4%` は同一の計算を別経路で表しただけであり、いずれも同じ約305 MiBに一致する）。
- 圧縮前後の取り違えを避けるため、生 du 値（2.6G）と blob 換算値（約305 MiB）を両方明記する。両者は同じ「incremental を除外した場合の削減量」を指すが、単位（未圧縮 target サイズ vs actions/cache が転送・保存する圧縮済み blob サイズ）が異なる点に注意。arm64 ネイティブ計測から算出した圧縮率を x86_64 の CI blob に適用する推定であり、アーキテクチャ横断の推定値である点にも留意（x86_64 実機での生 `target` サイズは未計測）。

## 3. workspace メンバー成果物の内訳（prune 対象の見積り）

`Cargo.toml` の `[workspace] members`（11 クレート、path 名基準）:

`crates/tensor-core` (`fandhe-ai-tensor-core`) / `crates/autodiff` (`fandhe-ai-autodiff`) / `crates/backend-cpu` (`fandhe-ai-backend-cpu`) / `crates/backend-cuda` (`fandhe-ai-backend-cuda`) / `crates/backend-metal` (`fandhe-ai-backend-metal`) / `crates/onnx-interop` (`onnx-interop`) / `crates/guardrail` (`guardrail`) / `crates/self-repair` (`self-repair`) / `crates/bench-harness` (`bench-harness`) / `crates/facade` (`fandhe-ai`) / `crates/docs-site` (`docs-site`、`publish = false`)

`cargo metadata --no-deps --format-version 1` から抽出したターゲット数（lib/bin/test/bench/example 込み、統合テスト・ベンチ単位）は **442 個**。`deps/` が `target` の約81.5%（22G）を占める主因は、この大量の統合テスト・ベンチバイナリそれぞれが依存ツリー全体を静的リンクしていることによるものと見られる（`tape_cuda_cache_bench`・`wmma_*` 系など、GPU 関連の統合テスト・ベンチが特に多い）。

**制約・限界**: 計測時間の制約により、計画ステップ4で規定した「`.fingerprint/<pkg>-<hash>/` のマーカーファイルで `deps/` 実体ファイルを member 名に突合し、依存 crate rlib／member lib rlib／member テスト・bin バイナリの3区分で集計する」精密な内訳付けは、本ラウンドでは完了していない（コンテナが `--rm` で計測直後に破棄され、事後の追加集計ができなかったため）。数値を捏造しないため、この3区分の正確な内訳は **未計測** とし、次回計測（または #132/#133 の実装時に prune ロジックを検証する過程）で補完する。

概算としては、442 ターゲットのうち大半が `test`/`bench`（統合テストバイナリ）であり、`deps/` 22G の主要な削減余地は member 自身の lib rlib（再利用可能）ではなく、これら大型の統合テスト・ベンチ実行バイナリ（prune 対象）にあると推測される（生 du 値ベースの参考情報。blob 換算・正確な按分は未実施）。

## 4. CI 実ログからの復元・保存時間

### 復元（restore）

2026-09-16 の `rust-ci / cargo test` run 11 件（同日 11:07〜13:43、cache key `rust-base-ci-Linux-test-49250d9e13f88f2c5ea947301d918eb3249f6452bd082589071020c27f2bc21f`、`actions@latest` SHA `b9b93c859305fbae763c433200fe8277eb4f1339` 時点。いずれも cache blob サイズは `3318233612 B` ≈3165 MB ≈3.09 GiB で一定）のログから `Cache hit for` → `Cache Size` → `Cache restored successfully` のタイムスタンプ差を集計:

| 区間 | min | median | max |
|---|---|---|---|
| download（hit〜Cache Size ログ） | 12.5秒 | 16.5秒 | 22.8秒 |
| 展開（tar/unzstd。Cache Size〜restored） | 47.7秒 | 49.0秒 | 93.0秒 |
| 合計（復元） | 60.6秒 | 66.7秒 | 112.1秒 |

（参考値として挙げられていた run `35103799823`: download ≈20.6秒・展開 ≈48.1秒・合計 ≈68.7秒は、上記11サンプルの中央値付近に位置する1サンプル）

### 保存（save）

直近（2026-09-16 時点）の `Cargo.lock` 最終変更コミットは `376dff60d5`（2026-09-14 マージ）だが、対応する push run が直近 100 run の一覧内に見つからず、保存時間は **未計測（次回 Cargo.lock 変更時に補完）** とする。完全一致キーヒット時は `actions/cache` が保存自体をスキップするため、直近サンプルの大半にも save ログは存在しない。

### コンパイル時間・テスト実行時間の分離（CI 実ログ、1サンプル）

run `35103799823`（`rust-ci / cargo test` ジョブ、キャッシュ復元済みのインクリメンタルビルド）:

- コンパイル: `` Finished `test` profile [unoptimized + debuginfo] target(s) in 2m 31s ``（cargo 自身の報告値。fandhe-ai#1918 の「再コンパイル約3分16秒」とは条件差分がある可能性があるため単純比較不可。同一粒度での before/after 比較は #134 側で改めて行うこと）
- テスト実行: 最初の `Compiling` 行〜最後の `test result:` 行のタイムスタンプ差から算出して約3分50秒

（参考・別基準）本計測環境（arm64 ネイティブ、cold build、`--no-run`）でのビルド時間: `real 2m3.869s`（`time cargo test --workspace --all-features --no-run`。CI のインクリメンタルビルドとは条件が異なる別基準の値であり、直接比較はできない）

## 5. 整合性チェック

- `target/debug` サブディレクトリ合計（2.6G+22G+87M+2.3G+12M ≈ 27.0G）と `target` 全体（27G）はおおむね整合（丸め誤差の範囲内）
- workspace member 内訳の精密な3区分集計は未実施のため、当該整合性チェックは次回計測時に行う

## 6. 参考: 削減見込みサマリ

| 対策 | 生 du 値ベース | blob 換算値ベース |
|---|---|---|
| `target/debug/incremental` 除外 | 約2.6G（target全体の約9.6%） | 約305 MiB（圧縮後 blob 3165 MiB の約9.6%相当。アーキテクチャ横断推定） |
| workspace member 成果物 prune | 未計測（3区分内訳が未完了のため） | 未計測 |

---

計測環境: Docker（`rust:1-slim-bookworm`、`--platform linux/arm64`、ネイティブ arm64）。実 CI（`ubuntu-latest`、x86_64）とはアーキテクチャが異なり、コンパイル時間の絶対値は直接比較できない点に留意。復元・保存時間および CI 実測のコンパイル/テスト時間分離は実際の CI ログから取得した実測値。
