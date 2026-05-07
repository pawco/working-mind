import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	buildMcpConfigs,
	findPackDir,
	loadPack,
	readCommands,
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

		expect(() => readPackManifest(dir)).toThrow(/optional/);
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

		expect(() => readPackManifest(dir)).toThrow(/optional/);
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

		expect(() => readPackManifest(dir)).toThrow(/optional/);
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
	it('builds npx command for package-based servers', async () => {
		const manifest = {
			name: 'test',
			version: '0.1.0',
			description: 'Test',
			prompt: 'prompt.md',
			mcpServers: {
				search: { package: 'some-mcp-server', env: {} },
			},
		};

		const configs = await buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.search.command).toEqual(['npx', '-y', 'some-mcp-server']);
		expect(configs.search.type).toBe('local');
	});

	it('merges saved config with pack defaults', async () => {
		const manifest = {
			name: 'test',
			version: '0.1.0',
			description: 'Test',
			prompt: 'prompt.md',
			mcpServers: {
				search: { package: 'some-mcp-server', env: {} },
			},
		};

		const configs = await buildMcpConfigs(
			manifest as any,
			{
				mcpServers: {
					search: { type: 'local', command: ['npx', 'existing'], env: { API_KEY: 'saved-key' }, enabled: true },
				},
			} as any,
		);
		expect(configs.search.command).toEqual(['npx', 'existing']);
		expect(configs.search.env?.API_KEY).toBe('saved-key');
		expect(configs.search.enabled).toBe(true);
	});

	it('uses env var values from process.env', async () => {
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

		const configs = await buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.search.env?.TEST_PACK_API_KEY).toBe('test-key-123');
		delete process.env.TEST_PACK_API_KEY;
	});

	it('skips servers with missing required env vars (enabled: false)', async () => {
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

		const configs = await buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.search.enabled).toBe(false);
		expect(configs.memory.enabled).toBe(true);
		expect(configs.search.requiredEnvVars).toBeDefined();
		expect(configs.search.requiredEnvVars?.length).toBe(1);
		expect(configs.search.requiredEnvVars?.[0].name).toBe('API_KEY');
		expect(configs.search.requiredEnvVars?.[0].required).toBe(true);
	});

	it('connects servers when required env vars are present', async () => {
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

		const configs = await buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.search.enabled).toBe(true);
		expect(configs.search.env?.TEST_REQ_KEY).toBe('present');
		delete process.env.TEST_REQ_KEY;
	});

	it('adds INPUT_DIR as required env var when pathPrompt set and $INPUT_DIR in command', async () => {
		const manifest = {
			name: 'test',
			mcpServers: {
				filesystem: {
					command: ['npx', '-y', 'fs-mcp', '$INPUT_DIR'],
					pathPrompt: 'Which directory to scan?',
					env: {},
				},
			},
		};

		const configs = await buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.filesystem.enabled).toBe(false);
		expect(configs.filesystem.pathPrompt).toBe('Which directory to scan?');
		expect(configs.filesystem.requiredEnvVars).toBeDefined();
		expect(configs.filesystem.requiredEnvVars?.length).toBe(1);
		expect(configs.filesystem.requiredEnvVars?.[0].name).toBe('INPUT_DIR');
		expect(configs.filesystem.requiredEnvVars?.[0].label).toBe(
			'Which directory to scan?',
		);
		expect(configs.filesystem.requiredEnvVars?.[0].sensitive).toBe(false);
	});

	it('enables server when INPUT_DIR is in process.env', async () => {
		process.env.INPUT_DIR = '/tmp/test-scan';
		const manifest = {
			name: 'test',
			mcpServers: {
				filesystem: {
					command: ['npx', '-y', 'fs-mcp', '$INPUT_DIR'],
					pathPrompt: 'Which directory to scan?',
					env: {},
				},
			},
		};

		const configs = await buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.filesystem.enabled).toBe(true);
		expect(configs.filesystem.env?.INPUT_DIR).toBe('/tmp/test-scan');
		delete process.env.INPUT_DIR;
	});

	it('does not add INPUT_DIR env var when no pathPrompt', async () => {
		const manifest = {
			name: 'test',
			mcpServers: {
				filesystem: {
					command: ['npx', '-y', 'fs-mcp', '$INPUT_DIR'],
					env: {},
				},
			},
		};

		const configs = await buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.filesystem.requiredEnvVars).toBeUndefined();
	});

	it('does not add INPUT_DIR env var when no $INPUT_DIR in command', async () => {
		const manifest = {
			name: 'test',
			mcpServers: {
				memory: {
					package: 'memory-mcp',
					pathPrompt: 'Where is memory?',
					env: {},
				},
			},
		};

		const configs = await buildMcpConfigs(manifest as any, { mcpServers: {} } as any);
		expect(configs.memory.requiredEnvVars).toBeUndefined();
		expect(configs.memory.enabled).toBe(true);
	});

	it('process.env overrides stale saved env var value', async () => {
		process.env.BRAVE_API_KEY = 'fresh-real-key';
		const manifest = {
			name: 'test',
			version: '0.1.0',
			description: 'Test',
			prompt: 'prompt.md',
			mcpServers: {
				search: {
					package: 'some-mcp-server',
					env: {
						BRAVE_API_KEY: { setting: 'BRAVE_API_KEY', sensitive: true, required: false },
					},
				},
			},
		};

		const configs = await buildMcpConfigs(
			manifest as any,
			{
				mcpServers: {
					search: { type: 'local', command: ['npx', 'search'], env: { BRAVE_API_KEY: 'old-stale-key' }, enabled: true },
				},
			} as any,
		);
		expect(configs.search.env?.BRAVE_API_KEY).toBe('fresh-real-key');
		delete process.env.BRAVE_API_KEY;
	});

	it('saved env var used as fallback when not in process.env', async () => {
		const manifest = {
			name: 'test',
			version: '0.1.0',
			description: 'Test',
			prompt: 'prompt.md',
			mcpServers: {
				search: {
					package: 'some-mcp-server',
					env: {
						BRAVE_API_KEY: { setting: 'BRAVE_API_KEY', sensitive: true, required: false },
					},
				},
			},
		};

		const configs = await buildMcpConfigs(
			manifest as any,
			{
				mcpServers: {
					search: { type: 'local', command: ['npx', 'search'], env: { BRAVE_API_KEY: 'saved-key' }, enabled: true },
				},
			} as any,
		);
		expect(configs.search.env?.BRAVE_API_KEY).toBe('saved-key');
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
	it('finds builtin starter pack', () => {
		const dir = findPackDir('starter');
		expect(dir).not.toBeNull();
		expect(dir).toContain('packs/starter');
	});

	it('returns null for unknown pack', () => {
		const dir = findPackDir('nonexistent-pack-xyz');
		expect(dir).toBeNull();
	});
});

