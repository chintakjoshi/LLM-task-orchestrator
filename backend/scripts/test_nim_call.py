from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.services.nim_client import NIMCallError, NIMClient


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Simple NVIDIA NIM connectivity test (outside Celery).",
    )
    parser.add_argument(
        "--prompt",
        default="Respond with exactly: NIM connectivity OK",
        help="Prompt to send to NVIDIA NIM",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    client = NIMClient()
    try:
        result = client.generate(prompt=args.prompt)
    except NIMCallError as exc:
        print(f"NIM call failed: {exc}", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "model_name": result.model_name,
                "prompt_tokens": result.prompt_tokens,
                "completion_tokens": result.completion_tokens,
                "total_tokens": result.total_tokens,
                "output_text": result.output_text,
            },
            indent=2,
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
