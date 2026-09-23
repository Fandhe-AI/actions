// ai-review reusable workflow の出力正規化・契約検証スクリプト。
//
// provider ごとに形の異なる CLI / API の生出力から、レビュー結果 JSON（summary /
// review_completed / findings / resolved_threads）を取り出し、gate 判定・PR コメント描画が
// 依存する契約を検証して、正規化済みの JSON を書き出す。
//
// - schema 強制が効く provider（codex の --output-schema / claude の --json-schema）でも
//   同じ検証を通す（呼び出し側のカスタム schema や CLI 側の不具合で契約が崩れた場合に
//   gate を素通りさせない）
// - 契約に適合しない出力は「レビュー未完了」（review_completed: false）の合成結果へ
//   置き換える（fail-closed）。合成結果の summary には固定文の理由だけを書き、モデル出力の
//   断片は載せない（未検証の出力を PR コメントへ流さない）
// - findings の未知フィールド・トップレベルの未知フィールドは落とす（後段が使わない
//   値を PR コメント・artifact へ持ち込まない）
//
// 本スクリプトは PR が改変できない信頼済み参照（呼び出された workflow と同一 SHA の
// Fandhe-AI/actions checkout）から実行される。
//
// 使い方: node normalize-output.mjs <provider> <raw> <out.json>
// 終了コード: 0 = 正規化済み JSON（または未完了の合成結果）を書き出した
//             2 = CLI がエラー応答を返した（呼び出し側でリトライ判定・失敗扱いにする）

import { readFileSync, writeFileSync } from 'node:fs';

const [provider, rawPath, outPath] = process.argv.slice(2);
if (!provider || !rawPath || !outPath) {
  console.error('usage: node normalize-output.mjs <provider> <raw> <out.json>');
  process.exit(1);
}

const MAX_TEXT = 20000;
const MAX_FINDINGS = 200;
const MAX_THREADS = 200;

const fail = reason => {
  const result = {
    summary:
      `AI レビューの出力を解釈できませんでした（${reason}）。` +
      '出力が契約（summary / review_completed / findings / resolved_threads）に適合しないため、' +
      'レビュー未完了として扱います（fail-closed）。再実行しても解消しない場合はモデル・' +
      'api-response-format の設定を見直してください。',
    review_completed: false,
    findings: [],
    resolved_threads: [],
  };
  writeFileSync(outPath, JSON.stringify(result));
  console.error(`出力の正規化に失敗したため未完了結果へ置き換えました: ${reason}`);
  process.exit(0);
};

// テキストから JSON オブジェクトを取り出す。推論モデルの <think> ブロック・コード
// フェンス・前後の説明文を許容する（取り出せなければ null）
const extractJson = text => {
  if (typeof text !== 'string') return null;
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(t);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    // 前後に説明文が付いた場合: 最初の "{" から最後の "}" までを試す
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
};

let raw;
try {
  raw = readFileSync(rawPath, 'utf8');
} catch {
  fail('出力ファイルが存在しない');
}

let candidate;
switch (provider) {
  case 'codex':
  case 'grok':
  case 'openai-compatible':
    candidate = extractJson(raw);
    break;
  case 'claude': {
    // `claude -p --output-format json` の結果オブジェクト。--json-schema 指定時は
    // structured_output に検証済みオブジェクトが入る
    let wrapper;
    try {
      wrapper = JSON.parse(raw);
    } catch {
      fail('claude の結果オブジェクトが JSON ではない');
    }
    if (wrapper?.is_error === true) {
      console.error(
        // "status <code>" はワークフロー側の一時エラー判定パターン（status.? (429|5xx)）に合わせた形
        `claude がエラー応答を返しました: status ${JSON.stringify(wrapper.api_error_status ?? null)} ` +
          `subtype=${JSON.stringify(wrapper.subtype ?? null)} result=${JSON.stringify(String(wrapper.result ?? '').slice(0, 300))}`,
      );
      process.exit(2);
    }
    candidate =
      wrapper?.structured_output && typeof wrapper.structured_output === 'object'
        ? wrapper.structured_output
        : extractJson(wrapper?.result);
    break;
  }
  case 'gemini': {
    // `gemini -p -o json` の結果オブジェクト（response に最終応答テキスト）
    let wrapper;
    try {
      wrapper = JSON.parse(raw);
    } catch {
      // 出力の前にログ行が混ざる場合に備え、末尾の JSON オブジェクトを探す
      wrapper = extractJson(raw);
    }
    if (wrapper?.error) {
      console.error(`gemini がエラー応答を返しました: ${JSON.stringify(wrapper.error).slice(0, 500)}`);
      process.exit(2);
    }
    candidate = extractJson(wrapper?.response);
    break;
  }
  default:
    fail('未知の provider');
}

