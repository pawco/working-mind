import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readPackManifest, validateNoRequiredMcp, validateNoRequiredSettings } from './pack-loader.js';

const PACKS_DIR = join(homedir(), '.openexplorer', 'packs');
const MANIFEST_PATH = join(PACKS_DIR, 'manifest.json');

interface InstalledPack {
	name: string;
	source: string;
	version: string;
	installedAt: string;
	sha256?: string;
	linked?: boolean;
}

interface PackManifest {
	name: string;
	version: string;
	description: string;
	author?: string;
	license?: string;
	private?: boolean;
	openexplorerMinVersion?: string;
	prompt: string;
	personas?: any;
	mcpServers?: any;
	settings?: any;
}

function loadManifest(): Record<string, InstalledPack> {
	if (!existsSync(MANIFEST_PATH)) return {};
	try {
		return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
	} catch {
		return {};
	}
}

function saveManifest(manifest: Record<string, InstalledPack>): void {
	mkdirSync(PACKS_DIR, { recursive: true });
	writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function validatePack(packDir: string): string[] {
	const errors: string[] = [];

	let manifest: PackManifest;
	try {
		manifest = readPackManifest(packDir);
	} catch (err: any) {
		errors.push(err.message);
		return errors;
	}

	try {
		validateNoRequiredMcp(manifest as any);
	} catch (err: any) {
		errors.push(err.message);
	}

	try {
		validateNoRequiredSettings(manifest as any);
	} catch (err: any) {
		errors.push(err.message);
	}

	if (!/^[a-z][a-z0-9-]{2,29}$/.test(manifest.name)) {
		errors.push(`Invalid pack name: "${manifest.name}"`);
	}

	if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
		errors.push(`Invalid version: "${manifest.version}"`);
	}

	const promptPath = join(packDir, manifest.prompt);
	if (!existsSync(promptPath)) {
		errors.push(`Prompt file "${manifest.prompt}" not found`);
	} else {
		const promptSize = readFileSync(promptPath, 'utf-8').length;
		if (promptSize > 10_000) {
			errors.push(`Prompt file exceeds 10,000 chars (${promptSize})`);
		}
	}

	if (manifest.personas) {
		for (const [name, def] of Object.entries(manifest.personas)) {
			const personaPath = join(packDir, (def as any).prompt);
			if (!existsSync(personaPath)) {
				errors.push(`Persona "${name}" file not found: ${(def as any).prompt}`);
			}
		}
	}

	return errors;
}

function computeDirectoryHash(dir: string): string {
	const hash = createHash('sha256');
	const files = readdirSync(dir, { recursive: true }) as string[];
	for (const file of files.sort()) {
		const fullPath = join(dir, file);
		if (existsSync(fullPath) && !file.startsWith('.git')) {
			try {
				const content = readFileSync(fullPath);
				hash.update(file);
				hash.update(content);
			} catch {
				// skip unreadable files
			}
		}
	}
	return hash.digest('hex').slice(0, 16);
}

export function installPackFromGit(gitUrl: string, tag?: string): { name: string; errors: string[] } {
	const tmpDir = join(tmpdir(), `oe-pack-install-${Date.now()}`);
	mkdirSync(tmpDir, { recursive: true });

	try {
		const cloneCmd = tag
			? `git clone --depth 1 --branch "${tag}" "${gitUrl}" "${tmpDir}"`
			: `git clone --depth 1 "${gitUrl}" "${tmpDir}"`;
		execSync(cloneCmd, { stdio: 'pipe', timeout: 30_000 });
	} catch (err: any) {
		rmSync(tmpDir, { recursive: true, force: true });
		return { name: '', errors: [`Git clone failed: ${err.message}`] };
	}

	const errors = validatePack(tmpDir);
	if (errors.length > 0) {
		rmSync(tmpDir, { recursive: true, force: true });
		return { name: '', errors };
	}

	const manifest = readPackManifest(tmpDir);
	const packName = manifest.name;
	const targetDir = join(PACKS_DIR, packName);

	if (existsSync(targetDir)) {
		rmSync(targetDir, { recursive: true, force: true });
	}

	execSync(`cp -r "${tmpDir}" "${targetDir}"`, { stdio: 'pipe' });
	rmSync(join(targetDir, '.git'), { recursive: true, force: true });
	rmSync(tmpDir, { recursive: true, force: true });

	const sha = computeDirectoryHash(targetDir);
	const installed: Record<string, InstalledPack> = loadManifest();
	installed[packName] = {
		name: packName,
		source: gitUrl,
		version: manifest.version,
		installedAt: new Date().toISOString(),
		sha256: sha,
	};
	saveManifest(installed);

	return { name: packName, errors: [] };
}

export function linkPackFromLocal(localPath: string): { name: string; errors: string[] } {
	const resolved = resolve(localPath);
	if (!existsSync(resolved)) {
		return { name: '', errors: [`Path not found: ${resolved}`] };
	}
	if (!existsSync(join(resolved, 'pack.json'))) {
		return { name: '', errors: [`No pack.json found at: ${resolved}`] };
	}

	const errors = validatePack(resolved);
	if (errors.length > 0) {
		return { name: '', errors };
	}

	const manifest = readPackManifest(resolved);
	const packName = manifest.name;
	const linkPath = join(PACKS_DIR, packName);

	mkdirSync(PACKS_DIR, { recursive: true });
	if (existsSync(linkPath)) {
		try {
			unlinkSync(linkPath);
		} catch {
			rmSync(linkPath, { recursive: true, force: true });
		}
	}
	symlinkSync(resolved, linkPath);

	const installed: Record<string, InstalledPack> = loadManifest();
	installed[packName] = {
		name: packName,
		source: `local:${resolved}`,
		version: manifest.version,
		installedAt: new Date().toISOString(),
		linked: true,
	};
	saveManifest(installed);

	return { name: packName, errors: [] };
}

export function listInstalledPacks(): InstalledPack[] {
	const manifest = loadManifest();
	return Object.values(manifest);
}

export function removePack(name: string): { success: boolean; error?: string } {
	const installed = loadManifest();
	if (!installed[name]) {
		return { success: false, error: `Pack "${name}" not installed` };
	}

	const packDir = join(PACKS_DIR, name);
	if (existsSync(packDir)) {
		try {
			const stat = readFileSync(linkPathIfExists(packDir), 'utf-8');
			unlinkSync(packDir);
		} catch {
			rmSync(packDir, { recursive: true, force: true });
		}
	}

	delete installed[name];
	saveManifest(installed);
	return { success: true };
}

function linkPathIfExists(path: string): string {
	try {
		return readFileSync(path, 'utf-8');
	} catch {
		return path;
	}
}

export function updatePack(name: string): { success: boolean; error?: string } {
	const installed = loadManifest();
	const entry = installed[name];
	if (!entry) {
		return { success: false, error: `Pack "${name}" not installed` };
	}
	if (entry.linked) {
		return { success: false, error: `Pack "${name}" is a local link — update the source directory directly` };
	}
	if (!entry.source.startsWith('http') && !entry.source.startsWith('git@')) {
		return { success: false, error: `Pack "${name}" source is not a git URL` };
	}

	const result = installPackFromGit(entry.source);
	if (result.errors.length > 0) {
		return { success: false, error: result.errors.join('; ') };
	}
	return { success: true };
}
