import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	buildMcpConfigs,
	findPackDir,
	loadPack,
	readCurationPrompts,
	readPackManifest,
	readPersonas,
	readPromptFile,
	readSkills,
	replaceAvailableTools,
	replaceCurationPlaceholders,
	validateCuration,
} from './pack-loader.js';

const TMP = join('/tmp', `oe-pack-test-${Date.now()}`);

function writePack(
	dir: string,
	manifest: Record<string, any>,
	files?: Record<string, string>,
) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'pack.json'), JSON.stringify(manifest, null, 2));
	for (const [path, content] of Object.entries(files || {})) {
		const full = join(dir, path);
		mkdirSync(join(full, '..'), { recursive: true });
		writeFileSync(full, content);
	}
}

describe('readPackManifest', () => {
	it('reads valid manifest', () => {
		const dir = join(TMP, 'valid');
		writePack(
			dir,
			{
				name: 'test-pack',
				version: '0.1.0',
				description: 'A test pack',
				prompt: 'prompt.md',
			},
			{ 'prompt.md': 'You are a test agent.' },
		);

		const m = readPackManifest(dir);
		expect(m.name).toBe('test-pack');
		expect(m.version).toBe('0.1.0');
	});

	it('rejects manifest with required MCP server', () => {
		const dir = join(TMP, 'req-mcp');
		writePack(
			dir,
			{
				name: 'bad-pack',
				version: '0.1.0',
				description: 'Bad',
				prompt: 'prompt.md',
				mcpServers: {
					search: { package: 'some-mcp', required: true, env: {} },
				},
			},
			{ 'prompt.md': 'Test' },
		);

		expect(() => readPackManifest(dir)).toThrow(/required: true/);
	});

	it('allows manifest with required env var on optional MCP server', () => {
		const dir = join(TMP, 'req-env-ok');
		writePack(
			dir,
			{
				name: 'env-pack',
				version: '0.1.0',
				description: 'Env pack',
				prompt: 'prompt.md',
				mcpServers: {
					search: {
						package: 'some-mcp',
						env: { API_KEY: { setting: 'API_KEY', required: true } },
					},
				},
			},
			{ 'prompt.md': 'Test' },
		);

		expect(() => readPackManifest(dir)).not.toThrow();
	});

	it('rejects manifest with required setting', () => {
		const dir = join(TMP, 'req-setting');
		writePack(
			dir,
			{
				name: 'bad-setting',
				version: '0.1.0',
				description: 'Bad',
				prompt: 'prompt.md',
				settings: [
					{
						name: 'API_KEY',
						description: 'Key',
						envVar: 'API_KEY',
						required: true,
					},
				],
			},
			{ 'prompt.md': 'Test' },
		);

		expect(() => readPackManifest(dir)).toThrow(/required: true/);
	});

	it('rejects invalid pack name', () => {
		const dir = join(TMP, 'bad-name');
		writePack(
			dir,
			{
				name: 'BAD_NAME',
				version: '0.1.0',
				description: 'Bad',
				prompt: 'prompt.md',
			},
			{ 'prompt.md': 'Test' },
		);

		expect(() => readPackManifest(dir)).toThrow(/must be lowercase/);
	});

	it('rejects missing prompt file', () => {
		const dir = join(TMP, 'no-prompt');
		writePack(dir, {
			name: 'no-prompt',
			version: '0.1.0',
			description: 'Bad',
			prompt: 'nonexistent.md',
		});

		expect(() => readPackManifest(dir)).toThrow(/does not exist/);
	});
});

describe('readPromptFile', () => {
	it('reads prompt within size limit', () => {
		const dir = join(TMP, 'prompt-ok');
		writePack(dir, {}, { 'prompt.md': 'Hello' });
		const content = readPromptFile(dir, 'prompt.md');
		expect(content).toBe('Hello');
	});

	it('rejects prompt over 10000 chars', () => {
		const dir = join(TMP, 'prompt-big');
		writePack(dir, {}, { 'prompt.md': 'x'.repeat(10001) });
		expect(() => readPromptFile(dir, 'prompt.md')).toThrow(/exceeds 10,000/);
	});
});

describe('readPersonas', () => {
	it('reads persona prompts', () => {
		const dir = join(TMP, 'personas');
		writePack(
			dir,
			{},
			{
				'personas/deep.md': 'Deep research agent',
				'personas/quick.md': 'Quick lookup agent',
			},
		);

		const personas = readPersonas(dir, {
			deep: { prompt: 'personas/deep.md' },
			quick: { prompt: 'personas/quick.md' },
		});

		expect(personas.deep.prompt).toBe('Deep research agent');
		expect(personas.quick.prompt).toBe('Quick lookup agent');
	});

	it('rejects missing persona file', () => {
		const dir = join(TMP, 'bad-persona');
		writePack(dir, {});

		expect(() =>
			readPersonas(dir, { test: { prompt: 'nonexistent.md' } }),
		).toThrow(/does not exist/);
	});
});

