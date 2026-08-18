# wasm-tool-install

`wasm-bindgen-cli` / `wasm-pack` のプリビルトバイナリを、**バージョン固定 + SHA256 検証 +
atomic install**（`mv` による rename）で冪等に導入する Composite Action。

GitHub Releases から tarball を取得し、**SHA256 が一致した場合にのみ**展開・配置します。
チェックサムが一致しなければ何も配置せずに失敗します（fail-closed）。配置先は
`<install-root>/<tool>/<version>-<target>` という不変パスで、導入済みの場合はダウンロードを
スキップするため、self-hosted runner のような永続環境で繰り返し実行しても高速に完了します。

複数バイナリを持つツール（`wasm-bindgen` は `wasm-bindgen` と `wasm-bindgen-test-runner`）は
**ディレクトリごと** rename で配置するため、「片方だけ存在する」不完全な導入は発生しません。
配置後は実バイナリの `--version` を**厳密一致**で再検証し、破損・部分 install・版不一致を
検知して失敗します。

## 前提条件

- runner に `curl` / `tar` と、`sha256sum` または `shasum` があること
- GitHub Releases（`https://github.com/rustwasm/...`）へアクセスできること
- バージョンと SHA256 は**呼び出し側で指定**します（本アクションは pin の値を持ちません）

> **なぜ pin を呼び出し側に置くのか**
> fandhe-frontend では `crates/dist-server/build.rs` の `expected_wasm_bindgen_version` が
> `Cargo.lock` 解決済みの `wasm-bindgen` クレートと CLI のバージョン完全一致を要求し、
> それを契約テストで固定しています。pin の正はその契約を持つリポジトリ側に残す必要があるため、
> 本アクションはバージョンを内蔵せず inputs で受け取ります。

## セットアップ

Secrets は不要です。ワークフローのステップに以下を追加します：

```yaml
steps:
  - name: Install wasm-pack (pinned + checksum-verified)
    uses: Fandhe-AI/actions/wasm-tool-install@latest
    with:
      tool: wasm-pack
      version: '0.13.1'
      sha256: c539d91ccab2591a7e975bcf82c82e1911b03335c80aa83d67ad25ed2ad06539
```

配置先は自動で `$GITHUB_PATH` に追加されるため、後続ステップから `wasm-pack` を
そのまま呼び出せます。

### 使用例（fandhe-frontend の既存パターンの置き換え）

fandhe-frontend の `ci.yml` にある同型のインストールステップ（`test` ジョブの
wasm-bindgen-cli、`browser-test` / `perf-harness` ジョブの wasm-pack。計 3 箇所）は、
以下のように置き換えられます：

```yaml
# test ジョブ: wasm-bindgen-cli
# バージョンは Cargo.lock の wasm-bindgen と一致させること
# （crates/dist-server/build.rs の expected_wasm_bindgen_version 参照）。
- name: Install wasm-bindgen-cli (pinned + checksum-verified, atomic install)
  uses: Fandhe-AI/actions/wasm-tool-install@latest
  with:
    tool: wasm-bindgen
    version: '0.2.126'
    sha256: 064948d58e2d6c0a745216477a639ba696216d6309aaa902939d1b865b1d869d

# browser-test / perf-harness ジョブ: wasm-pack
- name: Install wasm-pack (pinned + checksum-verified)
  uses: Fandhe-AI/actions/wasm-tool-install@latest
  with:
    tool: wasm-pack
    version: '0.13.1'
    sha256: c539d91ccab2591a7e975bcf82c82e1911b03335c80aa83d67ad25ed2ad06539
```

条件付き実行（既存の `if:` ガード）はそのまま `uses:` のステップに付けられます：

```yaml
- name: Install wasm-pack (pinned + checksum-verified)
  if: steps.check.outputs.exists == 'true'
  uses: Fandhe-AI/actions/wasm-tool-install@latest
  with:
    tool: wasm-pack
    version: '0.13.1'
    sha256: c539d91ccab2591a7e975bcf82c82e1911b03335c80aa83d67ad25ed2ad06539
```

### 配置先を PATH に入れず、パスだけ受け取る

