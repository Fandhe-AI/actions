# skills-update

`npx skills` で導入したエージェントスキルを最新に追従させ、変更があれば PR を自動作成する Composite Action。

`schedule:` (cron) と組み合わせて定期実行することで、upstream のスキル更新を検知して自動的に PR を起票します。`submodule-update` のスキル版にあたります。

> 内部では `npx skills update --project --yes` を実行し、`skills-lock.json` の `computedHash` 差分から更新されたスキルを特定します。

## 前提条件

- 対象リポジトリで `npx skills add` 済み（ルートに `skills-lock.json` が存在し、`.claude/skills/` 等が管理されている）
- 呼び出しワークフローで `actions/checkout@v4` を実行済みであること
- ランナーに Node.js / npx が利用可能であること（`ubuntu-latest` には標準搭載）
- push と PR 作成に必要なトークンを用意
  - スキルのソースが public で、**生成 PR の CI 発火・auto-merge が不要**な場合: `GITHUB_TOKEN` (ワークフロー側で `contents: write` / `pull-requests: write` permission を付与)
  - private なソースリポジトリ（例: `Fandhe-AI/agent-cli-skills`）を含む場合: fine-grained PAT (contents: write / pull-requests: write、およびソースリポジトリへの read 権限)
  - **生成 PR で後続 CI を走らせたい / 必須チェック付きで auto-merge したい場合**: `GITHUB_TOKEN` ではなく fine-grained PAT もしくは GitHub App トークン（`GITHUB_TOKEN` 起因の PR は後続 workflow をトリガーしない GitHub 仕様のため。後述の[注意事項](#注意事項)参照）

## セットアップ

### 1. Secrets を登録

リポジトリの Settings → Secrets and variables → Actions に以下を追加（PAT 利用時のみ）:

| Secret 名 | 値 |
|---|---|
| `SKILLS_PAT` | fine-grained PAT（private なスキルソース利用時） |

### 2. ワークフローファイルを作成

#### 例1: 毎週月曜 09:00 JST にスキルを更新

```yaml
name: Update skills

on:
  schedule:
    - cron: '0 0 * * 1'   # 毎週月曜 00:00 UTC = 09:00 JST
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: Fandhe-AI/actions/skills-update@<SHA> # main
        with:
          token: ${{ secrets.SKILLS_PAT }}
```

#### 例2: 特定スキルのみを更新

```yaml
- uses: Fandhe-AI/actions/skills-update@<SHA> # main
  with:
    token: ${{ secrets.SKILLS_PAT }}
    skills: 'create-commit, create-pr'
    pr-labels: 'dependencies,automated'
```

#### 例3: private なソースリポジトリを別トークンで取得

push/PR 用と、スキルソース取得用のトークンを分けたい場合:

```yaml
- uses: Fandhe-AI/actions/skills-update@<SHA> # main
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    source-token: ${{ secrets.SKILLS_SOURCE_PAT }}
```

> この例は `auto-merge` を使わない構成のため push/PR 用に `GITHUB_TOKEN` を使えます。
> `auto-merge` や生成 PR の CI 発火が必要な場合は `token` を PAT / GitHub App トークンに
> 変えてください（[注意事項](#注意事項)参照）。

#### 例4: 自動マージを有効化（`vars` で制御）

PR 作成後、条件を満たせば自動的にマージできます。ON/OFF と allowlist は repository
variables で制御し、ワークフロー側はそれを渡すだけで済みます。

> **重要**: `auto-merge` を使うなら `token` に `GITHUB_TOKEN` を渡さないでください。
> `GITHUB_TOKEN` で作成した PR は後続 workflow（CI）を発火しないため、必須チェック付き
> auto-merge がキューに残り続けるか、未検証のまま merge されます（[注意事項](#注意事項)参照）。
> fine-grained PAT または GitHub App トークンを使ってください。

```yaml
- name: Update skills and open PR
  uses: Fandhe-AI/actions/skills-update@<SHA> # main
  with:
    token: ${{ secrets.SKILLS_PAT }}
    base-branch: main
    auto-merge: ${{ vars.SKILLS_AUTO_MERGE }}
    auto-merge-allowlist: ${{ vars.SKILLS_AUTO_MERGE_ALLOWLIST }}
    auto-merge-strategy: squash
```

#### 例5: GitHub App トークンで CI を発火させつつ auto-merge

`actions/create-github-app-token` で発行した App トークンを使うと、生成 PR が後続 CI を
発火するため、必須ステータスチェック付きの auto-merge を正しくキューできます。

```yaml
jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/create-github-app-token@<SHA>
        id: app-token
        with:
          app-id: ${{ vars.AUTOMATION_APP_ID }}
          private-key: ${{ secrets.AUTOMATION_APP_PRIVATE_KEY }}
      - uses: actions/checkout@v4
      - uses: Fandhe-AI/actions/skills-update@<SHA> # main
        with:
          token: ${{ steps.app-token.outputs.token }}
          auto-merge: ${{ vars.SKILLS_AUTO_MERGE }}
          auto-merge-allowlist: ${{ vars.SKILLS_AUTO_MERGE_ALLOWLIST }}
```

> private なスキルソースの取得には別途 `source-token` に read 権限付き PAT を渡してください
> （App トークンがソースリポジトリにアクセスできない場合）。

repository variables（Settings → Secrets and variables → Actions → Variables）:

| Variable 名 | 例 | 説明 |
|---|---|---|
| `SKILLS_AUTO_MERGE` | （未設定）/ `false` | **未設定なら自動マージ有効**。無効化したいときだけ `false` 等を設定 |
| `SKILLS_AUTO_MERGE_ALLOWLIST` | `create-*` | 自動マージを許可するスキル名（未指定なら全許可） |

> **注意（空＝有効 / 既定＝無効 の非対称）**: `auto-merge` input は既存互換のため
> 既定値が `'false'`（＝input を一切渡さなければ自動マージしない）ですが、空文字を
> 渡した場合は「有効」に倒します。これは consumer が `${{ vars.SKILLS_AUTO_MERGE }}`
> を渡し、**variable 未設定（空文字）＝有効** としたいためです。
> 自動マージを使わないなら `auto-merge` input を渡さないでください。

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `token` | Yes | - | push と PR 作成に使うトークン (contents: write, pull-requests: write)。**生成 PR で CI を発火 / auto-merge する場合は `GITHUB_TOKEN` 不可**、fine-grained PAT または GitHub App トークンを渡す |
| `source-token` | No | `` (token を流用) | private なスキルソースリポジトリの取得に使うトークン |
| `base-branch` | No | `main` | PR の向き先ブランチ |
| `branch-prefix` | No | `chore/skills-update` | 自動生成するブランチ名の prefix。最終ブランチ名は `{prefix}-{YYYYMMDD}` (UTC) |
| `skills` | No | `` (全スキル) | 更新対象のスキル名 (改行/カンマ/空白区切り) |
| `skills-version` | No | `` (latest) | 使用する `skills` CLI のバージョン (npm semver) |
| `commit-message` | No | `chore: エージェントスキルを最新に更新` | コミットメッセージ |
| `pr-title` | No | `chore: エージェントスキルを最新に更新` | PR タイトル |
| `pr-body` | No | 自動生成 | PR 本文。空時は変更サマリを自動挿入 |
| `pr-labels` | No | `` | PR に付与するラベル (カンマ区切り) |
| `git-user-name` | No | `github-actions[bot]` | コミット作成者名 |
| `git-user-email` | No | `41898282+github-actions[bot]@users.noreply.github.com` | コミット作成者メール |
| `auto-merge` | No | `false` | 自動マージの ON/OFF。`''`(空)/`true`/`yes`/`on`/`1`/`enabled` → 有効、`false`/`no`/`off`/`0`/`disabled` → 無効、解釈不能値は安全側で無効。**input 既定は `false` だが空文字は「有効」**（上記の非対称を参照） |
| `auto-merge-allowlist` | No | `` (全許可) | 自動マージを許可するスキル名。改行/カンマ区切り、各エントリは biome scanner 準拠 glob（下記） |
| `auto-merge-strategy` | No | `squash` | マージ戦略 (`squash`/`rebase`/`merge`) |
| `auto-merge-immediate-fallback` | No | `true` | `gh pr merge --auto` が `allow_auto_merge:false` で失敗した時に即時マージへフォールバックするか |

## Outputs

| 名前 | 説明 |
|---|---|
| `has-changes` | スキルに更新があったかどうか (`true`/`false`) |
| `updated-skills` | 更新されたスキル名の一覧（改行区切り） |
| `branch-name` | 自動生成したブランチ名 |
| `pr-url` | 作成または更新した PR の URL |
| `merged` | auto-merge を実行（有効化 or 即時マージ）したかどうか (`true`/`false`) |
| `auto-merge-skipped-reason` | スキップ時の理由。`disabled` / `unparseable-switch` / `unknown-skills` / `not-allowlisted` のいずれか |

## allowlist の glob 仕様（biome scanner 準拠）

[biome scanner](https://biomejs.dev/reference/configuration/#interaction-with-the-scanner) のセマンティクスに準拠します。判定対象は **action が更新したスキル名**（`skills-lock.json` の `computedHash` 差分から特定）です。

- `*` … パスセパレータ `/` を**跨がない**任意文字列
- `**` … セパレータを**跨ぐ**任意文字列
- `?` … セパレータ以外の 1 文字
- 先頭 `!` … negation（除外）。後続パターンで再包含も可
- **順次評価・last-match-wins**: 最後にマッチしたパターンで決まる。どのパターンにもマッチしなければ**不許可**

| パターン | 意味 |
|---|---|
| （未指定） | 全スキルを許可 |
| `create-*` | `create-` で始まるスキルを許可 |
| `*` | 全スキルを許可（明示） |
| `*,!implement-*` | `implement-` で始まるスキル以外を全許可 |
| `*,!create-pr,create-commit` | `create-pr` を除外しつつ `create-commit` だけ再許可（例外の例外） |

判定は **PR 単位**で行われ、今回更新したスキルが**すべて** allowlist を通った時だけマージします。1 つでも対象外なら手動レビュー（マージしない）。allowlist 指定済みなのに更新スキルを特定できない場合も安全側で手動レビューになります。

## SHA の更新方法

セキュリティのため、Action は `@main` ではなくコミット SHA で固定しています。
`actions` リポジトリを更新した場合は、以下の手順で SHA を更新してください：

```bash
# actions リポジトリの最新コミット SHA を取得
git ls-remote https://github.com/Fandhe-AI/actions.git HEAD

# ワークフロー内の SHA を新しい値に置き換え
```

## 注意事項

- ブランチ名は `{branch-prefix}-{YYYYMMDD}` 形式で **自動生成** (UTC 日付)。同日中の再実行では `--force-with-lease` で既存ブランチを上書きし、既存 PR を更新します。日をまたぐと新しい PR が起票されます
- スキルのソースに private リポジトリを含む場合は `GITHUB_TOKEN` では不足するため、ソースへの read 権限を持つ fine-grained PAT を `token`（または `source-token`）に渡してください
- `npx skills update` は `--project` スコープで実行され、global（ユーザーレベル）スキルは更新しません
- `skills-version` を指定しない場合は `skills` CLI の latest を都度取得します。再現性が必要なら明示的に pin してください
- `base-branch` に branch protection がある場合、PR マージには追加のレビュー設定が必要
- 同名ブランチに人間が直接 push している場合、`--force-with-lease` が失敗する可能性があります。自動更新専用のブランチ prefix を維持してください
- **`GITHUB_TOKEN` で作成した PR は後続 workflow（`pull_request` トリガーの CI 等）を発火しません**（GitHub の再帰防止仕様）。このため `token: ${{ secrets.GITHUB_TOKEN }}` のまま `auto-merge` を使うと、(1) branch protection で必須ステータスチェックを要求している場合はチェックが永遠に走らず auto-merge した PR がキューに残り続ける、(2) 必須チェックが無い場合は CI 未実行のまま merge される、という不具合が起きます。**生成 PR で CI を走らせたい / 必須チェック付きで auto-merge したい場合は、fine-grained PAT もしくは `actions/create-github-app-token` で発行した GitHub App トークンを渡してください**（例5 参照）。本 Action は `auto-merge` 有効時に `GITHUB_TOKEN`（API ログインが `github-actions[bot]`）を検出すると `::warning::` を出します
- **auto-merge に渡す token は fine-grained PAT（`contents: write` + `pull-requests: write`）または GitHub App トークンを推奨**します。`gh pr merge --auto` を使うにはリポジトリの "Allow auto-merge" 設定が必要です（無効でも `auto-merge-immediate-fallback: true` なら即時マージにフォールバックします）
- `auto-merge-immediate-fallback`（既定 `true`）が有効な場合、`--auto` が使えない環境では**必須チェックやレビューの完了を待たずに即時マージ**します。レビューや CI を必須にしたい場合は `base-branch` に branch protection（required status checks / required reviews）を設定するか、`auto-merge-immediate-fallback: false` を指定してください
- `auto-merge` の既定値は `false`（input を渡さなければ従来どおり自動マージしない）ですが、**空文字を渡すと「有効」** に解釈されます。`${{ vars.SKILLS_AUTO_MERGE }}` を渡して「variable 未設定＝有効」とする運用を想定した非対称です
