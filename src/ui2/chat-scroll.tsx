import { forwardRef, createElement as h, useCallback, useImperativeHandle, useRef } from 'react';
import type { AgentInstance } from '../registry.js';
import type { HistoryEntry } from '../sdk/command.js';
import { ACCENT_ASSISTANT, MessageCard } from './message-card.js';
import { MessageItem } from './messages/index.js';

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
	isStreaming: boolean;
	onScrolledUp: (up: boolean) => void;
	availableRows: number;
	scrollboxRef?: React.RefObject<any>;
}

export const ChatScroll = forwardRef(function ChatScroll(
	{
		entries,
		agent,
		contentWidth,
		rawMode,
		expandAll,
		focused: _focused,
		isStreaming,
		onScrolledUp,
		availableRows: _availableRows,
		scrollboxRef: externalRef,
	}: ChatScrollProps,
	ref: React.Ref<ChatScrollHandle>,
) {
	const internalRef = useRef<any>(null);
	const boxRef = (externalRef ?? internalRef) as React.RefObject<any>;

	const scrollToTopFn = useCallback(() => {
		if (boxRef.current) {
			boxRef.current.scrollTop = 0;
			onScrolledUp(true);
		}
	}, [boxRef, onScrolledUp]);

	const scrollToBottomFn = useCallback(() => {
		if (boxRef.current) {
			boxRef.current.scrollTop = boxRef.current.scrollHeight;
			onScrolledUp(false);
		}
	}, [boxRef, onScrolledUp]);

	const scrollByFn = useCallback(
		(delta: number) => {
			if (boxRef.current) {
				boxRef.current.scrollBy(delta);
				if (delta < 0) onScrolledUp(true);
				else onScrolledUp(false);
			}
		},
		[boxRef, onScrolledUp],
	);

	const isAtBottomFn = useCallback(() => {
		if (!boxRef.current) return true;
		const sb = boxRef.current;
		return sb.scrollTop + sb.viewport.height >= sb.scrollHeight - 2;
	}, [boxRef]);

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

	const showWelcome = entries.length === 0 && !isStreaming;

	return h(
		'scrollbox',
		{
			ref: boxRef,
			flexGrow: 1,
			stickyScroll: true,
			stickyStart: 'bottom',
			viewportCulling: true,
			scrollY: true,
			focused: false,
			style: {
				scrollbarOptions: {
					trackOptions: {
						foregroundColor: '#414868',
						backgroundColor: '#1a1b26',
					},
				},
			},
		},
		showWelcome &&
			h(
				'box',
				{ key: 'welcome', marginBottom: 1, paddingBottom: 1 },
				h(
					MessageCard,
					{
						accentColor: ACCENT_ASSISTANT,
						backgroundColor: '#0d1117',
						header: h(
							'box',
							null,
							h('text', { content: '\u25c6', fg: ACCENT_ASSISTANT }),
							h('text', { content: ' Working Mind', fg: '#7982a9' }),
						),
					},
					h(
						'box',
						{ paddingLeft: 1, flexDirection: 'column' },
						h('text', {
							content: 'Type a message or /help for commands.',
							fg: '#7982a9',
						}),
					),
				),
			),
		...entries.map((entry) =>
			h(
				'box',
				{
					key: entry.id > 0 ? entry.id : `e-${entry.id}`,
					marginBottom: 1,
					paddingBottom: 1,
				},
				h(MessageItem, {
					entry,
					agent,
					contentWidth,
					rawMode,
					expanded: expandAll,
					collapsed: false,
				}),
			),
		),
	);
}) as any;
