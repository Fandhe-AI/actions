# AGENTS.md

## 文書の位置づけ

本リポジトリで作業するすべての AI エージェント・人間レビュアーが共通で用いるレビュー観点集。
Codex による PR 自動レビュー（`.github/workflows/codex-review-self.yml`。本リポジトリ自身の
codex-review reusable workflow を呼び出す self wrapper）は、PR の base コミットの本ファイルを
レビュー基準として読む。運用ガイドの正は `CLAUDE.md`、実装規約の詳細は `.claude/rules/`
（`coding-actions.md` / `security.md`）と `docs/`（`runner-policy.md` /
`codex-review-runner-exception.md`）を参照し、本書は重複させずレビュー判定基準に絞る。

本リポジトリは **Fandhe-AI Organization 全体の CI 基盤（Composite Action・reusable
workflow）**であり、消費側リポジトリは `@latest` で本リポジトリを参照する。ここでの欠陥・
権限過剰・インジェクション経路は組織内すべての CI へ伝播するため、通常のリポジトリより
厳しい基準でレビューする。

## 優先度の定義

| 優先度 | 意味 | 扱い |
|--------|------|------|
| P0 | マージブロック。消費側 CI への脆弱性・資格情報漏えいの伝播に直結 | 修正までマージ不可 |
| P1 | 強く推奨。実装規約・runner 方針・README 規約への違反 | 原則修正してからマージ |
| P2 | 提案。可読性・保守性・ドキュメント整備の改善 | 任意（コメントのみ） |

### 受容済み残留リスク（オーナー判断）の扱い

セキュリティ上の残留リスクに関する指摘は**抑止しない**。該当する欠陥・弱体化は
従来どおり finding として必ず報告する。そのうえで、以下の**すべて**を満たす指摘に
限り、priority を **P2（advisory・非ブロック）**として報告し、detail に README の
受容記載への参照を含める（受容するかどうか・マージするかどうかの最終判断は、
CI をブロックせず人間のオーナーに委ねる）:

1. 対象コンポーネントの README に「受容済み残留リスク」としてオーナー判断（日付付き）で
   明文化されており、その記載が**マージ前から PR の base コミットに存在し**、当該リスクと
   設計を**具体的に特定している**（包括的・白紙委任的な事前承認は根拠にならない）。
   当該 PR 自身が追記・改変した受容記載は根拠にしない（PR による自己承認の防止。
   受容を新設・拡張する場合は README 改訂の PR を先にレビュー・マージする）
2. 判定不能時に安全側へ倒す fail-closed 構造そのものは維持されている
   （fail-open 化は従来どおり P0）
3. リスクを行使できる主体が「対象リポジトリへ push できる主体」に限定される
   （fork PR・外部者へ攻撃面が広がる変更は対象外で、従来どおり P0）

受容記載と実装の乖離・受容範囲を超える弱体化・上記条件を欠く指摘は従来どおり
P0/P1 とする。受容記載そのものの妥当性への懸念も P2 で報告してよい。
個別の受容済みリスクは「リポジトリ固有の観点」に列挙する。

## 1. セキュリティ観点（重点）

- **テンプレート式インジェクション（P0）**: `${{ inputs.* }}` / `${{ github.event.* }}` 等を
  `run:` 本文・workflow command 行へ直接埋め込まない。必ず `env:` 経由でシェル変数へ渡し
  `"${VAR}"` で参照する（`.claude/rules/security.md`）。ユーザー由来の値を `::notice::` 等の
  workflow command 行と同一行に展開する変更も P0
- **アクション参照（P0 / 対象は第三者のみ）**: 本リポジトリ内で `uses:` する
  **第三者の** action・reusable workflow はコミット SHA 固定とする（`@main` / タグ参照への
  緩和は P0）。CLI・npm パッケージのバージョンも固定する（可動 latest の導入は P1）。
  **`Fandhe-AI/actions`（自リポジトリ）への参照は例外で、可変タグ `@latest` を使う**
  （オーナー判断。pin の手動更新コストを避けるための組織方針であり、`@latest` への
  統一を指摘しない）。`latest` は `.github/workflows/move-latest-tag.yml` が main への
  push ごとに付け替える
- **権限最小化（P0/P1）**: ジョブ・ステップの `permissions` は必要最小限を明示する。
  `write` 権限の追加・`GITHUB_TOKEN` で足りる箇所への PAT 要求・secrets の注入範囲拡大は
  根拠なしなら P0、根拠付きでも要精査（P1）
- **fork PR・信頼境界（P0）**: `pull_request_target` 等 secrets が露出するトリガーの追加、
  codex-review の fork PR 実行拒否・fail-closed 検証（sudo 不在検証・2 段 gate 等）の
  弱体化は P0。レビュー制御ファイルを PR の checkout（改変可能側）から読む構成への
  後退（base 参照化の解除）も P0
