import type { grpc } from "@improbable-eng/grpc-web";

import type {
  BatchCreateTasksResponse,
  CancelTaskResponse,
  CreateTaskFromTemplateResponse,
  CreateTaskResponse,
  GetTaskResponse,
  GetTaskLineageResponse,
  ListTaskTemplatesResponse,
  RetryTaskResponse,
  Task as TaskRecord,
  TaskTemplate,
} from "./generated/orchestrator/v1/tasks";
import { taskServiceClient } from "./client";
import { normalizeGrpcError } from "./grpcErrors";
import { createRpcMetadata } from "./rpcContext";

export interface CreateTaskInput {
  name: string;
  prompt: string;
  parentTaskId?: string;
}

export interface BatchCreateTaskInput {
  name: string;
  prompt: string;
  parentTaskId?: string;
}

export interface CreateTaskFromTemplateInput {
  templateId: string;
  inputText: string;
  name?: string;
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

function getTaskFromRetry(response: RetryTaskResponse): TaskRecord {
  if (!response.task) {
    throw new Error("RetryTask returned an empty task payload.");
  }
  return response.task;
}

function getTaskFromCancel(response: CancelTaskResponse): TaskRecord {
  if (!response.task) {
    throw new Error("CancelTask returned an empty task payload.");
  }
  return response.task;
}

function getTaskFromTemplate(response: CreateTaskFromTemplateResponse): TaskRecord {
  if (!response.task) {
    throw new Error("CreateTaskFromTemplate returned an empty task payload.");
  }
  return response.task;
}

function getTasksFromBatch(response: BatchCreateTasksResponse): TaskRecord[] {
  return response.tasks ?? [];
}

function getTemplates(response: ListTaskTemplatesResponse): TaskTemplate[] {
  return response.templates ?? [];
}

function getLineage(response: GetTaskLineageResponse): GetTaskLineageResponse {
  if (!response.rootTask) {
    throw new Error("GetTaskLineage returned an empty root task.");
  }
  return response;
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

export async function retryTask(id: string): Promise<TaskRecord> {
  return invokeRpc(async (metadata) => {
    const response = await taskServiceClient.RetryTask({ id }, metadata);
    return getTaskFromRetry(response);
  }, "Failed to retry task.");
}

export async function cancelTask(id: string): Promise<TaskRecord> {
  return invokeRpc(async (metadata) => {
    const response = await taskServiceClient.CancelTask({ id }, metadata);
    return getTaskFromCancel(response);
  }, "Failed to cancel task.");
}

export async function batchCreateTasks(tasks: BatchCreateTaskInput[]): Promise<TaskRecord[]> {
  return invokeRpc(async (metadata, userId) => {
    const response = await taskServiceClient.BatchCreateTasks(
      {
        tasks: tasks.map((task) => ({
          name: task.name,
          prompt: task.prompt,
          parentTaskId: task.parentTaskId ?? "",
          createdBy: userId,
        })),
      },
      metadata,
    );
    return getTasksFromBatch(response);
  }, "Failed to create tasks in batch.");
}

export async function listTaskTemplates(): Promise<TaskTemplate[]> {
  return invokeRpc(async (metadata) => {
    const response = await taskServiceClient.ListTaskTemplates({}, metadata);
    return getTemplates(response);
  }, "Failed to list task templates.");
}

export async function createTaskFromTemplate(
  input: CreateTaskFromTemplateInput,
): Promise<TaskRecord> {
  return invokeRpc(async (metadata, userId) => {
    const response = await taskServiceClient.CreateTaskFromTemplate(
      {
        templateId: input.templateId,
        inputText: input.inputText,
        name: input.name ?? "",
        parentTaskId: input.parentTaskId ?? "",
        createdBy: userId,
      },
      metadata,
    );
    return getTaskFromTemplate(response);
  }, "Failed to create task from template.");
}

export async function getTaskLineage(id: string, maxDepth = 10): Promise<GetTaskLineageResponse> {
  return invokeRpc(async (metadata) => {
    const response = await taskServiceClient.GetTaskLineage(
      {
        id,
        maxDepth,
      },
      metadata,
    );
    return getLineage(response);
  }, "Failed to load task lineage.");
}