describe('readSkills', () => {
	it('reads skills from skills/ directory', () => {
		const dir = join(TMP, 'skills');
		writePack(
			dir,
			{},
			{
				'skills/web-research/SKILL.md': `---
name: web-research
description: Web research
autoDiscover: true
---

# Web Research

Step 1: Search
Step 2: Read
`,
			},
		);

		const skills = readSkills(dir);
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe('web-research');
		expect(skills[0].autoDiscover).toBe(true);
		expect(skills[0].instructions).toContain('Step 1: Search');
	});

	it('returns empty array when no skills dir', () => {
		const dir = join(TMP, 'no-skills');
		writePack(dir, {}, { 'prompt.md': 'Test' });
		expect(readSkills(dir)).toEqual([]);
	});
});

describe('buildMcpConfigs', () => {
	it('builds npx command for package-based servers', () => {
		const manifest = {
			name: 'test',
			version: '0.1.0',
			description: 'Test',
			prompt: 'prompt.md',
			mcpServers: {
				search: { package: 'some-mcp-server', env: {} },
			},
		};

		const configs = buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.search.command).toEqual(['npx', '-y', 'some-mcp-server']);
		expect(configs.search.type).toBe('local');
	});

	it('skips servers already in user config', () => {
		const manifest = {
			name: 'test',
			version: '0.1.0',
			description: 'Test',
			prompt: 'prompt.md',
			mcpServers: {
				search: { package: 'some-mcp-server', env: {} },
			},
		};

		const configs = buildMcpConfigs(
			manifest as any,
			{
				mcpServers: {
					search: { type: 'local', command: ['npx', 'existing'], env: {} },
				},
			} as any,
		);
		expect(configs.search).toBeUndefined();
	});

	it('uses env var values from process.env', () => {
		process.env.TEST_PACK_API_KEY = 'test-key-123';
		const manifest = {
			name: 'test',
			version: '0.1.0',
			description: 'Test',
			prompt: 'prompt.md',
			mcpServers: {
				search: {
					package: 'some-mcp',
					env: {
						TEST_PACK_API_KEY: {
							setting: 'TEST_PACK_API_KEY',
							sensitive: true,
							required: false,
						},
					},
				},
			},
		};

		const configs = buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.search.env?.TEST_PACK_API_KEY).toBe('test-key-123');
		delete process.env.TEST_PACK_API_KEY;
	});

	it('skips servers with missing required env vars (enabled: false)', () => {
		const manifest = {
			name: 'test',
			mcpServers: {
				search: {
					package: 'some-mcp',
					env: {
						API_KEY: { setting: 'API_KEY', required: true },
					},
				},
				memory: {
					package: 'memory-mcp',
					env: {},
				},
			},
		};

		const configs = buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.search.enabled).toBe(false);
		expect(configs.memory.enabled).toBe(true);
		expect(configs.search.requiredEnvVars).toBeDefined();
		expect(configs.search.requiredEnvVars?.length).toBe(1);
		expect(configs.search.requiredEnvVars?.[0].name).toBe('API_KEY');
		expect(configs.search.requiredEnvVars?.[0].required).toBe(true);
	});

	it('connects servers when required env vars are present', () => {
		process.env.TEST_REQ_KEY = 'present';
		const manifest = {
			name: 'test',
			mcpServers: {
				search: {
					package: 'some-mcp',
					env: {
						TEST_REQ_KEY: { setting: 'TEST_REQ_KEY', required: true },
					},
				},
			},
		};

		const configs = buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.search.enabled).toBe(true);
		expect(configs.search.env?.TEST_REQ_KEY).toBe('present');
		delete process.env.TEST_REQ_KEY;
	});
});

describe('replaceAvailableTools', () => {
	it('replaces {{AVAILABLE_TOOLS}} with tool list', () => {
		const prompt =
			'You have these tools:\n{{AVAILABLE_TOOLS}}\nUse them wisely.';
		const result = replaceAvailableTools(prompt, ['search', 'scrape']);
		expect(result).toContain('- search');
		expect(result).toContain('- scrape');
		expect(result).not.toContain('{{AVAILABLE_TOOLS}}');
	});

	it('shows reasoning-only when no tools available', () => {
		const prompt = 'Tools: {{AVAILABLE_TOOLS}}';
		const result = replaceAvailableTools(prompt, []);
		expect(result).toContain('reasoning-only mode');
	});

	it('returns prompt unchanged when no placeholder', () => {
		const prompt = 'No placeholder here.';
		const result = replaceAvailableTools(prompt, ['tool1']);
		expect(result).toBe('No placeholder here.');
	});
});

describe('findPackDir', () => {
	it('finds builtin researcher pack', () => {
		const dir = findPackDir('researcher');
		expect(dir).not.toBeNull();
		expect(dir).toContain('packs/researcher');
	});

	it('returns null for unknown pack', () => {
		const dir = findPackDir('nonexistent-pack-xyz');
		expect(dir).toBeNull();
	});
});

