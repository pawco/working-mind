import { describe, expect, it, vi } from 'vitest';
import type { SessionSummary } from '../registry.js';
import { Sidebar, type SidebarProps } from './sidebar.js';

vi.mock('../ui/utils.js', () => ({
	useSpinner: () => ({ frame: '|', elapsed: '' }),
}));

vi.mock('../version.js', () => ({
	VERSION: '0.4.3',
}));

function extractTexts(element: any): string[] {
	const texts: string[] = [];
	if (!element) return texts;
	if (typeof element === 'string') {
		texts.push(element);
		return texts;
	}
	if (element?.props?.content !== undefined) {
		texts.push(element.props.content);
	}
	if (element?.props?.children) {
		const children = Array.isArray(element.props.children)
			? element.props.children
			: [element.props.children];
		for (const child of children) {
			texts.push(...extractTexts(child));
		}
	}
	return texts;
}

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		sessionId: overrides.sessionId || 'test',
		name: overrides.name || 'Test Session',
		model: overrides.model || 'openrouter/anthropic/claude-sonnet-4.6',
		updatedAt: overrides.updatedAt || new Date().toISOString(),
		messageCount: overrides.messageCount ?? 5,
		...overrides,
	};
}

function defaultProps(overrides: Partial<SidebarProps> = {}): SidebarProps {
	return {
		servers: [],
		model: 'openrouter/anthropic/claude-sonnet-4.6',
		activeSkills: new Set(),
		width: 26,
		msgCount: 5,
		approxTokens: 320,
		agents: [{ id: 'test', name: 'Test' }],
		activeId: 'test',
		isStreaming: false,
		isThinking: false,
		isExecuting: false,
		scrolledUp: false,
		rawMode: false,
		expandAll: false,
		projects: [],
		activeSessionId: null,
		cwdFiles: [],
		...overrides,
	};
}

function renderSidebar(overrides: Partial<SidebarProps> = {}): string[] {
	return extractTexts(Sidebar(defaultProps(overrides)));
}

