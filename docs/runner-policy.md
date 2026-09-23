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

2026-08-14 時点の該当リポジトリ。

### public（GitHub ホステッド）

- `fandhe-frontend`
- `agent-cli-skills`
- `agent-reference-skills`
- `actions`（本リポジトリ）
- `fandhe-backend`（2026-08-08 に public 化。CI のホステッド移行は同リポジトリ #550 で実施）
- `rust-ai-library`（2026-08-14 に public 化。CI のホステッド移行は同リポジトリ #457 で実施）

### private（self-hosted）

- `local-llm-server`
- `team-hub`
- `articles`
- `ideas`
- `local-server`

> リポジトリを新設・可視性変更した際は、この一覧を更新すること。

## 3. 例外: ai-review（旧 codex-review）

`ai-review` の **agentic reviewer（codex / claude / gemini）・local LLM 向け review ジョブが
使う self-hosted な sudo なし専用 runner** は、**public リポジトリでも許容される例外**とする。
`codex-review`（凍結。互換のため残置）の codex 専用 runner も引き続きこの例外に含む。

- 認証が home-dir 方式（runner 上に配置したログイン済みディレクトリ）であり、GitHub
  ホステッドでは資格情報を保持できないため。local LLM は LAN 内到達性が理由
- API provider（`grok`、クラウドの `openai-compatible` endpoint）はツールを持たず GitHub
  ホステッドで成立するため、この例外の対象外（ホステッドのまま運用する）
- 例外を安全に成立させるための前提は `ai-review/README.md` および
  `.github/workflows/ai-review.yml` のコメントを参照。特に以下が必須:
  - fork からの PR では実行しない（untrusted コードを self-hosted runner で実行しない）
  - ジョブユーザーに passwordless sudo を与えない（agentic のみ）
  - 信頼できないリポジトリへ runner を共有しない

ホステッドランナー既定（public）のリポジトリが例外を適用する際の条件・wrapper の書き方・
例外が及ばない範囲は [`ai-review/docs/runner-exception.md`](../ai-review/docs/runner-exception.md)
にまとめている。

この例外は ai-review の review ジョブ（`runner`、既定値は provider 名と同名ラベル）に限る。
`preflight` / `post_feedback`（資格情報に触れない）は、呼び出し側の可視性に応じて
**private なら `self-hosted`・public なら `ubuntu-latest` へ自動で切り替わる**（既定値の
まま呼び出せば方針に合致し、codex-review と異なり明示指定は不要）。

codex-review（凍結）を使い続けるリポジトリでは、引き続き `post-feedback-runner-label` の
既定値が `self-hosted` のままのため、**public リポジトリから呼び出す場合は
`post-feedback-runner-label: ubuntu-latest` を明示的に渡すこと**。この差分は wrapper
テンプレートとして用意してある（[`codex-review/templates/`](../codex-review/templates/)。
手順は [`codex-review/README.md`](../codex-review/README.md)「セットアップ」）。

## 4. 本リポジトリの reusable workflow との関係

本リポジトリの reusable workflow は、runner ラベルを**呼び出し側から入力で受け取る**。
したがって、どの runner を使うかは**呼び出し側リポジトリの可視性**が決める。

| 呼び出し側 | 渡すラベル |
|---|---|
| public リポジトリ | `ubuntu-latest` を**明示的に指定**（`pages-deploy` の `runner-label`、codex-review の `post-feedback-runner-label` 等） |
| private リポジトリ | `self-hosted`（または絞り込んだ独自ラベル）。既定値のままで方針に合致 |

reusable workflow ごとの runner 既定値:

| reusable workflow | 入力 | 既定値 | 可視性での自動切替 |
|---|---|---|---|
| `ai-review` | `runner`（review ジョブ） | agentic は provider 名と同名ラベル、API は private: `self-hosted` / public: `ubuntu-latest` | あり（API provider のみ） |
| `ai-review` | `post-feedback-runner`（preflight/post_feedback） | private: `self-hosted` / public: `ubuntu-latest` | あり |
| `codex-review`（凍結） | `runner-label` | `codex` | なし |
| `codex-review`（凍結） | `post-feedback-runner-label` | `self-hosted` | なし（public は明示指定が必須） |
| `pages-deploy` | `runner-label` | `self-hosted` | なし（public は明示指定が必須） |

**注意**: `pages-deploy` の `runner-label` と `codex-review` の `post-feedback-runner-label` は
いずれも既定値が `self-hosted` である（可視性での自動切替が無い）。既定値は private
リポジトリを前提としているため、public リポジトリから呼び出す場合は方針に合わせてラベルを
明示的に渡す必要がある。一方 `ai-review` の `preflight` / `post_feedback` は
`github.event.repository.private` を見て既定値が自動切替するため、public リポジトリでも
明示指定は不要（詳細は [`ai-review/docs/runner-exception.md`](../ai-review/docs/runner-exception.md)）。

なお `rust-toolchain-setup` は self-hosted runner の永続環境で rustup を自己修復する
Composite Action であり、private リポジトリ側での利用を想定している
（`rust-toolchain-setup/README.md` 参照）。

## 5. self-hosted runner での rust-cache 利用

**適用範囲**: `CARGO_HOME` をジョブ間・リポジトリ間で永続共有している self-hosted runner が
対象。GitHub ホステッド runner は毎回使い捨て環境のため対象外。

**ルール**: self-hosted runner 上のジョブで [`Swatinem/rust-cache`](https://github.com/Swatinem/rust-cache)
を使う場合は、**`with: cache-bin: false` を必須**とする。

**根拠**: 既定の `cache-bin: true` は post ステップで `${CARGO_HOME}/bin` 配下の
「cargo install 由来でない通常ファイル」を削除するため、runner イメージに焼き込んだ
rustup 本体等が失われうる。`CARGO_HOME` を使い捨てない self-hosted 環境ではこの副作用が
別ジョブ・別リポジトリの CI に波及するため、明示的に無効化する。

### 記述例

```yaml
jobs:
  build:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
      - uses: Swatinem/rust-cache@c19371144df3bb44fab255c43d04cbc2ab54d1c4 # v2.9.1
        with:
          cache-bin: false
```

## 関連

- [`ai-review/docs/runner-exception.md`](../ai-review/docs/runner-exception.md)
- [`ai-review/README.md`](../ai-review/README.md)
- [`codex-review/README.md`](../codex-review/README.md)（凍結）
- [`pages-deploy/README.md`](../pages-deploy/README.md)
- [`rust-toolchain-setup/README.md`](../rust-toolchain-setup/README.md)
