# Fandhe-AI/actions

Fandhe-AI Organization 向けの再利用可能な GitHub Composite Actions・reusable workflow。

## アクション一覧

| アクション | 説明 |
|---|---|
| [cargo-tool-install](cargo-tool-install/) | cargo ツールをバージョン固定（`--locked`）・冪等にインストールする |
| [post-comment](post-comment/) | Issue または PR にコメントを投稿する |
| [idempotent-issue](idempotent-issue/) | ラベルを冪等に作成し、同一検索条件の open Issue が存在しない場合のみ Issue を起票する |
| [project-sync](project-sync/) | Issue/PR の状態変更を GitHub Project (V2) の Status フィールドに自動同期する |
| [submodule-update](submodule-update/) | git submodule を最新に追従させ、変更があれば PR を自動作成する |
| [skills-update](skills-update/) | `npx skills` で導入したエージェントスキルを最新に更新し、変更があれば PR を自動作成する |
| [codex-review](codex-review/) | OpenAI Codex CLI による PR 自動レビュー（reusable workflow。ChatGPT ログイン済み self-hosted runner で動作、P0/P1 検出時に CI 失敗） |
| [pages-deploy](pages-deploy/) | GitHub Pages への deploy（reusable workflow。呼び出し側 build ジョブの dist を artifact で受け取り、Pages artifact 変換〜deploy まで担う） |

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
4. 複数ジョブ・runner 選択・permissions 分離が必要な場合は reusable workflow
   （`.github/workflows/<name>.yml` + `<name>/` に付随ファイルと README）として実装
