# post-comment

Issue または PR にコメントを投稿する Composite Action。

GitHub のデータモデルでは PR も Issue の一種であるため、`gh issue comment` を使用して両方に対応しています。

## 前提条件

- コメント投稿に使用するトークン（`GITHUB_TOKEN` または fine-grained PAT）を発行済み
  - Issue へのコメント: Issues Read/Write 権限
  - PR へのコメント: Pull requests Read/Write 権限
  - クロスリポジトリの場合: 対象リポジトリへのアクセス権を持つ fine-grained PAT

## セットアップ

### 1. Secrets を登録

リポジトリの Settings → Secrets and variables → Actions に以下を追加：

| Secret 名 | 値 |
|---|---|
| `COMMENT_TOKEN` | fine-grained PAT（クロスリポジトリや外部サービス連携の場合） |

> **Note:** 同一リポジトリ内のコメントであれば `${{ secrets.GITHUB_TOKEN }}` でも可能です。

### 2. ワークフローファイルを作成

#### 例1: PR への自動コメント

```yaml
name: PR Comment

on:
  pull_request:
    types: [opened]

jobs:
  comment:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - name: Post PR comment
        uses: Fandhe-AI/actions/post-comment@<SHA> # main
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body: 'PR を作成いただきありがとうございます！'
          token: ${{ secrets.GITHUB_TOKEN }}
```

#### 例2: Issue への自動コメント

```yaml
name: Issue Welcome

on:
  issues:
    types: [opened]

jobs:
  welcome:
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - name: Post welcome comment
        uses: Fandhe-AI/actions/post-comment@<SHA> # main
        with:
          issue-number: ${{ github.event.issue.number }}
          body: 'Issue を作成いただきありがとうございます！'
          token: ${{ secrets.GITHUB_TOKEN }}
```

#### 例3: クロスリポジトリコメント

```yaml
- name: Notify upstream
  uses: Fandhe-AI/actions/post-comment@<SHA> # main
  with:
    issue-number: '42'
    body: 'Downstream の修正が完了しました。'
    token: ${{ secrets.CROSS_REPO_PAT }}
    repository: 'Fandhe-AI/upstream-repo'
```

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `issue-number` | Yes | - | Issue または PR の番号 |
| `body` | Yes | - | コメント本文 |
| `token` | Yes | - | コメント投稿に使用するトークン（PAT または GITHUB_TOKEN） |
| `repository` | No | `$GITHUB_REPOSITORY` | 対象リポジトリ（OWNER/REPO 形式） |

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
- **PAT 発行者の異動・退職**: 再発行が必要
- **`actions` リポジトリのアクセス**: org の Settings → Actions → General でプライベートリポジトリからの Action 共有を許可する必要あり
