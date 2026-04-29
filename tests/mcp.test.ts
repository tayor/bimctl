import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, onTimeout?: () => void | Promise<void>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void onTimeout?.();
      reject(new Error(`${label} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

describe('bimctl MCP server', () => {
  it('starts over stdio and exposes BIM tools', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, 'mcp']
    });
    const client = new Client({ name: 'bimctl-test-client', version: '0.0.0' });
    let connected = false;

    try {
      await withTimeout(client.connect(transport), 5_000, 'MCP connect', () => transport.close());
      connected = true;
      const tools = await withTimeout(client.listTools(), 5_000, 'MCP listTools');
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        'bimctl_doctor',
        'bimctl_create_building_model',
        'bimctl_analyze_model',
        'bimctl_validate_model',
        'bimctl_simulate',
        'bimctl_freecad_build'
      ]));
    } finally {
      if (connected) {
        await withTimeout(client.close(), 5_000, 'MCP close', () => transport.close());
      } else {
        await transport.close().catch(() => undefined);
      }
    }
  }, 10_000);
});