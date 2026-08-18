# rust-base-ci

Rust リポジトリのベースライン品質ゲート（`cargo fmt` / `cargo clippy` / `cargo test` /
`cargo deny`）を共通化する reusable workflow。

`Fandhe-AI/local-llm-server`・`Fandhe-AI/rust-ai-library` の `ci.yml` がほぼ同型
（Cargo.toml 有無を各ステップの `if:` で判定する自己修復方式、`cargo-deny` を毎回
ソースからインストール）で重複していたものを集約した。

- **runner は `runner-label` 入力で呼び出し元から指定する**。public リポジトリは
  GitHub ホステッド（`ubuntu-latest` 等）、private リポジトリは self-hosted という
  組織方針の両方から利用できる
- **`Cargo.toml` 不在リポジトリでは安全に skip する**（ジョブは `success` のまま終了し
  CI を落とさない）。`cargo deny` は `deny.toml` も揃っている場合のみ実行する
- rustup セットアップは [`rust-toolchain-setup`](../rust-toolchain-setup/) に委譲し、
  **バージョン固定・冪等・runner のグローバル状態を汚さない**方針を 1 箇所へ集約している。
  `cargo-deny` はバージョン固定・冪等のインライン導入とし、**呼び出し側の
  `rust-toolchain.toml` とは独立した stable ツールチェーンでビルドする**
  （`cargo-deny` の MSRV が呼び出し側の固定チャネルより新しい場合の失敗を避けるため）
- 使用する外部 action はすべてコミット SHA 固定
- cache はオプトイン（`cache: true`）。workspace が永続する self-hosted runner では
  通常不要なため既定は無効

## ジョブ構成

| ジョブ | 実行内容 | 実行条件 |
|---|---|---|
| `fmt` | `cargo fmt --all --check` | `Cargo.toml` が存在する |
| `clippy` | `cargo clippy --workspace --all-targets --all-features -- -D warnings` | `Cargo.toml` が存在する |
| `test` | `cargo test --workspace --all-features` | `Cargo.toml` が存在する |
| `deny` | `cargo deny --locked check <deny-checks>` | `Cargo.toml` と `deny.toml` が存在する |
| `rust-base-ci-complete` | 上記 4 ジョブが全て `success` であることを fail-closed 判定 | 常に実行（`always()`） |

ジョブ単位の有効/無効入力は設けていない。ジョブを `skipped` にすると
`rust-base-ci-complete` の fail-closed 判定（`result != success` で失敗）に引っかかるため。
ジョブ構成を増やす場合は呼び出し側に独自ジョブを追加する。

## 前提条件

1. **runner に正常動作する rustup が導入済みであること**。本 workflow が内部で使う
   `rust-toolchain-setup` は **v1.1.0 以降、rustup が未導入・破損している場合に
   ネットワーク導入せず fail-closed でエラー終了する**（`Fandhe-AI/actions#86`）。
   GitHub ホステッドランナー（`ubuntu-latest` 等）は rustup 同梱のため追加作業は不要。
   self-hosted runner は **runner イメージ側で rustup を用意する**

   > **挙動差分（v1.1.0 未満からの更新時）**: 従来は rustup 不在時に
   > `curl https://sh.rustup.rs | sh` で自動導入していたが、pin できないリモート
   > コードをジョブ権限で実行する供給網リスク（OWASP A08 相当）のため既定で行わない。
   > **rustup を持たない self-hosted runner を使っている呼び出し側は、この更新で
   > ジョブが失敗するようになる**。恒久対応は runner イメージへの rustup 導入。
   > どうしても runner 上で導入する必要がある場合のみ、`rust-toolchain-setup` の
   > `allow-network-install: 'true'` を明示する（本 workflow は透過していないため、
   > 必要なら呼び出し側で本 workflow を使わず action を直接呼ぶ）
