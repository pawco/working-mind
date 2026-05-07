const COMPACTION_CHAR_THRESHOLD = 100_000;
const COMPACTION_KEEP_CHARS = 60_000;

function messageChars(msg: any): number {
	let size = 0;
	if (typeof msg.content === 'string') size += msg.content.length;
	if (Array.isArray(msg.tool_calls)) {
		for (const tc of msg.tool_calls) {
			size += (tc.name || '').length + (tc.arguments || '').length;
		}
	}
	return size;
}

export function estimateMessageTokens(messages: any[]): number {
	let total = 0;
	for (const msg of messages) {
		total += messageChars(msg);
	}
	return Math.ceil(total / 4);
}

export function shouldCompact(messages: any[]): boolean {
	let totalChars = 0;
	for (const msg of messages) {
		totalChars += messageChars(msg);
	}
	return totalChars > COMPACTION_CHAR_THRESHOLD;
}

export function compactMessages(messages: any[]): any[] {
	let totalChars = 0;
	for (const msg of messages) {
		totalChars += messageChars(msg);
	}

	if (totalChars <= COMPACTION_CHAR_THRESHOLD) return messages;

	let cutIndex = 0;
	let removedChars = 0;

	for (let i = 0; i < messages.length; i++) {
		const mc = messageChars(messages[i]);
		if (totalChars - removedChars - mc <= COMPACTION_KEEP_CHARS) {
			cutIndex = i;
			break;
		}
		removedChars += mc;
	}

	while (cutIndex < messages.length && messages[cutIndex].role !== 'user') {
		cutIndex++;
	}

	if (cutIndex >= messages.length || cutIndex === 0) return messages;

	cutIndex = preserveToolCallPairs(messages, cutIndex);

	const removed = cutIndex;
	const compacted = [
		{
			role: 'user',
			content: `[Previous ${removed} messages compacted. Key information is preserved in the knowledge graph. Use search_nodes to look up details.]`,
		},
		{
			role: 'assistant',
			content:
				'Understood. I will use search_nodes when I need details from earlier in the conversation.',
		},
		...messages.slice(cutIndex),
	];

	return compacted;
}

function preserveToolCallPairs(
	messages: any[],
	initialCutIndex: number,
): number {
	let cutIndex = initialCutIndex;
	let changed = true;

	while (changed) {
		changed = false;

		const toolCallIdsBeforeCut = new Set<string>();
		for (let i = 0; i < cutIndex; i++) {
			if (Array.isArray(messages[i].tool_calls)) {
				for (const tc of messages[i].tool_calls) {
					if (tc.id) toolCallIdsBeforeCut.add(tc.id);
				}
			}
		}

		for (let i = cutIndex; i < messages.length; i++) {
			if (
				messages[i].tool_call_id &&
				toolCallIdsBeforeCut.has(messages[i].tool_call_id)
			) {
				for (let j = i - 1; j >= 0; j--) {
					if (Array.isArray(messages[j].tool_calls)) {
						for (const tc of messages[j].tool_calls) {
							if (tc.id === messages[i].tool_call_id) {
								let newCut = j;
								while (newCut > 0 && messages[newCut - 1].role !== 'user') {
									newCut--;
								}
								if (newCut < cutIndex) {
									cutIndex = newCut;
									changed = true;
								}
								break;
							}
						}
					}
					if (changed) break;
				}
				if (changed) break;
			}
		}

		if (changed) continue;

		const toolCallIdsAfterCut = new Set<string>();
		for (let i = cutIndex; i < messages.length; i++) {
			if (Array.isArray(messages[i].tool_calls)) {
				for (const tc of messages[i].tool_calls) {
					if (tc.id) toolCallIdsAfterCut.add(tc.id);
				}
			}
		}

		for (const id of toolCallIdsAfterCut) {
			let found = false;
			for (let i = cutIndex; i < messages.length; i++) {
				if (messages[i].tool_call_id === id) {
					found = true;
					break;
				}
			}
			if (!found) {
				for (let i = cutIndex; i < messages.length; i++) {
					if (Array.isArray(messages[i].tool_calls)) {
						for (const tc of messages[i].tool_calls) {
							if (tc.id === id) {
								let newCut = i;
								while (newCut > 0 && messages[newCut - 1].role !== 'user') {
									newCut--;
								}
								if (newCut < cutIndex) {
									cutIndex = newCut;
									changed = true;
								}
								break;
							}
						}
					}
					if (changed) break;
				}
				if (changed) break;
			}
		}
	}

	return cutIndex;
}
