import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadUserConfig, writeUserConfig } from './config.js';

describe('loadUserConfig', () => {
	it('returns defaults when no config file exists', () => {
		const originalHome = process.env.HOME;
		process.env.HOME = `/tmp/oe-test-no-exist-${Date.now()}`;
		const config = loadUserConfig();
		expect(config.defaultModel).toBeDefined();
		expect(config.providers).toBeDefined();
		expect(config.systemPrompts?.default).toBeTruthy();
		expect(config.agents?.maxTurns).toBe(20);
		process.env.HOME = originalHome;
	});

	it('deep merges with defaults', () => {
		const originalHome = process.env.HOME;
		const tmpDir = `/tmp/oe-test-merge-${Date.now()}`;
		mkdirSync(join(tmpDir, '.wmind'), { recursive: true });
		process.env.HOME = tmpDir;
		writeUserConfig({ defaultModel: 'test-model' });
		const config = loadUserConfig();
		expect(config.defaultModel).toBe('test-model');
		expect(config.providers).toBeDefined();
		process.env.HOME = originalHome;
		rmSync(tmpDir, { recursive: true });
	});
});

describe('writeUserConfig', () => {
	it('writes and reads back config', () => {
		const originalHome = process.env.HOME;
		const tmpDir = `/tmp/oe-test-write-${Date.now()}`;
		mkdirSync(tmpDir, { recursive: true });
		process.env.HOME = tmpDir;

		const config = {
			defaultModel: 'openai/gpt-5.4',
			systemPrompts: { default: 'Test prompt' },
		};
		writeUserConfig(config);

		const loaded = loadUserConfig();
		expect(loaded.defaultModel).toBe('openai/gpt-5.4');
		expect(loaded.systemPrompts?.default).toBe('Test prompt');

		process.env.HOME = originalHome;
		rmSync(tmpDir, { recursive: true });
	});
});