describe('loadPack', () => {
	it('loads the builtin researcher pack', () => {
		const dir = findPackDir('researcher');
		if (!dir) throw new Error('researcher pack not found');

		const loaded = loadPack(dir, {} as any);
		expect(loaded.manifest.name).toBe('researcher');
		expect(loaded.systemPrompt).toContain('research agent');
		expect(loaded.systemPrompt).toContain('{{AVAILABLE_TOOLS}}');
		expect(Object.keys(loaded.personas)).toContain('deep-research');
		expect(Object.keys(loaded.personas)).toContain('quick-lookup');
		expect(loaded.skills.length).toBeGreaterThanOrEqual(3);
		expect(loaded.asToolPack.name).toBe('researcher');
		expect(loaded.curation).toBeDefined();
		expect(loaded.curation?.summarize).toBeTruthy();
		expect(loaded.curation?.export).toBeTruthy();
	});

	it('loads the builtin explorer pack with curation', () => {
		const dir = findPackDir('explorer');
		if (!dir) throw new Error('explorer pack not found');

		const loaded = loadPack(dir, {} as any);
		expect(loaded.manifest.name).toBe('explorer');
		expect(loaded.curation).toBeDefined();
		expect(loaded.curation?.summarize).toBeTruthy();
		expect(loaded.curation?.export).toBeTruthy();
		expect(Object.keys(loaded.personas)).toContain('researcher');
		expect(Object.keys(loaded.personas)).toContain('advisor');
		expect(loaded.skills.map((s) => s.name)).toContain('deep-dive');
		expect(loaded.skills.map((s) => s.name)).toContain('compare');
	});
});

describe('validateCuration', () => {
	it('returns without error for manifest without curation', () => {
		expect(() =>
			validateCuration({ name: 'test' } as any, '/tmp'),
		).not.toThrow();
	});

	it('returns without error for valid curation files', () => {
		const dir = join(TMP, 'curation-valid');
		writePack(
			dir,
			{ name: 'test' },
			{
				'curation/summarize.md': 'Summary template',
				'curation/export.md': 'Export template',
			},
		);
		expect(() =>
			validateCuration(
				{
					name: 'test',
					curation: {
						summarize: 'curation/summarize.md',
						export: 'curation/export.md',
					},
				} as any,
				dir,
			),
		).not.toThrow();
	});

	it('throws on missing summarize file', () => {
		const dir = join(TMP, 'curation-missing-sum');
		writePack(
			dir,
			{ name: 'test' },
			{
				'curation/export.md': 'Export template',
			},
		);
		expect(() =>
			validateCuration(
				{
					name: 'test',
					curation: {
						summarize: 'curation/summarize.md',
						export: 'curation/export.md',
					},
				} as any,
				dir,
			),
		).toThrow(/summarize/);
	});

	it('throws on missing export file', () => {
		const dir = join(TMP, 'curation-missing-exp');
		writePack(
			dir,
			{ name: 'test' },
			{
				'curation/summarize.md': 'Summary template',
			},
		);
		expect(() =>
			validateCuration(
				{
					name: 'test',
					curation: {
						summarize: 'curation/summarize.md',
						export: 'curation/export.md',
					},
				} as any,
				dir,
			),
		).toThrow(/export/);
	});
});

describe('readCurationPrompts', () => {
	it('returns empty object when no curation', () => {
		const result = readCurationPrompts('/tmp', undefined);
		expect(result).toEqual({});
	});

	it('reads summarize and export prompts', () => {
		const dir = join(TMP, 'curation-read');
		writePack(
			dir,
			{ name: 'test' },
			{
				'curation/summarize.md': 'Summarize template',
				'curation/export.md': 'Export template',
			},
		);
		const result = readCurationPrompts(dir, {
			summarize: 'curation/summarize.md',
			export: 'curation/export.md',
		});
		expect(result.summarize).toBe('Summarize template');
		expect(result.export).toBe('Export template');
	});

	it('throws on file exceeding 10K chars', () => {
		const dir = join(TMP, 'curation-toolarge');
		writePack(
			dir,
			{ name: 'test' },
			{
				'curation/summarize.md': 'x'.repeat(11000),
			},
		);
		expect(() =>
			readCurationPrompts(dir, {
				summarize: 'curation/summarize.md',
				export: undefined,
			}),
		).toThrow(/10,000/);
	});
});

describe('replaceCurationPlaceholders', () => {
	it('replaces {{DATE}}', () => {
		const result = replaceCurationPlaceholders('Date: {{DATE}}', {
			date: '2026-05-02',
			sourceCount: 5,
		});
		expect(result).toContain('2026-05-02');
	});

	it('replaces {{SOURCE_COUNT}}', () => {
		const result = replaceCurationPlaceholders('Sources: {{SOURCE_COUNT}}', {
			date: '2026-05-02',
			sourceCount: 12,
		});
		expect(result).toContain('12');
	});

	it('replaces both placeholders', () => {
		const result = replaceCurationPlaceholders('{{DATE}} {{SOURCE_COUNT}}', {
			date: '2026-05-02',
			sourceCount: 3,
		});
		expect(result).toBe('2026-05-02 3');
	});

	it('leaves text unchanged when no placeholders', () => {
		const result = replaceCurationPlaceholders('No placeholders here', {
			date: '2026-05-02',
			sourceCount: 0,
		});
		expect(result).toBe('No placeholders here');
	});
});
