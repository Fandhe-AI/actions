---
paths:
  - ".github/workflows/**"
  - "*/action.yml"
---

# github-actions（GitHub Actions のキャッシュ方針）

本リポジトリの reusable workflow・Composite Action にキャッシュを足す・変えるとき、および利用側へ
キャッシュの使い方を案内するときの方針。利用側は `@latest` で参照するため、キャッシュの変更は
全利用側へ即時に反映され、誤りがあれば全利用側の容量・所要時間に波及する。

## 現状（2026-10-11 時点）

- 本リポジトリ自身のキャッシュは 0 件（本リポジトリで動く `ai-review-self.yml`・`move-latest-tag.yml`・
  `update-external-self.yml` はキャッシュを使わない）
- キャッシュを持つのは `rust-base-ci.yml` だけで、`actions/cache/restore` と `actions/cache/save` に分けている。
  構成（対象パス・key）の正は `rust-base-ci/README.md` の「cache の構成」節とファイル冒頭のコメント

## 前提: 容量と課金

- キャッシュは呼び出し側リポジトリの容量を消費する。リポジトリあたりの上限は 10 GB（Org 設定も 10 GB）で、
  超えると最終アクセスの古い順に追い出され、7 日間アクセスの無いキャッシュは削除される
- Org の Actions 予算は $0 で、超過時は停止する。そのため 10 GB を超える上限は使えない
  （上限を上げると、10 GB を超えた時点でキャッシュが読み取り専用になる）。上限・予算の変更はユーザーが判断する

## rust-base-ci.yml の cache 入力

| 入力 | 既定 | 内容 |
|---|---|---|
| `cache` | `false` | cargo レジストリ・`target` の cache を有効にする（オプトイン）。workspace が永続する self-hosted runner では通常不要 |
| `cache-key-prefix` | `rust-base-ci` | key の接頭辞。同一 runner を共有する複数リポジトリでの衝突回避用 |
| `cache-save` | `true` | `cache: true` のとき保存するか（`false` で restore のみ）。#165 で追加 |

- 利用側への呼び出し例・案内は、`cache: true` と `cache-save: ${{ github.ref == 'refs/heads/main' }}` を組にする。
  `cache-save` を渡さないと PR でも保存し、PR の blob は `refs/pull/<N>/merge` スコープに入ってその PR からしか
  読めないのに容量を共有する（fandhe-container の実測では同一キーの blob が main と PR 3 件で 4 重に保存され、
  PR スコープの blob が全体 5.4 GB の約 6 割を占めた）
  - `github.ref` だけの式は `main` 上の `schedule`・`workflow_dispatch` でも真になる。利用側のワークフローがそれらの
    イベントでも呼び出し、保存を push に限りたい場合は `${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}` を渡す
- 入力の既定値を変えると `@latest` の全利用側の挙動が変わる。変える場合は利用側の呼び出しを棚卸しし、ユーザーの判断を得てから行う

## key 設計を変えるときの互換性

現行の `clippy` / `test` の key は `<cache-key-prefix>-<os>-<job>-v4-<rustc の release>-<commit-hash 先頭 12 桁>-<hashFiles('Cargo.lock')>`、
restore-keys は同じ rustc の `v4-` を優先し、移行期間だけ `v3-` へフォールバックする。

- ハッシュの入力はルートの `Cargo.lock` だけにする。`**/Cargo.lock` に戻さない（workspace 外のサンプル・治具、
  利用側の `.agents/skills/*/samples/**` などの lockfile の変更でキーが変わり、同内容の blob を作り直す。
  fandhe-browser・fandhe-frontend・fandhe-db・fandhe-container・template-frontend-react_router で発生した）
- `target` を含む key から rustc の版を外さない。外すと runner イメージの更新後も旧 rustc の blob に exact hit し続け、
  exact hit では再保存されないため依存を毎回全再ビルドする（fandhe-db で依存 135 crate を毎回再ビルドしていた）
- 保存対象（`path`）・保存前 prune・`CARGO_INCREMENTAL` などで blob の中身が変わる変更では、版セグメントを bump する
  （`v4` → `v5`）。exact hit では保存されないため、bump しないと既存の blob に当たり続け、新しい中身が保存されない。
  bump は `clippy` / `test` の両ジョブで同時に行う
- bump するときは restore-keys に旧版の前方一致（例: `...-v4-`）を移行期間だけ残し、全利用側が cold run を挟まずに
  移行できるようにする。旧 blob を復元してビルドし直したうえで新版として保存して問題ない場合に限る
  （復元した中身が新しい設計と矛盾するならフォールバックせず、1 回 cold になることを PR に書く）。
  旧版の行は、旧 blob が 7 日間アクセスされず削除された後に消してよい（現行の `v3-` 行も同じ）
- 旧版の blob は削除されるまで利用側の容量を新版と合わせて消費する。サイズが大きい場合は PR・README で
  `gh cache delete` による削除を案内する
