import type { SlashCommand } from './sdk/command.js';

interface RegisteredCommand {
	cmd: SlashCommand;
	packName?: string;
}

export class CommandRegistry {
	private commands: Map<string, RegisteredCommand> = new Map();
	private builtinNames: Set<string> = new Set();

	register(cmd: SlashCommand, packName?: string): void {
		const existing = this.commands.get(cmd.name);
		if (existing && !packName) {
			this.builtinNames.add(cmd.name);
		}

		this.commands.set(cmd.name, { cmd, packName });

		if (packName) {
			const nsKey = `${packName}:${cmd.name}`;
			if (!this.commands.has(nsKey)) {
				this.commands.set(nsKey, { cmd, packName });
			}
		}
	}

	registerAll(commands: SlashCommand[], packName?: string): void {
		for (const cmd of commands) this.register(cmd, packName);
	}

	markBuiltin(name: string): void {
		this.builtinNames.add(name);
	}

	resolve(input: string): { command: SlashCommand; args: string } | null {
		const trimmed = input.trim();
		if (!trimmed.startsWith('/')) return null;
		const [name, ...rest] = trimmed.slice(1).split(/\s+/);
		const entry = this.commands.get(name.toLowerCase());
		if (!entry) return null;
		return { command: entry.cmd, args: rest.join(' ') };
	}

	getAll(): SlashCommand[] {
		const seen = new Set<string>();
		const result: SlashCommand[] = [];
		for (const [, entry] of this.commands) {
			if (!seen.has(entry.cmd.name)) {
				seen.add(entry.cmd.name);
				result.push(entry.cmd);
			}
		}
		return result;
	}

	getPackCommands(): Map<string, SlashCommand[]> {
		const packs = new Map<string, SlashCommand[]>();
		for (const [key, entry] of this.commands) {
			if (entry.packName && !key.includes(':')) {
				const list = packs.get(entry.packName) || [];
				list.push(entry.cmd);
				packs.set(entry.packName, list);
			}
		}
		return packs;
	}

	getBuiltinCommands(): SlashCommand[] {
		const result: SlashCommand[] = [];
		for (const [key, entry] of this.commands) {
			if (!entry.packName && !key.includes(':')) {
				result.push(entry.cmd);
			}
		}
		return result;
	}

	getHelpText(): string {
		const builtins = this.getBuiltinCommands();
		const packCommands = this.getPackCommands();

		const lines = ['Slash commands:'];

		if (builtins.length > 0) {
			lines.push('  Built-in:');
			for (const cmd of builtins) {
				const usage = cmd.usage ? ` ${cmd.usage}` : '';
				lines.push(
					`    /${cmd.name}${usage.padEnd(25 - cmd.name.length - (cmd.usage?.length ?? 0))} -- ${cmd.description}`,
				);
			}
		}

		for (const [packName, cmds] of packCommands) {
			lines.push(`  ${packName}:`);
			for (const cmd of cmds) {
				const usage = cmd.usage ? ` ${cmd.usage}` : '';
				lines.push(
					`    /${cmd.name}${usage.padEnd(25 - cmd.name.length - (cmd.usage?.length ?? 0))} -- ${cmd.description}`,
				);
			}
		}

		if (packCommands.size > 0) {
			lines.push('  Use /pack:command for unambiguous invocation.');
		}

		lines.push('');
		lines.push('Key bindings:');
		lines.push('  Tab        -- Switch agent');
		lines.push('  Enter      -- Send message');
		lines.push('  y/N        -- Confirm/deny tool call or command');
		lines.push('  Esc        -- Clear input');
		return lines.join('\n');
	}
}
