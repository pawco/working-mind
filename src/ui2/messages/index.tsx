import { createElement as h, memo } from 'react';
import type { AgentInstance } from '../../registry.js';
import type { HistoryEntry } from '../../sdk/command.js';
import { AssistantMessage } from '../assistant-message.js';
import { ErrorBlock } from '../error-block.js';
import { ThinkingBlock } from '../thinking-block.js';
import { ToolCallBlock } from '../tool-call-block.js';
import { ToolResultBlock } from '../tool-result-block.js';
import { UserMessage } from '../user-message.js';

export interface MessageItemProps {
	entry: HistoryEntry;
	agent: AgentInstance;
	contentWidth: number;
	rawMode: boolean;
	expanded: boolean;
	collapsed?: boolean;
}

export const MessageItem = memo(function MessageItem({
	entry,
	agent,
	contentWidth,
	rawMode,
	expanded,
	collapsed,
}: MessageItemProps) {
	if (entry.role === 'user') {
		return h(UserMessage, { entry, collapsed });
	}
	if (entry.role === 'thinking') {
		return h(ThinkingBlock, { entry, expanded, collapsed });
	}
	if (entry.role === 'tool_call') {
		return h(ToolCallBlock, { entry, expanded, collapsed });
	}
	if (entry.role === 'tool_result') {
		return h(ToolResultBlock, { entry, expanded, collapsed });
	}
	if (entry.role === 'error') {
		return h(ErrorBlock, { entry, expanded, collapsed });
	}
	if (entry.role === 'assistant') {
		return h(AssistantMessage, {
			entry,
			agent,
			contentWidth,
			rawMode,
			collapsed,
		});
	}
	return null;
});
