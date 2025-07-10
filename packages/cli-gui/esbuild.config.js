const esbuild = require('esbuild');
const path = require('path');

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
