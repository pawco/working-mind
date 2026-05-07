import { describe, expect, it } from 'vitest';
import { KNOWN_SERVERS } from './mcp-catalog.js';

describe('MCP catalog', () => {
	it('has at least 10 servers', () => {
		expect(KNOWN_SERVERS.length).toBeGreaterThanOrEqual(10);
	});

	it('every entry has required fields', () => {
		for (const server of KNOWN_SERVERS) {
			expect(server.id).toBeTruthy();
			expect(server.name).toBeTruthy();
			expect(server.description).toBeTruthy();
			expect(Array.isArray(server.envVars)).toBe(true);
		}
	});

	it('every entry has package or command (not both empty)', () => {
		for (const server of KNOWN_SERVERS) {
			const hasPackage = !!server.package;
			const hasCommand = !!server.command?.length;
			expect(hasPackage || hasCommand).toBe(true);
		}
	});

	it('ids are unique', () => {
		const ids = KNOWN_SERVERS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('required env vars have labels', () => {
		for (const server of KNOWN_SERVERS) {
			for (const ev of server.envVars) {
				if (ev.required) {
					expect(ev.label).toBeTruthy();
				}
			}
		}
	});

	it('includes firecrawl with API key requirement', () => {
		const fc = KNOWN_SERVERS.find((s) => s.id === 'firecrawl');
		expect(fc).toBeDefined();
		expect(fc?.package).toBe('firecrawl-mcp');
		expect(fc?.envVars.some((e) => e.name === 'FIRECRAWL_API_KEY' && e.required)).toBe(true);
	});

	it('includes arxiv with no env vars', () => {
		const arxiv = KNOWN_SERVERS.find((s) => s.id === 'arxiv');
		expect(arxiv).toBeDefined();
		expect(arxiv?.package).toBe('arxiv-mcp-server');
		expect(arxiv?.envVars).toEqual([]);
	});

	it('includes brave-search', () => {
		const bs = KNOWN_SERVERS.find((s) => s.id === 'brave-search');
		expect(bs).toBeDefined();
		expect(bs?.envVars.some((e) => e.name === 'BRAVE_API_KEY')).toBe(true);
	});

	it('includes memory with no env vars', () => {
		const mem = KNOWN_SERVERS.find((s) => s.id === 'memory');
		expect(mem).toBeDefined();
		expect(mem?.envVars).toEqual([]);
	});

	it('includes context7 with no env vars', () => {
		const c7 = KNOWN_SERVERS.find((s) => s.id === 'context7');
		expect(c7).toBeDefined();
		expect(c7?.package).toBe('@upstash/context7-mcp');
		expect(c7?.envVars).toEqual([]);
	});

	it('github has Docker command', () => {
		const gh = KNOWN_SERVERS.find((s) => s.id === 'github');
		expect(gh).toBeDefined();
		expect(gh?.command?.[0]).toBe('docker');
	});

	it('github-npm has npm package', () => {
		const gh = KNOWN_SERVERS.find((s) => s.id === 'github-npm');
		expect(gh).toBeDefined();
		expect(gh?.package).toContain('@modelcontextprotocol');
	});
});
