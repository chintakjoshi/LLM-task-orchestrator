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

const result = isWindows
  ? { status: 1 }
  : spawnSync(protoc, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });

if (result.status === 0) {
  process.exit(0);
}

const grpcInclude = spawnSync(
  "python",
  [
    "-c",
    "import grpc_tools, pathlib; print(pathlib.Path(grpc_tools.__file__).resolve().parent / '_proto')",
  ],
  { cwd: root, encoding: "utf-8" }
);

if (grpcInclude.status !== 0 || !grpcInclude.stdout.trim()) {
  if (result.error) {
    console.error(result.error);
  }
  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  process.exit(1);
}

const fallbackArgs = [
  "-m",
  "grpc_tools.protoc",
  `--plugin=protoc-gen-ts_proto=${tsProtoPlugin}`,
  "--ts_proto_out=./src/grpc/generated",
  "--ts_proto_opt=esModuleInterop=true,env=browser,useOptionals=none,outputClientImpl=grpc-web,forceLong=string",
  "-I",
  "../proto",
  "-I",
  grpcInclude.stdout.trim(),
  "../proto/orchestrator/v1/tasks.proto",
];

const fallback = spawnSync("python", fallbackArgs, {
  cwd: root,
  stdio: "inherit",
  shell: isWindows,
});

if (typeof fallback.status === "number") {
  process.exit(fallback.status);
}

process.exit(1);
