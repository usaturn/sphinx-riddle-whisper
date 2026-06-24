// ESLint 9 flat config (dev-only). Mechanically enforces the "vanilla, no unsafe
// sinks" policy for the shipped riddle.js: no innerHTML/insertAdjacentHTML,
// no eval/new Function/setTimeout(string), no javascript: URLs.
import js from "@eslint/js";
import noUnsanitized from "eslint-plugin-no-unsanitized";

export default [
  {
    // The bad fixture intentionally violates no-unsanitized; it is linted
    // explicitly (not as part of the default set) to prove the rule fires.
    ignores: ["tests/js/fixtures/**", "node_modules/**"],
  },
  js.configs.recommended,
  noUnsanitized.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
    },
  },
  {
    // Unit tests run under node:test + jsdom and legitimately reference standard
    // node/browser globals (URL, setTimeout, console, document, …). Declaring
    // them here keeps no-undef from firing on test code WITHOUT weakening the
    // shipped-code guarantees above: no-unsanitized / no-script-url / no-eval
    // still apply to tests too (so attack payloads must be built as JSDOM HTML
    // strings or live in the eslint-ignored tests/js/fixtures/, never as a bare
    // `javascript:` literal or `innerHTML` assignment).
    files: ["tests/js/**/*.mjs", "tests/js/**/*.js"],
    languageOptions: {
      globals: {
        URL: "readonly",
        URLSearchParams: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        queueMicrotask: "readonly",
        structuredClone: "readonly",
        console: "readonly",
        globalThis: "readonly",
        process: "readonly",
        document: "readonly",
        window: "readonly",
      },
    },
  },
];
