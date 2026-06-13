# delegation-impl（作成・編集フェーズの委譲）

実装・編集も対象に応じて subagent へ委譲する。main は計画と統合・最終確認を担う。

## パスベース切り替え（作成/編集対象 → 委譲先）

| 対象 | 委譲先 |
|---|---|
| `*/action.yml`（Composite Action の新規/編集） | `action-builder` |
| `README.md`・`CLAUDE.md`・アクション別 README | `docs-writer` |
| 変更後の品質レビュー | `reviewer` |
| 変更後のセキュリティ監査 | `security-auditor` |

## フロー指針

1. 実装は `action-builder` に委譲（規約: env 経由・SHA 固定・`set -euo pipefail`）
2. 実装後に `reviewer` と `security-auditor` でセルフレビュー
3. ドキュメント追記は `docs-writer`
4. コミット / PR はスキル（`create-commit` / `create-pr`）を使用

## 注意

- 並列実行できる独立作業は同時に委譲する
- 既存ファイルの上書きが伴う場合はユーザー承認を得てから実施する
