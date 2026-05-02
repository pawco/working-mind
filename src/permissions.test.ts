import { describe, expect, it } from 'vitest';
import { isDenied, shouldConfirm } from './permissions.js';
import type { ToolDef } from './sdk/tool.js';

const tool = (
	name: string,
	opts?: Partial<Pick<ToolDef, 'destructive' | 'longRunning'>>,
): ToolDef => ({
	name,
	description: name,
	parameters: { type: 'object', properties: {} },
	execute: async () => ({}),
	destructive: false,
	longRunning: false,
	...opts,
});

describe('permissions', () => {
	it('requires confirmation for destructive tools', () => {
		expect(shouldConfirm(tool('destroy', { destructive: true }))).toBe(true);
	});

	it('requires confirmation for long-running tools', () => {
		expect(shouldConfirm(tool('deploy', { longRunning: true }))).toBe(true);
	});

	it('auto-approves normal tools', () => {
		expect(shouldConfirm(tool('status'))).toBe(false);
	});

	it('denies destructive when configured', () => {
		expect(
			isDenied(tool('destroy', { destructive: true }), {
				destructive: 'deny',
				longRunning: 'ask',
				normal: 'allow',
			}),
		).toBe(true);
	});

	it('does not deny destructive when allowed', () => {
		expect(
			isDenied(tool('destroy', { destructive: true }), {
				destructive: 'allow',
				longRunning: 'ask',
				normal: 'allow',
			}),
		).toBe(false);
	});
});
