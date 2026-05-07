import { describe, expect, it } from 'vitest';
import { CommandRegistry } from './command-registry.js';
import type { CommandContext, SlashCommand } from './sdk/command.js';

const mockCtx = (overrides?: Partial<CommandContext>): CommandContext => ({
	args: '',
	agent: {
		id: 'test',
		name: 'Test',
		persona: 'default',
		systemPrompt: '',
		tools: [],
		messages: [],
		status: 'idle',
		model: 'test',
		activeSkills: new Set(),
		currentTask: undefined,
		packSystemPrompt: undefined,
	},
	config: {
		model: 'test',
		apiKey: '',
		nonInteractive: false,
		maxTurns: 20,
		packs: [],
	},
	setHistory: () => {},
	setInput: () => {},
	exit: () => {},
	activateSkill: () => null,
	deactivateSkill: () => {},
	...overrides,
});

describe('CommandRegistry', () => {
	it('registers and resolves commands', () => {
		const reg = new CommandRegistry();
		const cmd: SlashCommand = {
			name: 'test',
			description: 'Test cmd',
			handler: () => ({ type: 'message', content: 'ok' }),
		};
		reg.register(cmd);
		const resolved = reg.resolve('/test');
		expect(resolved).not.toBeNull();
		expect(resolved?.command.name).toBe('test');
		expect(resolved?.args).toBe('');
	});

	it('resolves command with args', () => {
		const reg = new CommandRegistry();
		const cmd: SlashCommand = {
			name: 'greet',
			description: 'Greet',
			handler: (ctx) => ({ type: 'message', content: `Hello ${ctx.args}` }),
		};
		reg.register(cmd);
		const resolved = reg.resolve('/greet world');
		expect(resolved?.args).toBe('world');
	});

	it('returns null for non-slash input', () => {
		const reg = new CommandRegistry();
		expect(reg.resolve('hello')).toBeNull();
	});

	it('returns null for unknown command', () => {
		const reg = new CommandRegistry();
		expect(reg.resolve('/unknown')).toBeNull();
	});

	it('is case-insensitive', () => {
		const reg = new CommandRegistry();
		reg.register({
			name: 'help',
			description: 'Help',
			handler: () => ({ type: 'none' }),
		});
		expect(reg.resolve('/HELP')).not.toBeNull();
		expect(reg.resolve('/Help')).not.toBeNull();
	});

	it('registerAll adds multiple commands', () => {
		const reg = new CommandRegistry();
		reg.registerAll([
			{ name: 'a', description: 'A', handler: () => ({ type: 'none' }) },
			{ name: 'b', description: 'B', handler: () => ({ type: 'none' }) },
		]);
		expect(reg.getAll()).toHaveLength(2);
	});

	it('getHelpText includes command names', () => {
		const reg = new CommandRegistry();
		reg.register({
			name: 'clear',
			description: 'Clear history',
			handler: () => ({ type: 'none' }),
		});
		const help = reg.getHelpText();
		expect(help).toContain('/clear');
		expect(help).toContain('Clear history');
		expect(help).toContain('Key bindings');
	});

	it('handler receives correct context', async () => {
		const reg = new CommandRegistry();
		const cmd: SlashCommand = {
			name: 'echo',
			description: 'Echo args',
			handler: (ctx) => ({ type: 'message', content: ctx.args }),
		};
		reg.register(cmd);
		const resolved = reg.resolve('/echo hello world');
		const result = await resolved?.command.handler(mockCtx({ args: resolved?.args }));
		expect(result).toEqual({ type: 'message', content: 'hello world' });
	});

	it('registers namespaced form when packName provided', () => {
		const reg = new CommandRegistry();
		reg.register(
			{
				name: 'analyze',
				description: 'Analyze',
				handler: () => ({ type: 'none' }),
			},
			'marketing',
		);
		expect(reg.resolve('/analyze')).not.toBeNull();
		expect(reg.resolve('/marketing:analyze')).not.toBeNull();
	});

	it('groups pack commands in help text', () => {
		const reg = new CommandRegistry();
		reg.register({
			name: 'clear',
			description: 'Clear history',
			handler: () => ({ type: 'none' }),
		});
		reg.register(
			{
				name: 'analyze',
				description: 'Analyze competitors',
				handler: () => ({ type: 'none' }),
			},
			'marketing',
		);
		const help = reg.getHelpText();
		expect(help).toContain('Built-in:');
		expect(help).toContain('marketing:');
		expect(help).toContain('/analyze');
	});

	it('getPackCommands returns pack-grouped commands', () => {
		const reg = new CommandRegistry();
		reg.register(
			{
				name: 'dive',
				description: 'Deep dive',
				handler: () => ({ type: 'none' }),
			},
			'explorer',
		);
		reg.register(
			{
				name: 'analyze',
				description: 'Analyze',
				handler: () => ({ type: 'none' }),
			},
			'marketing',
		);
		const packCmds = reg.getPackCommands();
		expect(packCmds.has('explorer')).toBe(true);
		expect(packCmds.has('marketing')).toBe(true);
		expect(packCmds.get('explorer')?.[0].name).toBe('dive');
	});

	it('resolves namespaced commands even when short form collides', () => {
		const reg = new CommandRegistry();
		reg.register(
			{
				name: 'analyze',
				description: 'Marketing analyze',
				handler: () => ({ type: 'none' }),
			},
			'marketing',
		);
		reg.register(
			{
				name: 'analyze',
				description: 'Researcher analyze',
				handler: () => ({ type: 'none' }),
			},
			'researcher',
		);
		expect(reg.resolve('/marketing:analyze')?.command.description).toBe('Marketing analyze');
		expect(reg.resolve('/researcher:analyze')?.command.description).toBe('Researcher analyze');
	});
});
