# lint-docs

ドキュメント／設定ファイル系の lint（markdownlint・editorconfig-checker・yamllint・
commitlint）を束ねた reusable workflow。各リポジトリで個別実装されていた lint ジョブ
（`local-server` の check-pr.yml、`team-hub` の ci.yml、`agent-*-skills` の `npx` 直呼び）を
1 箇所へ集約し、外部 action の SHA 固定とツールのバージョン追随を共通側で引き受ける。

- 各 lint は**独立ジョブ**で、boolean input により個別に有効／無効を切り替えられる
- **reviewdog は opt-in**（既定 `false`）。無効時は linter の終了コードでジョブを失敗させる
  通常の CI として振る舞い、`pull_request` 以外のイベントでも使える
- **runner は呼び出し元が指定**する（`runner-label`）。public（GitHub ホステッド）／
  private（self-hosted）の両文化圏から利用できる
- 使用する外部 action はすべてコミット SHA 固定。lint ツール本体のバージョンも
  既定値で固定し、`latest` を使わない（サプライチェーン対策）

## 前提条件

1. `runner-label` に指定した runner が利用可能であること（既定は `ubuntu-latest`。
   fandhe 系 private リポジトリでは `self-hosted` 等を明示指定する）
2. runner に `node` / `python` のセットアップ用 action が動作する環境があること
   （本 workflow が `actions/setup-node` / `actions/setup-python` を実行する）
3. `reviewdog: true` で使う場合、呼び出し側の `uses:` ジョブに
   `pull-requests: write` を付与すること（後述）

各 linter の除外・ルール設定は**呼び出し側リポジトリの設定ファイル**を参照する:

| linter | 設定ファイル |
|---|---|
| markdownlint | `.markdownlint.yaml` / `.markdownlint.json` 等、除外は `.markdownlintignore` |
| editorconfig-checker | `.editorconfig` + `.editorconfig-checker.json` |
| yamllint | `.yamllint` / `.yamllint.yaml` / `.yamllint.yml`（自動探索。`yamllint-config` で明示も可） |
| commitlint | `commitlint.config.js` 等（**無くても動く**。既定で `@commitlint/config-conventional` を `--extends` する） |

## セットアップ

### 1. reviewdog なし（プレーン CI。違反でジョブが失敗する）

```yaml
name: lint

on:
  pull_request:

permissions:
  contents: read

# reusable workflow のトップレベル concurrency は機能しないため呼び出し側で設定する
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  lint-docs:
    permissions:
      contents: read
    uses: Fandhe-AI/actions/.github/workflows/lint-docs.yml@<SHA> # main
```

### 2. reviewdog あり（PR にインラインコメント。self-hosted runner）

```yaml
jobs:
  lint-docs:
    permissions:
      contents: read
      # reviewdog: true のときのみ必要（PR へのコメント投稿に使う）
      pull-requests: write
    uses: Fandhe-AI/actions/.github/workflows/lint-docs.yml@<SHA> # main
    with:
      runner-label: self-hosted
      reviewdog: true
```

### 3. push でも動かす場合（commitlint / reviewdog をイベントで切り替える）

`commitlint` と `reviewdog` は PR の情報（commit 範囲・レビューコメント先）を必要とするため
`pull_request` イベント専用で、それ以外のイベントでは **fail-closed でエラー**になる。
`on: [pull_request, push]` の wrapper では次のように切り替える:

```yaml
on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint-docs:
    permissions:
      contents: read
      pull-requests: write
    uses: Fandhe-AI/actions/.github/workflows/lint-docs.yml@<SHA> # main
    with:
      # push では commitlint / reviewdog を無効化する
      commitlint: ${{ github.event_name == 'pull_request' }}
      reviewdog: ${{ github.event_name == 'pull_request' }}
```

`<SHA>` は本リポジトリのコミット SHA で固定する（`@main` 不可。更新方法は後述）。

## Inputs

### 実行環境

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `runner-label` | - | `ubuntu-latest` | 全 lint ジョブを実行する runner ラベル。private は `self-hosted` 等を指定 |
| `timeout-minutes` | - | `15` | 各 lint ジョブの timeout（分） |
| `node-version` | - | `lts/*` | markdownlint / commitlint が使う Node.js のバージョン |
| `python-version` | - | `3.x` | yamllint が使う Python のバージョン |

### lint の有効／無効

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `markdownlint` | - | `true` | markdownlint-cli による Markdown lint |
| `editorconfig` | - | `true` | editorconfig-checker による EditorConfig 準拠チェック |
| `yamllint` | - | `true` | yamllint による YAML lint |
| `commitlint` | - | `true` | commitlint による Conventional Commits 検証（`pull_request` 専用） |

### reviewdog

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `reviewdog` | - | `false` | markdownlint / yamllint の指摘を PR へインラインコメントする（`pull_request` 専用） |
| `reviewdog-reporter` | - | `github-pr-review` | `-reporter`。`github-pr-review` / `github-pr-check` / `github-check` / `local` のみ許可 |
| `reviewdog-filter-mode` | - | `added` | `-filter-mode`（`added` / `diff_context` / `file` / `nofilter`） |
| `reviewdog-level` | - | `warning` | `-level`（`info` / `warning` / `error`） |
| `reviewdog-fail-level` | - | `none` | `-fail-level`。既定の `none` は「コメントは出すがジョブは落とさない」段階導入向け |
| `reviewdog-version` | - | `v0.21.0` | reviewdog 本体の固定バージョン |

