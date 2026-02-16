from __future__ import annotations

from pathlib import Path
import shutil
import sys

import grpc_tools
from grpc_tools import protoc


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    backend_dir = script_dir.parent
    repo_root = backend_dir.parent
    proto_root = repo_root / "proto"
    output_dir = backend_dir
    grpc_include = Path(grpc_tools.__file__).resolve().parent / "_proto"
    generated_root = output_dir / "orchestrator"

    if generated_root.exists():
        shutil.rmtree(generated_root)
    generated_root.mkdir(parents=True, exist_ok=True)

    proto_files = [
        str(p)
        for p in proto_root.rglob("*.proto")
        if p.is_file()
    ]

    if not proto_files:
        print("No proto files found.", file=sys.stderr)
        return 1

    result = protoc.main(
        [
            "grpc_tools.protoc",
            f"-I{proto_root}",
            f"-I{grpc_include}",
            f"--python_out={output_dir}",
            f"--grpc_python_out={output_dir}",
            *proto_files,
        ]
    )

    if result != 0:
        return result

    for directory in [generated_root, *generated_root.rglob("*")]:
        if directory.is_dir():
            init_file = directory / "__init__.py"
            if not init_file.exists():
                init_file.write_text("", encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
