import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const binariesDir = resolve(root, 'dist', 'binaries');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version;

console.log(`Publishing wmind v${version}...\n`);

const entries = readdirSync(binariesDir, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name);

for (const pkgName of entries) {
	const pkgDir = resolve(binariesDir, pkgName);
	console.log(`  Publishing ${pkgName}@${version}...`);
	try {
		await $`npm publish ${pkgDir} --access public`.quiet();
		console.log(`    OK`);
	} catch (err) {
		console.error(`    FAILED: ${err}`);
	}
}

console.log(`\n  Publishing main wmind@${version}...`);
try {
	await $`npm publish ${root} --access public`.quiet();
	console.log('    OK');
} catch (err) {
	console.error(`    FAILED: ${err}`);
}

console.log('\nDone.');
