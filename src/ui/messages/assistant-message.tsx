import { Box, Text } from 'ink';
import type { AgentInstance } from '../../registry.js';
import type { HistoryEntry } from '../../sdk/command.js';
import {
	isDiffContent,
	renderDiff,
	renderMarkdown,
} from '../markdown-renderer.js';
import { ACCENT_ASSISTANT, MessageCard } from '../message-card.js';

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
	const cursor = entry.streaming ? <Text dimColor>▍</Text> : null;

	const contentNode = rawMode ? (
		<Text wrap="wrap">
			{entry.content}
			{cursor}
		</Text>
	) : entry.plainText ? (
		<Box flexDirection="column">
			{entry.content.split('\n').map((line, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static split content, never reorders
				<Text key={i} wrap="wrap">
					{line}
				</Text>
			))}
		</Box>
	) : isDiffContent(entry.content) ? (
		<Text>{renderDiff(entry.content)}</Text>
	) : (
		<Text>
			{renderMarkdown(entry.content, usable)}
			{cursor}
		</Text>
	);

	return (
		<MessageCard
			accentColor={ACCENT_ASSISTANT}
			collapsed={collapsed}
			header={
				<Box>
					<Text color={ACCENT_ASSISTANT}>{'◆'}</Text>
					<Text dimColor> {agent.name}</Text>
					{rawMode && <Text dimColor> [raw]</Text>}
				</Box>
			}
		>
			<Box paddingLeft={2}>{contentNode}</Box>
		</MessageCard>
	);
}
