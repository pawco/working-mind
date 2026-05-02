const _v: string | undefined = (import.meta as any).env?.PACKAGE_VERSION;
export const VERSION: string = typeof _v === 'string' ? _v : '0.0.0-dev';
