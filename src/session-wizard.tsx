import { Box, Text } from 'ink';
import { forwardRef, useCallback, useImperativeHandle, useState } from 'react';
import type { AgentRegistry, SessionSummary } from './registry.js';

type SessionStep =
	| { id: 'menu' }
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
}

export interface SessionWizardProps {
	registry: AgentRegistry;
	onDone: (message: string) => void;
}

export const SessionWizard = forwardRef<
	SessionWizardHandle,
	SessionWizardProps
>(function SessionWizard({ registry, onDone }, ref) {
	const [step, setStep] = useState<SessionStep>({ id: 'menu' });

	const handleKey = useCallback(
		(inputChar: string, key: any) => {
			const s = step;

			if (s.id === 'menu') {
				if (inputChar === '1') {
					const sessions = registry.listSessions();
					if (sessions.length === 0) {
						setStep({ id: 'empty' });
					} else {
						setStep({ id: 'session-list', cursor: 0, sessions });
					}
					return;
				}
				if (inputChar === '2') {
					setStep({ id: 'new-session-name', input: '', error: '' });
					return;
				}
				if (inputChar === '3') {
					const sessions = registry.listSessions();
					if (sessions.length === 0) {
						setStep({ id: 'empty' });
					} else {
						setStep({ id: 'delete-select', cursor: 0, sessions });
					}
					return;
				}
				if (key.escape) {
					onDone('');
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
					setStep({ id: 'menu' });
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
					setStep({ id: 'menu' });
					return;
				}
				if (key.return) {
					const name = s.input.trim();
					if (!name) {
						setStep({ ...s, error: 'Name is required' });
						return;
					}
					const active = registry.getActive();
					const model =
						active?.model || 'openrouter/anthropic/claude-sonnet-4.6';
					registry.clear();
					registry.createAgent({ name, model });
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
					onDone(
						`Resumed "${s.name}" (${s.messageCount} messages in context).`,
					);
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
					setStep({ id: 'menu' });
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

	useImperativeHandle(ref, () => ({ handleKey }), [handleKey]);

	return (
		<Box
			flexDirection="column"
			flexGrow={1}
			backgroundColor="#0a0a1a"
			paddingX={2}
			paddingY={1}
			overflow="hidden"
		>
			{renderStep(step)}
			<Box marginTop={1}>
				<Text dimColor>Esc = back · Enter = confirm</Text>
			</Box>
		</Box>
	);
});

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
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Session Manager
				</Text>
				<Text dimColor>────────────────────</Text>
				<Box marginTop={1}>
					<Text color="green">1</Text>
					<Text> Resume a session</Text>
				</Box>
				<Box>
					<Text color="green">2</Text>
					<Text> Start new session</Text>
				</Box>
				<Box>
					<Text color="green">3</Text>
					<Text> Delete a session</Text>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>Press 1, 2, or 3</Text>
				</Box>
			</Box>
		);
	}

	if (s.id === 'session-list') {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Resume Session
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>↑↓ navigate · Enter select · Esc back</Text>
				<Box flexDirection="column" marginTop={1}>
					{s.sessions.map((sess, i) => {
						const selected = s.cursor === i;
						const timeAgo = formatTimeAgo(sess.updatedAt);
						return (
							<Box key={sess.sessionId}>
								{selected ? (
									<Text color="cyan" bold>
										{'▸ '}
									</Text>
								) : (
									<Text dimColor>{'  '}</Text>
								)}
								<Text bold={selected} color={selected ? 'white' : 'gray'}>
									{sess.name}
								</Text>
								<Text dimColor>
									{' '}
									({sess.messageCount} msgs, {timeAgo})
								</Text>
							</Box>
						);
					})}
				</Box>
			</Box>
		);
	}

	if (s.id === 'new-session-name') {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					New Session
				</Text>
				<Text dimColor>────────────────────</Text>
				<Box marginTop={1}>
					<Text color="white">Name: </Text>
					<Text color="cyan">{s.input}</Text>
					<Text dimColor>▍</Text>
				</Box>
				{s.error && <Text color="red">{s.error}</Text>}
			</Box>
		);
	}

	if (s.id === 'resuming') {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Resuming Session
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text color="yellow">⏳ Loading "{s.name}"...</Text>
			</Box>
		);
	}

	if (s.id === 'resumed') {
		return (
			<Box flexDirection="column">
				<Text bold color="green">
					Session Resumed
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text color="green">
					✓ "{s.name}" ({s.messageCount} messages)
				</Text>
				<Box marginTop={1}>
					<Text dimColor>Press Enter to continue</Text>
				</Box>
			</Box>
		);
	}

	if (s.id === 'created') {
		return (
			<Box flexDirection="column">
				<Text bold color="green">
					New Session
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text color="green">✓ "{s.name}" created</Text>
				<Box marginTop={1}>
					<Text dimColor>Press Enter to continue</Text>
				</Box>
			</Box>
		);
	}

	if (s.id === 'delete-select') {
		return (
			<Box flexDirection="column">
				<Text bold color="red">
					Delete Session
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>↑↓ navigate · Enter delete · Esc cancel</Text>
				<Box flexDirection="column" marginTop={1}>
					{s.sessions.map((sess, i) => {
						const selected = s.cursor === i;
						return (
							<Box key={sess.sessionId}>
								{selected ? (
									<Text color="red" bold>
										{'▸ '}
									</Text>
								) : (
									<Text dimColor>{'  '}</Text>
								)}
								<Text bold={selected}>{sess.name}</Text>
								<Text dimColor> ({sess.messageCount} msgs)</Text>
							</Box>
						);
					})}
				</Box>
			</Box>
		);
	}

	if (s.id === 'deleted') {
		return (
			<Box flexDirection="column">
				<Text bold color="green">
					Deleted
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text color="green">✓ "{s.name}" deleted</Text>
				<Box marginTop={1}>
					<Text dimColor>Press Enter to continue</Text>
				</Box>
			</Box>
		);
	}

	if (s.id === 'empty') {
		return (
			<Box flexDirection="column">
				<Text bold color="yellow">
					No Sessions
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>No saved sessions found.</Text>
				<Box marginTop={1}>
					<Text dimColor>Press Enter to create a new one</Text>
				</Box>
			</Box>
		);
	}

	return null;
}
