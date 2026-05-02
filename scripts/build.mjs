import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'),
);

mkdirSync('dist', { recursive: true });

const stubPlugin = {
	name: 'stub-optional-deps',
	setup(build) {
		build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
			path: 'react-devtools-core',
			namespace: 'stub',
		}));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
			contents: 'export default {};',
			loader: 'js',
		}));
	},
};

await esbuild.build({
	entryPoints: ['src/index.ts'],
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'esm',
	outfile: 'dist/index.mjs',
	packages: 'bundle',
	plugins: [stubPlugin],
	external: ['keytar'],
	define: {
		'import.meta.env.PACKAGE_VERSION': `"${pkg.version}"`,
	},
	banner: {
		js: `import{createRequire as _cr}from"node:module";import{fileURLToPath as _fu}from"node:url";import{dirname as _dn}from"node:path";var require=_cr(import.meta.url);var __filename=_fu(import.meta.url);var __dirname=_dn(__filename);`,
	},
	minify: false,
	sourcemap: false,
});

writeFileSync(
	'dist/cli.cjs',
	`#!/usr/bin/env node
const { pathToFileURL } = require('url');
const { join } = require('path');
import(pathToFileURL(join(__dirname, 'index.mjs')).href);
`,
);

console.log(`Built dist/ (v${pkg.version})`);
