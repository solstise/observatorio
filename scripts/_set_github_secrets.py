"""Setea secrets en GitHub Actions usando PyNaCl sealed boxes."""
from __future__ import annotations

import json
import os
import sys
import urllib.request
import urllib.error
from base64 import b64encode

from nacl import encoding, public

REPO = "solstise/observatorio"
PAT = os.environ["GH_PAT"]


def get_public_key() -> tuple[str, str]:
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/actions/secrets/public-key",
        headers={"Authorization": f"token {PAT}", "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    return d["key"], d["key_id"]


def encrypt(public_key_b64: str, plaintext: str) -> str:
    pk = public.PublicKey(public_key_b64.encode("utf-8"), encoding.Base64Encoder())
    sealed = public.SealedBox(pk).encrypt(plaintext.encode("utf-8"))
    return b64encode(sealed).decode("utf-8")


def set_secret(name: str, plaintext: str, pk_b64: str, key_id: str) -> None:
    encrypted = encrypt(pk_b64, plaintext)
    body = json.dumps({"encrypted_value": encrypted, "key_id": key_id}).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/actions/secrets/{name}",
        data=body,
        method="PUT",
        headers={
            "Authorization": f"token {PAT}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"  {name} -> HTTP {r.status}")
    except urllib.error.HTTPError as e:
        print(f"  {name} -> HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    pk_b64, key_id = get_public_key()
    print(f"Public key id: {key_id}")

    secrets = {
        "UPSTASH_REDIS_REST_URL": "https://fit-tick-106677.upstash.io",
        "UPSTASH_REDIS_REST_TOKEN": "gQAAAAAAAaC1AAIgcDJlY2UwZGVmODBhYzQ0OTFhOGU5Zjc4NTRjYzQ5OWIwYg",
    }

    # SSH key for VPS deploy
    with open(os.path.expanduser("~/.ssh/id_ed25519"), "r") as f:
        secrets["VPS_SSH_KEY"] = f.read()

    # Known hosts for VPS
    with open(os.path.expanduser("~/.ssh/known_hosts"), "r") as f:
        secrets["VPS_KNOWN_HOSTS"] = f.read()

    print(f"Subiendo {len(secrets)} secrets...")
    for name, value in secrets.items():
        set_secret(name, value, pk_b64, key_id)

    print("\nDone.")


if __name__ == "__main__":
    main()
