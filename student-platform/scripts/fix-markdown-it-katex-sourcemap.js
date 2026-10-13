const fs = require('fs');
const path = require('path');

const packageDirectory = path.join(
  __dirname,
  '..',
  'node_modules',
  '@vscode',
  'markdown-it-katex',
  'dist'
);
const bundlePath = path.join(packageDirectory, 'index.js');
const sourceMapPath = path.join(packageDirectory, 'index.js.map');

if (!fs.existsSync(bundlePath) || fs.existsSync(sourceMapPath)) {
  process.exit(0);
}

const bundle = fs.readFileSync(bundlePath, 'utf8');
const fixedBundle = bundle.replace(/\n?\/\/# sourceMappingURL=index\.js\.map\s*$/, '\n');

if (fixedBundle !== bundle) {
  fs.writeFileSync(bundlePath, fixedBundle);
  console.log('Removed missing @vscode/markdown-it-katex source map reference.');
}
