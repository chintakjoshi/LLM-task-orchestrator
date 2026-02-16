/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GRPC_WEB_URL?: string;
  readonly VITE_USER_ID?: string;
  readonly VITE_GRPC_TIMEOUT_SECONDS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
