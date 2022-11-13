import { build } from 'esbuild';
import { dependencies, devDependencies } from './package.json';

build({
	entryPoints: ['index.ts'],
	outdir: 'dist',
	bundle: true,
	platform: 'node',
	external: [...Object.keys(dependencies), ...Object.keys(devDependencies)],
});
