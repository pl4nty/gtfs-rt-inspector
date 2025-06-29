import { defineConfig, loadEnv } from 'vite'
import preact from "@preact/preset-vite";

export default defineConfig(({ command, mode }) => {
	const env = loadEnv(mode, process.cwd(), '')

	return {
		// vite config
		define: {
			__MAPBOX_TOKEN__: JSON.stringify(env.MAPBOX_TOKEN),
		},
		plugins: [preact()],
		base: '/gtfs-rt-inspector',
		optimizeDeps: {
			esbuildOptions: {
				loader: {
					'.js': 'jsx',
				},
			},
		},
	}
})
