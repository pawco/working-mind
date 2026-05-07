#!/usr/bin/env node
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const { platform, arch } = process;

const PLATFORM_MAP = {
	darwin: { arm64: 'wmind-darwin-arm64', x64: 'wmind-darwin-x64' },
	linux: { arm64: 'wmind-linux-arm64', x64: 'wmind-linux-x64' },
	win32: { x64: 'wmind-windows-x64' },
};

const pkgName = PLATFORM_MAP[platform]?.[arch];
if (!pkgName) {
	process.exit(0);
}

try {
	require.resolve(`${pkgName}/bin/wmind`);
	process.exit(0);
} catch {}

const version = require(join(__dirname, '..', 'package.json')).version;
const ext = platform === 'win32' ? '.exe' : '';
const binaryName = `${pkgName}${ext}`;
const url = `https://github.com/pawco/working-brain/releases/download/v${version}/${binaryName}`;

let targetDir;
try {
	const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
	targetDir = join(dirname(pkgJsonPath), 'bin');
} catch {
	process.exit(0);
}

const targetPath = join(targetDir, `wmind${ext}`);

async function download() {
	console.log(`  Downloading Working Mind binary for ${platform}/${arch}...`);
	mkdirSync(targetDir, { recursive: true });

	const res = await fetch(url);
	if (!res.ok) {
		console.error(`  Download failed: ${res.status} ${res.statusText}`);
		console.error(`  The platform binary will not be available.`);
		process.exit(0);
	}

	const file = createWriteStream(targetPath, { mode: 0o755 });
	await pipeline(Readable.fromWeb(res.body), file);
	console.log(`  Installed binary to ${targetPath}`);
}

download().catch(() => {
	console.error('  Failed to download platform binary.');
	process.exit(0);
});
