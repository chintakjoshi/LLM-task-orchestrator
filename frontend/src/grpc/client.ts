import { GrpcWebImpl, TaskServiceClientImpl } from "./generated/orchestrator/v1/tasks";

const grpcWebUrl = import.meta.env.VITE_GRPC_WEB_URL ?? "http://localhost:8080";

const rpc = new GrpcWebImpl(grpcWebUrl, {});

export const taskServiceClient = new TaskServiceClientImpl(rpc);
