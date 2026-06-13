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
| `submodule-update/` | git submodule を最新に追従させ、変更があれば PR を自動作成 |
| `skills-update/` | `npx skills` 導入のエージェントスキルを最新に更新し、変更があれば PR を自動作成 |

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

## 委譲方針（必読）

main コンテキストの消費を抑えるため、調査・実装・レビューは subagent へ委譲し、main は
計画・統合・最終判断に集中する。詳細は `.claude/rules/delegation.md` /
`.claude/rules/delegation-impl.md`。

### パスベース切り替え

| 対象 / フェーズ | 委譲先 Agent |
|---|---|
| `*/action.yml`・README の横断調査 | `explorer` |
| `*/action.yml` の新規作成・編集 | `action-builder` |
| `README.md` / `CLAUDE.md` / アクション別 README | `docs-writer` |
| 変更差分の品質レビュー | `reviewer` |
| セキュリティ監査（OWASP + Actions 特有） | `security-auditor` |

### model 配分

| 用途 | model |
|---|---|
| 複雑な横断判断・アーキテクチャ設計 | opus または fable（最上位 tier） |
| 調査・実装・レビュー・セキュリティ監査 | sonnet |
| 機械的集計・ドキュメント更新 | haiku |

## Sub-agents

| カテゴリ | subagent_type | model | 役割 |
|---|---|---|---|
| research | `explorer` | sonnet | action.yml / README の横断調査（読み取り専用） |
| implement | `action-builder` | sonnet | Composite Action の実装（bash + gh CLI、env 経由・SHA 固定） |
| implement | `docs-writer` | haiku | README / CLAUDE.md の作成・更新 |
| quality | `reviewer` | sonnet | 変更差分の品質・規約準拠レビュー |
| quality | `security-auditor` | sonnet | OWASP + GitHub Actions 特有のセキュリティ監査 |

## Rules

`.claude/rules/` 配下:

| ファイル | 内容 |
|---|---|
| `delegation.md` | 調査・設計フェーズの委譲原則・パスベース切り替え |
| `delegation-impl.md` | 作成・編集フェーズの委譲マッピング |
| `coding-actions.md` | Composite Action コーディング規約（env 経由・SHA 固定・`set -euo pipefail`） |
| `security.md` | OWASP Top 10 + GitHub Actions 特有（command injection・トークン後始末） |
| `japanese-style.md` | 日本語出力スタイル |
| `conventional-commits.md` | Conventional Commits 詳細規約 |

## Current Skills

`skills-lock.json` で管理（`Fandhe-AI/agent-cli-skills` を `npx skills` で導入）。
更新は `skills-update` アクションまたは `npx skills update`。

- 作成系: `create-commit` / `create-pr` / `create-issue` / `create-issue-tree` / `create-plan`
- 実装系: `implement-issue` / `implement-issue-tree`
- レビュー系: `implement-review` / `implement-review-pr`
- ドキュメント/メンテ系: `update-docs` / `update-issue-tree` / `update-claude` / `init-claude`
- スキル運用: `contribute-skill` / `sync-skills-lock`
- リファレンス: `github-docs`

## hooks（settings.json）

- **SessionStart**: 日本語運用・委譲方針・Composite Action 規約・Conventional Commits
  （`--no-verify` 禁止）・セキュリティ監査のリマインダーを表示する
