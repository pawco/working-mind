import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

export const ACCENT_USER = '#61afef';
export const ACCENT_THINKING = '#c678dd';
export const ACCENT_TOOL_CALL = '#e5c07b';
export const ACCENT_TOOL_OK = '#98c379';
export const ACCENT_TOOL_ERR = '#e06c75';
export const ACCENT_ASSISTANT = '#56b6c2';

export const BG_UNIFORM = '#0d1117';

export function getAccentColor(role: string, exitCode?: number): string {
	if (role === 'user') return ACCENT_USER;
	if (role === 'thinking') return ACCENT_THINKING;
	if (role === 'tool_call') return ACCENT_TOOL_CALL;
	if (role === 'tool_result') return exitCode === 0 ? ACCENT_TOOL_OK : ACCENT_TOOL_ERR;
	if (role === 'assistant') return ACCENT_ASSISTANT;
	return '#555555';
}

export interface MessageCardProps {
	accentColor: string;
	collapsed?: boolean;
	header: ReactNode;
	children?: ReactNode;
}

export function MessageCard({
	accentColor,
	collapsed,
	header,
	children,
}: MessageCardProps) {
	return (
		<Box flexDirection="row">
			<Box width={1} backgroundColor={accentColor}>
				<Text>{' '}</Text>
			</Box>
			<Box
				flexDirection="column"
				flexGrow={1}
				paddingX={1}
			>
				{header}
				{!collapsed && children}
			</Box>
		</Box>
	);
}
