import { createElement as h } from 'react';
import type { McpServerInfo } from '../mcp/registry.js';
import type { SessionSummary } from '../registry.js';
import { formatCost, formatPriceBadge } from '../sdk/cost-calc.js';
import type { ModelEntry } from '../sdk/provider-registry.js';
import { useSpinner } from '../ui/utils.js';
import { VERSION } from '../version.js';

function statusDot(status: McpServerInfo['status']): {
	icon: string;
	fg: string;
} {
	switch (status) {
		case 'connected':
			return { icon: '*', fg: 'green' };
		case 'connecting':
			return { icon: '~', fg: 'yellow' };
		case 'error':
			return { icon: '!', fg: 'red' };
		case 'disconnected':
			return { icon: 'o', fg: 'gray' };
	}
}

export interface SidebarProps {
	servers: McpServerInfo[];
	model: string;
	activeSkills: Set<string>;
	width: number;
	msgCount: number;
	approxTokens: number;
	agents: { id: string; name: string; persona?: string; packName?: string }[];
	activeId: string;
	isStreaming: boolean;
	isThinking: boolean;
	isExecuting: boolean;
	scrolledUp: boolean;
	rawMode: boolean;
	expandAll: boolean;
	sessionStart?: number;
	sessionCost?: number;
	turnCount?: number;
	maxTurns?: number;
	packName?: string;
	mcpSummary?: { connected: number; total: number };
	modelEntry?: ModelEntry;
	isLocal?: boolean;
	projects: SessionSummary[];
	activeSessionId: string | null;
	cwdFiles: string[];
}