if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
  fail('JSON オブジェクトを取り出せない');
}

const clip = s => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…（以下省略）` : s);

if (typeof candidate.summary !== 'string') fail('summary が文字列ではない');
if (typeof candidate.review_completed !== 'boolean') fail('review_completed が真偽値ではない');
if (!Array.isArray(candidate.findings)) fail('findings が配列ではない');
if (candidate.resolved_threads !== undefined && !Array.isArray(candidate.resolved_threads)) {
  fail('resolved_threads が配列ではない');
}

const findings = [];
for (const f of candidate.findings) {
  // 不正な finding を黙って落とすと P0 を取りこぼしうるため、1 件でも不正なら全体を
  // 未完了扱いにする（fail-closed）
  if (!f || typeof f !== 'object' || Array.isArray(f)) fail('findings に object 以外の要素がある');
  if (!['P0', 'P1', 'P2', 'P3'].includes(f.priority)) fail('finding の priority が P0〜P3 ではない');
  if (typeof f.title !== 'string' || typeof f.detail !== 'string') fail('finding の title / detail が文字列ではない');
  const path = typeof f.path === 'string' ? f.path : '';
  const line = Number.isInteger(f.line) && f.line >= 0 ? f.line : 0;
  const location = typeof f.location === 'string' ? f.location : (path ? `${path}:${line}` : '');
  findings.push({
    priority: f.priority,
    title: clip(f.title),
    location: clip(location),
    path: clip(path),
    line,
    detail: clip(f.detail),
  });
}
if (findings.length > MAX_FINDINGS) {
  // 上限超過分を黙って捨てて「完了」とすると指摘が欠落したまま正常完了に見えるため、
  // 件数を削らずレビュー未完了として扱う（fail-closed。gate が失敗し、PR には未完了として
  // 理由を投稿する）
  const result = {
    summary:
      `AI レビューの指摘が ${findings.length} 件あり、処理上限（${MAX_FINDINGS} 件）を超えました。` +
      '一部の指摘だけを完了扱いで投稿すると指摘が欠落するため、レビュー未完了として扱います' +
      '（fail-closed）。PR を分割するか、指摘の多い原因（生成ファイル等）を差分から外してください。',
    review_completed: false,
    findings: [],
    resolved_threads: [],
  };
  writeFileSync(outPath, JSON.stringify(result));
  console.error(`::warning::findings が ${findings.length} 件あり上限（${MAX_FINDINGS} 件）を超えたため、未完了結果へ置き換えました`);
  process.exit(0);
}

const resolvedThreads = (candidate.resolved_threads ?? [])
  .filter(id => typeof id === 'string' && /^[A-Za-z0-9_=-]{1,200}$/.test(id))
  .slice(0, MAX_THREADS);

const result = {
  summary: clip(candidate.summary),
  review_completed: candidate.review_completed,
  findings,
  resolved_threads: resolvedThreads,
};
// PR への投稿量（本文上限ごとに分割される続きコメントの件数）を抑えるため、全体が大きすぎる
// 場合は detail を短く切り詰める（finding 自体・priority は残すので gate 判定は変わらない）
const OUTPUT_BUDGET = 700000;
if (JSON.stringify(result).length > OUTPUT_BUDGET) {
  console.error('::warning::レビュー結果が大きすぎるため、各 finding の detail を切り詰めます');
  for (const f of findings) {
    if (f.detail.length > 1500) f.detail = `${f.detail.slice(0, 1500)}…（以下省略）`;
  }
  if (result.summary.length > 4000) result.summary = `${result.summary.slice(0, 4000)}…（以下省略）`;
}
writeFileSync(outPath, JSON.stringify(result));
console.log(
  `出力を正規化しました（review_completed=${result.review_completed} findings=${findings.length} resolved_threads=${resolvedThreads.length}）`,
);
