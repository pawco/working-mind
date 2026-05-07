import { describe, expect, it } from 'vitest';
import {
	formatZodError,
	packManifestSchema,
	parseMcpProjectConfig,
	parseMemoryGraph,
	partialUserConfigSchema,
	providersDataSchema,
	sessionDataSchema,
} from './schemas.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import stripJsonComments from 'strip-json-comments';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('packManifestSchema', () => {
	it('accepts valid starter pack', () => {
		const raw = readFileSync(
			join(__dirname, '..', 'packs', 'starter', 'pack.json'),
			'utf-8',
		);
		const result = packManifestSchema.safeParse(JSON.parse(raw));
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.name).toBe('starter');
			expect(result.data.prompt).toBe('prompt.md');
		}
	});

	it('rejects missing name', () => {
		const result = packManifestSchema.safeParse({
			version: '1.0.0',
			description: 'test',
			prompt: 'prompt.md',
		});
		expect(result.success).toBe(false);
	});

	it('rejects invalid name format', () => {
		const result = packManifestSchema.safeParse({
			name: 'INVALID',
			version: '1.0.0',
			description: 'test',
			prompt: 'prompt.md',
		});
		expect(result.success).toBe(false);
	});

	it('rejects invalid version', () => {
		const result = packManifestSchema.safeParse({
			name: 'test-pack',
			version: 'abc',
			description: 'test',
			prompt: 'prompt.md',
		});
		expect(result.success).toBe(false);
	});

	it('rejects description over 200 chars', () => {
		const result = packManifestSchema.safeParse({
			name: 'test-pack',
			version: '1.0.0',
			description: 'x'.repeat(201),
			prompt: 'prompt.md',
		});
		expect(result.success).toBe(false);
	});

	it('rejects missing prompt field', () => {
		const result = packManifestSchema.safeParse({
			name: 'test-pack',
			version: '1.0.0',
			description: 'test',
		});
		expect(result.success).toBe(false);
	});

	it('rejects required: true MCP server', () => {
		const result = packManifestSchema.safeParse({
			name: 'test-pack',
			version: '1.0.0',
			description: 'test',
			prompt: 'prompt.md',
			mcpServers: {
				fs: { package: 'mcp-filesystem', required: true },
			},
		});
		expect(result.success).toBe(false);
	});

	it('rejects required: true setting', () => {
		const result = packManifestSchema.safeParse({
			name: 'test-pack',
			version: '1.0.0',
			description: 'test',
			prompt: 'prompt.md',
			settings: [
				{
					name: 'key',
					description: 'test',
					envVar: 'TEST_KEY',
					required: true,
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it('rejects unknown fields (strict mode)', () => {
		const result = packManifestSchema.safeParse({
			name: 'test-pack',
			version: '1.0.0',
			description: 'test',
			prompt: 'prompt.md',
			unknownField: 'oops',
		});
		expect(result.success).toBe(false);
	});

	it('rejects invalid persona toolFilter preset', () => {
		const result = packManifestSchema.safeParse({
			name: 'test-pack',
			version: '1.0.0',
			description: 'test',
			prompt: 'prompt.md',
			personas: {
				expert: {
					prompt: 'expert.md',
					toolFilter: { preset: 'invalid' },
				},
			},
		});
		expect(result.success).toBe(false);
	});

	it('accepts valid persona with toolFilter', () => {
		const result = packManifestSchema.safeParse({
			name: 'test-pack',
			version: '1.0.0',
			description: 'test',
			prompt: 'prompt.md',
			personas: {
				expert: {
					prompt: 'expert.md',
					toolFilter: { preset: 'readonly', exclude: ['mcp__*'] },
				},
			},
		});
		expect(result.success).toBe(true);
	});
});

describe('partialUserConfigSchema', () => {
	it('accepts empty object', () => {
		const result = partialUserConfigSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts valid defaultModel', () => {
		const result = partialUserConfigSchema.safeParse({
			defaultModel: 'openrouter/anthropic/claude-sonnet-4.6',
		});
		expect(result.success).toBe(true);
	});

	it('rejects invalid permission enum', () => {
		const result = partialUserConfigSchema.safeParse({
			agents: {
				permissions: { destructive: 'maybe' },
			},
		});
		expect(result.success).toBe(false);
	});

	it('rejects custom provider missing baseUrl', () => {
		const result = partialUserConfigSchema.safeParse({
			customProviders: {
				myprov: { displayName: 'Test', apiFormat: 'openai' },
			},
		});
		expect(result.success).toBe(false);
	});

	it('rejects invalid custom provider apiFormat', () => {
		const result = partialUserConfigSchema.safeParse({
			customProviders: {
				myprov: {
					displayName: 'Test',
					baseUrl: 'https://api.test.com',
					apiFormat: 'ollama',
				},
			},
		});
		expect(result.success).toBe(false);
	});

	it('accepts valid custom provider', () => {
		const result = partialUserConfigSchema.safeParse({
			customProviders: {
				myprov: {
					displayName: 'Test',
					baseUrl: 'https://api.test.com',
					apiFormat: 'openai',
				},
			},
		});
		expect(result.success).toBe(true);
	});

	it('rejects invalid mcpServer type', () => {
		const result = partialUserConfigSchema.safeParse({
			mcpServers: {
				fs: { type: 'invalid' },
			},
		});
		expect(result.success).toBe(false);
	});

	it('accepts valid mcpServers', () => {
		const result = partialUserConfigSchema.safeParse({
			mcpServers: {
				fs: { type: 'local', command: ['npx', 'mcp-filesystem'] },
			},
		});
		expect(result.success).toBe(true);
	});
});

describe('providersDataSchema', () => {
	it('accepts bundled providers.jsonc', () => {
		const raw = readFileSync(
			join(__dirname, '..', 'data', 'providers.jsonc'),
			'utf-8',
		);
		const data = JSON.parse(stripJsonComments(raw));
		const result = providersDataSchema.safeParse(data);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.providers.length).toBeGreaterThan(0);
		}
	});
});

describe('sessionDataSchema', () => {
	it('accepts valid session', () => {
		const result = sessionDataSchema.safeParse({
			sessionId: 'abc123',
			name: 'test',
			persona: 'default',
			model: 'openrouter/anthropic/claude-sonnet-4.6',
			activeSkills: [],
			messages: [],
			createdAt: '2026-05-07T00:00:00Z',
			updatedAt: '2026-05-07T00:00:00Z',
		});
		expect(result.success).toBe(true);
	});

	it('rejects missing sessionId', () => {
		const result = sessionDataSchema.safeParse({
			name: 'test',
			persona: 'default',
			model: 'test',
			activeSkills: [],
			messages: [],
			createdAt: '',
			updatedAt: '',
		});
		expect(result.success).toBe(false);
	});
});

describe('parseMcpProjectConfig', () => {
	it('accepts valid config', () => {
		const result = parseMcpProjectConfig({
			mcpServers: {
				fs: { type: 'local', command: ['npx', 'mcp-filesystem'] },
			},
		});
		expect(result).toEqual({
			fs: { type: 'local', command: ['npx', 'mcp-filesystem'] },
		});
	});

	it('returns empty on invalid input', () => {
		const result = parseMcpProjectConfig({
			mcpServers: { fs: { type: 'INVALID' } },
		});
		expect(result).toEqual({});
	});

	it('returns empty on non-object', () => {
		expect(parseMcpProjectConfig(null)).toEqual({});
		expect(parseMcpProjectConfig('string')).toEqual({});
	});
});

describe('parseMemoryGraph', () => {
	it('parses valid graph from object', () => {
		const result = parseMemoryGraph({
			entities: [{ name: 'test', entityType: 'thing', observations: [] }],
			relations: [],
		});
		expect(result.entities.length).toBe(1);
	});

	it('parses valid graph from JSON string', () => {
		const result = parseMemoryGraph(
			JSON.stringify({
				entities: [],
				relations: [],
			}),
		);
		expect(result.entities).toEqual([]);
	});
});

describe('formatZodError', () => {
	it('formats error with context', () => {
		const result = packManifestSchema.safeParse({});
		expect(result.success).toBe(false);
		if (!result.success) {
			const formatted = formatZodError('Bad pack', result.error);
			expect(formatted).toContain('Bad pack');
			expect(formatted).toContain('name');
		}
	});
});