- **トークンの後始末（P0）**: remote URL・git config へトークンを埋め込む処理は
  `trap ... EXIT` で確実に復元する。トークンをログ（`echo` / `set -x`）へ出さない
- **runner 方針の準拠（P1）**: `docs/runner-policy.md`（public = GitHub ホステッド /
  private = self-hosted、codex-review の codex ジョブのみ self-hosted 例外）に反する
  runner 既定値・例外拡大は、方針文書の更新を伴わない限り P1

## 2. アーキテクチャ・設計整合の観点

- **形態の選択（P1）**: 単一ジョブ・単純ステップ列は Composite Action（`<name>/action.yml` +
  `README.md`、bash + `gh` CLI のみ・Docker/Node.js ランタイム不使用）、複数ジョブ・
  runner 選択・permissions 分離を要するものは reusable workflow
  （`.github/workflows/*.yml` + 付随ファイルは `<name>/` ディレクトリ）とする。
  この区分に反する実装は指摘する
- **bash 実装規約（P1）**: 各 `run:` は `shell: bash` 明示 + `set -euo pipefail`。
  ステップ間の値渡しは `$GITHUB_OUTPUT`（複数行は heredoc デリミタ）。配列は
  `"${arr[@]}"` 展開で空配列でも `set -u` で落ちないこと（`coding-actions.md`）
- **fail-closed 設計（P1）**: 前提ツール・入力の欠如は無言 skip ではなく明示エラーとする
  （意図的な skip は rust-base-ci の `Cargo.toml` 不在時 success skip のように README へ
  仕様として明記する）。既存の fail-closed 分岐を fail-open 化する変更は P0
- **既存アクションとの一貫性（P2）**: 命名・ディレクトリ構造・inputs の命名規約
  （`runner-label` 等の既存語彙）を既存アクションに揃える

## 3. 再利用・アセット化の観点（重点）

- **組織汎用性（P1）**: 特定の消費側リポジトリ名・固有パス・固有ブランチ名を action /
  workflow 本体へハードコードしない。リポジトリ差は inputs（デフォルト値付き）で吸収する
- **後方互換性（P1）**: 既存 inputs / outputs / secrets の改名・削除・意味変更は破壊的変更。
  消費側は SHA 固定参照のため即時には壊れないが、SHA 更新時に一斉に影響するため、
  PR に影響範囲（消費側リポジトリと必要な追随変更）を明記する。互換の追加
  （デフォルト値付き input の追加）を優先する
- **README 規約（P1）**: 各アクションの README は統一構造（概要 / 前提条件 /
  セットアップ / Inputs テーブル / SHA の更新方法 / 注意事項）に従う（`CLAUDE.md`）。
  inputs 追加時の Inputs テーブル未更新は P1
- **消費側から参照される docs の整合（P1）**: `docs/runner-policy.md` /
  `docs/codex-review-runner-exception.md` は消費側リポジトリの規約から参照される
  組織横断文書。挙動変更とこれら文書の記述が乖離する PR は指摘する
- **セットアップ手順の完結性（P2）**: 新規アクションは README のワークフロー例だけで
  導入が完結すること（Secrets 登録手順・SHA 取得コマンドを含む）

## リポジトリ固有の観点

- **codex-review の多層防御（P0）**: prompt / schema / AGENTS.md の base 参照抽出、
  `project_doc_max_bytes=0` による自動読込無効化、`review_completed` の fail-closed 判定
  など、レビュー実行の自己参照攻撃対策を弱める変更はブロックする
- **受容済み残留リスク: レビュー skip のブランチ接頭辞判定**: codex-review の
  `skip-branch-prefixes`（旧 `skip-sync-pr-review`）が head branch 名の接頭辞のみで
  codex ジョブを skip する設計は、push できる主体が該当接頭辞のブランチで P0/P1 gate を
  回避できる残留リスクごとオーナー判断で受容済み
  （`codex-review/README.md`「受容済み残留リスク」節、2026-08-18 判断・
  2026-08-21 追記で変更ファイル集合の実測検証の撤去まで受容範囲を拡張）。
  同節の記載が base に存在する限り、この設計およびその導入 PR への指摘は
  「受容済み残留リスクの扱い」に従い **P2（advisory・非ブロック）**として報告し、
  detail に同節への参照を含める（指摘自体は省略しない）。判定不能時にレビュー実行側へ
  倒す fail-closed 構造の毀損・fork PR への拡大・同 README の受容記載を伴わない
  類似 skip の新設は受容範囲外で、従来どおり P0
- **YAML の検証（P2）**: action.yml / workflow YAML の変更は
  `python3 -c "import yaml; yaml.safe_load(...)"` 等での構文確認を経る。ステップ名に
  「: 」を含む場合のクォート漏れに注意
- **コミット規約（P2）**: 日本語 Conventional Commits。`--no-verify` の使用を促す・
  前提とする記述は P1
