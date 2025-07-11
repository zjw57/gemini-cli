const esbuild = require('esbuild');
const path = require('path');
const packageJson = require('./package.json');

// Build for the browser (React components)
esbuild.build({
  entryPoints: [
    path.resolve(__dirname, 'src/index.tsx'),
    path.resolve(__dirname, 'src/components/dashboard.tsx'),
  ],
  bundle: true,
  outdir: path.resolve(__dirname, 'dist'),
  platform: 'browser',
  format: 'esm',
  define: {
    'process.env.NODE_ENV': '"development"',
  },
}).catch(() => process.exit(1));

// Build for Node.js (main process)
esbuild.build({
    entryPoints: [path.resolve(__dirname, 'main.ts')],
    bundle: true,
    outfile: path.resolve(__dirname, 'dist/main.js'),
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron', ...Object.keys(packageJson.dependencies || {})],
}).catch(() => process.exit(1));

// Build for Node.js (preload script)
esbuild.build({
    entryPoints: [path.resolve(__dirname, 'preload.js')],
    bundle: true,
    outfile: path.resolve(__dirname, 'dist/preload.js'),
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
}).catch(() => process.exit(1));
