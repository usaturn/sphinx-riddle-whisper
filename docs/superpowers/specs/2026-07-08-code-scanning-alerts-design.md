# Code Scanning Alerts 1-3 Fix Design

## Goal

GitHub Code Scanning alerts 1, 2, and 3 on `main` are closed by changing test code to express the existing safety contracts through parser/API based checks instead of patterns that CodeQL flags as vulnerable.

## Alert Scope

The target alerts are:

1. `https://github.com/usaturn/sphinx-riddle-whisper/security/code-scanning/1`
   - Rule: `py/bad-tag-filter`
   - Location: `tests/test_assets.py:39`
   - Message: the regular expression does not match uppercase `<SCRIPT>` tags.
2. `https://github.com/usaturn/sphinx-riddle-whisper/security/code-scanning/2`
   - Rule: `py/bad-tag-filter`
   - Location: `tests/test_runtime_config.py:431`
   - Message: the regular expression does not match uppercase `<SCRIPT>` tags.
3. `https://github.com/usaturn/sphinx-riddle-whisper/security/code-scanning/3`
   - Rule: `js/incomplete-url-scheme-check`
   - Location: `tests/js/sanitize-fragment.test.mjs:373`
   - Message: the check does not consider `data:` and `vbscript:`.

All three locations are tests. The production sanitizer and runtime URL checks already reject the relevant dangerous constructs. The fix should make the tests communicate that contract in a way static analysis understands.

## Chosen Approach

Use parser and existing safety APIs rather than suppression comments.

For alerts 1 and 2, replace ad hoc `<script>` extraction with `BeautifulSoup(html, "html.parser")`. Locate script tags whose `src` contains `riddle-init.js`, then assert that each such tag has `type="module"`.

For alert 3, import `isSafeUrl` from `src/sphinx_riddle_whisper/static/riddle.js` alongside `sanitizeFragment`. In the mixed-fragment regression test, inspect remaining URL-bearing attributes and assert that every remaining value passes `isSafeUrl`. This covers `javascript:`, `data:`, `vbscript:`, malformed schemes, and future unsafe explicit schemes through the same production contract.

## Alternatives Considered

1. Add CodeQL suppression comments.
   - Rejected because it leaves the tests using expressions CodeQL reasonably treats as security-adjacent anti-patterns.
2. Create broad shared helper modules for all Python and JavaScript HTML/security assertions.
   - Rejected for this fix because only three localized alerts are in scope. Shared helpers can be introduced later if more repeated checks appear.
3. Disable CodeQL test classification for these paths.
   - Rejected because tests in this repository intentionally exercise security behavior and should remain scanned.

## Architecture

The change is limited to test code:

- `tests/test_assets.py` imports `BeautifulSoup` and uses DOM-style tag lookup for script assertions.
- `tests/test_runtime_config.py` imports `BeautifulSoup` and uses the same lookup pattern in its integration script assertion.
- `tests/js/sanitize-fragment.test.mjs` imports `isSafeUrl` and validates URL-bearing attributes using the production URL safety predicate.

No production files, workflow files, dependency files, or package metadata need to change. `beautifulsoup4` is already present in the `dev` dependency group and is already used by other tests.

## Data Flow

Python build tests:

1. Sphinx builds HTML.
2. The generated `index.html` is parsed with `BeautifulSoup`.
3. Script tags are filtered by `src` containing `riddle-init.js`.
4. The test asserts at least one matching tag exists and all matching tags have `type="module"`.

JavaScript sanitize test:

1. A mixed hostile `DocumentFragment` is built through the existing JSDOM fixture.
2. `sanitizeFragment` mutates the fragment.
3. The test gathers remaining URL-bearing attributes from allowed elements.
4. The test asserts every remaining URL value passes `isSafeUrl`, so any `javascript:`, `data:`, `vbscript:`, invalid explicit scheme, or malformed URL that survives sanitization fails the test.

## Error Handling

Python tests should fail with explicit assertion messages when:

- `riddle-init.js` has no script tag in the output.
- A matching script tag lacks `type="module"`.

JavaScript tests should fail with explicit assertion messages that include the unsafe attribute name and value when a dangerous URL remains after sanitization.

## Testing

Run targeted checks first:

- `uv run pytest tests/test_assets.py::test_html_build後にriddle_initがtype_moduleのscriptとして読み込まれる -q`
- `uv run pytest tests/test_runtime_config.py::test_実ビルドでriddle_initがtype_moduleのscriptとして読み込まれる -q`
- `yarn test tests/js/sanitize-fragment.test.mjs`

Then run broader checks:

- `uv run pytest -q`
- `yarn test`
- `yarn lint`

Finally, use static grep checks to confirm the exact alert patterns no longer exist at the reported locations:

- `rg -n 're\.findall\(r"<script\\b\[\^>\]\*>"' tests/test_assets.py tests/test_runtime_config.py`
- `rg -n 'startsWith\(dangerScheme\)' tests/js/sanitize-fragment.test.mjs`

## Out of Scope

- Changing `src/sphinx_riddle_whisper/sanitize.py`.
- Changing `src/sphinx_riddle_whisper/static/riddle.js` runtime behavior.
- Dismissing alerts in GitHub without code changes.
- Refactoring unrelated test files that contain harmless string fixtures for attack payloads.

## Implementation Order

1. Fix alert 1 in `tests/test_assets.py`.
2. Fix alert 2 in `tests/test_runtime_config.py`.
3. Fix alert 3 in `tests/js/sanitize-fragment.test.mjs`.
4. Run targeted tests.
5. Run full Python, JavaScript, and lint checks.
6. Push the branch and let GitHub CodeQL verify that the alerts close.
