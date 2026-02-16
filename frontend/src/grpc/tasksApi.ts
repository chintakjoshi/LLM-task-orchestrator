import type {
  CreateTaskResponse,
  GetTaskResponse,
  Task as TaskRecord,
  TriggerTestTaskResponse,
} from "./generated/orchestrator/v1/tasks";
import { taskServiceClient } from "./client";

export interface CreateTaskInput {
  name: string;
  prompt: string;
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

function getTaskFromTrigger(response: TriggerTestTaskResponse): TaskRecord {
  if (!response.task) {
    throw new Error("TriggerTestTask returned an empty task payload.");
  }
  return response.task;
}

export async function createTask({ name, prompt }: CreateTaskInput): Promise<TaskRecord> {
  const response = await taskServiceClient.CreateTask({
    name,
    prompt,
    parentTaskId: "",
    createdBy: "",
  });

  return getTaskFromCreate(response);
}

export async function listTasks(): Promise<TaskRecord[]> {
  const response = await taskServiceClient.ListTasks({
    limit: 100,
    offset: 0,
  });

  return response.tasks ?? [];
}

export async function getTask(id: string): Promise<TaskRecord> {
  const response = await taskServiceClient.GetTask({ id });
  return getTaskFromGet(response);
}

export async function triggerTestTask(id: string, sleepSeconds = 5): Promise<TaskRecord> {
  const response = await taskServiceClient.TriggerTestTask({
    id,
    sleepSeconds,
  });
  return getTaskFromTrigger(response);
}
