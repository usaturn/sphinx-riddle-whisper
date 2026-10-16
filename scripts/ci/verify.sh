#!/usr/bin/env bash
# 公開 CI（.github/workflows/ci.yml）の lint・test・docs・audit-and-package と同じ検査を、
# ローカルで 1 回で実行する。
#
# 使い方: scripts/ci/verify.sh [full]
#   full（省略時）  下の手順をすべて順に実行し、最初に失敗した手順で止まる
#
# 終了コード: すべて成功なら 0、失敗した手順があればその終了コード。
# 未知のプロファイル名・余分な引数は、何も実行せずに 64。
#
# 対象外: tox による複数版の実行（py311〜py313 は CI の test ジョブで確かめる。
# ここの pytest はプロジェクトの Python 1 つだけ）、CodeQL・zizmor、ブラウザを使う検査。
#
# 対話の確認で止まらないよう、標準入力を閉じ、corepack のダウンロードの確認を無効にする。
# sphinx-build と uv build の出力は一時ディレクトリに置き、終了時に消す
# （追跡対象のファイルと、既存の dist/ には触らない）。
set -euo pipefail

usage() {
    printf 'usage: scripts/ci/verify.sh [full]\n' >&2
}

if (($# > 1)); then
    printf 'verify.sh: too many arguments\n' >&2
    usage
    exit 64
fi
# 省略は full。空文字列は省略ではなく、未知のプロファイル名として扱う
profile="${1-full}"
if [[ "$profile" != full ]]; then
    printf "verify.sh: unknown verification profile: '%s'\n" "$profile" >&2
    usage
    exit 64
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."

exec </dev/null
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

out="$(mktemp -d "${TMPDIR:-/tmp}/srw-verify.XXXXXX")"
on_exit() {
    local rc=$?
    rm -rf -- "${out:?}" || printf 'verify.sh: could not remove %s\n' "$out" >&2
    if ((rc == 0)); then
        printf '\nverify.sh: %s passed\n' "$profile" >&2
    else
        printf '\nverify.sh: %s failed (exit %d)\n' "$profile" "$rc" >&2
    fi
    exit "$rc"
}
trap on_exit EXIT
# シグナルで止められたときも EXIT の trap で一時ディレクトリを消す
trap 'exit 130' INT
trap 'exit 143' TERM

# 手順の見出しを出してから実行する。失敗すると set -e で止まる（条件の文脈で呼ばない）
step() {
    printf '\n==> %s\n' "$*" >&2
    "$@"
}

# 準備（CI の lint・docs は uv sync --all-groups。--locked で uv.lock も確かめる）
step uv lock --check
step uv sync --locked --all-groups

# lint
step uv run --no-sync ruff check
step uv run --no-sync ruff format --check
step uv run --no-sync mypy src
step corepack yarn install --immutable
step corepack yarn lint
step corepack yarn test

# test（プロジェクトの Python 1 つだけ）
step uv run --no-sync pytest

# docs
step uv run --no-sync sphinx-build -W docs "$out/html"

# audit-and-package
step uv audit --locked
step uv build --out-dir "$out/dist" --clear
step uvx twine check --strict "$out"/dist/*
