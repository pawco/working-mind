import { createElement as h } from 'react';
import type { AgentInstance } from '../registry.js';
import type { HistoryEntry } from '../sdk/command.js';
import { formatCost } from '../sdk/cost-calc.js';
import { sanitizeUntrusted } from '../ui/ansi-sanitize.js';
import { ansiToStyledText } from '../ui/ansi-styled-text.js';
import {
	isDiffContent,
	renderDiff,
	renderMarkdown,
} from '../ui/markdown-renderer.js';
import { ACCENT_ASSISTANT, BG_ASSISTANT, MessageCard } from './message-card.js';

export interface AssistantMessageProps {
	entry: HistoryEntry;
	agent: AgentInstance;
	contentWidth: number;
	rawMode: boolean;
	collapsed?: boolean;
}

export function AssistantMessage({
	entry,
	agent,
	contentWidth,
	rawMode,
	collapsed,
}: AssistantMessageProps) {
	const usable = Math.max(20, contentWidth - 6);
	const cursor = entry.streaming ? ' \u258d' : '';
	const safeContent = sanitizeUntrusted(entry.content);

	let contentStyled: ReturnType<typeof ansiToStyledText>;
	if (rawMode) {
		contentStyled = ansiToStyledText(safeContent + cursor);
	} else if (entry.plainText) {
		contentStyled = ansiToStyledText(safeContent);
	} else if (isDiffContent(safeContent)) {
		contentStyled = ansiToStyledText(renderDiff(safeContent));
	} else {
		const ansi = renderMarkdown(safeContent, usable);
		contentStyled = ansiToStyledText(ansi + cursor);
	}

	return h(
		MessageCard,
		{
			accentColor: ACCENT_ASSISTANT,
			backgroundColor: BG_ASSISTANT,
			collapsed,
			header: h(
				'box',
				null,
				h('text', { content: '\u25c6', fg: ACCENT_ASSISTANT }),
				h('text', { content: ` ${agent.name}`, fg: '#7982a9' }),
				rawMode && h('text', { content: ' [raw]', fg: '#7982a9' }),
			),
		},
		h('box', { paddingLeft: 2 }, h('text', { content: contentStyled })),
		entry.costInfo &&
			!entry.streaming &&
			h(
				'box',
				{ paddingLeft: 2, paddingTop: 0 },
				h('text', {
					content: `${entry.costInfo.promptTokens + entry.costInfo.completionTokens} tokens | ${formatCost(entry.costInfo.cost)}`,
					fg: '#7982a9',
				}),
			),
	);
}
