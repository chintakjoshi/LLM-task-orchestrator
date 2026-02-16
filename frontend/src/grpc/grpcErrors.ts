import { grpc } from "@improbable-eng/grpc-web";
import type { BrowserHeaders } from "browser-headers";

import { GrpcWebError } from "./generated/orchestrator/v1/tasks";

const GRPC_ERROR_MESSAGES: Partial<Record<grpc.Code, string>> = {
  [grpc.Code.InvalidArgument]: "Request validation failed.",
  [grpc.Code.NotFound]: "Requested task was not found.",
  [grpc.Code.DeadlineExceeded]: "Request timed out before the server could respond.",
  [grpc.Code.Unavailable]: "Task service is temporarily unavailable.",
  [grpc.Code.PermissionDenied]: "You do not have permission to perform this action.",
  [grpc.Code.Unauthenticated]: "Authentication is required to perform this action.",
  [grpc.Code.ResourceExhausted]: "Service is currently overloaded. Please retry shortly.",
  [grpc.Code.Canceled]: "The operation was cancelled before completion.",
  [grpc.Code.FailedPrecondition]: "Request could not be processed in the current state.",
  [grpc.Code.Internal]: "Task service failed to process the request.",
};

export class RpcClientError extends Error {
  readonly code: grpc.Code | undefined;
  readonly requestId: string | undefined;

  constructor(message: string, code?: grpc.Code, requestId?: string) {
    super(message);
    this.name = "RpcClientError";
    this.code = code;
    this.requestId = requestId;
  }
}

function extractMetadataValue(metadata: grpc.Metadata | undefined, key: string): string | undefined {
  if (!metadata) {
    return undefined;
  }

  const headers = metadata as BrowserHeaders;
  const direct = headers.get?.(key) ?? headers.get?.(key.toLowerCase());
  if (Array.isArray(direct) && direct.length > 0) {
    const value = direct[0].trim();
    if (value) {
      return value;
    }
  }

  const map = (headers as { headersMap?: Record<string, string[]> }).headersMap;
  if (!map) {
    return undefined;
  }

  const candidates = [map[key], map[key.toLowerCase()]];
  for (const values of candidates) {
    if (!Array.isArray(values) || values.length === 0) {
      continue;
    }
    const value = values[0].trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function normalizeGrpcError(error: unknown, fallbackMessage: string): RpcClientError {
  if (error instanceof RpcClientError) {
    return error;
  }

  if (error instanceof GrpcWebError) {
    const baseMessage = GRPC_ERROR_MESSAGES[error.code] ?? fallbackMessage;
    const requestId = extractMetadataValue(error.metadata, "x-request-id");
    const detail = error.message?.trim();
    const detailSuffix = detail ? ` Details: ${detail}.` : "";
    const requestSuffix = requestId && !(detail?.includes(requestId) ?? false)
      ? ` request_id=${requestId}`
      : "";
    return new RpcClientError(`${baseMessage}${detailSuffix}${requestSuffix}`.trim(), error.code, requestId);
  }

  if (error instanceof Error) {
    return new RpcClientError(error.message || fallbackMessage);
  }

  return new RpcClientError(fallbackMessage);
}
