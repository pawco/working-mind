import type { UserConfig } from './config.js';
import type { ToolDef } from './sdk/tool.js';

export interface PermissionConfig {
	destructive: 'allow' | 'deny' | 'ask';
	longRunning: 'allow' | 'deny' | 'ask';
	normal: 'allow' | 'deny' | 'ask';
}

const DEFAULT_PERMISSIONS: PermissionConfig = {
	destructive: 'ask',
	longRunning: 'ask',
	normal: 'allow',
};

export function getPermissionConfig(userConfig?: UserConfig): PermissionConfig {
	const overrides = userConfig?.agents?.permissions;
	if (!overrides) return DEFAULT_PERMISSIONS;
	return {
		destructive: overrides.destructive ?? DEFAULT_PERMISSIONS.destructive,
		longRunning: overrides.longRunning ?? DEFAULT_PERMISSIONS.longRunning,
		normal: overrides.normal ?? DEFAULT_PERMISSIONS.normal,
	};
}

export function shouldConfirm(tool: ToolDef, userConfig?: UserConfig): boolean {
	if (tool.mcpServer === 'memory') return false;
	const config = getPermissionConfig(userConfig);
	if (tool.destructive) return config.destructive === 'ask';
	if (tool.longRunning) return config.longRunning === 'ask';
	return false;
}

export function isDenied(
	tool: ToolDef,
	config: PermissionConfig = DEFAULT_PERMISSIONS,
): boolean {
	if (tool.mcpServer === 'memory') return false;
	if (tool.destructive) return config.destructive === 'deny';
	if (tool.longRunning) return config.longRunning === 'deny';
	return false;
}
