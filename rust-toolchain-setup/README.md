# rust-toolchain-setup

runner の rustup を検証し、リポジトリの `rust-toolchain.toml` にツールチェーンを
同期する Composite Action。

- **rustup 不在時は fail-closed（既定）**: rustup が未導入、または残骸だけが残って
  実行不能（破損）な場合、**何が足りないかを明示してジョブを失敗させる**。
  健全な導入済み環境では何もせず、追加コストはほぼゼロ（冪等）。
  ネットワークからの導入は `allow-network-install: 'true'` の明示的な opt-in が必要
- **なぜ既定が fail-closed か**: 導入は `curl https://sh.rustup.rs | sh` で行われ、
  本アクションを commit SHA で pin しても**取得されるスクリプトの内容は固定・検証されない**。
  永続 self-hosted runner の root ジョブ（Docker socket を持つ構成もある）で
  未 pin のリモートコードが実行される供給網経路（OWASP A08 相当）になる。
  「rustup が無い」は runner イメージ側の不備なので、黙って踏まずに落とす。
  恒久対応は **runner イメージへ rustup を焼き込むこと**
- **単一真実源**: ツールチェーンのチャネル・components は `rust-toolchain.toml` に委ね、
  `rustup show` で同期する（toolchain 指定 input は意図的に設けない）
- **追加コンポーネント**: ジョブ固有のコンポーネント（例: カバレッジ用
  `llvm-tools-preview`）は `components` input で追加できる。インストール済み一覧が
  「ベース名 + ホスト三つ組」かつ preview は `-preview` なしで列挙される仕様を
  踏まえ、正規化した候補名との厳密一致で導入済みを判定してスキップする（冪等。
  ホスト三つ組を取得できない場合は判定を諦めて `rustup component add` に倒す）
- **stale credential ガード（既定 fail-closed で有効）**: 先頭ステップで、元の
  グローバル git config を `[include]` で取り込んだ上で **github.com 向けの
  `http.extraheader`（スコープ付き・host 非限定のどちらも）を空値でリセットする**
  だけの**ジョブ専用オーバーレイ**を作成し、`GIT_CONFIG_GLOBAL` を `$GITHUB_ENV`
  経由で以降のステップにのみ適用する（**runner ホストの実 global config ファイルは
  書き換えない。extraheader の値そのものも本ステップのどの変数・コマンドライン
  引数・一時ファイルにも一度も現れない**。他ホスト向け認証ヘッダーは include 元の
  実ファイルを通じてそのまま有効であり、実ファイルからも消えないため、並行実行中の
  他ジョブや本ジョブ以外の用途を壊さない）。永続 self-hosted runner のホスト側に
  失効済みトークンが残置していると、公開 repo（例: `cargo audit` / `cargo deny`
  が fetch する `RustSec/advisory-db`）への本来認証不要な匿名 fetch にまで混入し、
  断続的な HTTP 401（flaky な症状として観測される）を引き起こす。本ステップは
  これを CI 側で防ぐ多層防御の 1 層であり、`sanitize-github-extraheader: 'false'`
  で無効化できる。オーバーレイ作成後は github.com 向けの実効 extraheader が
  残っていないか（リポジトリローカル・system config を混ぜない `--file` +
  `--includes` 経路で）`--get-urlmatch` で検証し、検証失敗、または実効値が
  残っている場合はジョブを失敗させる（fail-closed）

## 前提条件

- self-hosted runner（永続環境）での利用を想定。GitHub ホステッドランナーでも動作するが、
  自己修復・冪等性の設計は永続環境向け
- **runner に rustup が導入済みであること**（既定の fail-closed 動作の前提）。
  未導入の runner で使うには `allow-network-install: 'true'` が要り、その場合は
  `curl` と `https://sh.rustup.rs` へのネットワークアクセスも必要
- `rust-toolchain.toml` のチャネル・components が runner に未導入の場合、
  `rustup show` がそれらを取得するため `https://static.rust-lang.org` への
  ネットワークアクセスが必要（これは rustup 本体による pin 済み成果物の取得であり、
  上記の未 pin スクリプト実行とは別種）
- 呼び出し側リポジトリのワークスペース直下に `rust-toolchain.toml` があること
  （本アクションの前に `actions/checkout` を実行しておくこと）

## セットアップ

Secrets は不要。checkout の後に本アクションを置く。

```yaml
jobs:
  test:
    runs-on: self-hosted
    timeout-minutes: 30
    steps:
      - name: Checkout
        uses: actions/checkout@<SHA> # v6

      - name: Setup Rust toolchain
        uses: Fandhe-AI/actions/rust-toolchain-setup@latest

      - name: cargo test
        run: cargo test --workspace --all-features
```

### fandhe-backend の既存ステップの置換例

fandhe-backend の各ジョブにある以下の 2〜3 ステップ:

```yaml
      - name: Ensure rustup is installed
        run: |
          if ! command -v rustup >/dev/null 2>&1; then
            curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain none
            echo "${CARGO_HOME:-${HOME}/.cargo}/bin" >> "${GITHUB_PATH}"
          fi

      - name: Sync toolchain (rust-toolchain.toml)
        run: rustup show

      # （coverage ジョブのみ）
      - name: Ensure llvm-tools-preview component
        run: |
          if ! rustup component list --installed | grep -q '^llvm-tools'; then
            rustup component add llvm-tools-preview
          fi
```

は、次の 1 ステップに置換できる:

```yaml
      - name: Setup Rust toolchain
        uses: Fandhe-AI/actions/rust-toolchain-setup@latest
        with:
          components: llvm-tools-preview # coverage ジョブのみ。他ジョブでは省略
```

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `components` | No | `''` | 追加でインストールする rustup コンポーネント（カンマ区切り。例: `llvm-tools-preview`）。`rust-toolchain.toml` の `components` に列挙済みのものは指定不要 |
| `allow-network-install` | No | `'false'` | rustup 未導入・破損時にネットワークから rustup-init を取得して導入することを許可する。既定は fail-closed。使い捨ての GitHub ホストランナーや、供給網リスクを許容できる環境でのみ `'true'` にする |
| `sanitize-github-extraheader` | No | `'true'` | グローバル git config を `[include]` で取り込みつつ github.com 向け `http.extraheader`（スコープ付き・host 非限定の両方）を空値でリセットするジョブ専用オーバーレイを作成し、`GIT_CONFIG_GLOBAL` で以降のステップにのみ適用する（runner ホストの実 global config ファイル・extraheader の値そのものには一切触れない）。他ホスト向け認証ヘッダー・リポジトリローカル config には触れない。オーバーレイ作成・検証に失敗した場合、またはオーバーレイに対する検証で github.com 向け実効値が残っている場合はジョブを失敗させる（fail-closed）。互換問題時のみ `'false'` で無効化する |

## 参照バージョン（`@latest`）

`Fandhe-AI/actions` は可変タグ `@latest` で参照する。`latest` は main への push ごとに
`.github/workflows/move-latest-tag.yml` が付け替えるため、呼び出し側で参照を更新する作業は不要である。
第三者の action（`actions/checkout` 等）は従来どおりコミット SHA で固定する。

## 注意事項

- **checkout より後に置く**: `rustup show` はカレントディレクトリの
  `rust-toolchain.toml` を検出して同期するため、checkout 前に実行すると
  ツールチェーンが同期されない
- **nightly 等の一時利用**: fuzz / サニタイザ用の pinned nightly など、
  `rust-toolchain.toml` 以外のツールチェーンが必要なジョブは、本アクションの後に
  `rustup toolchain install <pinned-nightly>` 等を別ステップで明示する
  （本アクションは単一真実源の同期のみを担う）
- **PATH の反映タイミング**: `allow-network-install: 'true'` での新規インストール時は
  `$GITHUB_PATH` へ `${CARGO_HOME:-$HOME/.cargo}/bin` を追記する。反映は後続ステップからのため、
  同一ステップ内で続けて cargo を呼ぶ構成にはしない（本アクション内部はステップ分割済みで問題ない）
- **`CARGO_HOME` を設定済みの runner**: rustup-init は `CARGO_HOME` を尊重して
  そこへ cargo/rustup 本体を配置する。self-hosted runner のコンテナイメージが
  `ENV CARGO_HOME=/opt/cargo` のように設定している場合、`$HOME/.cargo/bin` を
  決め打ちで `$GITHUB_PATH` に入れると、インストールは成功しているのに PATH に
  載るのが実在しないディレクトリになり、後続ステップが
  `cargo: command not found`（exit 127）で落ちる。本アクションは
  `${CARGO_HOME:-$HOME/.cargo}/bin` を追記してこれを回避する
- **`actions` リポジトリのアクセス**: `actions` は public のため共有設定（提供側）は不要。
  ただし利用側の org / リポジトリの Settings → Actions → General で外部 Action の
  利用が制限されている場合は許可が必要
- **stale credential ガードの適用範囲**: オーバーレイでリセットする対象は
  github.com 向けの `http.extraheader`（スコープ付き・host 非限定の両方）のみで、
  他ホスト向けの extraheader や `git config --global` に登録された credential
  helper（`gh auth setup-git` 等が設定するもの）はリセットしない。credential
  helper 由来の 401 が残る場合は、当該コマンドの実行時のみ
  `GIT_CONFIG_GLOBAL=/dev/null` を環境変数として渡し、グローバル config
  そのものを無効化する回避策を検討すること
- **`GIT_CONFIG_GLOBAL` の副作用**: 本ガードが実際にリセットを行う必要がある
  場合（github.com 向けの `extraheader` が存在する場合）、`GIT_CONFIG_GLOBAL`
  を `$GITHUB_ENV` 経由でジョブ専用オーバーレイへ差し替える。以降のステップで
  `git config --global` を直接操作するカスタムステップを追加する場合は、
  このオーバーレイを参照している点に注意すること（runner ホストの実
  `~/.gitconfig` ではない。オーバーレイは元ファイルを `[include]` しているため、
  実ファイル側の他ホスト向け設定・credential helper 設定は通常どおり有効）