- restore と save は同じ `path` と primary key（`steps.<id>.outputs.cache-primary-key`）を使い、save は前段の成功と
  `steps.<id>.outputs.cache-hit != 'true'` を条件にする（`actions/cache` の post 保存と同じ条件）。`cache-save` の条件も外さない
  - `rust-base-ci.yml` の `clippy` / `test` は、`cache-save` と exact hit の判定を `cache-save-decision` ステップに
    まとめ、保存前 prune と save がその出力を共有する。保存の前処理（prune 等）を足すときも判定を複製せず同じ出力を使い、
    保存しない run（PR の restore のみ・exact hit）で前処理を走らせない
- key の変更は `rust-base-ci.yml` のコメントと `rust-base-ci/README.md` の「cache の構成」節を同じ PR で更新する

## キャッシュを新しく足すとき

対象は `rust-base-ci.yml` への追加のほか、他の reusable workflow・Composite Action へのキャッシュ導入。

- 入れる前に効果を測る。self-hosted runner ではツールチェーン・pnpm store・`CARGO_TARGET_DIR` 等がジョブをまたいで
  残ることがあり、GitHub のキャッシュが無意味（復元時間だけかかる）な場合がある
  - mirror-ui: pnpm キャッシュの復元に 1 ジョブ平均 75 秒かけていたが、install は `downloaded 0` で効果が無かったため撤去した
  - team-hub: `Swatinem/rust-cache` が `./target` を保存対象にしていたが、runner の `CARGO_TARGET_DIR` が別の場所で
    registry しか保存されておらず、さらに後処理が共有 `CARGO_HOME` の crate を消していたため撤去した
  - 利用側の実 CI のジョブログで、キャッシュ有無の `downloaded` 件数・依存の再ビルド数（`Compiling` の行数）・
    復元にかかった秒数を比べる
- オプトインの入力にし、保存を止める入力（`cache-save` 相当）を用意する。restore と save を分け、保存は利用側が
  `main` の push に限れるようにする
- `actions/setup-node` の `cache:` のように restore と save が一体の action は PR でも保存し、利用側から止められない。
  使う場合は restore / save の分離に置き換えられないか検討する
- `Swatinem/rust-cache` を使うなら `save-if` を利用側から渡せるようにし、self-hosted で `CARGO_HOME` を共有する場合は
  `cache-bin: false` を付ける（`docs/runner-policy.md` §5）
- key には中身のハッシュ（ルートの lockfile 等）を入れ、`github.sha`・`github.run_id` など毎回変わる値は入れない
  （入れる場合は restore-keys の前方一致で直近を拾う設計にし、保存は `main` に限る）。ビルド成果物を含むならツールチェーンの版も入れ、
  restore-keys で前方一致の部分復元を許す。runner を共有するリポジトリ間で衝突しないよう接頭辞を入力で変えられるようにする
- 1 世代（キャッシュ種別ごとの最新 1 件）の合計が利用側の 10 GB に余裕をもって収まるようにする。
  「1 件のサイズ × 種別（ジョブ）× OS」を見積もり、Rust なら保存前の workspace メンバー成果物の prune・
  `CARGO_INCREMENTAL=0`・CI 限定の `CARGO_PROFILE_DEV_DEBUG=line-tables-only` 等で縮める
  （`rust-base-ci.yml` の prune の計測は `rust-base-ci/cache-before-after-2026-09-17.md`）

## 追い出されても hit する設計

- 上限に達しても、毎回読まれる `main` の最新キャッシュは最後まで残る（最終アクセスの古い順に追い出されるため）。
  キーの切り替えで古い世代が追い出されても、新しい世代が保存済みならミスにならない
- 保存を `main` に限り、キーが不要に変わらない状態を保てていれば上限を上げる必要はない

## 計測コマンド

効果やサイズは、キャッシュを持たない本リポジトリではなく利用側リポジトリで測る。

```bash
gh api repos/Fandhe-AI/<repo>/actions/cache/usage
gh cache list -R Fandhe-AI/<repo> -L 100   # key・サイズ・ref
gh cache delete <id> -R Fandhe-AI/<repo>   # 共有状態のため、key と ref を確認してから消す
```

ジョブログでは次の行を見る。

- `Cache restored from key: <key>`: primary key と一致すれば exact hit、それ以外は restore-keys による部分復元
- `Cache not found for input keys: ...`: ミス
- `Cache saved with key: <key>`: 保存された（`cache-save` に main 限定の式を渡した利用側の PR で出ていれば誤り）

## キャッシュを追加・変更する PR のチェックリスト

PR 本文に次を確認したことを書く。

1. 効果を測った（利用側の実 CI で、キャッシュ有無の `downloaded` 件数・再ビルド数・復元秒数）
2. 利用側が保存を `main` の push に限れる（入力があり、README の呼び出し例が渡している）
3. key が中身のハッシュ（ルートの lockfile のみ）と、成果物を含むならツールチェーンの版でできており、restore-keys がある。
   key 設計を変えたなら版セグメントを bump し、旧版へのフォールバックの有無と理由を書いた
4. 1 世代の合計サイズを見積もり、利用側の 10 GB に余裕をもって収まる
