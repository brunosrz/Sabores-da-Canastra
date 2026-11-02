"""Gera hashes PBKDF2 e os grava em um arquivo de secrets ignorado pelo Git."""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ITERATIONS = 600_000
USERS = (("user_bruno", "bruno"), ("user_ivone", "ivone"))
LEGACY_KEYS = {"PDV_WRITE_TOKEN", "CATALOG_READ_TOKEN", "BACKUP_DOWNLOAD_TOKEN"}


def encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def hash_password(username: str) -> dict[str, str | int]:
    password = getpass.getpass(f"Senha para {username}: ")
    confirmation = getpass.getpass(f"Confirme a senha de {username}: ")
    if password != confirmation:
        raise SystemExit(f"As senhas de {username} não conferem.")
    password_length = len(password.encode("utf-16-le")) // 2
    if not 6 <= password_length <= 128:
        raise SystemExit(f"A senha de {username} deve ter entre 6 e 128 caracteres.")
    salt = secrets.token_bytes(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, ITERATIONS, dklen=32
    )
    return {
        "salt": encode(salt),
        "hash": encode(password_hash),
        "iterations": ITERATIONS,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", choices=("local", "preview", "production"))
    args = parser.parse_args()
    api = ROOT / "apps" / "api"
    target = api / (
        ".dev.vars" if args.environment == "local" else f".env.{args.environment}"
    )
    if args.environment == "local":
        preview = api / ".env.preview"
        auth_line = (
            next(
                (
                    line
                    for line in preview.read_text(encoding="utf-8").splitlines()
                    if line.startswith("AUTH_USERS=")
                ),
                None,
            )
            if preview.exists()
            else None
        )
        if auth_line is None:
            raise SystemExit(
                "Gere primeiro os usuários para preview: uv run python apps/api/scripts/provision_auth_users.py preview"
            )
        lines = (
            target.read_text(encoding="utf-8").splitlines() if target.exists() else []
        )
        lines = [
            line
            for line in lines
            if not line.startswith("AUTH_USERS=")
            and line.partition("=")[0] not in LEGACY_KEYS
        ]
        lines.append(auth_line)
        target.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("Hashes de autenticação aplicados ao arquivo local ignorado pelo Git.")
        return
    if not target.exists():
        template = target.with_name(f".env.{args.environment}.example")
        target.write_text(template.read_text(encoding="utf-8"), encoding="utf-8")

    configured = []
    for user_id, username in USERS:
        password_data = hash_password(username)
        configured.append(
            {
                "id": user_id,
                "username": username,
                "role": "owner",
                **password_data,
            }
        )
    serialized = json.dumps(configured, separators=(",", ":"))
    lines = target.read_text(encoding="utf-8").splitlines()
    lines = [
        line
        for line in lines
        if not line.startswith("AUTH_USERS=")
        and line.partition("=")[0] not in LEGACY_KEYS
    ]
    lines.append(f"AUTH_USERS={serialized}")
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(
        f"Hashes PBKDF2 das contas autorizadas gravados em {target.relative_to(ROOT)}."
    )
    print(
        "O arquivo é ignorado pelo Git. Confirme também os outros secrets antes do deploy."
    )


if __name__ == "__main__":
    main()
