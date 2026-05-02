import type { SlashCommand } from './sdk/command.js';

export class CommandRegistry {
	private commands: Map<string, SlashCommand> = new Map();

	register(cmd: SlashCommand): void {
		this.commands.set(cmd.name, cmd);
	}

	registerAll(commands: SlashCommand[]): void {
		for (const cmd of commands) this.register(cmd);
	}

	resolve(input: string): { command: SlashCommand; args: string } | null {
		const trimmed = input.trim();
		if (!trimmed.startsWith('/')) return null;
		const [name, ...rest] = trimmed.slice(1).split(/\s+/);
		const cmd = this.commands.get(name.toLowerCase());
		if (!cmd) return null;
		return { command: cmd, args: rest.join(' ') };
	}

	getAll(): SlashCommand[] {
		return [...this.commands.values()];
	}

	getHelpText(): string {
		const cmds = this.getAll();
		const lines = ['Slash commands:'];
		for (const cmd of cmds) {
			const usage = cmd.usage ? ` ${cmd.usage}` : '';
			lines.push(
				`  /${cmd.name}${usage.padEnd(25 - cmd.name.length - (cmd.usage?.length ?? 0))} -- ${cmd.description}`,
			);
		}
		lines.push('');
		lines.push('Key bindings:');
		lines.push('  Tab        -- Switch agent');
		lines.push('  Enter      -- Send message');
		lines.push('  y/N        -- Confirm/deny tool call');
		lines.push('  Esc        -- Clear input');
		return lines.join('\n');
	}
}
