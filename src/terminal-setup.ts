import { useEffect } from 'react';

const ALT_SCREEN_OFF = '\x1b[?1049l';

export function exitAlternateScreen(): void {
	process.stdout.write(ALT_SCREEN_OFF);
}

export function useTerminalSetup(): void {
	useEffect(() => {
		process.stdout.write('\x1b[?2004h');
		process.stdout.write('\x1b[?1002h');
		process.stdout.write('\x1b[?1006h');

		const cleanup = () => {
			process.stdout.write('\x1b[?2004l');
			process.stdout.write('\x1b[?1002l');
			process.stdout.write('\x1b[?1006l');
		};

		const onExit = () => {
			cleanup();
			exitAlternateScreen();
		};

		process.on('exit', onExit);

		return () => {
			cleanup();
			process.removeListener('exit', onExit);
		};
	}, []);
}
