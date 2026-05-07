import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR_NAME = '.wmind';

function resolveHomeDir(): string {
	return join(homedir(), CONFIG_DIR_NAME);
}

const EMBED_DIR = process.env.WMIND_EMBEDDED_DIR;

export function getProjectRoot(): string {
	return EMBED_DIR || join(__dirname, '..');
}

export function getBuiltinPacksDir(): string {
	return EMBED_DIR ? join(EMBED_DIR, 'packs') : join(__dirname, '..', 'packs');
}

export function getDataDir(): string {
	return EMBED_DIR ? join(EMBED_DIR, 'data') : join(__dirname, '..', 'data');
}

export function getConfigDir(): string {
	return resolveHomeDir();
}

export function getMemoriesDir(): string {
	return join(resolveHomeDir(), 'memories');
}

export function getDefaultMemoryPath(): string {
	return join(resolveHomeDir(), 'memory.jsonl');
}

export function getStorePath(name: string): string {
	if (name === 'default') return join(resolveHomeDir(), 'memory.jsonl');
	return join(getMemoriesDir(), `${name}.jsonl`);
}

export function getSessionsDir(): string {
	return join(resolveHomeDir(), 'sessions');
}

export function getPacksDir(): string {
	return join(resolveHomeDir(), 'packs');
}

export function getExportsDir(): string {
	return join(resolveHomeDir(), 'exports');
}

export function getResearchDir(): string {
	return join(resolveHomeDir(), 'research');
}

export function getCommandsDir(): string {
	return join(resolveHomeDir(), 'commands');
}

export function getSkillsDir(): string {
	return join(resolveHomeDir(), 'skills');
}

export function getProvidersPath(): string {
	return join(resolveHomeDir(), 'providers.jsonc');
}

export function getMcpProjectDir(): string {
	return '.wmind';
}
