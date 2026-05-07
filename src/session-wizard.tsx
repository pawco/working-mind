import { forwardRef, createElement as h, useCallback, useImperativeHandle, useState } from 'react';
import type { AgentRegistry, SessionSummary } from './registry.js';

type SessionStep =
	| { id: 'menu'; cursor: number }
	| { id: 'session-list'; cursor: number; sessions: SessionSummary[] }
	| { id: 'new-session-name'; input: string; error: string }
	| { id: 'resuming'; name: string }
	| { id: 'resumed'; name: string; messageCount: number }
	| { id: 'created'; name: string }
	| { id: 'delete-select'; cursor: number; sessions: SessionSummary[] }
	| { id: 'deleted'; name: string }
	| { id: 'empty' };

export interface SessionWizardHandle {
	handleKey: (inputChar: string, key: any) => void;
	handlePaste: (text: string) => void;
}

export interface SessionWizardProps {
	registry: AgentRegistry;
	onDone: (message: string) => void;
}

const MENU_OPTIONS = [
	{ label: 'Resume a session', action: 'resume' as const },
	{ label: 'Start new session', action: 'new' as const },
	{ label: 'Delete a session', action: 'delete' as const },
];

export const SessionWizard = forwardRef<SessionWizardHandle, SessionWizardProps>(
	function SessionWizard({ registry, onDone }, ref) {
		const [step, setStep] = useState<SessionStep>({ id: 'menu', cursor: 0 });

		const handleKey = useCallback(
			(inputChar: string, key: any) => {
				const s = step;

				if (s.id === 'menu') {
					if (key.upArrow) {
						setStep({ ...s, cursor: Math.max(0, s.cursor - 1) });
						return;
					}
					if (key.downArrow) {
						setStep({
							...s,
							cursor: Math.min(MENU_OPTIONS.length - 1, s.cursor + 1),
						});
						return;
					}
					if (key.escape) {
						onDone('');
						return;
					}
					const numIdx =
						inputChar === '1' ? 0 : inputChar === '2' ? 1 : inputChar === '3' ? 2 : -1;
					const target = numIdx >= 0 ? numIdx : key.return ? s.cursor : -1;
					if (target < 0) return;
					const action = MENU_OPTIONS[target]?.action;
					if (action === 'resume') {
						const sessions = registry.listSessions();
						if (sessions.length === 0) {
							setStep({ id: 'empty' });
						} else {
							setStep({ id: 'session-list', cursor: 0, sessions });
						}
						return;
					}
					if (action === 'new') {
						setStep({ id: 'new-session-name', input: '', error: '' });
						return;
					}
					if (action === 'delete') {
						const sessions = registry.listSessions();
						if (sessions.length === 0) {
							setStep({ id: 'empty' });
						} else {
							setStep({ id: 'delete-select', cursor: 0, sessions });
						}
						return;
					}
					return;
				}

				if (s.id === 'session-list') {
					if (key.upArrow) {
						setStep({
							...s,
							cursor: Math.max(0, s.cursor - 1),
						});
						return;
					}
					if (key.downArrow) {
						setStep({
							...s,
							cursor: Math.min(s.sessions.length - 1, s.cursor + 1),
						});
						return;
					}
					if (key.escape) {
						setStep({ id: 'menu', cursor: 0 });
						return;
					}
					if (key.return) {
						const session = s.sessions[s.cursor];
						if (!session) return;
						setStep({ id: 'resuming', name: session.name });
						const agent = registry.resumeSession(session.sessionId);
						if (agent) {
							setStep({
								id: 'resumed',
								name: session.name,
								messageCount: agent.messages.length,
							});
						} else {
							onDone(`Failed to resume "${session.name}".`);
						}
						return;
					}
					return;
				}

				if (s.id === 'new-session-name') {
					if (key.escape) {
						setStep({ id: 'menu', cursor: 1 });
						return;
					}
					if (key.return) {
						const name = s.input.trim();
						if (!name) {
							setStep({ ...s, error: 'Name is required' });
							return;
						}
						const active = registry.getActive();
						const model = active?.model || 'openrouter/anthropic/claude-sonnet-4.6';
						const packName = active?.packName;
						registry.clear();
						registry.createAgent({ name, model, packName });
						registry.saveSessionsSync();
						setStep({ id: 'created', name });
						return;
					}
					if (key.backspace) {
						setStep({ ...s, input: s.input.slice(0, -1), error: '' });
						return;
					}
					if (!key.ctrl && !key.meta && inputChar) {
						setStep({ ...s, input: s.input + inputChar, error: '' });
					}
					return;
				}

				if (s.id === 'resuming') {
					if (key.escape) onDone('Resuming...');
					return;
				}

				if (s.id === 'resumed') {
					if (key.return || key.escape) {
						onDone(`Resumed "${s.name}" (${s.messageCount} messages in context).`);
					}
					return;
				}

				if (s.id === 'created') {
					if (key.return || key.escape) {
						onDone(`New session "${s.name}" created.`);
					}
					return;
				}

				if (s.id === 'delete-select') {
					if (key.upArrow) {
						setStep({ ...s, cursor: Math.max(0, s.cursor - 1) });
						return;
					}
					if (key.downArrow) {
						setStep({
							...s,
							cursor: Math.min(s.sessions.length - 1, s.cursor + 1),
						});
						return;
					}
					if (key.escape) {
						setStep({ id: 'menu', cursor: 2 });
						return;
					}
					if (key.return) {
						const session = s.sessions[s.cursor];
						if (!session) return;
						registry.deleteSession(session.sessionId);
						setStep({ id: 'deleted', name: session.name });
						return;
					}
					return;
				}

				if (s.id === 'deleted') {
					if (key.return || key.escape) {
						onDone(`Deleted session "${s.name}".`);
					}
					return;
				}

				if (s.id === 'empty') {
					if (key.return || key.escape) {
						onDone('No saved sessions found.');
					}
					return;
				}
			},
			[step, registry, onDone],
		);

		const handlePaste = useCallback(
			(text: string) => {
				const s = step;
				if (s.id === 'new-session-name') {
					setStep({ ...s, input: s.input + text, error: '' });
				}
			},
			[step],
		);

		useImperativeHandle(ref, () => ({ handleKey, handlePaste }), [handleKey, handlePaste]);

		return h(
			'box',
			{
				flexDirection: 'column',
				flexGrow: 1,
				backgroundColor: '#0a0a1a',
				paddingX: 2,
				paddingY: 1,
				overflow: 'hidden',
			},
			renderStep(step),
			h(
				'box',
				{ marginTop: 1 },
				h('text', {
					dimColor: true,
					content: 'Esc = back \u00b7 Enter = confirm',
				}),
			),
		);
	},
);

