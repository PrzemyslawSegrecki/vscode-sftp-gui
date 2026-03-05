const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
   entryPoints: ['./src/extension.ts'],
   bundle: true,
   outfile: './dist/extension.js',
   external: ['vscode'],
   format: 'cjs',
   platform: 'node',
   target: 'node18',
   sourcemap: true,
   minify: !isWatch,
};

async function build() {
   if (isWatch) {
      const ctx = await esbuild.context(extensionConfig);
      await ctx.watch();
      console.log('[esbuild] Watching for changes...');
   } else {
      await esbuild.build(extensionConfig);
      console.log('[esbuild] Build complete.');
   }
}

build().catch((err) => {
   console.error(err);
   process.exit(1);
});
