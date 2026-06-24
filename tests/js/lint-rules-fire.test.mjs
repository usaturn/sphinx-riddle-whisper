// #16 DoD「no-unsanitized が発火する」を自動検証する meta テスト。
// 敵対フィクスチャ（eslint.config.mjs の ignores 対象）を ESLint Node API で
// ignore 無効化して lint し、危険シンク禁止ルールが実際に発火することを assert する。
// これにより、ルールのサイレント無効化（設定ミス・依存更新）を CI/`npm test` で検知できる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";

/**
 * フィクスチャを ignore 無効で lint し、検出された ruleId と error 総数を返す。
 * @param {string} fixture lint 対象フィクスチャの相対パス
 * @returns {Promise<{ruleIds: string[], errorCount: number}>}
 */
async function lintFixture(fixture) {
  const eslint = new ESLint({ ignore: false });
  const results = await eslint.lintFiles([fixture]);
  const ruleIds = results.flatMap((r) => r.messages.map((m) => m.ruleId));
  const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
  return { ruleIds, errorCount };
}

test("no-unsanitized が innerHTML 代入フィクスチャで発火する", async () => {
  // Act: innerHTML 代入を含む敵対フィクスチャを ignore 無効で lint する
  const { ruleIds, errorCount } = await lintFixture(
    "tests/js/fixtures/needs-sanitizer.js",
  );

  // Assert: no-unsanitized/property が発火し、lint エラーが 1 件以上ある
  assert.ok(
    ruleIds.includes("no-unsanitized/property"),
    `no-unsanitized/property が発火していない。実際: ${JSON.stringify(ruleIds)}`,
  );
  assert.ok(errorCount > 0, "lint エラーが 0 件（ルールが無効化されている可能性）");
});

test("動的コード実行・javascript:URL の禁止ルールがフィクスチャで発火する", async () => {
  // Act: eval/new Function/setTimeout(string)/javascript: を含むフィクスチャを lint する
  const { ruleIds } = await lintFixture(
    "tests/js/fixtures/unsafe-dynamic-code.js",
  );

  // Assert: 危険シンク禁止ルールがいずれも発火している
  for (const expected of [
    "no-eval",
    "no-new-func",
    "no-implied-eval",
    "no-script-url",
  ]) {
    assert.ok(
      ruleIds.includes(expected),
      `${expected} が発火していない。実際: ${JSON.stringify(ruleIds)}`,
    );
  }
});