function formatTimeAgo(iso: string): string {
	if (!iso) return '';
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	return `${days}d ago`;
}

function renderStep(s: SessionStep): React.ReactNode {
	if (s.id === 'menu') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Session Manager' }),
			h('text', {
				dimColor: true,
				content:
					'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
			}),
			h('text', {
				dimColor: true,
				content: '\u2191\u2193 navigate \u00b7 Enter select \u00b7 or press 1-3',
			}),
			h(
				'box',
				{ flexDirection: 'column', marginTop: 1 },
				MENU_OPTIONS.map((opt, i) =>
					h(
						'box',
						{ key: opt.action },
						s.cursor === i
							? h('text', { fg: 'cyan', bold: true, content: '\u25b8 ' })
							: h('text', { dimColor: true, content: '  ' }),
						h('text', { fg: 'green', content: `${i + 1} ` }),
						h('text', {
							bold: s.cursor === i,
							fg: s.cursor === i ? 'white' : 'gray',
							content: opt.label,
						}),
					),
				),
			),
		);
	}

	if (s.id === 'session-list') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Resume Session' }),
			h('text', {
				dimColor: true,
				content:
					'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
			}),
			h('text', {
				dimColor: true,
				content: '\u2191\u2193 navigate \u00b7 Enter select \u00b7 Esc back',
			}),
			h(
				'box',
				{ flexDirection: 'column', marginTop: 1 },
				s.sessions.map((sess, i) => {
					const selected = s.cursor === i;
					const timeAgo = formatTimeAgo(sess.updatedAt);
					return h(
						'box',
						{ key: sess.sessionId },
						selected
							? h('text', { fg: 'cyan', bold: true, content: '\u25b8 ' })
							: h('text', { dimColor: true, content: '  ' }),
						h('text', {
							bold: selected,
							fg: selected ? 'white' : 'gray',
							content: sess.name,
						}),
						h('text', {
							dimColor: true,
							content: ` (${sess.messageCount} msgs, ${timeAgo})`,
						}),
					);
				}),
			),
		);
	}

	if (s.id === 'new-session-name') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'New Session' }),
			h('text', {
				dimColor: true,
				content:
					'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
			}),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { fg: 'white', content: 'Name: ' }),
				h('text', { fg: 'cyan', content: s.input }),
				h('text', { dimColor: true, content: '\u258d' }),
			),
			s.error ? h('text', { fg: 'red', content: s.error }) : null,
		);
	}

	if (s.id === 'resuming') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Resuming Session' }),
			h('text', {
				dimColor: true,
				content:
					'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
			}),
			h('text', { fg: 'yellow', content: `\u23f3 Loading "${s.name}"...` }),
		);
	}

	if (s.id === 'resumed') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'green', content: 'Session Resumed' }),
			h('text', {
				dimColor: true,
				content:
					'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
			}),
			h('text', {
				fg: 'green',
				content: `\u2713 "${s.name}" (${s.messageCount} messages)`,
			}),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { dimColor: true, content: 'Press Enter to continue' }),
			),
		);
	}

	if (s.id === 'created') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'green', content: 'New Session' }),
			h('text', {
				dimColor: true,
				content:
					'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
			}),
			h('text', { fg: 'green', content: `\u2713 "${s.name}" created` }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { dimColor: true, content: 'Press Enter to continue' }),
			),
		);
	}

	if (s.id === 'delete-select') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'red', content: 'Delete Session' }),
			h('text', {
				dimColor: true,
				content:
					'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
			}),
			h('text', {
				dimColor: true,
				content: '\u2191\u2193 navigate \u00b7 Enter delete \u00b7 Esc cancel',
			}),
			h(
				'box',
				{ flexDirection: 'column', marginTop: 1 },
				s.sessions.map((sess, i) => {
					const selected = s.cursor === i;
					return h(
						'box',
						{ key: sess.sessionId },
						selected
							? h('text', { fg: 'red', bold: true, content: '\u25b8 ' })
							: h('text', { dimColor: true, content: '  ' }),
						h('text', { bold: selected, content: sess.name }),
						h('text', {
							dimColor: true,
							content: ` (${sess.messageCount} msgs)`,
						}),
					);
				}),
			),
		);
	}

	if (s.id === 'deleted') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'green', content: 'Deleted' }),
			h('text', {
				dimColor: true,
				content:
					'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
			}),
			h('text', { fg: 'green', content: `\u2713 "${s.name}" deleted` }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { dimColor: true, content: 'Press Enter to continue' }),
			),
		);
	}

	if (s.id === 'empty') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'yellow', content: 'No Sessions' }),
			h('text', {
				dimColor: true,
				content:
					'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
			}),
			h('text', { dimColor: true, content: 'No saved sessions found.' }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', {
					dimColor: true,
					content: 'Press Enter to create a new one',
				}),
			),
		);
	}

	return null;
}