### 各 lint の詳細設定

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `markdownlint-version` | - | `0.49.1` | markdownlint-cli の固定バージョン |
| `markdownlint-globs` | - | `**/*.md` | 検査対象の glob（**改行区切りで複数指定可**）。除外は `.markdownlintignore` |
| `editorconfig-checker-version` | - | `v3.8.0` | editorconfig-checker 本体の release タグ |
| `yamllint-version` | - | `1.38.0` | yamllint の固定バージョン |
| `yamllint-targets` | - | `.` | 検査対象パス（**改行区切りで複数指定可**） |
| `yamllint-config` | - | （空） | `-c` に渡す設定ファイル。空なら yamllint の自動探索に任せる |
| `commitlint-version` | - | `21.2.1` | `@commitlint/cli` の固定バージョン |
| `commitlint-config-version` | - | `21.2.0` | `@commitlint/config-conventional` の固定バージョン |
| `commitlint-extends` | - | `@commitlint/config-conventional` | `--extends` に渡す共有設定。空にすると渡さない |

## SHA の更新方法

```bash
# 最新の main の SHA を確認
gh api repos/Fandhe-AI/actions/commits/main --jq '.sha'
```

呼び出し側 wrapper の `uses: Fandhe-AI/actions/.github/workflows/lint-docs.yml@<SHA>` を更新する。

本 workflow が内部で使う外部 action の SHA を更新する場合は、タグの実コミット SHA を
API で解決して使う（値をでっち上げない）:

```bash
# 例: reviewdog/action-setup の v1.5.0 タグのコミット SHA を解決
gh api repos/reviewdog/action-setup/git/ref/tags/v1.5.0 --jq '.object'
# .object.type が "tag"（annotated tag）の場合はもう 1 段 dereference する
gh api repos/reviewdog/action-setup/git/tags/<tag-object-sha> --jq '.object.sha'
```

## 注意事項

### permissions

- **`reviewdog: true` のときだけ呼び出し側 `uses:` ジョブに `pull-requests: write` を付与する。**
  reusable workflow のジョブが宣言した `permissions` は呼び出し側が付与した権限を**絞る方向に
  しか働かない**ため、`markdownlint` / `yamllint` ジョブでは job-level `permissions` を
  **あえて宣言していない**（`permissions:` は式を書けず「reviewdog のときだけ write」という
  条件付き宣言ができないため、呼び出し側の付与をそのまま継承する設計）。
  権限要件が無条件に決まる `editorconfig` / `commitlint` ジョブは `contents: read` を明示する
- 呼び出し側の `uses:` ジョブに `contents: read` は常に必要（checkout のため）

### イベント制約

- `commitlint` / `reviewdog` は `pull_request` イベント専用。それ以外では**黙ってスキップせず
  エラーで停止**する（検証したつもりで検証されていない状態を避けるため）。
  `on: [pull_request, push]` の wrapper では上記セットアップ例 3 の書き方で切り替える
- **fork からの PR では reviewdog への報告を自動的にスキップ**し、診断のログ出力のみに
  フォールバックする（fork PR の `GITHUB_TOKEN` は read-only で `github-pr-*` reporter が
  403 になるため）。スキップした事実は `::notice::` でログに残る

### 出力・失敗の挙動

- 診断内容は reviewdog の有無にかかわらず**必ずジョブログに出力**する
  （reviewdog へ渡すだけでログに出さないと「理由の見えない赤」になるため）
- linter 出力は `::stop-commands::` で挟んで流すため、リポジトリ内のファイル名や内容に
  `::error::` 等が含まれても workflow command として解釈されない
- reviewdog はステップ最後のコマンドとして実行し、終了コードを伝播させる
  （`|| true` で握り潰さないため、403 等の報告失敗がパスに見えることはない）
- reviewdog 無効時は linter の終了コードがそのままジョブの成否になる
- **linter 自体の実行失敗（設定ファイル不正・引数誤り等）は fail-open させない。**
  markdownlint-cli は「違反検出」も「設定ファイル不正」も同じ終了コード `1` を返すため、
  `reviewdog-fail-level: none` と組み合わせると「何も報告されないまま緑」になりうる。
  本 workflow は非 0 終了かつ解析可能な診断行が 1 件も無い場合をツールの実行失敗と
  みなしてジョブを失敗させる

### その他

- **`concurrency` は呼び出し側で設定する**（reusable workflow のトップレベル
  `concurrency` は機能しない）。PR 単位でグループ化する場合、`head_ref` だけだと
  fork PR や同名ブランチで別 PR のチェックを誤ってキャンセルしうるため
  PR 番号を含める（セットアップ例参照）
- `runner-label` は**単一ラベルの文字列**。`runs-on` の配列形式（複数ラベルの AND 指定）
  には対応しない
- markdownlint は `npx` ではなくジョブ専用ディレクトリ（`$RUNNER_TEMP`）への
  インストール後に直接実行する。`npx` は初回実行時のインストール警告を **stderr** へ出し、
  markdownlint の診断（同じく stderr）と混ざって reviewdog の解析へ流れ込むため
- Docker コンテナ型 action は使っていない（`editorconfig-checker` の action は
  `runs.using: node24`、`reviewdog/action-setup` はバイナリ配置のみ）。
  Docker-out-of-Docker 構成の self-hosted runner でも動作する
