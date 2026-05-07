import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	forwardRef,
	createElement as h,
	useCallback,
	useImperativeHandle,
	useState,
} from 'react';
import type { UserConfig } from './config.js';
import type { McpRegistry } from './mcp/registry.js';
import {
	ensureMemoriesDir,
	getActiveStoreName,
	listMemoryStores,
	type MemoryStoreInfo,
} from './memory/render.js';
import { getStorePath } from './paths.js';

type MemoryWizardStep =
	| {
			id: 'store-list';
			cursor: number;
			stores: MemoryStoreInfo[];
			creating: boolean;
			newName: string;
	  }
	| { id: 'switching'; storeName: string }
	| { id: 'switched'; storeName: string; entityCount: number }
	| { id: 'error'; error: string };

export interface MemoryWizardHandle {
	handleKey: (inputChar: string, key: any) => void;
	handlePaste: (text: string) => void;
}

export interface MemoryWizardProps {
	mcpRegistry: McpRegistry;
	onDone: (message: string) => void;
	getUserConfig: () => UserConfig | undefined;
	writeUserConfigFn: (config: UserConfig) => void;
}

export const MemoryWizard = forwardRef<MemoryWizardHandle, MemoryWizardProps>(
	function MemoryWizard(
		{ mcpRegistry, onDone, getUserConfig, writeUserConfigFn },
		ref,
	) {
		const [step, setStep] = useState<MemoryWizardStep>(() => {
			const stores = listMemoryStores();
			return {
				id: 'store-list',
				cursor: 0,
				stores,
				creating: false,
				newName: '',
			};
		});

		const doSwitch = useCallback(
			async (storeName: string) => {
				setStep({ id: 'switching', storeName });

				ensureMemoriesDir();
				const storePath = getStorePath(storeName);
				if (!existsSync(storePath)) {
					const dir = join(storePath, '..');
					if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
					writeFileSync(storePath, '', 'utf-8');
				}

				process.env.MEMORY_FILE_PATH = storePath;

				const cfg = getUserConfig();
				if (cfg) {
					cfg.lastMemoryStore = storeName;
					writeUserConfigFn(cfg);
				}

				if (!mcpRegistry.hasServer('memory')) {
					onDone(
						`Switched to memory store '${storeName}'. Memory MCP server is not connected -- run /mcp-connect memory to reconnect.`,
					);
					return;
				}

				const result = await mcpRegistry.reconnectMemoryStore(
					storeName,
					storePath,
				);
				if (result.success) {
					setStep({
						id: 'switched',
						storeName,
						entityCount: result.entityCount,
					});
				} else {
					setStep({ id: 'error', error: result.error || 'Reconnect failed' });
				}
			},
			[mcpRegistry, getUserConfig, writeUserConfigFn, onDone],
		);

		const handleKey = useCallback(
			(inputChar: string, key: any) => {
				const s = step;

				if (s.id === 'store-list') {
					if (s.creating) {
						if (key.escape) {
							setStep({ ...s, creating: false, newName: '' });
							return;
						}
						if (key.return) {
							const name = s.newName
								.trim()
								.toLowerCase()
								.replace(/[^a-z0-9_-]/g, '');
							if (!name || !/^[a-z][a-z0-9_-]{0,49}$/.test(name)) {
								return;
							}
							doSwitch(name);
							return;
						}
						if (key.backspace) {
							setStep({ ...s, newName: s.newName.slice(0, -1) });
							return;
						}
						if (!key.ctrl && !key.meta && inputChar) {
							setStep({ ...s, newName: s.newName + inputChar });
						}
						return;
					}

					const stores = s.stores;
					const totalItems = stores.length + 1;

					if (key.upArrow) {
						setStep({ ...s, cursor: Math.max(0, s.cursor - 1) });
						return;
					}
					if (key.downArrow) {
						setStep({ ...s, cursor: Math.min(totalItems - 1, s.cursor + 1) });
						return;
					}
					if (key.escape) {
						onDone('');
						return;
					}
					if (key.return) {
						if (s.cursor === stores.length) {
							setStep({ ...s, creating: true, newName: '' });
							return;
						}
						const store = stores[s.cursor];
						if (store) {
							doSwitch(store.name);
						}
					}
					return;
				}

				if (s.id === 'switching') {
					if (key.escape) {
						onDone('');
					}
					return;
				}

				if (s.id === 'switched') {
					if (key.return || key.escape) {
						onDone(
							`Switched to memory store '${s.storeName}' (${s.entityCount} entities)`,
						);
					}
					return;
				}

				if (s.id === 'error') {
					if (key.return || key.escape) {
						onDone(`Failed to switch memory store: ${s.error}`);
					}
					return;
				}
			},
			[step, onDone, doSwitch],
		);

		const handlePaste = useCallback(
			(text: string) => {
				const s = step;
				if (s.id === 'store-list' && s.creating) {
					setStep({ ...s, newName: s.newName + text });
				}
			},
			[step],
		);

		useImperativeHandle(ref, () => ({ handleKey, handlePaste }), [
			handleKey,
			handlePaste,
		]);

		const activeName = getActiveStoreName(getUserConfig());

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
			renderStep(step, activeName),
			h(
				'box',
				{ marginTop: 1 },
				h('text', {
					dimColor: true,
					content:
						step.id === 'store-list'
							? step.creating
								? 'Type name  Enter create  Esc cancel'
								: 'Up/Down navigate  Enter select  Esc cancel'
							: 'Enter/Esc continue',
				}),
			),
		);
	},
);

