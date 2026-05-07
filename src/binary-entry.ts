import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import providersJsoncPath from '../data/providers.jsonc' with { type: 'file' };
import starterPackJsonPath from '../packs/starter/pack.json' with { type: 'file' };
import starterPromptMdPath from '../packs/starter/prompt.md' with { type: 'file' };
import starterReadmeMdPath from '../packs/starter/readme.md' with { type: 'file' };
import starterCurationSummarizePath from '../packs/starter/curation/summarize.md' with { type: 'file' };
import starterCurationExportPath from '../packs/starter/curation/export.md' with { type: 'file' };

const EMBEDDED_FILES: Record<string, string> = {
	'data/providers.jsonc': providersJsoncPath,
	'packs/starter/pack.json': starterPackJsonPath,
	'packs/starter/prompt.md': starterPromptMdPath,
	'packs/starter/readme.md': starterReadmeMdPath,
	'packs/starter/curation/summarize.md': starterCurationSummarizePath,
	'packs/starter/curation/export.md': starterCurationExportPath,
};

const VERSION = (import.meta as any).env?.PACKAGE_VERSION || '0.0.1-dev';
const EMBED_DIR = join(homedir(), '.wmind', 'embedded', VERSION);

function extractFiles() {
	const marker = join(EMBED_DIR, '.extracted');
	if (existsSync(marker)) return;

	for (const [logicalPath, embeddedPath] of Object.entries(EMBEDDED_FILES)) {
		const target = join(EMBED_DIR, logicalPath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, readFileSync(embeddedPath, 'utf-8'), 'utf-8');
	}

	writeFileSync(marker, new Date().toISOString(), 'utf-8');
}

extractFiles();
process.env.WMIND_EMBEDDED_DIR = EMBED_DIR;

await import('./index.js');
