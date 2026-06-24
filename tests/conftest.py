"""sphinx.testing の app fixture を有効化し、testroot を tests/roots に配線する。"""

from pathlib import Path

import pytest

pytest_plugins = ("sphinx.testing.fixtures",)


@pytest.fixture(scope="session")
def rootdir() -> Path:
    """testroot='<name>' が tests/roots/test-<name>/ を指すようにルートを返す。"""
    return Path(__file__).parent.resolve() / "roots"
