const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// 1. Register TS Loader
require.extensions['.ts'] = function (module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      resolveJsonModule: true
    }
  });
  module._compile(result.outputText, filename);
};

// Parse command line arguments
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
let tier = null;
const tierArg = args.find(a => a.startsWith('--tier'));
if (tierArg) {
  const nextIdx = args.indexOf(tierArg) + 1;
  tier = args[nextIdx] || tierArg.split('=')[1];
} else if (args.includes('1') || args.includes('tier1')) {
  tier = '1';
} else if (args.includes('2') || args.includes('tier2')) {
  tier = '2';
} else if (args.includes('3') || args.includes('tier3')) {
  tier = '3';
} else if (args.includes('4') || args.includes('tier4')) {
  tier = '4';
}

if (verbose) {
  console.log(`[E2E Runner] Starting with options: tier=${tier || 'all'}, verbose=true`);
}

// 2. Configure environment sandbox database and CLI wrapper injection
process.env.NODE_ENV = 'test';
const testDbPath = path.resolve('.memfork/db.test.json');
process.env.MEMFORK_DB_PATH = testDbPath;

const mockCliPath = path.resolve('scripts/mock-memfork.js');
process.env.MEMFORK_CLI_PATH = mockCliPath;

// 3. Create temporary bin wrapper to support direct shell call fallbacks
const binDir = path.resolve(__dirname, '../bin');
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

if (process.platform === 'win32') {
  fs.writeFileSync(
    path.join(binDir, 'memfork.cmd'),
    `@echo off\r\nnode "${mockCliPath}" %*\r\n`
  );
} else {
  const wrapperPath = path.join(binDir, 'memfork');
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nnode "${mockCliPath}" "$@"\n`
  );
  fs.chmodSync(wrapperPath, '755');
}

// Prepend bin folder to system PATH
const originalPath = process.env.PATH;
process.env.PATH = binDir + path.delimiter + originalPath;

// Clean up helper
function cleanup() {
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const corruptedDbPath = testDbPath.replace('.json', '.corrupted.json');
    if (fs.existsSync(corruptedDbPath)) fs.unlinkSync(corruptedDbPath);
  } catch (_) {}
  try {
    if (process.platform === 'win32') {
      const cmdFile = path.join(binDir, 'memfork.cmd');
      if (fs.existsSync(cmdFile)) fs.unlinkSync(cmdFile);
    } else {
      const wrapperPath = path.join(binDir, 'memfork');
      if (fs.existsSync(wrapperPath)) fs.unlinkSync(wrapperPath);
    }
    if (fs.existsSync(binDir)) fs.rmdirSync(binDir);
  } catch (_) {}
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});

if (verbose) {
  console.log(`[E2E Runner] Sandbox database: ${testDbPath}`);
  console.log(`[E2E Runner] Mock CLI: ${mockCliPath}`);
  console.log(`[E2E Runner] Injected bin PATH: ${binDir}`);
}

// We require node:test files based on selected tier
if (!tier || tier === '1') {
  if (verbose) console.log(`[E2E Runner] Loading Tier 1 feature tests...`);
  require('../tests/e2e/tier1_feature.test.js');
}
if (!tier || tier === '2') {
  if (verbose) console.log(`[E2E Runner] Loading Tier 2 boundary tests...`);
  require('../tests/e2e/tier2_boundary.test.js');
}
if (!tier || tier === '3') {
  if (verbose) console.log(`[E2E Runner] Loading Tier 3 combined tests...`);
  require('../tests/e2e/tier3_combined.test.js');
}
if (!tier || tier === '4') {
  if (verbose) console.log(`[E2E Runner] Loading Tier 4 scenario tests...`);
  require('../tests/e2e/tier4_scenario.test.js');
}