describe('Sidebar', () => {
	describe('Projects section', () => {
		it('shows Projects header when projects exist', () => {
			const texts = renderSidebar({
				projects: [makeSession({ sessionId: 'a', name: 'project-a' })],
				activeSessionId: 'a',
			});
			expect(texts).toContain('Projects');
		});

		it('hides Projects section when no projects', () => {
			const texts = renderSidebar({ projects: [], activeSessionId: null });
			expect(texts).not.toContain('Projects');
		});

		it('shows active project with > prefix', () => {
			const texts = renderSidebar({
				projects: [
					makeSession({ sessionId: 'a', name: 'active-project' }),
					makeSession({ sessionId: 'b', name: 'other-project' }),
				],
				activeSessionId: 'a',
			});
			expect(texts).toContain('> active-project');
			expect(texts).toContain('  other-project');
		});

		it('shows overflow when more than 5 projects', () => {
			const projects = Array.from({ length: 8 }, (_, i) =>
				makeSession({ sessionId: `p${i}`, name: `project-${i}` }),
			);
			const texts = renderSidebar({ projects, activeSessionId: 'p0' });
			expect(texts.some((t) => t.includes('+3 more'))).toBe(true);
		});

		it('does not show overflow for 5 or fewer projects', () => {
			const projects = Array.from({ length: 5 }, (_, i) =>
				makeSession({ sessionId: `p${i}`, name: `project-${i}` }),
			);
			const texts = renderSidebar({ projects, activeSessionId: 'p0' });
			expect(texts.some((t) => t.includes('more'))).toBe(false);
		});
	});

	describe('Files section', () => {
		it('shows Files header when .md files exist', () => {
			const texts = renderSidebar({ cwdFiles: ['paper1.md', 'notes.md'] });
			expect(texts).toContain('Files');
		});

		it('hides Files section when no .md files', () => {
			const texts = renderSidebar({ cwdFiles: [] });
			expect(texts).not.toContain('Files');
		});

		it('lists .md filenames', () => {
			const texts = renderSidebar({ cwdFiles: ['paper1.md', 'notes.md'] });
			expect(texts).toContain('  paper1.md');
			expect(texts).toContain('  notes.md');
		});

		it('shows overflow when more than 5 files', () => {
			const files = Array.from({ length: 8 }, (_, i) => `doc${i}.md`);
			const texts = renderSidebar({ cwdFiles: files });
			expect(texts.some((t) => t.includes('+3 more'))).toBe(true);
		});

		it('does not show overflow for 5 or fewer files', () => {
			const texts = renderSidebar({ cwdFiles: ['a.md', 'b.md', 'c.md'] });
			expect(texts.some((t) => t.includes('more'))).toBe(false);
		});
	});

	describe('Session name', () => {
		it('shows active agent name in Session section', () => {
			const texts = renderSidebar({
				agents: [{ id: 'test', name: 'My Research' }],
				activeId: 'test',
				activeSessionId: 'test',
			});
			expect(texts).toContain(' My Research');
		});

		it('falls back to activeSessionId when agent has no name', () => {
			const texts = renderSidebar({
				agents: [{ id: 'abc123', name: '' }],
				activeId: 'abc123',
				activeSessionId: 'abc123',
			});
			expect(texts).toContain(' abc123');
		});

		it('falls back to untitled when neither exists', () => {
			const texts = renderSidebar({
				agents: [{ id: 'x', name: '' }],
				activeId: 'x',
				activeSessionId: null,
			});
			expect(texts).toContain(' untitled');
		});
	});

	describe('existing sections unchanged', () => {
		it('still renders Model section', () => {
			const texts = renderSidebar();
			expect(texts).toContain('Model');
		});

		it('still renders MCP section', () => {
			const texts = renderSidebar();
			expect(texts).toContain('MCP');
			expect(texts).toContain(' (none)');
		});

		it('still renders Session with msg count', () => {
			const texts = renderSidebar({ msgCount: 7, approxTokens: 400 });
			expect(texts.some((t) => t.includes('7 msgs'))).toBe(true);
		});

		it('still renders Agents when more than one', () => {
			const texts = renderSidebar({
				agents: [
					{ id: 'a', name: 'A' },
					{ id: 'b', name: 'B' },
				],
				activeId: 'a',
			});
			expect(texts).toContain('Agents');
		});

		it('still renders Skills when active', () => {
			const texts = renderSidebar({
				activeSkills: new Set(['fact-check', 'synthesize']),
			});
			expect(texts).toContain('Skills');
			expect(texts).toContain('! fact-check');
		});
	});

	describe('section ordering', () => {
		it('Projects appears between Session and Agents', () => {
			const texts = renderSidebar({
				projects: [makeSession({ sessionId: 'a', name: 'proj' })],
				activeSessionId: 'a',
				agents: [
					{ id: 'a', name: 'A' },
					{ id: 'b', name: 'B' },
				],
				activeId: 'a',
			});
			const sessionIdx = texts.indexOf('Session');
			const projectsIdx = texts.indexOf('Projects');
			const agentsIdx = texts.indexOf('Agents');
			expect(sessionIdx).toBeLessThan(projectsIdx);
			expect(projectsIdx).toBeLessThan(agentsIdx);
		});

		it('Files appears between Projects and Agents', () => {
			const texts = renderSidebar({
				projects: [makeSession({ sessionId: 'a', name: 'proj' })],
				activeSessionId: 'a',
				cwdFiles: ['doc.md'],
				agents: [
					{ id: 'a', name: 'A' },
					{ id: 'b', name: 'B' },
				],
				activeId: 'a',
			});
			const projectsIdx = texts.indexOf('Projects');
			const filesIdx = texts.indexOf('Files');
			const agentsIdx = texts.indexOf('Agents');
			expect(projectsIdx).toBeLessThan(filesIdx);
			expect(filesIdx).toBeLessThan(agentsIdx);
		});
	});

	describe('collapsed sidebar', () => {
		it('hides Projects and Files when width is 0', () => {
			const texts = renderSidebar({
				width: 0,
				projects: [makeSession()],
				activeSessionId: 'test',
				cwdFiles: ['a.md'],
			});
			expect(texts).not.toContain('Projects');
			expect(texts).not.toContain('Files');
		});

		it('hides Projects and Files when width is 2', () => {
			const texts = renderSidebar({
				width: 2,
				projects: [makeSession()],
				activeSessionId: 'test',
				cwdFiles: ['a.md'],
			});
			expect(texts).not.toContain('Projects');
			expect(texts).not.toContain('Files');
		});
	});
});
