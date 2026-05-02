import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getProjectRoot(): string {
	return join(__dirname, '..');
}

export function getBuiltinPacksDir(): string {
	return join(__dirname, '..', 'packs');
}

export function getDataDir(): string {
	return join(__dirname, '..', 'data');
}

export function getConfigDir(): string {
	return join(homedir(), '.openexplorer');
}

export function getMemoriesDir(): string {
	return join(homedir(), '.openexplorer', 'memories');
}

export function getDefaultMemoryPath(): string {
	return join(homedir(), '.openexplorer', 'memory.jsonl');
}

export function getStorePath(name: string): string {
	if (name === 'default')
		return join(homedir(), '.openexplorer', 'memory.jsonl');
	return join(getMemoriesDir(), `${name}.jsonl`);
}
