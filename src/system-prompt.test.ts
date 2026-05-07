import { describe, it, expect, vi } from 'vitest';
import { refreshKnowledgeIndex } from './system-prompt.js';

vi.mock('./memory/render.js', () => ({
	readKnowledgeIndex: vi.fn(),
}));

import { readKnowledgeIndex } from './memory/render.js';

const mockReadKnowledgeIndex = vi.mocked(readKnowledgeIndex);

describe('refreshKnowledgeIndex', () => {
	it('adds knowledge index when not present', () => {
		mockReadKnowledgeIndex.mockReturnValue('# Knowledge Index\nEntities: 3');
		const prompt = 'You are a helpful assistant.';
		const result = refreshKnowledgeIndex(prompt);
		expect(result).toContain('## Knowledge Index');
		expect(result).toContain('Entities: 3');
		expect(result).toContain('You are a helpful assistant.');
	});

	it('replaces existing knowledge index', () => {
		mockReadKnowledgeIndex.mockReturnValue('# Knowledge Index\nEntities: 10');
		const prompt = 'You are a helpful assistant.\n\n## Knowledge Index\nOld index data here.\n\n## Other Section\nstuff';
		const result = refreshKnowledgeIndex(prompt);
		expect(result).toContain('Entities: 10');
		expect(result).not.toContain('Old index data here.');
		expect(result).toContain('## Other Section');
		expect(result).toContain('stuff');
	});

	it('removes knowledge index when none available', () => {
		mockReadKnowledgeIndex.mockReturnValue(null);
		const prompt = 'You are a helpful assistant.\n\n## Knowledge Index\nOld index data here.\n\n## Other Section\nstuff';
		const result = refreshKnowledgeIndex(prompt);
		expect(result).not.toContain('Old index data here.');
		expect(result).not.toContain('## Knowledge Index');
		expect(result).toContain('## Other Section');
	});

	it('handles prompt with only knowledge index at end', () => {
		mockReadKnowledgeIndex.mockReturnValue('# Knowledge Index\nEntities: 5');
		const prompt = 'You are a helpful assistant.\n\n## Knowledge Index\nOld data';
		const result = refreshKnowledgeIndex(prompt);
		expect(result).toContain('Entities: 5');
		expect(result).not.toContain('Old data');
	});

	it('truncates long index to 3000 chars', () => {
		mockReadKnowledgeIndex.mockReturnValue('X'.repeat(5000));
		const prompt = 'You are a helpful assistant.';
		const result = refreshKnowledgeIndex(prompt);
		expect(result).toContain('...(index truncated)');
	});
});
