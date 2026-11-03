import ast
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest


def runner(tmp_path):
    source = Path(__file__).resolve().parents[1] / "SConstruct"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {"_run", "_write_console"}]
    namespace = {"ROOT": tmp_path, "ROOT_ENV": {}, "Path": Path, "subprocess": subprocess, "sys": sys, "re": re, "time": time}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), "exec"), namespace)
    return namespace["_run"]


def test_retries_network_failures(monkeypatch, tmp_path):
    responses = iter([subprocess.CompletedProcess([], 1, "", "fetch failed"), subprocess.CompletedProcess([], 0, "conta validada", "")])
    calls = []
    def run(*args, **kwargs):
        calls.append(kwargs)
        return next(responses)
    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setattr(time, "sleep", lambda _: None)
    assert runner(tmp_path)(["wrangler", "whoami"], cwd=tmp_path, capture=True, network_attempts=3) == "conta validada"
    assert len(calls) == 2


@pytest.mark.parametrize("message", ["Authentication error 403 fetch failed", "JSON inválido", "fetch failed"])
def test_failure_is_not_hidden(monkeypatch, tmp_path, message):
    calls = []
    def run(*args, **kwargs):
        calls.append(kwargs)
        return subprocess.CompletedProcess([], 1, "", message)
    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setattr(time, "sleep", lambda _: None)
    with pytest.raises(SystemExit):
        runner(tmp_path)(["wrangler", "whoami"], cwd=tmp_path, capture=True, network_attempts=3)
    assert len(calls) == (3 if message == "fetch failed" else 1)
