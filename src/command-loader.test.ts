import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCommandFiles } from './command-loader.js';

const TMP = join(tmpdir(), `oe-cmd-test-${Date.now()}`);

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('loadCommandFiles', () => {
	it('returns empty array when no command files exist', () => {
		const cmds = loadCommandFiles([TMP]);
		expect(cmds).toEqual([]);
	});

	it('loads a command .md file', () => {
		writeFileSync(
			join(TMP, 'deploy.md'),
			`---
name: deploy
description: Deploy application
usage: "[environment]"
---

Run: npm run deploy $ARGUMENTS`,
		);

		const cmds = loadCommandFiles([TMP]);
		expect(cmds).toHaveLength(1);
		expect(cmds[0].name).toBe('deploy');
		expect(cmds[0].description).toBe('Deploy application');
		expect(cmds[0].usage).toBe('[environment]');
	});

	it('uses filename as command name when no frontmatter', () => {
		writeFileSync(join(TMP, 'status.md'), 'Check system status.');

		const cmds = loadCommandFiles([TMP]);
		expect(cmds).toHaveLength(1);
		expect(cmds[0].name).toBe('status');
	});

	it('loads multiple command files', () => {
		writeFileSync(
			join(TMP, 'deploy.md'),
			'---\nname: deploy\ndescription: Deploy\n---\nDeploy it',
		);
		writeFileSync(
			join(TMP, 'rollback.md'),
			'---\nname: rollback\ndescription: Rollback\n---\nRollback it',
		);

		const cmds = loadCommandFiles([TMP]);
		expect(cmds).toHaveLength(2);
		expect(cmds.map((c) => c.name).sort()).toEqual(['deploy', 'rollback']);
	});
});
