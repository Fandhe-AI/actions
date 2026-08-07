# cargo-tool-install

cargo ツール（`cargo install` で導入するバイナリ crate）をバージョン固定・冪等にインストールする Composite Action。

`<コマンド> --version` の出力からバージョンを取り出して指定バージョンと**厳密一致**で比較し、
未導入または版不一致の場合のみ `cargo install --locked <tool>@<version>` を実行します。
導入済み・版一致の場合はインストールをスキップするため、self-hosted runner のような
永続環境で繰り返し実行しても高速に完了します（冪等）。インストール後にも同じ判定で
バージョンを再検証し、期待値と一致しない場合はエラーで失敗します（fail-closed）。

## 前提条件

- runner に Rust ツールチェーン（`cargo`）が導入済みであること
- crates.io へアクセスできること（初回インストール時・版不一致時のみ）
- self-hosted runner での利用を想定（GitHub ホステッドランナーでは毎回フルインストールが
  走るため、キャッシュ戦略の併用を推奨）

## セットアップ

Secrets は不要です。ワークフローのステップに以下を追加します：

```yaml
steps:
  - name: Ensure cargo-nextest 0.9.137
    uses: Fandhe-AI/actions/cargo-tool-install@<SHA> # main
    with:
      tool: cargo-nextest
      version: '0.9.137'
```

### 使用例（fandhe-backend の既存パターンの置き換え）

fandhe-backend の CI（ci.yml / release.yml / bench-schedule.yml）にある
「`<tool> --version` を確認して未導入・版不一致なら `cargo install --locked` する」
ステップは、以下のように置き換えられます：

```yaml
# cargo サブコマンド型（cargo nextest / cargo deny / cargo audit /
# cargo geiger / cargo llvm-cov / cargo fuzz）。
# binary-name 省略時は tool と同名のバイナリとみなし、`cargo-` 始まりは
# 自動的に `cargo <sub> --version` 形式でバージョン確認する。
- name: Ensure cargo-nextest 0.9.137
  uses: Fandhe-AI/actions/cargo-tool-install@<SHA> # main
  with:
    tool: cargo-nextest
    version: '0.9.137'

- name: Ensure cargo-deny 0.19.8
  uses: Fandhe-AI/actions/cargo-tool-install@<SHA> # main
  with:
    tool: cargo-deny
    version: '0.19.8'

- name: Ensure cargo-audit 0.22.2
  uses: Fandhe-AI/actions/cargo-tool-install@<SHA> # main
  with:
    tool: cargo-audit
    version: '0.22.2'

- name: Ensure cargo-geiger 0.13.0
  uses: Fandhe-AI/actions/cargo-tool-install@<SHA> # main
  with:
    tool: cargo-geiger
    version: '0.13.0'

- name: Ensure cargo-llvm-cov 0.8.7
  uses: Fandhe-AI/actions/cargo-tool-install@<SHA> # main
  with:
    tool: cargo-llvm-cov
    version: '0.8.7'

- name: Ensure cargo-fuzz 0.13.2
  uses: Fandhe-AI/actions/cargo-tool-install@<SHA> # main
  with:
    tool: cargo-fuzz
    version: '0.13.2'

# スタンドアロンバイナリ型（コマンド名 = crate 名）
- name: Ensure oha 1.15.0
  uses: Fandhe-AI/actions/cargo-tool-install@<SHA> # main
  with:
    tool: oha
    version: '1.15.0'
```

crate 名とコマンド名が異なるツールは `binary-name` で明示します：

```yaml
# 例: crate 名 ripgrep のコマンド名は rg
- name: Ensure ripgrep 14.1.1
  uses: Fandhe-AI/actions/cargo-tool-install@<SHA> # main
  with:
    tool: ripgrep
    version: '14.1.1'
    binary-name: rg
```

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `tool` | Yes | - | crates.io のクレート名（例: `cargo-nextest`, `oha`） |
| `version` | Yes | - | 固定するバージョン（semver 形式、厳密一致で判定） |
| `binary-name` | No | `tool` と同じ | 導入後に呼び出すコマンド名。`cargo-` 始まりはサブコマンド形式（`cargo <name> --version`）で確認する |

## SHA の更新方法

セキュリティのため、Action は `@main` ではなくコミット SHA で固定しています。
`actions` リポジトリを更新した場合は、以下の手順で SHA を更新してください：

```bash
# actions リポジトリの main 最新コミット SHA を取得
# （本リポジトリは private のため、認証済み gh CLI で解決する）
gh api repos/Fandhe-AI/actions/commits/main --jq '.sha'

# ワークフロー内の SHA を新しい値に置き換え
```

## 注意事項

- **サプライチェーン**: crates.io からバージョン固定（`--locked` で Cargo.lock 準拠）で
  取得します。バージョンを更新する際は changelog・依存差分を確認してから固定値を
  変更してください
- **厳密一致判定**: バージョン比較は前方一致ではなく厳密一致です。`1.15` のような
  部分指定はできません（semver 3 要素で指定してください）
- **crates.io に存在しないバージョン**: 存在しないバージョンを指定すると
  `cargo install` が失敗します（例: oha に `1.9.1` は存在しない）。crates.io で
  公開済みバージョンを確認してから指定してください
- **PATH の前提**: `~/.cargo/bin` が PATH に含まれている必要があります（rustup 標準
  セットアップでは含まれます）。インストール後の再検証で版不一致になる場合は、
  PATH 上に別経路で導入された同名バイナリが優先されていないか確認してください
