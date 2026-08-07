# rust-toolchain-setup

self-hosted runner 上で rustup を自己修復し、リポジトリの `rust-toolchain.toml` に
ツールチェーンを同期する Composite Action。

- **自己修復**: rustup が未導入、または残骸だけが残って実行不能（破損）な場合のみ、
  非対話・HTTPS 検証込み（`curl --proto '=https' --tlsv1.2`）でインストールする。
  健全な導入済み環境では何もせず、追加コストはほぼゼロ（冪等）
- **単一真実源**: ツールチェーンのチャネル・components は `rust-toolchain.toml` に委ね、
  `rustup show` で同期する（toolchain 指定 input は意図的に設けない）
- **追加コンポーネント**: ジョブ固有のコンポーネント（例: カバレッジ用
  `llvm-tools-preview`）は `components` input で追加できる。インストール済み一覧が
  「ベース名 + ホスト三つ組」かつ preview は `-preview` なしで列挙される仕様を
  踏まえ、正規化した候補名との厳密一致で導入済みを判定してスキップする（冪等。
  ホスト三つ組を取得できない場合は判定を諦めて `rustup component add` に倒す）

## 前提条件

- self-hosted runner（永続環境）での利用を想定。GitHub ホステッドランナーでも動作するが、
  自己修復・冪等性の設計は永続環境向け
- runner に `curl` が導入済みであること
- 初回インストール時は `https://sh.rustup.rs` / `https://static.rust-lang.org` への
  ネットワークアクセスが必要
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
        uses: Fandhe-AI/actions/rust-toolchain-setup@<SHA> # main

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
            echo "${HOME}/.cargo/bin" >> "${GITHUB_PATH}"
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
        uses: Fandhe-AI/actions/rust-toolchain-setup@<SHA> # main
        with:
          components: llvm-tools-preview # coverage ジョブのみ。他ジョブでは省略
```

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `components` | No | `''` | 追加でインストールする rustup コンポーネント（カンマ区切り。例: `llvm-tools-preview`）。`rust-toolchain.toml` の `components` に列挙済みのものは指定不要 |

## SHA の更新方法

セキュリティのため、Action は `@main` ではなくコミット SHA で固定する。
`actions` リポジトリを更新した場合は、以下の手順で SHA を更新する:

```bash
# actions リポジトリの main 最新コミット SHA を取得
# （本リポジトリは private のため、認証済み gh CLI で解決する）
gh api repos/Fandhe-AI/actions/commits/main --jq '.sha'

# ワークフロー内の SHA を新しい値に置き換え
```

## 注意事項

- **checkout より後に置く**: `rustup show` はカレントディレクトリの
  `rust-toolchain.toml` を検出して同期するため、checkout 前に実行すると
  ツールチェーンが同期されない
- **nightly 等の一時利用**: fuzz / サニタイザ用の pinned nightly など、
  `rust-toolchain.toml` 以外のツールチェーンが必要なジョブは、本アクションの後に
  `rustup toolchain install <pinned-nightly>` 等を別ステップで明示する
  （本アクションは単一真実源の同期のみを担う）
- **PATH の反映タイミング**: 新規インストール時は `$GITHUB_PATH` へ
  `~/.cargo/bin` を追記する。反映は後続ステップからのため、同一ステップ内で
  続けて cargo を呼ぶ構成にはしない（本アクション内部はステップ分割済みで問題ない）
- **`actions` リポジトリのアクセス**: org の Settings → Actions → General で
  プライベートリポジトリからの Action 共有を許可する必要あり
