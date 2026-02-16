const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";

const protoc = path.join(
  root,
  "node_modules",
  ".bin",
  isWindows ? "grpc_tools_node_protoc.cmd" : "grpc_tools_node_protoc"
);

const tsProtoPlugin = path.join(
  root,
  "node_modules",
  ".bin",
  isWindows ? "protoc-gen-ts_proto.cmd" : "protoc-gen-ts_proto"
);

const grpcToolsInclude = path.join(root, "node_modules", "grpc-tools", "bin");

const args = [
  `--plugin=protoc-gen-ts_proto=${tsProtoPlugin}`,
  "--ts_proto_out=./src/grpc/generated",
  "--ts_proto_opt=esModuleInterop=true,env=browser,useOptionals=none,outputClientImpl=grpc-web,forceLong=string",
  "-I",
  "../proto",
  "-I",
  grpcToolsInclude,
  "../proto/orchestrator/v1/tasks.proto",
];

const result = spawnSync(protoc, args, {
  cwd: root,
  stdio: "inherit",
  shell: isWindows,
});

if (result.error) {
  console.error(result.error);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
