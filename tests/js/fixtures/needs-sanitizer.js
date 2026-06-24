// no-unsanitized ルールが発火することを実証するための敵対フィクスチャ。
// 既定の lint 対象からは ignores で除外し、検証時に明示的に lint する。
export function unsafe(el, userInput) {
  el.innerHTML = userInput; // no-unsanitized/property がここで発火する想定
}
