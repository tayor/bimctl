import { describe, expect, it } from 'vitest';
import { runExternalCommand } from '../src/process.js';

describe('external process runner', () => {
  it('returns quickly when a child process exceeds its timeout', async () => {
    const script = [
      "process.on('SIGTERM', () => {});",
      "process.stdout.write('started\\n');",
      'setInterval(() => {}, 1000);'
    ].join('');

    const result = await runExternalCommand(process.execPath, ['-e', script], {
      timeoutMs: 250,
      killAfterMs: 100
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeLessThan(2_000);
  }, 5_000);
});