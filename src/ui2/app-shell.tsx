import { createElement as h, type ReactNode } from 'react';

export interface AppShellProps {
	sidebar: ReactNode;
	inputBar: ReactNode;
	children?: ReactNode;
}

export function AppShell({ sidebar, inputBar, children }: AppShellProps) {
	return h(
		'box',
		{ flexDirection: 'row', height: '100%', overflow: 'hidden' },
		sidebar,
		h(
			'box',
			{ flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
			h(
				'box',
				{ flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
				children,
			),
			h('box', { height: 1, flexShrink: 0, backgroundColor: '#30363d' }),
			inputBar,
		),
	);
}
