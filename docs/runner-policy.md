# 組織 runner 方針

Fandhe-AI Organization における GitHub Actions の runner 選択方針。
ユーザー決定（2026-08-07）に基づく。各リポジトリの CI 設定・rule・CI 変更 issue は
本ドキュメントを参照すること。

## 1. 方針

リポジトリの**可視性**で runner を決める。

| リポジトリの可視性 | 使用する runner |
|---|---|
| public | GitHub ホステッド（`ubuntu-latest` 等） |
| private | self-hosted runner |

public 側で GitHub ホステッドを使う根拠として、fork からの PR で untrusted なコードを
self-hosted runner 上で実行しないことが挙げられる（`.github/workflows/codex-review.yml`
のコメント参照）。

### 記述例

public リポジトリ:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
```

private リポジトリ:

```yaml
jobs:
  build:
    runs-on: self-hosted
```

ラベルを絞り込む場合は配列で指定する（`runs-on: [self-hosted, linux, x64]`）。

## 2. 対象リポジトリ一覧

2026-08-08 時点の該当リポジトリ。

### public（GitHub ホステッド）

- `fandhe-frontend`
- `agent-cli-skills`
- `agent-reference-skills`
- `actions`（本リポジトリ）
- `fandhe-backend`（2026-08-08 に public 化。CI のホステッド移行は同リポジトリ #550 で実施）

### private（self-hosted）

- `local-llm-server`
- `rust-ai-library`
- `team-hub`
- `articles`
- `ideas`
- `local-server`

> リポジトリを新設・可視性変更した際は、この一覧を更新すること。

## 3. 例外: codex-review

`codex-review` の **self-hosted な codex 専用 runner** は、**public リポジトリでも許容される
唯一の例外**とする。

- 認証が codex-home 方式（runner 上に配置した `auth.json`）であり、GitHub ホステッドでは
  資格情報を保持できないため
- 例外を安全に成立させるための前提は `codex-review/README.md` および
  `.github/workflows/codex-review.yml` のコメントを参照。特に以下が必須:
  - fork からの PR では実行しない（untrusted コードを self-hosted runner で実行しない）
  - ジョブユーザーに passwordless sudo を与えない
  - 信頼できないリポジトリへ runner を共有しない

ホステッドランナー既定（public）のリポジトリが例外を適用する際の条件・wrapper の書き方・
例外が及ばない範囲は [`codex-review-runner-exception.md`](codex-review-runner-exception.md) にまとめている。

この例外は codex-review の codex 実行ジョブ（`runner-label`、既定値 `codex`）に限る。
PR コメント投稿など資格情報に触れないジョブ（`post-feedback-runner-label`）は、上表の方針どおり
呼び出し側の可視性に従う。ただし既定値が `self-hosted` であるため、**public リポジトリから
呼び出す場合は `post-feedback-runner-label: ubuntu-latest` を明示的に渡すこと**。

この差分は wrapper テンプレートとして用意してあるため、導入時は可視性に応じて
[`codex-review/templates/`](../codex-review/templates/) の該当ファイルをコピーすればよい
（`codex-review.private.yml` / `codex-review.public.yml`。手順は
[`codex-review/README.md`](../codex-review/README.md)「セットアップ」）。

## 4. 本リポジトリの reusable workflow との関係

本リポジトリの reusable workflow（`codex-review` / `pages-deploy`）は、runner ラベルを
**呼び出し側から `runner-label` 入力で受け取る**。したがって、どの runner を使うかは
**呼び出し側リポジトリの可視性**が決める。

| 呼び出し側 | 渡すラベル |
|---|---|
| public リポジトリ | `ubuntu-latest` を**明示的に指定**（codex-review の codex ジョブのみ例外的に self-hosted な codex 専用ラベル） |
| private リポジトリ | `self-hosted`（または絞り込んだ独自ラベル）。既定値のままで方針に合致 |

**注意**: `pages-deploy` の `runner-label` と `codex-review` の `post-feedback-runner-label` は
いずれも既定値が `self-hosted` である。既定値は private リポジトリを前提としているため、
public リポジトリから呼び出す場合は方針に合わせてラベルを明示的に渡す必要がある。

なお `rust-toolchain-setup` は self-hosted runner の永続環境で rustup を自己修復する
Composite Action であり、private リポジトリ側での利用を想定している
（`rust-toolchain-setup/README.md` 参照）。

## 関連

- [`codex-review-runner-exception.md`](codex-review-runner-exception.md)
- [`codex-review/README.md`](../codex-review/README.md)
- [`pages-deploy/README.md`](../pages-deploy/README.md)
- [`rust-toolchain-setup/README.md`](../rust-toolchain-setup/README.md)
