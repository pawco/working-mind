import { Box, measureElement, Text, useInput } from 'ink';
import type React from 'react';
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import type { AgentInstance } from '../registry.js';
import type { HistoryEntry } from '../sdk/command.js';
import { MessageItem } from './messages/index.js';
import {
	plainLineCount,
	THINKING_COLLAPSE_THRESHOLD,
	THINKING_PREVIEW_LINES,
} from './utils.js';

const SCROLL_SPEED = 3;
const ENTRY_GAP = 1;
const MESSAGE_CARD_OVERHEAD = 2;

export interface ChatScrollHandle {
	scrollToTop: () => void;
	scrollToBottom: () => void;
	scrollBy: (delta: number) => void;
	isAtBottom: () => boolean;
}

export interface ChatScrollProps {
	entries: HistoryEntry[];
	agent: AgentInstance;
	contentWidth: number;
	rawMode: boolean;
	expandAll: boolean;
	focused: boolean;
	onScrolledUp: (up: boolean) => void;
	availableRows: number;
}

const TOOL_RESULT_PREVIEW_LINES = 8;

function estimateEntryHeight(
	entry: HistoryEntry,
	width: number,
	expandAll: boolean,
): number {
	const usable = Math.max(20, width - 4);
	const contentLines = plainLineCount(entry.content || '', usable);
	const header = 1;

	if (entry.role === 'thinking' && !entry.streaming) {
		if (!expandAll && contentLines > THINKING_COLLAPSE_THRESHOLD) {
			return header + THINKING_PREVIEW_LINES + 1 + MESSAGE_CARD_OVERHEAD;
		}
		return header + contentLines + MESSAGE_CARD_OVERHEAD;
	}
	if (entry.role === 'tool_result') {
		if (!expandAll && contentLines > TOOL_RESULT_PREVIEW_LINES) {
			return header + TOOL_RESULT_PREVIEW_LINES + 1 + MESSAGE_CARD_OVERHEAD;
		}
		return header + contentLines + MESSAGE_CARD_OVERHEAD;
	}
	if (entry.role === 'tool_call') {
		return header + MESSAGE_CARD_OVERHEAD;
	}
	if (entry.role === 'error') {
		const capped = Math.min(contentLines, 5);
		return header + capped + 1 + MESSAGE_CARD_OVERHEAD;
	}
	return header + contentLines + MESSAGE_CARD_OVERHEAD;
}

function computeCumulativeOffsets(
	entries: HistoryEntry[],
	heights: Map<number, number>,
	contentWidth: number,
	expandAll: boolean,
): { offsets: number[]; totalHeight: number } {
	const offsets: number[] = [];
	let cumulative = 0;
	for (let i = 0; i < entries.length; i++) {
		offsets.push(cumulative);
		const h =
			heights.get(entries[i].id) ??
			estimateEntryHeight(entries[i], contentWidth, expandAll);
		cumulative += h + (i < entries.length - 1 ? ENTRY_GAP : 0);
	}
	return { offsets, totalHeight: cumulative };
}

function findVisibleRange(
	offsets: number[],
	_totalHeight: number,
	heights: Map<number, number>,
	entries: HistoryEntry[],
	yOffset: number,
	viewportRows: number,
	expandAll: boolean,
): { startIdx: number; endIdx: number } {
	if (offsets.length === 0) return { startIdx: 0, endIdx: -1 };

	const bottomEdge = yOffset + viewportRows;

	let lo = 0;
	let hi = offsets.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		const h =
			heights.get(entries[mid].id) ??
			estimateEntryHeight(entries[mid], 80, expandAll);
		if (offsets[mid] + h + ENTRY_GAP <= yOffset) lo = mid + 1;
		else hi = mid;
	}
	const startIdx = Math.max(0, lo - 1);

	lo = startIdx;
	hi = offsets.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (offsets[mid] < bottomEdge) lo = mid;
		else hi = mid - 1;
	}
	const endIdx = Math.min(offsets.length - 1, lo + 1);

	return { startIdx, endIdx };
}

