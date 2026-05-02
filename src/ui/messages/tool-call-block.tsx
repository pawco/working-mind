import { Box, Text } from 'ink';
import type { HistoryEntry } from '../../sdk/command.js';
import { MessageCard, ACCENT_TOOL_CALL } from '../message-card.js';
import { formatElapsed } from '../utils.js';

export interface ToolCallBlockProps {
	entry: HistoryEntry;
	expanded?: boolean;
	collapsed?: boolean;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return formatElapsed(ms);
}

function extractFilePath(name: string, args: string): string | null {
	const pathPatterns = [
		/(?:path|file|filename|filepath|filePath)\s*[:=]\s*["']([^"']+)["']/i,
		/(?:command|cmd)\s*[:=]\s*["'](?:cat|head|tail|less|more|diff)\s+([^\s"']+)/i,
	];
	for (const pat of pathPatterns) {
		const m = args.match(pat);
		if (m) return m[1];
	}
	if (name.toLowerCase().includes('read')) return args.trim().slice(0, 60) || null;
	if (name.toLowerCase().includes('write') || name.toLowerCase().includes('edit'))
		return args.trim().slice(0, 60) || null;
	return null;
}

function prettyTruncate(text: string, maxLen: number): string {
	let parsed: any;
	try {
		parsed = JSON.parse(text);
	} catch {
		return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
	}
	const pretty = JSON.stringify(parsed, null, 2);
	return pretty.length > maxLen ? `${pretty.slice(0, maxLen)}…` : pretty;
}

export function ToolCallBlock({ entry, expanded, collapsed }: ToolCallBlockProps) {
	if (collapsed) {
		return (
			<MessageCard
				accentColor={ACCENT_TOOL_CALL}
				collapsed
				header={
					<Box>
						<Text color={ACCENT_TOOL_CALL}>{'>'}</Text>
						<Text dimColor> {entry.name}</Text>
					</Box>
				}
			/>
		);
	}

	const filePath = extractFilePath(entry.name || '', entry.content);
	const label = filePath ? filePath : entry.name || 'tool';
	const duration =
		entry.startTime && entry.endTime
			? formatDuration(entry.endTime - entry.startTime)
			: null;
	const args = expanded ? entry.content : prettyTruncate(entry.content, 300);

	return (
		<MessageCard
			accentColor={ACCENT_TOOL_CALL}
			header={
				<Box>
					<Text color={ACCENT_TOOL_CALL}>{'>'}</Text>
					<Text bold> {label}</Text>
					{duration && (
						<Text dimColor>
							{' '}
							{duration}
						</Text>
					)}
					{entry.streaming && (
						<Text dimColor> ...</Text>
					)}
				</Box>
			}
		>
			{expanded && args && (
				<Box paddingLeft={1}>
					<Text dimColor>
						{args}
					</Text>
				</Box>
			)}
		</MessageCard>
	);
}
