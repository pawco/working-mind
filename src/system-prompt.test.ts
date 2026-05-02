import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UserConfig } from './config.js';
import {
	assembleSystemPrompt,
	listSystemPrompts,
	saveSystemPrompt,
} from './system-prompt.js';

describe('assembleSystemPrompt', () => {
	it('returns personaDef prompt when provided', () => {
		const result = assembleSystemPrompt(undefined, {
			prompt: 'You are a deploy agent.',
		});
		expect(result).toBe('You are a deploy agent.');
	});

	it('returns named prompt from config', () => {
		const config: UserConfig = {
			systemPrompts: {
				'code-review': 'You are a code reviewer.',
			},
		};
		const result = assembleSystemPrompt('code-review', undefined, config);
		expect(result).toBe('You are a code reviewer.');
	});

	it('reads from file if path exists', () => {
		const tmpFile = join(tmpdir(), `oe-sp-test-${Date.now()}.md`);
		writeFileSync(tmpFile, 'You are the file agent.');
		try {
			const result = assembleSystemPrompt(tmpFile, undefined);
			expect(result).toBe('You are the file agent.');
		} finally {
			rmSync(tmpFile);
		}
	});

	it('uses inline text when not a named prompt or file', () => {
		const result = assembleSystemPrompt(
			'You are a helpful assistant.',
			undefined,
		);
		expect(result).toBe('You are a helpful assistant.');
	});

	it('returns default from config when no prompt spec', () => {
		const config: UserConfig = {
			systemPrompts: {
				default: 'Custom default prompt.',
			},
		};
		const result = assembleSystemPrompt(undefined, undefined, config);
		expect(result).toBe('Custom default prompt.');
	});

	it('returns built-in default when no config', () => {
		const result = assembleSystemPrompt(undefined, undefined);
		expect(result).toContain('OpenExplorer');
		expect(result).toContain('reasoning agent');
	});

	it('appends active skills to prompt', () => {
		const skills = [
			{
				name: 'deploy',
				description: 'Deploy skill',
				instructions: 'Deploy the app',
				allowedTools: ['bash', 'write'],
			},
		];
		const result = assembleSystemPrompt(
			undefined,
			{ prompt: 'Base.' },
			undefined,
			skills,
		);
		expect(result).toContain('Active Skill: deploy');
		expect(result).toContain('Deploy the app');
		expect(result).toContain('Allowed tools: bash, write');
	});

	it('includes available skills index for inactive skills', () => {
		const allSkills = [
			{
				name: 'deploy',
				description: 'Deploy the app to production',
				instructions: 'Deploy the app step by step.',
			},
			{
				name: 'research',
				description: 'Deep research on a topic',
				instructions: 'Research the topic thoroughly.',
			},
		];
		const result = assembleSystemPrompt(
			undefined,
			{ prompt: 'Base.' },
			undefined,
			[],
			undefined,
			allSkills,
		);
		expect(result).toContain('Available Skills');
		expect(result).toContain('- deploy: Deploy the app to production');
		expect(result).toContain('- research: Deep research on a topic');
		expect(result).not.toContain('Active Skill:');
		expect(result).not.toContain('Deploy the app step by step');
	});

	it('excludes active skills from available index', () => {
		const deploy = {
			name: 'deploy',
			description: 'Deploy the app to production',
			instructions: 'Deploy the app step by step.',
		};
		const research = {
			name: 'research',
			description: 'Deep research on a topic',
			instructions: 'Research the topic thoroughly.',
		};
		const result = assembleSystemPrompt(
			undefined,
			{ prompt: 'Base.' },
			undefined,
			[deploy],
			undefined,
			[deploy, research],
		);
		expect(result).toContain('Active Skill: deploy');
		expect(result).toContain('Deploy the app step by step');
		expect(result).toContain('Available Skills');
		expect(result).toContain('- research: Deep research on a topic');
		expect(result).not.toContain('- deploy: Deploy the app to production');
	});

	it('omits available skills section when allSkills not provided', () => {
		const result = assembleSystemPrompt(
			undefined,
			{ prompt: 'Base.' },
			undefined,
			[],
		);
		expect(result).not.toContain('Available Skills');
	});

	it('omits available skills section when all skills are active', () => {
		const skill = {
			name: 'deploy',
			description: 'Deploy the app',
			instructions: 'Deploy the app.',
		};
		const result = assembleSystemPrompt(
			undefined,
			{ prompt: 'Base.' },
			undefined,
			[skill],
			undefined,
			[skill],
		);
		expect(result).toContain('Active Skill: deploy');
		expect(result).not.toContain('Available Skills');
	});
});

describe('listSystemPrompts', () => {
	it('lists prompts from config', () => {
		const config: UserConfig = {
			systemPrompts: {
				default: 'Default prompt here.',
				'code-review': 'Review code for bugs and security issues.',
			},
		};
		const prompts = listSystemPrompts(config);
		expect(prompts).toHaveLength(2);
		expect(prompts[0].name).toBe('default');
		expect(prompts[1].name).toBe('code-review');
	});

	it('truncates long prompts in preview', () => {
		const config: UserConfig = {
			systemPrompts: {
				long: 'A'.repeat(200),
			},
		};
		const prompts = listSystemPrompts(config);
		expect(prompts[0].preview.length).toBeLessThan(200);
		expect(prompts[0].preview).toContain('...');
	});
});

describe('saveSystemPrompt', () => {
	it('saves a prompt to config', () => {
		const config: UserConfig = {
			systemPrompts: { default: 'Original' },
		};
		saveSystemPrompt('deploy', 'Deploy mode', config);
		expect(config.systemPrompts?.deploy).toBe('Deploy mode');
	});

	it('creates systemPrompts object if missing', () => {
		const config: UserConfig = {};
		saveSystemPrompt('test', 'Test prompt', config);
		expect(config.systemPrompts?.test).toBe('Test prompt');
	});
});
