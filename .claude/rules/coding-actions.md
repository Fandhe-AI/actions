# coding-actions（Composite Action コーディング規約）

このリポジトリのアクションは **bash + `gh` CLI のみ**で実装する Composite Action 集である。

## 必須規約

- `runs.using: composite`。Docker / Node.js ランタイムは使わない
- 入力値は **`env:` 経由でシェル変数に渡す**。`${{ inputs.* }}` / `${{ github.* }}` を
  `run:` 本文に直接埋め込まない（インジェクション防止 → `security.md`）
- 各 `run:` は `shell: bash` を明示し、原則 `set -euo pipefail` を付ける
- ステップ間の値渡しは `$GITHUB_OUTPUT` を使う。複数行値は heredoc デリミタで囲む
- アクションは `<name>/action.yml` + `<name>/README.md` のペアで構成する

## 堅牢な bash

- 配列は `"${arr[@]}"` で展開し、空配列でも `set -u` で落ちないことを確認する
- ユーザー入力（カンマ/改行区切り等）のパースは trim してから配列化する
- リモート URL・git config をトークンで書き換えたら `trap ... EXIT` で必ず復元する
- 外部コマンド出力を `::notice::` 等に直接混ぜない（別 `echo` 行に分離）

## 検証

- 変更後は `python3 -c "import yaml; yaml.safe_load(open('<dir>/action.yml'))"` で YAML を確認
- 肝となるロジック（jq・glob 判定・配列展開）はローカルで小さく実行して確かめる

## 利用側の参照

- セキュリティのため利用側は `@main` ではなく**コミット SHA で固定**して参照する
- 既存アクション（`submodule-update/`・`skills-update/`）の構造・命名に揃える
