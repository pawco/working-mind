import { Box, Text } from 'ink';
import type { HistoryEntry } from '../../sdk/command.js';
import {
	MessageCard,
	ACCENT_THINKING,
} from '../message-card.js';
import {
	THINKING_COLLAPSE_THRESHOLD,
	THINKING_PREVIEW_LINES,
	formatElapsed,
} from '../utils.js';

export interface ThinkingBlockProps {
	entry: HistoryEntry;
	expanded: boolean;
	collapsed?: boolean;
}

export function ThinkingBlock({ entry, expanded, collapsed }: ThinkingBlockProps) {
	if (collapsed) {
		return (
			<MessageCard
				accentColor={ACCENT_THINKING}
				collapsed
				header={
					<Box>
						<Text color={ACCENT_THINKING}>*</Text>
						<Text dimColor> thinking</Text>
					</Box>
				}
			/>
		);
	}

	const duration =
		entry.startTime && entry.endTime
			? formatElapsed(entry.endTime - entry.startTime)
			: null;

	if (entry.streaming && !expanded) {
		return (
			<MessageCard
				accentColor={ACCENT_THINKING}
				header={
					<Box>
						<Text color={ACCENT_THINKING}>*</Text>
						<Text dimColor> thinking</Text>
						<Text dimColor> ...</Text>
						{duration && <Text dimColor> {duration}</Text>}
					</Box>
				}
			/>
		);
	}

	const lines = entry.content.split('\n');
	const totalLines = lines.length;
	const isLong = !entry.streaming && totalLines > THINKING_COLLAPSE_THRESHOLD;
	const shown =
		isLong && !expanded ? lines.slice(0, THINKING_PREVIEW_LINES) : lines;
	const remaining = totalLines - THINKING_PREVIEW_LINES;

	return (
		<MessageCard
			accentColor={ACCENT_THINKING}
			header={
				<Box>
					<Text color={ACCENT_THINKING}>*</Text>
					<Text dimColor> thinking</Text>
					{duration && <Text dimColor> {duration}</Text>}
				</Box>
			}
		>
			<Box paddingLeft={1}>
				<Text dimColor wrap="wrap">
					{shown.join('\n')}
				</Text>
			</Box>
			{isLong && !expanded && remaining > 0 && (
				<Text dimColor>
					+{remaining} lines [Ctrl+E]
				</Text>
			)}
		</MessageCard>
	);
}
