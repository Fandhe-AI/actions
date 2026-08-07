# 組織 runner 方針

Fandhe-AI Organization における GitHub Actions の runner 選択方針。
ユーザー決定（2026-08-07）に基づく。各リポジトリの CI 設定・rule・CI 変更 issue は
本ドキュメントを参照すること。

## 1. 方針

リポジトリの**可視性**で runner を決める。

| リポジトリの可視性 | 使用する runner | 理由 |
|---|---|---|
| public | GitHub ホステッド（`ubuntu-latest` 等） | fork PR で untrusted なコードが実行されうるため、使い捨て環境で隔離する。public リポジトリは Actions の実行時間が無料 |
| private | self-hosted runner | private リポジトリは GitHub ホステッドの実行時間が従量課金。fork PR の経路が実質存在せず、永続環境（toolchain キャッシュ等）の利点を取れる |

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

2026-08-07 時点の該当リポジトリ。

### public（GitHub ホステッド）

- `fandhe-frontend`
- `agent-cli-skills`
- `agent-reference-skills`
- `actions`（本リポジトリ）

### private（self-hosted）

- `fandhe-backend`
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

この例外は codex-review の codex 実行ジョブに限る。PR コメント投稿など資格情報に触れない
ジョブ（`post-feedback-runner-label`）は、上表の方針どおり呼び出し側の可視性に従う。

## 4. 本リポジトリの reusable workflow との関係

本リポジトリの reusable workflow（`codex-review` / `pages-deploy`）は、runner ラベルを
**呼び出し側から `runner-label` 入力で受け取る**。したがって、どの runner を使うかは
**呼び出し側リポジトリの可視性**が決める。

| 呼び出し側 | 渡すラベル |
|---|---|
| public リポジトリ | `ubuntu-latest`（codex-review の codex ジョブのみ例外的に self-hosted ラベル） |
| private リポジトリ | `self-hosted`（または絞り込んだ独自ラベル） |

なお `rust-toolchain-setup` は self-hosted runner の永続環境で rustup を自己修復する
Composite Action であり、private リポジトリ側での利用を想定している
（`rust-toolchain-setup/README.md` 参照）。

## 関連

- [`codex-review/README.md`](../codex-review/README.md)
- [`pages-deploy/README.md`](../pages-deploy/README.md)
- [`rust-toolchain-setup/README.md`](../rust-toolchain-setup/README.md)
