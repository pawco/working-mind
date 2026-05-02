import { describe, expect, it } from 'vitest';
import { verifyConnection, verifyUrl } from './verify.js';

describe('verifyConnection', () => {
	it('fails gracefully for unreachable server', async () => {
		const result = await verifyConnection({
			type: 'remote',
			url: 'http://localhost:1/mcp',
		});
		expect(result.ok).toBe(false);
		expect(result.tools).toEqual([]);
		expect(result.error).toBeTruthy();
	});

	it('fails for invalid local command', async () => {
		const result = await verifyConnection({
			type: 'local',
			command: ['nonexistent-command-xyz'],
		});
		expect(result.ok).toBe(false);
		expect(result.error).toBeTruthy();
	});
});

describe('verifyUrl', () => {
	it('fails for unreachable URL', async () => {
		const result = await verifyUrl('http://localhost:1/mcp');
		expect(result.ok).toBe(false);
	});
});
