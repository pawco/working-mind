#!/usr/bin/env node
const { platform, arch } = process;
const path = require('path');
const { spawn } = require('child_process');

const PLATFORM_MAP = {
	darwin: { arm64: 'wmind-darwin-arm64', x64: 'wmind-darwin-x64' },
	linux: { arm64: 'wmind-linux-arm64', x64: 'wmind-linux-x64' },
	win32: { x64: 'wmind-windows-x64' },
};

const pkgName = PLATFORM_MAP[platform]?.[arch];

if (!pkgName) {
	runFallback();
} else {
	try {
		const binary = require.resolve(`${pkgName}/bin/wmind`);
		spawnBinary(binary);
	} catch {
		runFallback();
	}
}

function spawnBinary(binary) {
	const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' });
	child.on('exit', (code) => process.exit(code ?? 0));
	child.on('error', () => runFallback());
}

function runFallback() {
	const entry = path.join(__dirname, '..', 'dist', 'cli.cjs');
	if (require('fs').existsSync(entry)) {
		spawn(process.execPath, [entry, ...process.argv.slice(2)], { stdio: 'inherit' })
			.on('exit', (code) => process.exit(code ?? 0));
	} else {
		console.error('Working Mind: could not start. Reinstall with: npm install -g wmind');
		process.exit(1);
	}
}