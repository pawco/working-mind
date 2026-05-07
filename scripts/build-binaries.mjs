import { mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version;

const ALL_TARGETS = [
	['bun-darwin-arm64', 'wmind-darwin-arm64'],
	['bun-darwin-x64', 'wmind-darwin-x64'],
	['bun-linux-x64', 'wmind-linux-x64'],
	['bun-linux-arm64', 'wmind-linux-arm64'],
	['bun-windows-x64', 'wmind-windows-x64.exe'],
];

function detectCurrentTarget() {
	const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : null;
	const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
	if (!platform || !arch) return undefined;
	return [`bun-${platform}-${arch}`, `wmind-${platform}-${arch}`];
}

const requestedTarget = process.argv[2];
let targets;

if (requestedTarget === 'all') {
	targets = ALL_TARGETS;
} else if (requestedTarget) {
	const found = ALL_TARGETS.find(([t]) => t === requestedTarget);
	if (!found) {
		console.error(`Unknown target: ${requestedTarget}`);
		console.error(`Valid targets: ${ALL_TARGETS.map(([t]) => t).join(', ')}, all`);
		process.exit(1);
	}
	targets = [found];
} else {
	const current = detectCurrentTarget();
	if (!current) {
		console.error('Cannot detect current platform. Specify a target explicitly.');
		process.exit(1);
	}
	targets = [current];
}

rmSync(resolve(distDir, 'binaries'), { recursive: true, force: true });
mkdirSync(resolve(distDir, 'binaries', 'raw'), { recursive: true });

const versionSrc = resolve(root, 'src', 'version.ts');
const origVersionContent = readFileSync(versionSrc, 'utf-8');
writeFileSync(versionSrc, origVersionContent.replace("'0.0.1-dev'", `'${version}'`), 'utf-8');

console.log(`Building binaries for v${version}...\n`);

for (const [target, outfile] of targets) {
	const outPath = resolve(distDir, 'binaries', 'raw', outfile);
	console.log(`  ${target} → ${outfile}`);
	try {
		await $`bun build ${resolve(root, 'src', 'binary-entry.ts')} --compile --target=${target} --outfile=${outPath} --minify`.quiet();
	} catch (err) {
		console.error(`  FAILED: ${target}`);
		console.error(`    ${err}`);
		continue;
	}
	const stat = await Bun.file(outPath).stat();
	const mb = (stat.size / 1024 / 1024).toFixed(1);
	console.log(`    ${mb} MB`);
}

writeFileSync(versionSrc, origVersionContent, 'utf-8');

console.log('\nGenerating platform packages...');

const rawDir = resolve(distDir, 'binaries', 'raw');

for (const [_target, outfile] of targets) {
	const rawBinary = resolve(rawDir, outfile);
	try {
		await Bun.file(rawBinary).stat();
	} catch {
		console.log(`  Skipping ${outfile} (build failed)`);
		continue;
	}

	const pkgName = outfile.replace('.exe', '');
	const pkgDir = resolve(distDir, 'binaries', pkgName);
	mkdirSync(resolve(pkgDir, 'bin'), { recursive: true });

	const isWin = outfile.endsWith('.exe');
	const binaryDest = resolve(pkgDir, 'bin', `wmind${isWin ? '.exe' : ''}`);
	copyFileSync(rawBinary, binaryDest);

	const osField = isWin ? 'win32' : _target.split('-')[1];
	const cpuField = _target.split('-')[2] === 'arm64' ? 'arm64' : 'x64';

	const pkgJson = {
		name: pkgName,
		version,
		description: `Working Mind binary for ${osField}/${cpuField}`,
		license: 'MIT',
		os: [osField],
		cpu: [cpuField],
	};

	writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

	console.log(`  ${pkgName}/`);
}

rmSync(rawDir, { recursive: true, force: true });
console.log('\nDone. Platform packages in dist/binaries/');
