"""Regression checks for the locale sorting utility shared with Vectora."""
import importlib.util
import json
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "utils/sort_translation_keys.py"
spec = importlib.util.spec_from_file_location("sort_translation_keys", MODULE_PATH)
assert spec and spec.loader
sorter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sorter)


def test_sort_preserves_metadata_values_and_unicode(tmp_path):
    path = tmp_path / "pt-BR.json"
    messages = {"z": "Ação", "$comment": "Texto", "a": "{name}", "$schema": "schema"}
    path.write_text(json.dumps(messages), encoding="utf-8")
    assert not sorter.check_file(path, write=False)
    assert sorter.check_file(path, write=True)
    assert list(json.loads(path.read_text(encoding="utf-8"))) == ["$schema", "$comment", "a", "z"]
    assert json.loads(path.read_text(encoding="utf-8")) == messages
    content = path.read_bytes()
    assert sorter.check_file(path, write=True)
    assert path.read_bytes() == content
