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
		const stubs = {
			'react-devtools-core': 'export default {};',
		};

		for (const [mod, contents] of Object.entries(stubs)) {
			const key = mod.replace(/[/.]/g, '_');
			build.onResolve({ filter: new RegExp(`^${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }, () => ({
				path: key,
				namespace: 'stub',
			}));
			build.onLoad({ filter: new RegExp(`^${key}$`), namespace: 'stub' }, () => ({
				contents,
				loader: 'js',
			}));
		}
	},
};

const tuiStubPlugin = {
	name: 'tui-stub-for-main',
	setup(build) {
		build.onResolve({ filter: /^\.\/app-opentui\.js$/ }, () => ({
			path: 'app_opentui_stub',
			namespace: 'tui-stub',
		}));
		build.onLoad({ filter: /^app_opentui_stub$/, namespace: 'tui-stub' }, () => ({
			contents: `
export async function startAgentTUI() {
  const isBun = typeof Bun !== 'undefined';
  if (!isBun) {
    throw Object.assign(new Error('TUI_REQUIRES_BUN'), { code: 'TUI_REQUIRES_BUN' });
  }
  const real = await import('./tui.mjs');
  return real.startAgentTUI.apply(this, arguments);
}
`,
			loader: 'js',
			resolveDir: 'dist',
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
	plugins: [stubPlugin, tuiStubPlugin],
	external: ['./tui.mjs'],
	define: {
		'import.meta.env.PACKAGE_VERSION': `"${pkg.version}"`,
	},
	banner: {
		js: `import{createRequire as _cr}from"node:module";import{fileURLToPath as _fu}from"node:url";import{dirname as _dn}from"node:path";var require=_cr(import.meta.url);var __filename=_fu(import.meta.url);var __dirname=_dn(__filename);`,
	},
	minify: false,
	sourcemap: false,
});

await esbuild.build({
	entryPoints: ['src/app-opentui.tsx'],
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'esm',
	outfile: 'dist/tui.mjs',
	packages: 'bundle',
	plugins: [],
	external: ['@opentui/core', '@opentui/react', 'react', 'react-devtools-core'],
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
