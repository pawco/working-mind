import { Box } from 'ink';
import type { ReactNode } from 'react';
import { SEPARATOR_COLOR } from './utils.js';

export interface AppShellProps {
	height: number;
	sidebar: ReactNode;
	inputBar: ReactNode;
	children: ReactNode;
}

export function AppShell({
	height,
	sidebar,
	inputBar,
	children,
}: AppShellProps) {
	return (
		<Box flexDirection="row" height={height} overflow="hidden">
			{sidebar}
			<Box flexDirection="column" flexGrow={1} overflow="hidden">
				<Box flexDirection="column" flexGrow={1} overflow="hidden">
					{children}
				</Box>
				<Box height={1} flexShrink={0} backgroundColor={SEPARATOR_COLOR} />
				{inputBar}
			</Box>
		</Box>
	);
}