2. **呼び出し側リポジトリに `rust-toolchain.toml` が存在すること**。
   `rust-toolchain-setup` は `rust-toolchain.toml` を単一真実源として toolchain を
   同期するため、不在の runner では既定ツールチェーンが決まらず `cargo` が失敗する
   （移行元 `ci.yml` の `--default-toolchain stable` からの挙動差分）
3. `cargo deny` を有効にする場合、リポジトリルートに `deny.toml` が存在すること
   （不在時は `deny` ジョブが `success` のまま skip される）。`cargo-deny` 本体は
   `rust-toolchain.toml` の固定チャネルではなく、`deny` ジョブが別途導入する **stable**
   でビルドされる（`cargo-deny` 0.20.x の MSRV は 1.88.0 であり、呼び出し側がそれより
   古いチャネルを固定していてもインストールが失敗しないようにするため）。
   `cargo deny check` 自体は呼び出し側の `rust-toolchain.toml` の toolchain で実行される
4. runner が利用可能であること。private リポジトリは self-hosted、public リポジトリは
   GitHub ホステッド（`ubuntu-latest` 等）を `runner-label` で指定する
5. 本リポジトリ（`Fandhe-AI/actions`）は public のため、workflow 共有（提供側）の設定は
   不要。ただし利用側の org / リポジトリの **Settings → Actions → General** で外部
   Action / workflow の利用が制限されている場合は許可が必要

## セットアップ

呼び出し側リポジトリに `.github/workflows/ci.yml` を置く:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

# reusable workflow のトップレベル concurrency は機能しないため呼び出し側で設定する
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  rust-ci:
    # reusable workflow は呼び出し側が付与した以上の権限を持てないため、
    # 共通側ジョブが必要とする権限をここでも付与する
    permissions:
      contents: read
    uses: Fandhe-AI/actions/.github/workflows/rust-base-ci.yml@<SHA> # main
    with:
      runner-label: self-hosted
```

`<SHA>` は本リポジトリのコミット SHA で固定する（`@main` 不可。SHA の更新方法は後述）。

### public リポジトリ（GitHub ホステッド）から呼ぶ場合

```yaml
jobs:
  rust-ci:
    permissions:
      contents: read
    uses: Fandhe-AI/actions/.github/workflows/rust-base-ci.yml@<SHA> # main
    with:
      runner-label: ubuntu-latest
      # ホステッド runner は毎回まっさらなため cache が効く
      cache: true
```

### 移行元リポジトリ相当の指定

| リポジトリ | 指定 |
|---|---|
| `local-llm-server` | `deny-checks: advisories licenses sources`（既定のまま）・`test-timeout-minutes: 30`（既定のまま） |
| `rust-ai-library` | `deny-checks: licenses sources`・`test-timeout-minutes: 45` |

```yaml
# rust-ai-library の場合
with:
  runner-label: self-hosted
  deny-checks: licenses sources
  test-timeout-minutes: 45
