import type { grpc } from "@improbable-eng/grpc-web";

import type {
  CreateTaskResponse,
  GetTaskResponse,
  Task as TaskRecord,
} from "./generated/orchestrator/v1/tasks";
import { taskServiceClient } from "./client";
import { normalizeGrpcError } from "./grpcErrors";
import { createRpcMetadata } from "./rpcContext";

export interface CreateTaskInput {
  name: string;
  prompt: string;
  parentTaskId?: string;
}

function getTaskFromCreate(response: CreateTaskResponse): TaskRecord {
  if (!response.task) {
    throw new Error("CreateTask returned an empty task payload.");
  }
  return response.task;
}

function getTaskFromGet(response: GetTaskResponse): TaskRecord {
  if (!response.task) {
    throw new Error("GetTask returned an empty task payload.");
  }
  return response.task;
}

async function invokeRpc<T>(
  operation: (metadata: grpc.Metadata, userId: string) => Promise<T>,
  fallbackMessage: string,
): Promise<T> {
  const { metadata, context } = createRpcMetadata();
  try {
    return await operation(metadata, context.userId);
  } catch (error: unknown) {
    throw normalizeGrpcError(error, fallbackMessage);
  }
}

export async function createTask({
  name,
  prompt,
  parentTaskId,
}: CreateTaskInput): Promise<TaskRecord> {
  return invokeRpc(async (metadata, userId) => {
    const response = await taskServiceClient.CreateTask(
      {
        name,
        prompt,
        parentTaskId: parentTaskId ?? "",
        createdBy: userId,
      },
      metadata,
    );
    return getTaskFromCreate(response);
  }, "Failed to create task.");
}

export async function listTasks(): Promise<TaskRecord[]> {
  return invokeRpc(async (metadata) => {
    const response = await taskServiceClient.ListTasks(
      {
        limit: 100,
        offset: 0,
      },
      metadata,
    );
    return response.tasks ?? [];
  }, "Failed to list tasks.");
}

export async function getTask(id: string): Promise<TaskRecord> {
  return invokeRpc(async (metadata) => {
    const response = await taskServiceClient.GetTask({ id }, metadata);
    return getTaskFromGet(response);
  }, "Failed to load task.");
}