export function Sidebar(props: SidebarProps) {
	const {
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
		sessionCost,
		turnCount,
		maxTurns,
		packName,
		mcpSummary,
		modelEntry,
		isLocal,
		projects,
		activeSessionId,
		cwdFiles,
	} = props;

	const { frame: spinnerFrame, elapsed } = useSpinner(isStreaming);

	if (width === 0) {
		return h('box', { width: 0, overflow: 'hidden' });
	}

	if (width <= 2) {
		return h(
			'box',
			{
				flexDirection: 'column',
				width: 2,
				paddingX: 0,
				backgroundColor: '#0e0e14',
				overflow: 'hidden',
			},
			h('text', { content: '|', fg: 'cyan' }),
			h('text', { content: '|', fg: 'cyan', dimColor: true }),
			h('text', { content: model.split('/')?.pop() || '', fg: 'blue' }),
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
	const priceBadge = modelEntry
		? formatPriceBadge(
				modelEntry.inputPricePer1M,
				modelEntry.outputPricePer1M,
				isLocal,
			)
		: provider === 'ollama'
			? '[local]'
			: '[?]';

	const children: (ReturnType<typeof h> | false | null | '')[] = [];

	// Title
	children.push(
		h(
			'box',
			null,
			h('text', { content: '*', fg: 'cyan', bold: true }),
			h('text', { content: ' Working Mind', fg: 'white', bold: true }),
		),
		h('text', { content: ` v${VERSION}`, fg: '#7982a9' }),
		h('text', { content: sep, fg: '#7982a9' }),

		// Model section
		h('text', { content: 'Model', fg: '#7982a9', bold: true }),
		h(
			'box',
			null,
			h('text', { content: '# ', fg: 'blue' }),
			h('text', { content: modelShort, fg: 'white' }),
		),
		provider
			? h(
					'box',
					null,
					h('text', { content: ` ${provider}`, fg: '#7982a9' }),
					h('text', {
						content: ` ${priceBadge}`,
						fg: isLocal ? 'green' : '#7982a9',
					}),
				)
			: null,
	);

	// Pack / persona
	if (
		packName ||
		activeAgent?.packName ||
		(activeAgent?.persona && activeAgent.persona !== 'default')
	) {
		const displayPack = packName || activeAgent?.packName;
		const parts: string[] = [' '];
		if (displayPack) parts.push(displayPack);
		if (
			displayPack &&
			activeAgent?.persona &&
			activeAgent.persona !== 'default'
		)
			parts.push('/');
		if (activeAgent?.persona && activeAgent.persona !== 'default')
			parts.push(activeAgent.persona);
		children.push(h('text', { content: parts.join(''), fg: 'magenta' }));
	}

	if (mcpSummary && mcpSummary.total > 0) {
		children.push(
			h('text', {
				content: ` mcp ${mcpSummary.connected}/${mcpSummary.total}`,
				fg: '#7982a9',
			}),
		);
	}

	children.push(
		h('text', { content: sep, fg: '#7982a9' }),
		h('text', { content: 'Session', fg: '#7982a9', bold: true }),
		h('text', {
			content: ` ${activeAgent?.name || activeSessionId || 'untitled'}`,
			fg: 'white',
		}),
		h('text', {
			content: ` ${msgCount} msgs | ~${approxTokens} tok`,
			fg: '#7982a9',
		}),
		sessionDuration
			? h('text', { content: ` ${sessionDuration}`, fg: '#7982a9' })
			: null,
		maxTurns && maxTurns > 0
			? h('text', {
					content: ` turn ${turnCount ?? 0}/${maxTurns}`,
					fg: '#7982a9',
				})
			: null,
		sessionCost && sessionCost > 0
			? h('text', { content: ` ${formatCost(sessionCost)}`, fg: '#7982a9' })
			: null,
		mcpConnected > 0
			? h('text', { content: ` @${mcpConnected} mcp`, fg: '#7982a9' })
			: null,
	);

	// Projects
	if (projects.length > 0) {
		children.push(
			h('text', { content: sep, fg: '#7982a9' }),
			h('text', { content: 'Projects', fg: '#7982a9', bold: true }),
		);
		const visibleProjects = projects.slice(0, 5);
		for (const p of visibleProjects) {
			const isActive = p.sessionId === activeSessionId;
			const nameTrunc = p.name.slice(0, width - 6);
			children.push(
				h('text', {
					content: `${isActive ? '>' : ' '} ${nameTrunc}`,
					fg: isActive ? 'cyan' : 'gray',
					bold: isActive,
				}),
			);
		}
		if (projects.length > 5) {
			children.push(
				h('text', {
					content: ` +${projects.length - 5} more`,
					fg: '#7982a9',
				}),
			);
		}
	}

	// Files (CWD .md files available for /ingest)
	if (cwdFiles.length > 0) {
		children.push(
			h('text', { content: sep, fg: '#7982a9' }),
			h('text', { content: 'Files', fg: '#7982a9', bold: true }),
		);
		const visibleFiles = cwdFiles.slice(0, 5);
		for (const f of visibleFiles) {
			const nameTrunc = f.slice(0, width - 4);
			children.push(
				h('text', {
					content: `  ${nameTrunc}`,
					fg: '#7982a9',
				}),
			);
		}
		if (cwdFiles.length > 5) {
			children.push(
				h('text', {
					content: ` +${cwdFiles.length - 5} more`,
					fg: '#7982a9',
				}),
			);
		}
	}

	// Agents
	if (agents.length > 1) {
		children.push(
			h('text', { content: sep, fg: '#7982a9' }),
			h('text', { content: 'Agents', fg: '#7982a9', bold: true }),
		);
		for (const a of agents) {
			const label = a.packName
				? `${a.packName}/${a.persona && a.persona !== 'default' ? a.persona : 'default'}`
				: a.name;
			children.push(
				h('text', {
					content: `${a.id === activeId ? '>' : '-'} ${label}`,
					fg: a.id === activeId ? 'cyan' : 'gray',
					bold: a.id === activeId,
				}),
			);
		}
	}

	// Skills
	if (activeSkills.size > 0) {
		children.push(
			h('text', { content: sep, fg: '#7982a9' }),
			h('text', { content: 'Skills', fg: '#7982a9', bold: true }),
		);
		const skillArr = [...activeSkills].slice(0, 6);
		for (const s of skillArr) {
			children.push(h('text', { content: `! ${s}`, fg: 'magenta' }));
		}
		if (activeSkills.size > 6) {
			children.push(
				h('text', {
					content: ` +${activeSkills.size - 6} more`,
					fg: '#7982a9',
				}),
			);
		}
	}

	// MCP servers
	children.push(
		h('text', { content: sep, fg: '#7982a9' }),
		h('text', { content: 'MCP', fg: '#7982a9', bold: true }),
	);
	if (servers.length === 0) {
		children.push(h('text', { content: ' (none)', fg: '#7982a9' }));
	}
	for (const s of servers.slice(0, 6)) {
		const dot = statusDot(s.status);
		children.push(
			h('text', {
				content: `${dot.icon} ${s.name.slice(0, 14)}`,
				fg: dot.fg,
			}),
		);
		if (s.status === 'connected') {
			for (const t of s.tools.slice(0, 3)) {
				children.push(
					h('text', {
						content: `   . ${t.replace(`mcp__${s.name}__`, '').slice(0, 14)}`,
						fg: '#7982a9',
					}),
				);
			}
		}
		if (s.status === 'error' && s.error) {
			children.push(
				h('text', { content: `   ${s.error.slice(0, 16)}`, fg: 'red' }),
			);
		}
	}
	if (servers.length > 6) {
		children.push(
			h('text', { content: ` +${servers.length - 6} more`, fg: '#7982a9' }),
		);
	}

	// Status
	children.push(h('text', { content: sep, fg: '#7982a9' }));
	if (isStreaming) {
		const label = isThinking ? 'thinking' : 'responding';
		children.push(
			h('text', {
				content: `${spinnerFrame} ${label}${elapsed ? ` ${elapsed}` : ''}`,
				fg: 'green',
			}),
		);
	}
	if (isExecuting) {
		children.push(h('text', { content: '* executing', fg: 'yellow' }));
	}
	if (scrolledUp) {
		children.push(h('text', { content: '^ scrolled up', fg: 'yellow' }));
	}
	if (rawMode) {
		children.push(h('text', { content: 'RAW mode', fg: 'yellow' }));
	}
	if (expandAll) {
		children.push(h('text', { content: 'EXPAND', fg: 'green' }));
	}

	return h(
		'box',
		{
			flexDirection: 'column',
			width,
			borderStyle: 'single',
			borderColor: 'gray',
			borderBackgroundColor: '#0e0e14',
			paddingX: 1,
			backgroundColor: '#0e0e14',
			overflow: 'hidden',
		},
		...(children.filter(Boolean) as ReturnType<typeof h>[]),
	);
}

function formatSidebarDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const hr = Math.floor(m / 60);
	return `${hr}h ${m % 60}m`;
}