function findSnapStartIdx(offsets: number[], effectiveYOffset: number): number {
	for (let i = 0; i < offsets.length; i++) {
		if (offsets[i] >= effectiveYOffset) return i;
	}
	return offsets.length - 1;
}

export const ChatScroll = forwardRef(function ChatScroll(
	{
		entries,
		agent,
		contentWidth,
		rawMode,
		expandAll,
		focused,
		onScrolledUp,
		availableRows,
	}: ChatScrollProps,
	ref: React.Ref<ChatScrollHandle>,
) {
	const [yOffset, setYOffset] = useState(0);
	const [stickingToBottom, setStickingToBottom] = useState(true);
	const [_heightsVersion, setHeightsVersion] = useState(0);
	const viewportRows = availableRows;
	const heightsRef = useRef<Map<number, number>>(new Map());
	const itemRefs = useRef<Map<number, any>>(new Map());
	const entriesRef = useRef(entries);
	entriesRef.current = entries;
	const entryIdsRef = useRef<Set<number>>(new Set());

	const prevEntryIds = entryIdsRef.current;
	const currentEntryIds = new Set(entries.map((e) => e.id));
	for (const id of prevEntryIds) {
		if (!currentEntryIds.has(id)) {
			heightsRef.current.delete(id);
			itemRefs.current.delete(id);
		}
	}
	entryIdsRef.current = currentEntryIds;

	const anyStreaming = entries.some((e) => e.streaming);

	const computeMaxOffset = useCallback(() => {
		const { totalHeight } = computeCumulativeOffsets(
			entriesRef.current,
			heightsRef.current,
			contentWidth,
			expandAll,
		);
		return Math.max(0, totalHeight - viewportRows);
	}, [contentWidth, viewportRows, expandAll]);

	const scrollToTopFn = useCallback(() => {
		setYOffset(0);
		setStickingToBottom(false);
		onScrolledUp(true);
	}, [onScrolledUp]);

	const scrollToBottomFn = useCallback(() => {
		const maxOffset = computeMaxOffset();
		setYOffset(maxOffset);
		setStickingToBottom(true);
		onScrolledUp(false);
	}, [computeMaxOffset, onScrolledUp]);

	const scrollByFn = useCallback(
		(delta: number) => {
			if (delta < 0) {
				setStickingToBottom(false);
				onScrolledUp(true);
			}
			setYOffset((prev) => {
				const maxOffset = computeMaxOffset();
				const next = Math.max(0, Math.min(maxOffset, prev + delta));
				if (delta > 0 && next >= maxOffset) {
					setStickingToBottom(true);
					onScrolledUp(false);
				}
				return next;
			});
		},
		[computeMaxOffset, onScrolledUp],
	);

	const isAtBottomFn = useCallback(() => {
		if (stickingToBottom) return true;
		const maxOffset = computeMaxOffset();
		return yOffset >= maxOffset;
	}, [stickingToBottom, computeMaxOffset, yOffset]);

	useImperativeHandle(
		ref,
		() => ({
			scrollToTop: scrollToTopFn,
			scrollToBottom: scrollToBottomFn,
			scrollBy: scrollByFn,
			isAtBottom: isAtBottomFn,
		}),
		[scrollToTopFn, scrollToBottomFn, scrollByFn, isAtBottomFn],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: entries.length triggers auto-scroll
	useEffect(() => {
		if (stickingToBottom) {
			const maxOffset = computeMaxOffset();
			setYOffset(maxOffset);
		}
	}, [entries.length, stickingToBottom, computeMaxOffset]);

	const prevContentHashRef = useRef('');
	useEffect(() => {
		if (!stickingToBottom) return;
		const hash = entries
			.filter((e) => e.streaming)
			.map((e) => `${e.id}:${e.content.length}`)
			.join('|');
		if (hash !== prevContentHashRef.current && hash) {
			prevContentHashRef.current = hash;
			const maxOffset = computeMaxOffset();
			setYOffset(maxOffset);
		}
	}, [entries, stickingToBottom, computeMaxOffset]);

	useInput(
		useCallback(
			(_inputChar: string, key: any) => {
				if (!focused) return;
				if (key.shift && key.upArrow) {
					scrollByFn(-SCROLL_SPEED);
				} else if (key.shift && key.downArrow) {
					scrollByFn(SCROLL_SPEED);
				} else if (key.pageUp) {
					scrollByFn(-viewportRows);
				} else if (key.pageDown) {
					scrollByFn(viewportRows);
				} else if (key.ctrl && key.upArrow) {
					scrollToTopFn();
				} else if (key.ctrl && key.downArrow) {
					scrollToBottomFn();
				}
			},
			[focused, scrollByFn, scrollToTopFn, scrollToBottomFn, viewportRows],
		),
	);

	const { offsets, totalHeight } = computeCumulativeOffsets(
		entries,
		heightsRef.current,
		contentWidth,
		expandAll,
	);
	const maxOffset = Math.max(0, totalHeight - viewportRows);
	const effectiveYOffset = stickingToBottom
		? maxOffset
		: Math.min(yOffset, maxOffset);

	const snapMode = stickingToBottom && anyStreaming;

	let { startIdx, endIdx } = findVisibleRange(
		offsets,
		totalHeight,
		heightsRef.current,
		entries,
		effectiveYOffset,
		viewportRows,
		expandAll,
	);

	let topClip =
		startIdx < offsets.length ? effectiveYOffset - offsets[startIdx] : 0;

	if (snapMode && topClip > 0) {
		const snapIdx = findSnapStartIdx(offsets, effectiveYOffset);
		if (snapIdx <= endIdx) {
			startIdx = snapIdx;
			topClip = 0;
		}
	}

	const visibleEntries =
		startIdx <= endIdx ? entries.slice(startIdx, endIdx + 1) : [];

	useLayoutEffect(() => {
		let changed = false;
		for (const entry of visibleEntries) {
			const node = itemRefs.current.get(entry.id);
			if (node) {
				const { height } = measureElement(node);
				if (height > 0) {
					const prev = heightsRef.current.get(entry.id);
					if (prev !== height) {
						heightsRef.current.set(entry.id, height);
						changed = true;
					}
				}
			}
		}
		if (changed) setHeightsVersion((v) => v + 1);
	}, [visibleEntries]);

	const scrollFraction = maxOffset > 0 ? effectiveYOffset / maxOffset : 0;
	const thumbPosition = Math.floor(scrollFraction * (viewportRows - 1));

	const scrollbar =
		totalHeight > viewportRows ? (
			<Box
				flexDirection="column"
				width={1}
				alignItems="center"
				height={viewportRows}
			>
				<Text>
					{'\n'.repeat(Math.max(0, thumbPosition))}
					{'█'}
				</Text>
			</Box>
		) : null;

	return (
		<Box flexDirection="row" flexGrow={1} overflow="hidden">
			<Box
				flexDirection="column"
				flexGrow={1}
				height={viewportRows}
				overflow="hidden"
			>
				<Box flexDirection="column" overflow="hidden" marginTop={-topClip}>
					{visibleEntries.map((entry, i) => {
						const globalIdx = startIdx + i;
						return (
							<Box
								key={entry.id > 0 ? entry.id : `e-${entry.id}`}
								ref={(el: any) => {
									if (el) itemRefs.current.set(entry.id, el);
									else itemRefs.current.delete(entry.id);
								}}
								flexDirection="column"
								marginBottom={globalIdx < entries.length - 1 ? ENTRY_GAP : 0}
							>
								<MessageItem
									entry={entry}
									agent={agent}
									contentWidth={contentWidth}
									rawMode={rawMode}
									expanded={expandAll}
									collapsed={false}
								/>
							</Box>
						);
					})}
				</Box>
			</Box>
			{scrollbar}
		</Box>
	);
}) as (
	props: ChatScrollProps & { ref?: React.Ref<ChatScrollHandle> },
) => React.ReactElement;
