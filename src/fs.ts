import { access, constants, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { BimctlError } from './types.js';

export function resolvePath(pathLike: string, cwd = process.cwd()): string {
  return isAbsolute(pathLike) ? pathLike : resolve(cwd, pathLike);
}

export async function ensureDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await ensureDirectory(dirname(filePath));
}

export async function pathExists(pathLike: string): Promise<boolean> {
  try {
    await access(pathLike, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isExecutable(pathLike: string): Promise<boolean> {
  try {
    await access(pathLike, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BimctlError('json_read_failed', `Unable to read JSON file ${filePath}: ${message}`);
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureParentDirectory(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeTextFile(filePath: string, value: string): Promise<void> {
  await ensureParentDirectory(filePath);
  await writeFile(filePath, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}

export async function assertWritableTarget(filePath: string, force = false): Promise<void> {
  if (!force && await pathExists(filePath)) {
    throw new BimctlError('target_exists', `Refusing to overwrite existing file: ${filePath}`);
  }
}

export async function fileSize(pathLike: string): Promise<number | null> {
  try {
    const result = await stat(pathLike);
    return result.size;
  } catch {
    return null;
  }
}

export function projectPath(cwd: string, ...parts: string[]): string {
  return join(cwd, ...parts);
}