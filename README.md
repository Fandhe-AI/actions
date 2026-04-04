# Fandhe-AI/actions

Fandhe-AI Organization 向けの再利用可能な GitHub Composite Actions。

## アクション一覧

| アクション | 説明 |
|---|---|
| [post-comment](post-comment/) | Issue または PR にコメントを投稿する |
| [project-sync](project-sync/) | Issue/PR の状態変更を GitHub Project (V2) の Status フィールドに自動同期する |

## 使い方

セキュリティのため、Action は `@main` ではなくコミット SHA で固定して参照します：

```yaml
steps:
  - uses: Fandhe-AI/actions/post-comment@<SHA> # main
    with:
      issue-number: ${{ github.event.issue.number }}
      body: 'コメント本文'
      token: ${{ secrets.GITHUB_TOKEN }}
```

最新の SHA は以下で取得できます：

```bash
git ls-remote https://github.com/Fandhe-AI/actions.git HEAD
```

## 前提条件

- プライベートリポジトリから利用する場合、org の **Settings → Actions → General** で Action 共有を許可する必要あり
- 各アクションに必要なトークン権限は個別の README を参照

## 新しいアクションの追加

1. ディレクトリを作成（lowercase + hyphen: `action-name/`）
2. `action.yml` と `README.md` を配置
3. Composite Action（bash + `gh` CLI）で実装
