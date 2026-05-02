import { Box, Text } from 'ink';
import {
	INPUT_ACCENT,
	INPUT_BG,
	INPUT_CONFIRM_BG,
	INPUT_H,
	INPUT_MAX_H,
	useSpinner,
} from './utils.js';

export interface InputBarProps {
	input: string;
	cursorIndex: number;
	isStreaming: boolean;
	waitingConfirmation: boolean;
	confirmationTool: string;
	packName?: string;
	model?: string;
	provider?: string;
}

function InputText({
	input,
	cursorIndex,
}: {
	input: string;
	cursorIndex: number;
}) {
	const before = input.slice(0, cursorIndex);
	const after = input.slice(cursorIndex);

	if (!input) {
		return (
			<Box>
				<Text dimColor>{'> '}</Text>
				<Text inverse> </Text>
				<Text dimColor> Type your message · /help · Esc Esc = abort</Text>
			</Box>
		);
	}

	return (
		<Box>
			<Text dimColor>{'> '}</Text>
			<Text>{before}</Text>
			<Text inverse>{after.charAt(0) || ' '}</Text>
			<Text>{after.slice(1)}</Text>
		</Box>
	);
}

export function computeInputBarHeight(
	input: string,
	isStreaming: boolean,
	waitingConfirmation: boolean,
): number {
	if (isStreaming || waitingConfirmation) return INPUT_H;
	const inputLines = input.split('\n').length;
	const blockHeight = Math.max(INPUT_H, Math.min(INPUT_MAX_H, inputLines + 2));
	return blockHeight + 1;
}

export function InputBar({
	input,
	cursorIndex,
	isStreaming,
	waitingConfirmation,
	confirmationTool,
	packName,
	model,
	provider,
}: InputBarProps) {
	const { frame: spinnerFrame, elapsed } = useSpinner(isStreaming);

	const lines = input.split('\n');
	const inputLines = lines.length;
	const blockHeight = Math.max(INPUT_H, Math.min(INPUT_MAX_H, inputLines + 2));

	const infoParts: string[] = [];
	if (packName) infoParts.push(packName);
	if (model) infoParts.push(model);
	if (provider) infoParts.push(provider);

	if (waitingConfirmation) {
		return (
			<Box flexDirection="row" height={INPUT_H} flexShrink={0}>
				<Box width={1} backgroundColor="#e5a00d" />
				<Box
					flexDirection="column"
					flexGrow={1}
					backgroundColor={INPUT_CONFIRM_BG}
					justifyContent="center"
					paddingX={2}
					paddingTop={1}
					paddingBottom={1}
				>
					<Box>
						<Text bold>{'! '}</Text>
						<Text>{confirmationTool} — proceed? </Text>
						<Text dimColor>[</Text>
						<Text bold>y</Text>
						<Text dimColor>/</Text>
						<Text bold>N</Text>
						<Text dimColor>]</Text>
					</Box>
				</Box>
			</Box>
		);
	}

	if (isStreaming) {
		return (
			<Box flexDirection="row" height={INPUT_H} flexShrink={0}>
				<Box width={1} backgroundColor={INPUT_ACCENT} />
				<Box
					flexDirection="column"
					flexGrow={1}
					backgroundColor={INPUT_BG}
					justifyContent="center"
					paddingX={2}
					paddingTop={1}
					paddingBottom={1}
				>
					<Box>
						<Text dimColor>{spinnerFrame} </Text>
						<Text dimColor>waiting</Text>
						{elapsed && <Text dimColor> {elapsed}</Text>}
						<Text dimColor>…</Text>
					</Box>
					{infoParts.length > 0 && (
						<Box>
							<Text dimColor>
								{'  '}
								{infoParts.join(' · ')}
							</Text>
						</Box>
					)}
				</Box>
			</Box>
		);
	}

	return (
		<Box
			flexDirection="row"
			height={blockHeight}
			flexShrink={0}
			marginBottom={1}
		>
			<Box width={1} backgroundColor={INPUT_ACCENT} />
			<Box
				flexDirection="column"
				flexGrow={1}
				backgroundColor={INPUT_BG}
				paddingX={2}
				paddingTop={1}
			>
				<Box flexGrow={1} justifyContent="flex-start">
					<InputText input={input} cursorIndex={cursorIndex} />
				</Box>
				{infoParts.length > 0 && (
					<Box paddingBottom={1}>
						<Text dimColor>{infoParts.join(' · ')}</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
}
