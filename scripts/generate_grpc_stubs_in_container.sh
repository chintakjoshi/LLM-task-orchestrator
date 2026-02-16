#!/bin/sh
set -eu

python3 backend/scripts/generate_grpc_stubs.py

grpc_tools_node_protoc \
  --plugin=protoc-gen-ts_proto="$(command -v protoc-gen-ts_proto)" \
  --ts_proto_out=./frontend/src/grpc/generated \
  --ts_proto_opt=esModuleInterop=true,env=browser,useOptionals=none,outputClientImpl=grpc-web,forceLong=string \
  -I ./proto \
  -I /usr/local/lib/node_modules/grpc-tools/bin \
  ./proto/orchestrator/v1/tasks.proto
