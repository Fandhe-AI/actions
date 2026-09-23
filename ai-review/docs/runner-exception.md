# runner 例外の適用ガイド（ai-review）

ホステッドランナー既定（public）のリポジトリが `ai-review` を導入するときの
**適用条件・手順・範囲**をまとめる。

例外そのものの定義と根拠は
[`../../docs/runner-policy.md` の「3. 例外: ai-review」](../../docs/runner-policy.md#3-例外-ai-review)
にある。本ドキュメントは根拠を再掲せず、**適用の実務**だけを扱う。

要約: public リポジトリでも、**ai-review の agentic reviewer（`codex` / `claude` /
`gemini`）の review ジョブ、および local LLM（`openai-compatible` を LAN 内 runner へ向ける
構成）の review ジョブに限り**、self-hosted な sudo なし専用 runner を使ってよい。API
provider（`grok` / クラウドの OpenAI 互換 endpoint）は GitHub ホステッドで成立するため
例外は不要。それ以外のジョブ・それ以外の workflow は、可視性どおり GitHub ホステッドを使う。

## 1. 適用条件（誰が担保するか）

例外が安全に成立する条件は 3 者に分かれる。消費側リポジトリが自力で満たせるのは 3 番目だけで、
1・2 が未達なら例外を適用してはいけない。

### 1-1. workflow が強制する（呼び出し側の作業は不要）

`.github/workflows/ai-review.yml` が fail-closed で検証するため、消費側で書く必要はない。

| 条件 | 強制方法 |
|---|---|
| fork からの PR では review ジョブを実行しない | `github.event.pull_request.head.repo.full_name == github.repository` を `preflight` の `if` で判定（以降のジョブも連鎖的に起動しない） |
| runner が未準備の間は実行しない | 資格情報（home-dir 用の Actions variable / secret `API_KEY`）が空なら job を skip（設定が唯一の有効化操作） |
| ジョブユーザーが passwordless sudo を持たない（agentic のみ） | `sudo -n true` が通ったら `::error::` で即座に失敗 |
| PR の内容がレビュー基準を書き換えない | prompt / schema / `AGENTS.md` 等を PR の checkout ではなく **base コミット**から読む |
| local LLM もツールを一切持たない | `openai-compatible` provider はファイル読み取り・コマンド実行の経路自体が無く、PR コードを実行しない |

### 1-2. runner / org 管理者が担保する

workflow からは検証できないため、runner 構築・org 設定の側で満たす。手順は
[`self-hosted-runner.md`](self-hosted-runner.md) を参照。

- runner group の共有範囲を**信頼できるリポジトリに限定**する（public リポジトリを追加する
  場合も、そのリポジトリの write 権限保有者を信頼できることが前提）
- ジョブ実行ユーザーを非 root・sudo 非導入（または sudoers 非登録）にする
- home-dir（`CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `GEMINI_CLI_HOME`）の権限を絞る
  （ディレクトリ `700`、認証ファイル `600`）。パスワード同等として扱う
- 専用の用途ラベルで登録し、レビュー以外のジョブと混ぜない
- `docker.sock` をマウントしない

### 1-3. 呼び出し側リポジトリが担保する

- `post-feedback-runner` を明示的に渡すか、既定値（public では `ubuntu-latest`）のまま
  使う（ai-review は codex-review と異なり、public リポジトリの既定値が最初から
  `ubuntu-latest` になるため、**明示指定は不要**）
- 資格情報（home-dir 用の Actions variable、または secret `API_KEY`）を設定する
- `uses:` は `@latest` で参照する（`latest` は main へ自動追従する）

## 2. public リポジトリ向け wrapper

ai-review の `preflight` / `post_feedback` の既定 runner は、private なら `self-hosted`・
public なら `ubuntu-latest` に自動で切り替わる（`github.event.repository.private` を見て
分岐する）。したがって **codex-review と異なり、public リポジトリでも
`post-feedback-runner` の明示指定は不要**。`runner`（review ジョブ）だけが provider 名と
同名ラベルの既定になる。

```yaml
name: AI PR review

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]

