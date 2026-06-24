// 動的コード実行・javascript: スキームが各 ESLint ルールで弾かれることを実証する
// 敵対フィクスチャ。既定 lint からは ignores で除外し、検証時に明示的に lint する。
export function dangers(userInput) {
  eval(userInput); // no-eval がここで発火する想定
  const built = new Function("return " + userInput); // no-new-func
  setTimeout("alert(1)", 0); // no-implied-eval（文字列引数）
  const scriptUrl = "javascript:alert(1)"; // no-script-url
  return [built, scriptUrl];
}
