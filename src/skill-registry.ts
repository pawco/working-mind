export type { SkillDef } from './sdk/tool.js';

import type { SkillDef } from './sdk/tool.js';

export class SkillRegistry {
	private skills: Map<string, SkillDef> = new Map();
	private activeSkills: Set<string> = new Set();

	register(skill: SkillDef): void {
		this.skills.set(skill.name, skill);
	}

	registerAll(skills: SkillDef[]): void {
		for (const s of skills) this.register(s);
	}

	activate(name: string): SkillDef | null {
		const skill = this.skills.get(name);
		if (!skill) return null;
		this.activeSkills.add(name);
		return skill;
	}

	deactivate(name: string): void {
		this.activeSkills.delete(name);
	}

	deactivateAll(): void {
		this.activeSkills.clear();
	}

	getActive(): SkillDef[] {
		return [...this.activeSkills]
			.map((n) => this.skills.get(n))
			.filter((s): s is SkillDef => Boolean(s));
	}

	getAll(): SkillDef[] {
		return [...this.skills.values()];
	}

	isActive(name: string): boolean {
		return this.activeSkills.has(name);
	}

	findAutoDiscoverable(query: string): SkillDef | null {
		const lower = query.toLowerCase();
		const words = lower.split(/\s+/).filter((w) => w.length > 3);
		const discoverable = [...this.skills.values()].filter(
			(s) => s.autoDiscover !== false,
		);
		for (const skill of discoverable) {
			if (lower.includes(skill.name)) return skill;
			const descWords = skill.description.toLowerCase().split(/\s+/);
			if (
				descWords.some((dw) => words.some((qw) => qw === dw && dw.length > 3))
			)
				return skill;
		}
		return null;
	}
}
