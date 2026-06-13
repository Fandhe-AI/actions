# conventional-commits（コミット規約）

コミットは **Conventional Commits** 形式 `type(scope): subject` に従う。

## type

| type | 用途 |
|---|---|
| `feat` | 新機能（新アクション追加など） |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `refactor` | 機能変更なしのリファクタリング |
| `chore` | 補助ツール・依存・スキル同期等 |
| `test` | テストの追加・修正 |
| `style` | フォーマットのみ |
| `build` | ビルドシステム・外部依存 |
| `ci` | CI 設定 |
| `perf` | パフォーマンス改善 |

## ルール

- scope は変更対象から推定する（例: `submodule-update`・`skills-update`）。横断時は省略可
- subject は命令形・現在形、72 文字以内。**日本語可**
- Breaking change は `type!:` または body に `BREAKING CHANGE:` を記述
- Co-author を付与: `Co-Authored-By: Claude <noreply@anthropic.com>`
- **`--no-verify` 禁止**（pre-commit フックを迂回しない）
- `.env` や認証情報が含まれる場合はコミットを中止して警告する

## 例

```
feat(skills-update): npx skills 導入スキルの自動更新アクションを追加
fix(submodule-update): auto-merge の allowlist 判定を修正
docs: アクション一覧に skills-update を追記
chore: エージェントスキルを最新に同期
```
