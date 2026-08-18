# codex-review runner 例外の適用ガイド

ホステッドランナー既定（public）のリポジトリが `codex-review` を導入するときの
**適用条件・手順・範囲**をまとめる。

例外そのものの定義と根拠は [`runner-policy.md` の「3. 例外: codex-review」](runner-policy.md#3-例外-codex-review)
にある。本ドキュメントは根拠を再掲せず、**適用の実務**だけを扱う。

要約: public リポジトリでも、**codex-review の codex 実行ジョブに限り** self-hosted な
codex 専用 runner（既定ラベル `codex`）を使ってよい。それ以外のジョブ・それ以外の
workflow は、可視性どおり GitHub ホステッドを使う。

## 1. 適用条件（誰が担保するか）

例外が安全に成立する条件は 3 者に分かれる。消費側リポジトリが自力で満たせるのは 3 番目だけで、
1・2 が未達なら例外を適用してはいけない。

### 1-1. workflow が強制する（呼び出し側の作業は不要）

`.github/workflows/codex-review.yml` が fail-closed で検証するため、消費側で書く必要はない。

| 条件 | 強制方法 |
|---|---|
| fork からの PR では codex ジョブを実行しない | `github.event.pull_request.head.repo.full_name == github.repository` を job の `if` で判定 |
| runner が未準備の間は実行しない | Actions variable `CODEX_HOME_DIR` が空なら job を skip（設定が唯一の有効化操作） |
| ジョブユーザーが passwordless sudo を持たない | `sudo -n true` が通ったら `::error::` で即座に失敗 |
| PR の内容がレビュー基準を書き換えない | prompt / schema を PR の checkout ではなく **base コミット**から読む |

### 1-2. runner / org 管理者が担保する

workflow からは検証できないため、runner 構築・org 設定の側で満たす。
手順は [`codex-review/README.md` の「runner 構築」](../codex-review/README.md#runner-構築)を参照。

- runner group の共有範囲を**信頼できるリポジトリに限定**する（public リポジトリを追加する
  場合も、そのリポジトリの write 権限保有者を信頼できることが前提）
- ジョブ実行ユーザーを非 root・sudo 非導入（または sudoers 非登録）にする
- `CODEX_HOME`（`auth.json`）の権限を絞る（ディレクトリ `700` / ファイル `600`）。
  `auth.json` はパスワード同等として扱う
- 専用の用途ラベル（既定 `codex`）で登録し、レビュー以外のジョブと混ぜない
- `docker.sock` をマウントしない

### 1-3. 呼び出し側リポジトリが担保する

- wrapper で `post-feedback-runner-label: ubuntu-latest` を**明示的に渡す**（次節）
- `CODEX_HOME_DIR` を org または当該リポジトリの Actions variable に設定する
- `uses:` は `@latest` で参照する（`latest` は main へ自動追従する）

## 2. public リポジトリ向け wrapper

`post-feedback-runner-label` の既定値は `self-hosted`（private リポジトリ前提）である。
そのため **public リポジトリでは明示的な上書きが必須**で、既定値のまま呼び出すと
コメント投稿ジョブが方針違反の runner に載る。

public リポジトリでは以下を `.github/workflows/codex-review.yml` として設置する。

```yaml
name: Codex PR review

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]

# reusable workflow のトップレベル concurrency は機能しないため呼び出し側で設定する
concurrency:
  group: codex-review-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  codex-review:
    uses: Fandhe-AI/actions/.github/workflows/codex-review.yml@latest
    permissions:
      contents: read
      pull-requests: write
    with:
      # 資格情報に触れないコメント投稿ジョブは可視性どおりホステッドへ寄せる
      # （既定値 `self-hosted` は private リポジトリ前提のため上書きが必須）
      post-feedback-runner-label: ubuntu-latest
      # runner-label は既定 `codex` のままにする。ここを ubuntu-latest に
      # 「修正」すると CODEX_HOME が存在せず認証が壊れ、例外の対象外にもなる
```

参照は `@latest` のまま使う（`latest` は main へ自動追従する。詳細は
[ルート README](../README.md#使い方)）。

ジョブごとの runner の対応:

| ジョブ | runner | 理由 |
|---|---|---|
| `codex`（`runner-label`） | self-hosted codex 専用ラベル（既定 `codex`） | **例外の対象**。codex-home 方式の認証はホステッドでは成立しない |
| `post_feedback`（`post-feedback-runner-label`） | `ubuntu-latest` を明示指定 | 資格情報に触れないため例外の対象外。可視性どおりの方針に従う |

## 3. 例外が及ばない範囲

この例外は **codex-review の codex 実行ジョブのみ**に閉じる。以下は例外の根拠にならない。

- `pages-deploy` をはじめ、本リポジトリの他の reusable workflow を public リポジトリで
  self-hosted にすること（`pages-deploy` の `runner-label` も既定 `self-hosted` のため、
  public から呼ぶ場合は `ubuntu-latest` を明示する）
- codex-review の `post_feedback` ジョブを self-hosted にすること
- 「codex-review が self-hosted なのだから他の CI も揃えたい」という同一化
- 例外を根拠に、codex runner のプールへレビュー以外のジョブを流すこと

fork からの PR は codex ジョブが skip される。public リポジトリでは fork PR が主要な
経路になりうるため、gate（P0/P1 でのジョブ失敗）を required status check にする場合は
skip の扱いを branch protection 側で設計すること。

## 4. 消費側の規約から参照する

消費側リポジトリの CI 規約（例: `fandhe-frontend` の `.claude/rules/ci.md`）には、
方針を書き写さず**参照だけ**を置く。書き写すと本リポジトリ側の更新から取り残される。

```markdown
## runner 方針

- 本リポジトリは public のため、GitHub ホステッド（`ubuntu-latest`）を既定とする。
- 唯一の例外は `codex-review` の codex 実行ジョブ（self-hosted な codex 専用 runner）。
  適用条件・wrapper の書き方・例外が及ばない範囲は
  [Fandhe-AI/actions `docs/codex-review-runner-exception.md`](https://github.com/Fandhe-AI/actions/blob/main/docs/codex-review-runner-exception.md)
  に従う（組織方針の原典は同リポジトリ `docs/runner-policy.md`）。
- 上記以外のジョブで `runs-on: self-hosted` を書かない。必要が生じたら
  `docs/runner-policy.md` の更新から始める。
```

## 関連

- [`runner-policy.md`](runner-policy.md) — 組織 runner 方針（原典）
- [`codex-review/README.md`](../codex-review/README.md) — 導入手順・runner 構築・Inputs
- [`pages-deploy/README.md`](../pages-deploy/README.md) — 同じく `runner-label` の既定が `self-hosted`
