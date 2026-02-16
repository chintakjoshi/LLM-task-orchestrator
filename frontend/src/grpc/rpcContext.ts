import type { grpc } from "@improbable-eng/grpc-web";
import { BrowserHeaders } from "browser-headers";

const FALLBACK_USER_ID = "web-user";
const FALLBACK_TIMEOUT_SECONDS = 10;

function resolveUserId(userId?: string): string {
  const candidate = (userId ?? import.meta.env.VITE_USER_ID ?? FALLBACK_USER_ID).trim();
  return candidate.length > 0 ? candidate : FALLBACK_USER_ID;
}

function resolveTimeoutSeconds(): number {
  const configured = Number(import.meta.env.VITE_GRPC_TIMEOUT_SECONDS ?? FALLBACK_TIMEOUT_SECONDS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return FALLBACK_TIMEOUT_SECONDS;
  }
  return Math.floor(configured);
}

function generateRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface RpcRequestContext {
  requestId: string;
  userId: string;
  timeoutSeconds: number;
}

export function createRpcMetadata(
  userId?: string,
): { metadata: grpc.Metadata; context: RpcRequestContext } {
  const requestId = generateRequestId();
  const resolvedUserId = resolveUserId(userId);
  const timeoutSeconds = resolveTimeoutSeconds();
  const metadata = new BrowserHeaders({
    "x-request-id": requestId,
    "x-user-id": resolvedUserId,
    "grpc-timeout": `${timeoutSeconds}S`,
  }) as grpc.Metadata;

  return {
    metadata,
    context: {
      requestId,
      userId: resolvedUserId,
      timeoutSeconds,
    },
  };
}
