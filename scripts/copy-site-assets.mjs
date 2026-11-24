import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const appOutput = join(output, 'eraudio');
const appFiles = [
  'ErAudio.json',
  'app.js',
  'history-sync.js',
  'history.js',
  'index.html',
  'styles.css',
  'tempo.js',
];

await mkdir(appOutput, { recursive: true });
for (const file of appFiles) {
  await cp(join(root, file), join(appOutput, file));
}
await cp(join(root, 'visualizer'), join(appOutput, 'visualizer'), { recursive: true });
await cp(join(root, 'privacy.html'), join(output, 'privacy.html'));
await cp(join(root, 'privacy.html'), join(appOutput, 'privacy.html'));
await writeFile(join(output, '.nojekyll'), '');
