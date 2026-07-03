"""パッケージング（wheel 同梱物）の検証テスト。

JS lint/jsdom の検証は dev-only（``yarn lint`` / ``yarn test``）で別途行い、
出荷物（wheel）の依存ゼロを壊さない。ここでは Python 側ガードとして、
dev-only 資材（package.json / node_modules / eslint.config / tests/）が
wheel に同梱されないこと（最重要 DoD）を固定する。
"""

import json
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

import pytest

# tests/ の親＝リポジトリルート
REPO_ROOT: Path = Path(__file__).resolve().parent.parent


def _build_wheel_namelist() -> list[str]:
    """``uv build --wheel`` を一時ディレクトリで実行し、生成 wheel の namelist を返す。

    リポジトリの dist/ を汚さないよう --out-dir に一時ディレクトリを指定する。
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        subprocess.run(
            ["uv", "build", "--wheel", "--out-dir", tmpdir],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
        )
        wheels = list(Path(tmpdir).glob("*.whl"))
        assert len(wheels) == 1, f"wheel が一意に生成されていない: {wheels}"
        with zipfile.ZipFile(wheels[0]) as zf:
            return zf.namelist()


def _entries_containing(namelist: list[str], token: str) -> list[str]:
    """namelist のうち ``token`` を含むエントリ名だけを抽出して返す。"""
    return [name for name in namelist if token in name]


@pytest.mark.skipif(shutil.which("uv") is None, reason="uv が無い環境ではビルドできない")
def test_wheelのnamelistにpackage_jsonが含まれない() -> None:
    """uv build で生成した wheel の namelist のどのエントリにも "package.json" を含む文字列が無い。

    package.json は dev-only 資材であり、出荷物（wheel）に同梱されてはならない。
    """
    # Arrange / Act: wheel をビルドして同梱物一覧を得る
    namelist = _build_wheel_namelist()

    # Assert: どのエントリにも "package.json" を含む文字列が存在しない
    offending = _entries_containing(namelist, "package.json")
    assert offending == [], f"wheel に package.json が同梱されている: {offending}"


@pytest.mark.skipif(shutil.which("uv") is None, reason="uv が無い環境ではビルドできない")
def test_wheelのnamelistにnode_modulesが含まれない() -> None:
    """uv build で生成した wheel の namelist のどのエントリにも "node_modules" を含む文字列が無い。

    node_modules は dev-only の JS ツール依存であり、出荷物（wheel）に同梱されてはならない。
    """
    # Arrange / Act: wheel をビルドして同梱物一覧を得る
    namelist = _build_wheel_namelist()

    # Assert: どのエントリにも "node_modules" を含む文字列が存在しない
    offending = _entries_containing(namelist, "node_modules")
    assert offending == [], f"wheel に node_modules が同梱されている: {offending}"


@pytest.mark.skipif(shutil.which("uv") is None, reason="uv が無い環境ではビルドできない")
def test_wheelのnamelistにeslint_configが含まれない() -> None:
    """uv build で生成した wheel の namelist のどのエントリにも "eslint.config" を含む文字列が無い。

    eslint.config（ESLint flat config）は dev-only の lint 設定であり、
    出荷物（wheel）に同梱されてはならない。
    """
    # Arrange / Act: wheel をビルドして同梱物一覧を得る
    namelist = _build_wheel_namelist()

    # Assert: どのエントリにも "eslint.config" を含む文字列が存在しない
    offending = _entries_containing(namelist, "eslint.config")
    assert offending == [], f"wheel に eslint.config が同梱されている: {offending}"


@pytest.mark.skipif(shutil.which("uv") is None, reason="uv が無い環境ではビルドできない")
def test_wheelのnamelistにtestsが含まれない() -> None:
    """wheel の namelist のどのエントリにも "tests/" を含む文字列が無い（テスト資材の非同梱）。"""
    namelist = _build_wheel_namelist()

    offending = _entries_containing(namelist, "tests/")
    assert offending == [], f"wheel に tests/ が同梱されている: {offending}"


@pytest.mark.skipif(shutil.which("uv") is None, reason="uv が無い環境ではビルドできない")
def test_wheelに出荷物のstaticが同梱される() -> None:
    """wheel には出荷物 static/riddle.js が同梱される（dev-only 除外と出荷物保持の両立）。"""
    namelist = _build_wheel_namelist()

    assert any(
        name.endswith("sphinx_riddle_whisper/static/riddle.js") for name in namelist
    ), f"wheel に static/riddle.js が同梱されていない: {namelist}"


def test_package_jsonはprivateでランタイム依存ゼロのdev_only構成である() -> None:
    """package.json は private=True・dependencies 空・devDependencies に lint 道具を持つ。"""
    data = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))

    assert data["private"] is True
    assert data.get("dependencies", {}) == {}
    dev = data.get("devDependencies")
    assert isinstance(dev, dict) and dev
    assert "eslint" in dev
    assert "eslint-plugin-no-unsanitized" in dev
    # dev tooling は Yarn 4 (Berry) 前提。Corepack が参照する packageManager 固定を守る。
    assert data["packageManager"].startswith("yarn@4")


def test_yarn_lockfileがリポジトリに存在しnpm_lockfileは存在しない() -> None:
    """Yarn 4 移行後の lockfile 構成を固定する。

    yarn.lock のコミット漏れ（fresh checkout で lockfile 不在になり、devcontainer の
    ``yarn install --immutable`` が再現不能になる）を CI の pytest で検出する。
    npm の package-lock.json は .gitignore 対象であり、復活してはならない。
    """
    assert (REPO_ROOT / "yarn.lock").exists(), "yarn.lock がコミットされていない"
    assert not (REPO_ROOT / "package-lock.json").exists(), (
        "npm の package-lock.json が残っている（Yarn 4 移行後は yarn.lock に一本化）"
    )