describe('loadPack', () => {
	it('loads the builtin starter pack', async () => {
		const dir = findPackDir('starter');
		if (!dir) throw new Error('starter pack not found');

		const loaded = await loadPack(dir, {} as any);
		expect(loaded.manifest.name).toBe('starter');
		expect(loaded.systemPrompt).toContain('{{AVAILABLE_TOOLS}}');
		const mcpServerNames = Object.keys(
			(loaded.manifest as any).mcpServers || {},
		);
		expect(mcpServerNames).toContain('memory');
		expect(mcpServerNames).toContain('brave-search');
		expect(mcpServerNames).toContain('firecrawl');
		expect((loaded.manifest as any).mcpServers['brave-search'].required).toBe(
			false,
		);
		expect((loaded.manifest as any).mcpServers['firecrawl'].required).toBe(
			false,
		);
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

describe('readCommands', () => {
	it('reads commands from commands/ map in manifest', () => {
		const dir = join(TMP, 'cmds');
		writePack(
			dir,
			{
				name: 'cmd-pack',
				version: '0.1.0',
				description: 'Pack with commands',
				prompt: 'prompt.md',
				commands: {
					'analyze': 'commands/analyze.md',
				},
			},
			{
				'prompt.md': 'Test',
				'commands/analyze.md': `---
name: analyze
description: Analyze something
usage: <topic>
result: trigger-agent
---

Analyze $ARGUMENTS deeply.
`,
			},
		);

		const commands = readCommands(dir, readPackManifest(dir));
		expect(commands).toHaveLength(1);
		expect(commands[0].name).toBe('analyze');
		expect(commands[0].description).toBe('Analyze something');
		expect(commands[0].usage).toBe('<topic>');
	});

	it('returns empty array when no commands', () => {
		const dir = join(TMP, 'no-cmds');
		writePack(dir, { name: 'nocmd', version: '0.1.0', description: 'No cmds', prompt: 'prompt.md' }, { 'prompt.md': 'Test' });
		const commands = readCommands(dir, readPackManifest(dir));
		expect(commands).toEqual([]);
	});

	it('throws when command name mismatches key', () => {
		const dir = join(TMP, 'cmd-mismatch');
		writePack(
			dir,
			{
				name: 'mismatch',
				version: '0.1.0',
				description: 'Mismatch',
				prompt: 'prompt.md',
				commands: { 'analyze': 'commands/analyze.md' },
			},
			{
				'prompt.md': 'Test',
				'commands/analyze.md': `---
name: wrong-name
description: Wrong name
---

Oops.
`,
			},
		);

		expect(() => readCommands(dir, readPackManifest(dir))).toThrow(/name="wrong-name".*"analyze"/);
	});

	it('throws when command file missing', () => {
		const dir = join(TMP, 'cmd-missing');
		writePack(
			dir,
			{
				name: 'missing',
				version: '0.1.0',
				description: 'Missing',
				prompt: 'prompt.md',
				commands: { 'analyze': 'commands/analyze.md' },
			},
			{ 'prompt.md': 'Test' },
		);

		expect(() => readCommands(dir, readPackManifest(dir))).toThrow(/does not exist/);
	});

	it('creates trigger-agent handler when result: trigger-agent', async () => {
		const dir = join(TMP, 'cmd-trigger');
		writePack(
			dir,
			{
				name: 'trig',
				version: '0.1.0',
				description: 'Trigger',
				prompt: 'prompt.md',
				commands: { 'dive': 'commands/dive.md' },
			},
			{
				'prompt.md': 'Test',
				'commands/dive.md': `---
name: dive
description: Deep dive
result: trigger-agent
---

Dive into $ARGUMENTS now.
`,
			},
		);

		const commands = readCommands(dir, readPackManifest(dir));
		const result = await commands[0].handler!({
			args: 'quantum computing',
			agent: { messages: [], id: 'test', name: 'test-agent' },
			config: {} as any,
		} as any);

		expect(result.type).toBe('trigger-agent');
		if (result.type === 'trigger-agent') {
			expect(result.content).toContain('Running dive');
		}
	});

	it('creates message handler when result: message or default', async () => {
		const dir = join(TMP, 'cmd-msg');
		writePack(
			dir,
			{
				name: 'msg',
				version: '0.1.0',
				description: 'Msg',
				prompt: 'prompt.md',
				commands: { 'info': 'commands/info.md' },
			},
			{
				'prompt.md': 'Test',
				'commands/info.md': `---
name: info
description: Show info
---

Info about $ARGUMENTS.
`,
			},
		);

		const commands = readCommands(dir, readPackManifest(dir));
		const result = await commands[0].handler!({
			args: 'test-topic',
			agent: { messages: [], id: 'test', name: 'test-agent' },
			config: {} as any,
		} as any);

		expect(result.type).toBe('message');
		expect((result as any).content).toContain('test-topic');
	});
});
