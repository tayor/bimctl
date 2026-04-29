import { spawn } from 'node:child_process';
import { ExternalRunResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_KILL_AFTER_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

export interface RunExternalCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  killAfterMs?: number;
  maxOutputBytes?: number;
}

function appendBoundedOutput(current: string, chunk: string, maxBytes: number): string {
  const combined = current + chunk;
  if (Buffer.byteLength(combined, 'utf8') <= maxBytes) return combined;
  return combined.slice(-maxBytes);
}

export async function runExternalCommand(
  command: string,
  args: string[],
  options: RunExternalCommandOptions = {}
): Promise<ExternalRunResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killAfterMs = options.killAfterMs ?? DEFAULT_KILL_AFTER_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return await new Promise<ExternalRunResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), killAfterMs);
      }, timeoutMs)
      : undefined;

    const clearTimers = () => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout = appendBoundedOutput(stdout, chunk, maxOutputBytes);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr = appendBoundedOutput(stderr, chunk, maxOutputBytes);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        command,
        args,
        exitCode: null,
        signal: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
        durationMs: Date.now() - startedAt,
        timedOut
      });
    });

    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        command,
        args,
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut
      });
    });
  });
}