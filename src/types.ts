export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ToolErrorPayload {
  code: string;
  message: string;
  details?: JsonValue;
}

export interface CommandEnvelope<TData = JsonValue> {
  ok: boolean;
  data?: TData;
  error?: ToolErrorPayload;
}

export interface ExternalRunResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export class BimctlError extends Error {
  readonly code: string;
  readonly details?: JsonValue;

  constructor(code: string, message: string, details?: JsonValue) {
    super(message);
    this.name = 'BimctlError';
    this.code = code;
    this.details = details;
  }
}