import { Box, Text } from 'ink';
import type { McpServerInfo } from './mcp/registry.js';
import { useSpinner } from './ui/utils.js';
import { VERSION } from './version.js';

function statusDot(status: McpServerInfo['status']): {
	icon: string;
	color: string;
} {
	switch (status) {
		case 'connected':
			return { icon: '*', color: 'green' };
		case 'connecting':
			return { icon: '~', color: 'yellow' };
		case 'error':
			return { icon: '!', color: 'red' };
		case 'disconnected':
			return { icon: 'o', color: 'gray' };
	}
}

export interface SidebarProps {
	servers: McpServerInfo[];
	model: string;
	activeSkills: Set<string>;
	width: number;
	msgCount: number;
	approxTokens: number;
	agents: { id: string; name: string; persona?: string }[];
	activeId: string;
	isStreaming: boolean;
	isThinking: boolean;
	isExecuting: boolean;
	scrolledUp: boolean;
	rawMode: boolean;
	expandAll: boolean;
	sessionStart?: number;
	usage?: { promptTokens: number; completionTokens: number };
	turnCount?: number;
	maxTurns?: number;
	packName?: string;
	mcpSummary?: { connected: number; total: number };
}

export function Sidebar({
	servers,
	model,
	activeSkills,
	width,
	msgCount,
	approxTokens,
	agents,
	activeId,
	isStreaming,
	isThinking,
	isExecuting,
	scrolledUp,
	rawMode,
	expandAll,
	sessionStart,
	usage,
	turnCount,
	maxTurns,
	packName,
	mcpSummary,
}: SidebarProps) {
	const { frame: spinnerFrame, elapsed } = useSpinner(isStreaming);
	if (width === 0) {
		return <Box width={0} overflow="hidden" />;
	}

	if (width <= 2) {
		return (
			<Box
				flexDirection="column"
				width={2}
				paddingX={0}
				backgroundColor="#0e0e14"
				overflow="hidden"
			>
				<Text color="cyan">|</Text>
				<Text color="cyan" dimColor>
					|
				</Text>
				<Text color="blue">{model.split('/')?.pop()}</Text>
			</Box>
		);
	}

	const modelShort = model.split('/').pop() || model;
	const provider = model.split('/')[0] || '';
	const mcpConnected = servers.filter((s) => s.status === 'connected').length;
	const sepW = Math.max(1, width - 4);
	const sep = '-'.repeat(sepW);
	const activeAgent = agents.find((a) => a.id === activeId);

	const sessionDuration = sessionStart
		? formatSidebarDuration(Date.now() - sessionStart)
		: null;

	const totalPrompt = usage?.promptTokens ?? approxTokens;
	const totalCompletion = usage?.completionTokens ?? 0;
	const costEst = estimateCost(model, totalPrompt, totalCompletion);

	return (
		<Box
			flexDirection="column"
			width={width}
			borderStyle="single"
			borderColor="gray"
			borderBackgroundColor="#0e0e14"
			paddingX={1}
			backgroundColor="#0e0e14"
			overflow="hidden"
		>
			<Box>
				<Text bold color="cyan">
					*
				</Text>
				<Text bold color="white">
					{' '}
					OpenExplorer
				</Text>
			</Box>
			<Text dimColor> v{VERSION}</Text>
			<Text dimColor>{sep}</Text>

			<Text dimColor bold>
				Model
			</Text>
			<Box>
				<Text color="blue"># </Text>
				<Text color="white">{modelShort}</Text>
			</Box>
			{provider && <Text dimColor> {provider}</Text>}

			{(packName || (activeAgent?.persona && activeAgent.persona !== 'default')) && (
				<Box>
					<Text dimColor> </Text>
					{packName && <Text color="magenta">{packName}</Text>}
					{packName && activeAgent?.persona && activeAgent.persona !== 'default' && <Text dimColor>/</Text>}
					{activeAgent?.persona && activeAgent.persona !== 'default' && (
						<Text color="cyan">{activeAgent.persona}</Text>
					)}
				</Box>
			)}
			{mcpSummary && mcpSummary.total > 0 && (
				<Text dimColor> mcp {mcpSummary.connected}/{mcpSummary.total}</Text>
			)}

			<Text dimColor>{sep}</Text>
			<Text dimColor bold>
				Session
			</Text>
			<Text dimColor>
				{' '}
				{msgCount} msgs | ~{approxTokens} tok
			</Text>
			{sessionDuration && (
				<Text dimColor> {sessionDuration}</Text>
			)}
			{maxTurns && maxTurns > 0 && (
				<Text dimColor> turn {turnCount ?? 0}/{maxTurns}</Text>
			)}
			{costEst && <Text dimColor> ~${costEst}</Text>}
			{mcpConnected > 0 && <Text dimColor> @{mcpConnected} mcp</Text>}

			{agents.length > 1 && (
				<Box flexDirection="column">
					<Text dimColor>{sep}</Text>
					<Text dimColor bold>
						Agents
					</Text>
					{agents.map((a) => (
						<Box key={a.id}>
							<Text
								color={a.id === activeId ? 'cyan' : 'gray'}
								bold={a.id === activeId}
							>
								{a.id === activeId ? '>' : '-'} {a.name}
							</Text>
						</Box>
					))}
				</Box>
			)}

			{activeSkills.size > 0 && (
				<Box flexDirection="column">
					<Text dimColor>{sep}</Text>
					<Text dimColor bold>
						Skills
					</Text>
					{[...activeSkills].slice(0, 6).map((s) => (
						<Box key={s}>
							<Text color="magenta">!</Text>
							<Text dimColor>{s}</Text>
						</Box>
					))}
					{activeSkills.size > 6 && (
						<Text dimColor> +{activeSkills.size - 6} more</Text>
					)}
				</Box>
			)}

			<Text dimColor>{sep}</Text>
			<Text dimColor bold>
				MCP
			</Text>
			{servers.length === 0 && <Text dimColor> (none)</Text>}
			{servers.slice(0, 6).map((s) => {
				const dot = statusDot(s.status);
				return (
					<Box key={s.name} flexDirection="column">
						<Box>
							<Text color={dot.color}>{dot.icon} </Text>
							<Text bold={s.status === 'connected'}>{s.name.slice(0, 14)}</Text>
						</Box>
						{s.status === 'connected' &&
							s.tools.slice(0, 3).map((t) => (
								<Text key={t} dimColor>
									{' '}
									. {t.replace(`mcp__${s.name}__`, '').slice(0, 14)}
								</Text>
							))}
						{s.status === 'error' && s.error && (
							<Text color="red" dimColor>
								{' '}
								{s.error.slice(0, 16)}
							</Text>
						)}
					</Box>
				);
			})}
			{servers.length > 6 && <Text dimColor> +{servers.length - 6} more</Text>}

			<Box flexDirection="column" marginTop={1}>
				<Text dimColor>{sep}</Text>
				{isStreaming && (
					<Box>
						<Text color="green">
							{spinnerFrame} {isThinking ? 'thinking' : 'responding'}
						</Text>
						{elapsed && <Text dimColor> {elapsed}</Text>}
					</Box>
				)}
				{isExecuting && <Text color="yellow">* executing</Text>}
				{scrolledUp && <Text color="yellow">^ scrolled up</Text>}
				{rawMode && <Text color="yellow">RAW mode</Text>}
				{expandAll && <Text color="green">EXPAND</Text>}
			</Box>
		</Box>
	);
}

function formatSidebarDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}

function estimateCost(
	model: string,
	promptTokens: number,
	completionTokens: number,
): string | null {
	const m = model.toLowerCase();
	let pPrice = 0;
	let cPrice = 0;
	if (m.includes('gpt-4o')) {
		pPrice = 2.5 / 1_000_000;
		cPrice = 10 / 1_000_000;
	} else if (m.includes('gpt-4-turbo') || m.includes('gpt-4-1106')) {
		pPrice = 10 / 1_000_000;
		cPrice = 30 / 1_000_000;
	} else if (m.includes('gpt-3.5')) {
		pPrice = 0.5 / 1_000_000;
		cPrice = 1.5 / 1_000_000;
	} else if (m.includes('claude-3.5-sonnet') || m.includes('claude-3-5-sonnet')) {
		pPrice = 3 / 1_000_000;
		cPrice = 15 / 1_000_000;
	} else if (m.includes('claude-3-haiku')) {
		pPrice = 0.25 / 1_000_000;
		cPrice = 1.25 / 1_000_000;
	} else if (m.includes('o1-preview')) {
		pPrice = 15 / 1_000_000;
		cPrice = 60 / 1_000_000;
	} else if (m.includes('o1-mini')) {
		pPrice = 3 / 1_000_000;
		cPrice = 12 / 1_000_000;
	} else {
		if (promptTokens + completionTokens === 0) return null;
		return null;
	}
	const cost = promptTokens * pPrice + completionTokens * cPrice;
	if (cost < 0.001) return null;
	return cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3);
}
