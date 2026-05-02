import { Box, Text } from 'ink';
import type { HistoryEntry } from '../../sdk/command.js';
import {
	MessageCard,
	ACCENT_TOOL_OK,
	ACCENT_TOOL_ERR,
} from '../message-card.js';
import { formatElapsed } from '../utils.js';

export interface ToolResultBlockProps {
	entry: HistoryEntry;
	expanded?: boolean;
	collapsed?: boolean;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return formatElapsed(ms);
}

const SUCCESS = 0;
const MAX_PREVIEW_LINES = 8;

export function ToolResultBlock({ entry, expanded, collapsed }: ToolResultBlockProps) {
	const isOk = entry.exitCode === SUCCESS;
	const accentColor = isOk ? ACCENT_TOOL_OK : ACCENT_TOOL_ERR;
	const icon = isOk ? '<' : '!';

	if (collapsed) {
		return (
			<MessageCard
				accentColor={accentColor}
				collapsed
				header={
					<Box>
						<Text color={accentColor}>{icon}</Text>
						<Text dimColor> {entry.name}</Text>
					</Box>
				}
			/>
		);
	}

	const duration =
		entry.startTime && entry.endTime
			? formatDuration(entry.endTime - entry.startTime)
			: null;
	const lines = entry.content.split('\n');
	const isLong = lines.length > MAX_PREVIEW_LINES;
	const showLines =
		isLong && !expanded ? lines.slice(0, MAX_PREVIEW_LINES) : lines;
	const remaining = lines.length - MAX_PREVIEW_LINES;

	return (
		<MessageCard
			accentColor={accentColor}
			header={
				<Box>
					<Text color={accentColor}>{icon}</Text>
					<Text bold> {entry.name || 'result'}</Text>
					{duration && (
						<Text dimColor>
							{' '}
							{duration}
						</Text>
					)}
				</Box>
			}
		>
			<Box paddingLeft={1} flexDirection="column">
				{showLines.map((line) => (
					<Text key={line.slice(0, 40)} dimColor wrap="wrap">
						{line}
					</Text>
				))}
			</Box>
			{isLong && !expanded && remaining > 0 && (
				<Text dimColor>
					{' '}
					+{remaining} lines [Ctrl+E]
				</Text>
			)}
		</MessageCard>
	);
}
