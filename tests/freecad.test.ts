import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFreeCadModel } from '../src/engines/freecad.js';
import { initializeProject } from '../src/project.js';

async function writeExecutable(filePath: string, content: string): Promise<string> {
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
  return filePath;
}

describe('FreeCAD orchestration', () => {
  it('passes model and output paths after --pass', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bimctl-freecad-'));
    const project = await initializeProject(directory, { name: 'FreeCAD Test' });
    const outputPath = join(directory, 'runs', 'shoebox.FCStd');
    const freecadPath = await writeExecutable(join(directory, 'freecadcmd'), `#!/bin/sh
set -eu
script="$1"
shift
if [ "$1" != "--pass" ]; then
  echo "missing --pass" >&2
  exit 12
fi
shift
model="$1"
output="$2"
printf '%s\n%s\n%s\n' "$script" "$model" "$output" > "$(dirname "$output")/invocation.txt"
: > "$output"
`);

    const result = await buildFreeCadModel(project.modelPath, {
      outputPath,
      freecadCommand: freecadPath,
      cwd: directory
    });

    expect(result.status).toBe('completed');
    expect(result.args).toEqual([result.scriptPath, '--pass', project.modelPath, outputPath]);
    expect(await readFile(join(directory, 'runs', 'invocation.txt'), 'utf8')).toBe(`${result.scriptPath}\n${project.modelPath}\n${outputPath}\n`);
  });

  it('extracts freecadcmd from an AppImage and uses it for headless builds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bimctl-freecad-appimage-'));
    const project = await initializeProject(directory, { name: 'FreeCAD AppImage Test' });
    const outputPath = join(directory, 'runs', 'shoebox.FCStd');
    const appImagePath = await writeExecutable(join(directory, 'FreeCAD.AppImage'), `#!/bin/sh
set -eu
case "$1" in
  --appimage-extract)
    mkdir -p squashfs-root/usr/bin
    cat > squashfs-root/usr/bin/freecadcmd <<'INNER'
#!/bin/sh
set -eu
script="$1"
shift
if [ "$1" != "--pass" ]; then
  echo "missing --pass" >&2
  exit 13
fi
shift
model="$1"
output="$2"
printf '%s\n%s\n%s\n' "$script" "$model" "$output" > "$(dirname "$output")/invocation.txt"
: > "$output"
INNER
    chmod +x squashfs-root/usr/bin/freecadcmd
    exit 0
    ;;
  --appimage-version)
    echo 'type 2'
    exit 0
    ;;
esac
echo "unexpected invocation: $*" >&2
exit 14
`);

    const result = await buildFreeCadModel(project.modelPath, {
      outputPath,
      freecadCommand: appImagePath,
      cwd: directory
    });

    expect(result.status).toBe('completed');
    expect(result.command).toContain('/squashfs-root/usr/bin/freecadcmd');
    expect(await readFile(join(directory, 'runs', 'invocation.txt'), 'utf8')).toBe(`${result.scriptPath}\n${project.modelPath}\n${outputPath}\n`);
  });
});