```yaml
- name: Install wasm-bindgen-cli
  id: wb
  uses: Fandhe-AI/actions/wasm-tool-install@latest
  with:
    tool: wasm-bindgen
    version: '0.2.126'
    sha256: 064948d58e2d6c0a745216477a639ba696216d6309aaa902939d1b865b1d869d
    add-to-path: 'false'

- name: Run
  run: |
    "${INSTALL_DIR}/wasm-bindgen" --version
  env:
    INSTALL_DIR: ${{ steps.wb.outputs.install-dir }}
```

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `tool` | Yes | - | `wasm-bindgen` または `wasm-pack`。それ以外は拒否する |
| `version` | Yes | - | 固定するバージョン（semver、**`v` 接頭辞なし**。例: `0.2.126` / `0.13.1`）。release tag への変換はアクション側で行う |
| `sha256` | Yes | - | 配布 tarball の SHA256（64 桁 hex）。不一致なら配置せず失敗する |
| `target` | No | `x86_64-unknown-linux-musl` | release asset の target triple |
| `install-root` | No | `$HOME/.local/share` | 配置先のルート**絶対パス**。実配置先は `<install-root>/<tool>/<version>-<target>` |
| `add-to-path` | No | `true` | 配置先を `$GITHUB_PATH` に追加するか（`true` / `false`） |

## Outputs

| 名前 | 説明 |
|---|---|
| `install-dir` | バイナリを配置したディレクトリの絶対パス |

## tarball チェックサムの調べ方

`sha256` 入力に渡す値の求め方です（Action 自体の参照バージョンとは別物なので注意）。

`wasm-bindgen` は各 asset に `.sha256sum` を併載しています：

```bash
curl -sSfL https://github.com/rustwasm/wasm-bindgen/releases/download/0.2.126/wasm-bindgen-0.2.126-x86_64-unknown-linux-musl.tar.gz.sha256sum
```

`wasm-pack` は併載がないため、取得して自分で計算します
（macOS には `sha256sum` が無いため `shasum -a 256` を使います）：

```bash
# Linux
curl -sSfL https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-x86_64-unknown-linux-musl.tar.gz \
  | sha256sum

# macOS
curl -sSfL https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-x86_64-unknown-linux-musl.tar.gz \
  | shasum -a 256
```

## 参照バージョン（`@latest`）

`Fandhe-AI/actions` は可変タグ `@latest` で参照します。`latest` は main への push ごとに
`.github/workflows/move-latest-tag.yml` が付け替えるため、呼び出し側で参照を更新する作業は
不要です。第三者の action（`actions/checkout` 等）は従来どおりコミット SHA で固定します。
## 注意事項

- **サプライチェーン**: 取得元は `https://github.com/rustwasm/<tool>/releases/...` に固定して
  おり、任意 URL は受け付けません。バージョンを上げる際は `version` と `sha256` を**必ず
  セットで**更新してください（`sha256` は asset ごと、つまり target ごとに異なります）
- **`version` に `v` を付けない**: `wasm-pack` の release tag は `v0.13.1` ですが、
  入力は `0.13.1` を指定します。`v` 付与はアクション側で行います
- **並列実行の安全性**: `$HOME` を共有する self-hosted runner で複数ジョブが同時に実行されても、
  一時ディレクトリで検証・展開してから rename で配置するため、互いのツリーを破損しません。
  同一バージョンを同時に配置しようとした場合は先着の成果物を採用します
  （内容は決定的に同一のため安全）
- **配置先の破損からは自動復旧しません**: 配置先に不完全なツリーが残っている場合は
  fail-closed でエラーになります（誤った成果物での実行を防ぐため）。
  該当ディレクトリを削除して再実行してください
- **macOS runner**: BSD の `mv` は `-T` を持たないため、宛先の不在を確認してから rename する
  経路に切り替わります（GNU / BSD 双方で入れ子配置は発生しません）
- **`install-root` は絶対パスのみ**: 相対パスは拒否します。既定は `$HOME/.local/share` で、
  `sudo` を必要としません
- **入力検証**: 全入力は `env:` 経由で受け取り、文字列全体に対する照合で形式を検証します。
  改行を含む値は拒否し、診断出力の際も制御文字を除去するため、`inputs` が
  `github.event.*` 由来であっても workflow command（`::error::` 等）を注入できません
- **`sha256` は大文字・小文字どちらでも可**: 内部で小文字へ正規化して照合します
