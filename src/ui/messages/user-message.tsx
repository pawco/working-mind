import { Box, Text } from 'ink';
import type { HistoryEntry } from '../../sdk/command.js';
import { MessageCard, ACCENT_USER } from '../message-card.js';

export interface UserMessageProps {
	entry: HistoryEntry;
	collapsed?: boolean;
}

export function UserMessage({ entry, collapsed }: UserMessageProps) {
	return (
		<MessageCard
			accentColor={ACCENT_USER}
			collapsed={collapsed}
			header={
				<Box>
					<Text color={ACCENT_USER}>{'>'}</Text>
					<Text bold> You</Text>
				</Box>
			}
		>
			<Box paddingLeft={1}>
				<Text wrap="wrap">
					{entry.content}
				</Text>
			</Box>
		</MessageCard>
	);
}
