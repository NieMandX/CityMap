import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(rootDir, 'dist');

await mkdir(rootDir, { recursive: true });
await cp(resolve(distDir, 'index.html'), resolve(rootDir, 'index.html'));
await mkdir(resolve(rootDir, 'assets'), { recursive: true });
await cp(resolve(distDir, 'assets'), resolve(rootDir, 'assets'), { recursive: true });