```

`rust-ai-library` の `build` / `build-no-cuda-toolkit` / `deps-forbidden` のような
リポジトリ固有ジョブは呼び出し側の `ci.yml` に残す。

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `runner-label` | - | `self-hosted` | 全ジョブを実行する runner ラベル（public は `ubuntu-latest` 等） |
| `deny-checks` | - | `advisories licenses sources` | `cargo deny check` に渡すチェック名（空白区切り）。`advisories` / `bans` / `licenses` / `sources` のみ許容し、それ以外は fail-closed で拒否 |
| `cargo-deny-version` | - | `0.20.2` | `cargo-deny` の固定バージョン（インストール後に厳密一致で検証する） |
| `cache` | - | `false` | cargo レジストリ・`target` の cache を有効にする（オプトイン） |
| `cache-key-prefix` | - | `rust-base-ci` | cache key の接頭辞（runner 共有時の衝突回避用） |
| `fmt-timeout-minutes` | - | `10` | `fmt` ジョブの timeout（分） |
| `clippy-timeout-minutes` | - | `30` | `clippy` ジョブの timeout（分） |
| `test-timeout-minutes` | - | `30` | `test` ジョブの timeout（分） |
| `deny-timeout-minutes` | - | `20` | `deny` ジョブの timeout（分） |

コマンドの自由記述入力（`fmt-args` / `clippy-args` 等）は意図的に設けていない。移行元
2 リポジトリでコマンドに差分が無く、`run:` 内での非クォート展開（単語分割）という
シェル注入面だけが増えるため。

## SHA の更新方法

```bash
# 最新の main の SHA を確認
gh api repos/Fandhe-AI/actions/commits/main --jq '.sha'
```

呼び出し側の `uses: Fandhe-AI/actions/.github/workflows/rust-base-ci.yml@<SHA>` を更新する。

本 workflow が内部で参照する **本リポジトリ内の action**
（`rust-toolchain-setup`）は、相対参照
（`uses: ./rust-toolchain-setup`）が**呼び出し側リポジトリのチェックアウト**を指してしまう
ため使えず、`Fandhe-AI/actions/<action>@<SHA> # <バージョン>` 形式で固定している
（`# main` のような可動参照ラベルはコメントにも書かない）。参照先の action を更新した
際は `.github/workflows/rust-base-ci.yml` 内の各 SHA を手動で追随させ、**呼び出し側も
本 workflow の新しい SHA へ更新する**（内部 pin を直しただけでは、古い SHA で本 workflow
を呼んでいるリポジトリには反映されない）。

外部 action（`actions/checkout` / `actions/cache`）の SHA を更新する場合は、タグの実コミット
SHA を API で解決して使う（値をでっち上げない）:

```bash
gh api repos/actions/cache/git/ref/tags/v6.1.0 --jq '.object'
# .object.type が "tag"（annotated tag）の場合はもう 1 段 dereference する
gh api repos/actions/cache/git/tags/<tag-object-sha> --jq '.object.sha'
```

## 注意事項

- **`concurrency` は呼び出し側で設定する**（reusable workflow のトップレベル concurrency は
  機能しない）
- **required status check の名前は `<呼び出し側 job id> / rust-base-ci-complete`** になる
  （上記セットアップ例では `rust-ci / rust-base-ci-complete`）。ジョブ名ではなく
  呼び出し側の job id が接頭辞になる点に注意
- **`rust-base-ci-complete` は呼び出し側の独自ジョブを見ない**。呼び出し側にリポジトリ固有
  ジョブがある場合は、呼び出し側でも `needs` に `rust-ci` と独自ジョブを並べた集約ジョブを
  用意する（`bare needs` は `skipped` も success 扱いになるため、`always()` +
  `result` の明示検査で fail-closed にする）
- **`Cargo.toml` / `deny.toml` 不在時は skip して success で終わる**（fail-closed ではない）。
  これは workspace 作成前のリポジトリで CI を落とさないための自己修復方式であり、移行元
  `ci.yml` の挙動を踏襲している。存在を強制したい場合は呼び出し側で別途検査ジョブを置く
- 各ステップの `if:` でスキップ判定しているのは、`jobs.<id>.if` が Checkout 前
  （ワークスペース展開前）に評価され `hashFiles('Cargo.toml')` が常に空文字となり判定
  できないため。ジョブ単位の `if:` に変更してはならない
- **cache はホステッド runner 向けのオプトイン**。workspace と `~/.cargo` が永続する
  self-hosted runner では復元コストのほうが大きく、既定 (`false`) のままでよい
- `cargo deny` は `--locked` 付きで実行するため、`Cargo.lock` が最新でない場合は失敗する
  （`Cargo.lock` の意図しない書き換え・runner 汚染を防ぐための意図的な挙動）
- checkout は `persist-credentials: false`・`submodules: false`（既定）で行う。submodule に
  ある Rust クレートを検査対象にしたい場合、本 workflow では対応していない
