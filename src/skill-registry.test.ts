import { describe, expect, it } from 'vitest';
import type { SkillDef } from './sdk/tool.js';
import { SkillRegistry } from './skill-registry.js';
import { assembleSystemPrompt } from './system-prompt.js';

const makeSkill = (name: string, overrides?: Partial<SkillDef>): SkillDef => ({
	name,
	description: `${name} skill`,
	instructions: `Instructions for ${name}`,
	...overrides,
});

describe('SkillRegistry', () => {
	it('registers and retrieves skills', () => {
		const reg = new SkillRegistry();
		reg.register(makeSkill('deploy'));
		expect(reg.getAll()).toHaveLength(1);
		expect(reg.getAll()[0].name).toBe('deploy');
	});

	it('activate returns skill and adds to active', () => {
		const reg = new SkillRegistry();
		reg.register(makeSkill('deploy'));
		const skill = reg.activate('deploy');
		expect(skill).not.toBeNull();
		expect(skill?.name).toBe('deploy');
		expect(reg.getActive()).toHaveLength(1);
		expect(reg.isActive('deploy')).toBe(true);
	});

	it('activate returns null for unknown skill', () => {
		const reg = new SkillRegistry();
		expect(reg.activate('unknown')).toBeNull();
	});

	it('deactivate removes from active', () => {
		const reg = new SkillRegistry();
		reg.register(makeSkill('deploy'));
		reg.activate('deploy');
		expect(reg.isActive('deploy')).toBe(true);
		reg.deactivate('deploy');
		expect(reg.isActive('deploy')).toBe(false);
		expect(reg.getActive()).toHaveLength(0);
	});

	it('deactivateAll clears all active', () => {
		const reg = new SkillRegistry();
		reg.registerAll([makeSkill('a'), makeSkill('b')]);
		reg.activate('a');
		reg.activate('b');
		expect(reg.getActive()).toHaveLength(2);
		reg.deactivateAll();
		expect(reg.getActive()).toHaveLength(0);
	});

	it('registerAll adds multiple skills', () => {
		const reg = new SkillRegistry();
		reg.registerAll([makeSkill('a'), makeSkill('b'), makeSkill('c')]);
		expect(reg.getAll()).toHaveLength(3);
	});

	it('assembleSystemPrompt with active skills includes instructions', () => {
		const reg = new SkillRegistry();
		reg.register(
			makeSkill('deploy', {
				instructions: 'Deploy the app',
				allowedTools: ['bash', 'write'],
			}),
		);
		reg.activate('deploy');
		const prompt = assembleSystemPrompt(
			undefined,
			{ prompt: 'Base.' },
			undefined,
			reg.getActive(),
		);
		expect(prompt).toContain('Active Skill: deploy');
		expect(prompt).toContain('Deploy the app');
		expect(prompt).toContain('Allowed tools: bash, write');
	});

	it('assembleSystemPrompt includes multiple active skills', () => {
		const reg = new SkillRegistry();
		reg.registerAll([makeSkill('a'), makeSkill('b')]);
		reg.activate('a');
		reg.activate('b');
		const prompt = assembleSystemPrompt(
			undefined,
			{ prompt: 'Base.' },
			undefined,
			reg.getActive(),
		);
		expect(prompt).toContain('Active Skill: a');
		expect(prompt).toContain('Active Skill: b');
	});

	it('findAutoDiscoverable matches skill name in query', () => {
		const reg = new SkillRegistry();
		reg.register(makeSkill('deploy', { autoDiscover: true }));
		const found = reg.findAutoDiscoverable('please deploy my app');
		expect(found).not.toBeNull();
		expect(found?.name).toBe('deploy');
	});

	it('findAutoDiscoverable matches description words', () => {
		const reg = new SkillRegistry();
		reg.register(
			makeSkill('cd', {
				description: 'continuous deployment pipeline',
				autoDiscover: true,
			}),
		);
		const found = reg.findAutoDiscoverable('setup deployment pipeline');
		expect(found).not.toBeNull();
		expect(found?.name).toBe('cd');
	});

	it('findAutoDiscoverable returns null when no match', () => {
		const reg = new SkillRegistry();
		reg.register(makeSkill('deploy'));
		expect(reg.findAutoDiscoverable('hello world')).toBeNull();
	});

	it('findAutoDiscoverable ignores short words', () => {
		const reg = new SkillRegistry();
		reg.register(makeSkill('deploy'));
		expect(reg.findAutoDiscoverable('de')).toBeNull();
	});
});
