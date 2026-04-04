# project-sync

Issue/PR の状態変更を GitHub Project (V2) の Status フィールドに自動同期する Composite Action。

## 前提条件

- GitHub Project (V2) が対象リポジトリにリンク済み
- Status フィールドに Todo / In Progress / In Review / Done オプションが存在（カスタム名は inputs で指定可能）
- project スコープ付きの **fine-grained PAT** または **GitHub App トークン** を発行済み

## セットアップ

### 1. Secrets を登録

リポジトリの Settings → Secrets and variables → Actions に以下を追加：

| Secret 名 | 値 |
|---|---|
| `PROJECT_TOKEN` | project / issues / pull_requests スコープ付き fine-grained PAT |

> **Organization 向け（推奨）:** GitHub App を作成し `Projects: Read and write` 権限を付与する方式もあります。

### 2. ワークフローファイルを作成

`.github/workflows/project-sync.yml` を作成：

#### PAT を使用する場合

```yaml
name: Project Sync

on:
  issues:
    types: [opened, closed, reopened]
  pull_request:
    types: [opened, closed, ready_for_review, review_requested]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Sync project status
        uses: Fandhe-AI/actions/project-sync@<SHA> # main
        with:
          project-number: '5'
          project-owner: 'Fandhe-AI'
          token: ${{ secrets.PROJECT_TOKEN }}
```

#### GitHub App を使用する場合（推奨）

```yaml
name: Project Sync

on:
  issues:
    types: [opened, closed, reopened]
  pull_request:
    types: [opened, closed, ready_for_review, review_requested]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Generate token
        id: token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ vars.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          owner: Fandhe-AI

      - name: Sync project status
        uses: Fandhe-AI/actions/project-sync@<SHA> # main
        with:
          project-number: '5'
          project-owner: 'Fandhe-AI'
          token: ${{ steps.token.outputs.token }}
```

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `project-number` | Yes | - | GitHub Project 番号 |
| `project-owner` | Yes | - | プロジェクトオーナー（Organization or ユーザー） |
| `token` | Yes | - | project スコープ付き PAT or GitHub App トークン |
| `status-todo` | No | `Todo` | Todo に対応する Status オプション名 |
| `status-in-progress` | No | `In Progress` | In Progress に対応する Status オプション名 |
| `status-in-review` | No | `In Review` | In Review に対応する Status オプション名 |
| `status-done` | No | `Done` | Done に対応する Status オプション名 |

## ステータスマッピング

| イベント | アクション | Status |
|---------|----------|--------|
| Issue | opened | Todo |
| Issue | closed | Done |
| Issue | reopened | Todo |
| PR | opened | In Progress |
| PR | ready_for_review | In Review |
| PR | review_requested | In Review |
| PR | closed (merged) | Done |
| PR | closed (not merged) | Todo |

## カスタムステータス名

Status オプション名がデフォルトと異なる場合は inputs で指定できます：

```yaml
- name: Sync project status
  uses: Fandhe-AI/actions/project-sync@<SHA> # main
  with:
    project-number: '5'
    project-owner: 'Fandhe-AI'
    token: ${{ secrets.PROJECT_TOKEN }}
    status-todo: 'バックログ'
    status-in-progress: '作業中'
    status-in-review: 'レビュー中'
    status-done: '完了'
```

## SHA の更新方法

セキュリティのため、Action は `@main` ではなくコミット SHA で固定しています。
`actions` リポジトリを更新した場合は、以下の手順で SHA を更新してください：

```bash
# actions リポジトリの最新コミット SHA を取得
git ls-remote https://github.com/Fandhe-AI/actions.git HEAD

# ワークフロー内の SHA を新しい値に置き換え
```

## 注意事項

- **PAT の有効期限**: fine-grained PAT は最大1年。定期ローテーション推奨
- **ビルトインワークフローとの併用**: Project の built-in ワークフロー（closed→Done, merged→Done）と二重発火するが、同じ値への更新なので実害なし
- **PR ライフサイクル**: built-in は closed/merged のみ。opened→In Progress, review_requested→In Review はこの Action でのみ自動化可能
- **`actions` リポジトリのアクセス**: org の Settings → Actions → General でプライベートリポジトリからの Action 共有を許可する必要あり