concurrency:
  group: ai-review-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  codex:
    uses: Fandhe-AI/actions/.github/workflows/ai-review.yml@latest
    permissions:
      contents: read
      pull-requests: write
    with:
      provider: codex
      # runner は既定 `codex`（例外の対象）のままでよい。post-feedback-runner は
      # public リポジトリでは既定で ubuntu-latest になるため明示不要
```

ジョブごとの runner の対応:

| ジョブ | runner | 理由 |
|---|---|---|
| `review`（`runner`） | self-hosted な sudo なし専用ラベル（既定は provider 名） | **例外の対象**。agentic の home-dir 認証・local LLM の LAN 到達性はホステッドでは成立しない |
| `preflight` / `post_feedback`（`post-feedback-runner`） | 既定で可視性どおり自動切替（public は `ubuntu-latest`） | 資格情報に触れないため例外の対象外。既定値のままで方針に合致する |

**codex-review.yml（凍結）を使い続ける public リポジトリ向け**の従来記述（
`post-feedback-runner-label: ubuntu-latest` の明示が必須）は codex-review 固有の既定値の
都合であり、ai-review へ移行済みのリポジトリには適用しない。codex-review を使い続ける
限りは、引き続き明示指定が必要:

```yaml
# codex-review.yml（凍結）を使い続ける public リポジトリの場合のみ
with:
  post-feedback-runner-label: ubuntu-latest
```

## 3. 例外が及ばない範囲

この例外は **ai-review の agentic reviewer・local LLM の review ジョブのみ**に閉じる。
以下は例外の根拠にならない。

- API provider（`grok`、クラウドの `openai-compatible` endpoint）の review ジョブを
  self-hosted にすること（GitHub ホステッドで成立するため例外不要）
- `pages-deploy` をはじめ、本リポジトリの他の reusable workflow を public リポジトリで
  self-hosted にすること
- ai-review の `preflight` / `post_feedback` ジョブを self-hosted にすること
- 「ai-review が self-hosted なのだから他の CI も揃えたい」という同一化
- 例外を根拠に、専用プールへレビュー以外のジョブを流すこと

fork からの PR は review ジョブが skip される。public リポジトリでは fork PR が主要な
経路になりうるため、gate（P0/P1 でのジョブ失敗）を required status check にする場合は
skip の扱いを branch protection 側で設計すること。

## 4. 消費側の規約から参照する

消費側リポジトリの CI 規約には、方針を書き写さず**参照だけ**を置く。書き写すと本リポジトリ
側の更新から取り残される。

```markdown
## runner 方針

- 本リポジトリは public のため、GitHub ホステッド（`ubuntu-latest`）を既定とする。
- 唯一の例外は `ai-review` の agentic reviewer・local LLM の review ジョブ（self-hosted な
  sudo なし専用 runner）。適用条件・wrapper の書き方・例外が及ばない範囲は
  [Fandhe-AI/actions `ai-review/docs/runner-exception.md`](https://github.com/Fandhe-AI/actions/blob/main/ai-review/docs/runner-exception.md)
  に従う（組織方針の原典は同リポジトリ `docs/runner-policy.md`）。
- 上記以外のジョブで `runs-on: self-hosted` を書かない。必要が生じたら
  `docs/runner-policy.md` の更新から始める。
```

## 関連

- [`../../docs/runner-policy.md`](../../docs/runner-policy.md) — 組織 runner 方針（原典）
- [`../README.md`](../README.md) — 導入手順・provider 一覧・Inputs
- [`self-hosted-runner.md`](self-hosted-runner.md) — runner 構築手順
- [`../../codex-review/README.md`](../../codex-review/README.md) — codex-review（凍結）
- [`../../pages-deploy/README.md`](../../pages-deploy/README.md) — 同じく `runner-label` の既定が `self-hosted`
