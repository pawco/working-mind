import { describe, expect, it } from 'vitest';
import type { CommandResult, SlashCommand } from './command.js';

describe('CommandResult confirm variant', () => {
	it('accepts confirm result type', () => {
		const result: CommandResult = {
			type: 'confirm',
			message: 'This action requires confirmation.',
			command: 'ingest',
			args: 'doc.md --confirmed',
		};
		expect(result.type).toBe('confirm');
		if (result.type === 'confirm') {
			expect(result.message).toContain('confirmation');
			expect(result.command).toBe('ingest');
			expect(result.args).toContain('--confirmed');
		}
	});

	it('all existing CommandResult types still work', () => {
		const results: CommandResult[] = [
			{ type: 'message', content: 'hello' },
			{ type: 'none' },
			{ type: 'reconnect-server', serverName: 'memory', requiredEnvVars: [] },
			{ type: 'trigger-agent', content: 'run' },
			{ type: 'trigger-agent', content: 'run', allowedTools: ['tool1'] },
			{ type: 'reconnect-memory-store', storeName: 'default' },
			{
				type: 'reconnect-memory-store',
				storeName: 'default',
				deletedStore: 'old',
			},
			{ type: 'open-memory-wizard' },
			{ type: 'add-pack-agent', packName: 'starter' },
			{ type: 'confirm', message: 'msg', command: 'cmd', args: 'args' },
		];
		expect(results).toHaveLength(10);
		expect(results.map((r) => r.type)).toEqual([
			'message',
			'none',
			'reconnect-server',
			'trigger-agent',
			'trigger-agent',
			'reconnect-memory-store',
			'reconnect-memory-store',
			'open-memory-wizard',
			'add-pack-agent',
			'confirm',
		]);
	});
});

describe('SlashCommand requiresConfirmation field', () => {
	it('accepts commands with requiresConfirmation', () => {
		const cmd: SlashCommand = {
			name: 'ingest',
			description: 'Ingest a file',
			requiresConfirmation: true,
			handler: () => ({ type: 'message', content: 'ok' }),
		};
		expect(cmd.requiresConfirmation).toBe(true);
	});

	it('accepts commands without requiresConfirmation (backwards compatible)', () => {
		const cmd: SlashCommand = {
			name: 'help',
			description: 'Show help',
			handler: () => ({ type: 'message', content: 'ok' }),
		};
		expect(cmd.requiresConfirmation).toBeUndefined();
	});

	it('commands without requiresConfirmation default to no confirmation', () => {
		const cmd: SlashCommand = {
			name: 'clear',
			description: 'Clear',
			handler: () => ({ type: 'none' }),
		};
		const needsConfirm = cmd.requiresConfirmation === true;
		expect(needsConfirm).toBe(false);
	});
});
