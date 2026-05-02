import type { McpRegistry } from './mcp/registry.js';
import type { AgentRegistry } from './registry.js';
import { runAgent } from './sdk/loop.js';
import type { AgentConfig } from './types.js';

export async function runNonInteractive(
	prompt: string,
	config: AgentConfig,
	registry: AgentRegistry,
	_mcpRegistry?: McpRegistry,
): Promise<string> {
	const agent = registry.createAgent({
		name: 'non-interactive',
		persona: config.persona,
		model: config.model,
	});

	const result = await runAgent([{ role: 'user', content: prompt }], {
		model: config.model,
		apiKey: config.apiKey || process.env.OPENEXPLORER_API_KEY || '',
		baseUrl: config.baseUrl,
		systemPrompt: agent.systemPrompt,
		tools: agent.tools,
		maxTurns: config.maxTurns || 5,
		userConfig: config.userConfig,
		onThinking: config.noThinking
			? undefined
			: (text) => process.stderr.write(`\x1b[2m${text}\x1b[0m`),
		onText: (text) => process.stderr.write(text),
		onToolResult: (name, result) => {
			process.stderr.write(`  [${name}] exit=${result?.exitCode ?? '?'}\n`);
		},
	});

	process.stdout.write(result);
	return result;
}
