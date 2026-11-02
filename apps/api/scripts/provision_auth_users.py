"""Cadastra credenciais diretamente na tabela privada users do D1."""

from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import getpass
import hashlib
import re
import secrets
import shutil
import subprocess
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
API = ROOT / "apps" / "api"
ITERATIONS = 100_000
DATABASES = {
    "local": "sabores-canastra-local",
    "preview": "sabores-canastra-preview",
    "production": "sabores-canastra-production",
}


def encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def collect_user(role: str = "owner") -> tuple[str, str, str, str, str]:
    username = input("Nome de usuário: ").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", username):
        raise SystemExit("O nome de usuário precisa ter de 1 a 80 caracteres.")
    password = getpass.getpass("Senha (mínimo de 4 caracteres): ")
    confirmation = getpass.getpass("Confirme a senha: ")
    if password != confirmation:
        raise SystemExit("As senhas não conferem.")
    if not 4 <= len(password.encode("utf-16-le")) // 2 <= 128:
        raise SystemExit("A senha deve ter entre 4 e 128 caracteres.")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, ITERATIONS, dklen=32
    )
    return (
        username,
        encode(salt),
        encode(digest),
        str(uuid.uuid4()),
        role,
    )


def statements(user: tuple[str, str, str, str, str]) -> str:
    username, salt, digest, user_id, role = user
    name = sql_string(username)
    created = sql_string(datetime.now(timezone.utc).isoformat())
    return f"""INSERT INTO users (user_id, username, role, salt, password_hash, iterations, active, created_at, updated_at)
VALUES (COALESCE((SELECT user_id FROM auth_users WHERE username = {name} COLLATE NOCASE LIMIT 1), {sql_string(user_id)}), {name}, {sql_string(role)}, {sql_string(salt)}, {sql_string(digest)}, {ITERATIONS}, 1, {created}, {created})
ON CONFLICT(username) DO UPDATE SET role=excluded.role, salt=excluded.salt, password_hash=excluded.password_hash, iterations=excluded.iterations, active=1, updated_at=excluded.updated_at;
INSERT INTO auth_users (user_id, username, role, active, created_at)
SELECT user_id, username, role, active, created_at FROM users WHERE username = {name} COLLATE NOCASE
ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, role=excluded.role, active=excluded.active;
UPDATE auth_sessions SET revoked_at = {created}
WHERE user_id = (SELECT user_id FROM users WHERE username = {name} COLLATE NOCASE) AND revoked_at IS NULL;
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", choices=tuple(DATABASES))
    parser.add_argument("--role", choices=("owner", "operator"), default="owner")
    args = parser.parse_args()
    count = input("Quantidade de usuários para cadastrar/atualizar: ").strip()
    if not count.isdecimal() or not 1 <= int(count) <= 100:
        raise SystemExit("Informe uma quantidade entre 1 e 100.")
    sql = "\n".join(statements(collect_user(args.role)) for _ in range(int(count)))
    temporary = ROOT / ".local" / f"provision-users-{args.environment}.sql"
    temporary.parent.mkdir(parents=True, exist_ok=True)
    temporary.write_text(sql, encoding="utf-8")
    pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
    if not pnpm:
        temporary.unlink(missing_ok=True)
        raise SystemExit("pnpm não foi encontrado no PATH.")
    command = [
        pnpm,
        "--filter",
        "@sabores/api",
        "exec",
        "wrangler",
        "d1",
        "execute",
        DATABASES[args.environment],
        "--file",
        str(temporary),
        "--config",
        "wrangler.jsonc",
    ]
    if args.environment == "local":
        command.append("--local")
    else:
        command.extend(("--remote", "--env", args.environment))
    try:
        subprocess.run(command, cwd=API, check=True)
    finally:
        temporary.unlink(missing_ok=True)
    print("Credenciais cadastradas/atualizadas no D1; nenhuma senha foi exibida.")


if __name__ == "__main__":
    main()
