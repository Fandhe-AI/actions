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
        uses: Fandhe-AI/actions/post-comment@latest
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
        uses: Fandhe-AI/actions/post-comment@latest
        with:
          issue-number: ${{ github.event.issue.number }}
          body: 'Issue を作成いただきありがとうございます！'
          token: ${{ secrets.GITHUB_TOKEN }}
```

#### 例3: クロスリポジトリコメント

```yaml
- name: Notify upstream
  uses: Fandhe-AI/actions/post-comment@latest
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

## 参照バージョン（`@latest`）

`Fandhe-AI/actions` は可変タグ `@latest` で参照する。`latest` は main への push ごとに
`.github/workflows/move-latest-tag.yml` が付け替えるため、呼び出し側で参照を更新する作業は不要である。
第三者の action（`actions/checkout` 等）は従来どおりコミット SHA で固定する。

## 注意事項

- **PAT の有効期限**: fine-grained PAT は最大1年。定期ローテーション推奨
- **PAT 発行者の異動・退職**: 再発行が必要
- **`actions` リポジトリのアクセス**: `actions` は public のため共有設定（提供側）は不要。ただし利用側の org / リポジトリの Settings → Actions → General で外部 Action の利用が制限されている場合は許可が必要
