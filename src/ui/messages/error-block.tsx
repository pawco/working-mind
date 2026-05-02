import { Box, Text } from 'ink';
import type { HistoryEntry } from '../../sdk/command.js';
import {
	MessageCard,
	ACCENT_TOOL_ERR,
} from '../message-card.js';

export interface ErrorBlockProps {
	entry: HistoryEntry;
	expanded: boolean;
	collapsed?: boolean;
}

export function ErrorBlock({ entry, expanded, collapsed }: ErrorBlockProps) {
	if (collapsed) {
		return (
			<MessageCard
				accentColor={ACCENT_TOOL_ERR}
				collapsed
				header={
					<Box>
						<Text color={ACCENT_TOOL_ERR}>!</Text>
						<Text color="red"> error</Text>
					</Box>
				}
			/>
		);
	}

	const content = entry.content || 'Unknown error';
	const lines = content.split('\n');
	const previewLines = expanded ? lines : lines.slice(0, 3);
	const remaining = lines.length - previewLines.length;

	return (
		<MessageCard
			accentColor={ACCENT_TOOL_ERR}
			header={
				<Box>
					<Text color={ACCENT_TOOL_ERR}>!</Text>
					<Text color="red"> error</Text>
				</Box>
			}
		>
			<Box paddingLeft={1} flexDirection="column">
				{previewLines.map((line) => (
					<Text key={line.slice(0, 40)} color="red" wrap="wrap">
						{line}
					</Text>
				))}
				{remaining > 0 && (
					<Text dimColor>
						+{remaining} lines [Ctrl+E]
					</Text>
				)}
				<Text dimColor>
					Press [r] to retry
				</Text>
			</Box>
		</MessageCard>
	);
}