function renderStep(
	step: MemoryWizardStep,
	activeName: string,
): React.ReactNode {
	if (step.id === 'store-list') {
		const stores = step.stores;
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Memory Stores' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h(
				'box',
				{ flexDirection: 'column', marginTop: 1 },
				stores.map((store, i) => {
					const isActive = store.name === activeName;
					const selected = step.cursor === i && !step.creating;
					const marker = isActive ? '●' : '○';
					return h(
						'box',
						{ key: store.name },
						selected
							? h('text', { fg: 'cyan', bold: true, content: `${marker} ` })
							: h('text', { dimColor: true, content: `${marker} ` }),
						h('text', {
							bold: selected,
							fg: selected ? 'white' : 'gray',
							content: store.name,
						}),
						h('text', {
							dimColor: true,
							content:
								store.exists && store.entityCount > 0
									? ` (${store.entityCount} entities, ${store.observationCount} obs)`
									: store.exists
										? ' (empty)'
										: ' (new)',
						}),
					);
				}),
				step.creating
					? h(
							'box',
							null,
							h('text', { fg: 'cyan', bold: true, content: '▸  ' }),
							h('text', { fg: 'white', content: 'Create: ' }),
							h('text', { fg: 'cyan', content: step.newName }),
							h('text', { dimColor: true, content: '▍' }),
						)
					: h(
							'box',
							null,
							step.cursor === stores.length
								? h('text', { fg: 'cyan', bold: true, content: '▸  ' })
								: h('text', { dimColor: true, content: '   ' }),
							h('text', { dimColor: true, content: '[Create New Store]' }),
						),
			),
		);
	}

	if (step.id === 'switching') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Switching Store' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', {
				fg: 'yellow',
				content: `Switching to '${step.storeName}'...`,
			}),
			h('text', { dimColor: true, content: 'Reconnecting memory MCP server' }),
		);
	}

	if (step.id === 'switched') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'green', content: 'Store Switched' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', { fg: 'green', content: `Now using '${step.storeName}'` }),
			h('text', {
				dimColor: true,
				content: `${step.entityCount} entities in this store`,
			}),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { dimColor: true, content: 'Press Enter to continue' }),
			),
		);
	}

	if (step.id === 'error') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'red', content: 'Switch Failed' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', { fg: 'red', content: step.error }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { dimColor: true, content: 'Press Enter to continue' }),
			),
		);
	}

	return null;
}
