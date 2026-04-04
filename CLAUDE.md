# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリ概要

Fandhe-AI Organization 向けの再利用可能な GitHub Composite Actions を管理するリポジトリ。

## アーキテクチャ

- 各アクションは独自のディレクトリに `action.yml` + `README.md` のペアで構成
- すべて Composite Action（`runs.using: composite`）で、bash + `gh` CLI のみで実装（Docker/Node.js 不使用）
- 入力値は `env:` 経由でシェル変数に渡す（`${{ inputs.* }}` を直接 `run:` に埋め込まない）

## アクション一覧

| ディレクトリ | 用途 |
|---|---|
| `post-comment/` | Issue/PR へのコメント投稿（`gh issue comment`） |
| `project-sync/` | Issue/PR の状態変更を GitHub Project (V2) の Status に自動同期 |

## コミット規約

- **Conventional Commits** 形式: `type(scope): subject`
- type: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `style`, `build`, `ci`, `perf`
- subject は日本語可
- Co-author: `Co-Authored-By: Claude <noreply@anthropic.com>`
- `--no-verify` 禁止

## 利用側の参照方法

セキュリティのためコミット SHA で固定（`@main` 不可）:

```yaml
uses: Fandhe-AI/actions/post-comment@<SHA> # main
```

## README 規約

各アクションの README.md は以下の構造に統一:

1. タイトル・概要
2. 前提条件
3. セットアップ（Secrets 登録 → ワークフロー例）
4. Inputs テーブル（名前 / 必須 / デフォルト / 説明）
5. SHA の更新方法
6. 注意事項

ドキュメントは日本語で記述する。
