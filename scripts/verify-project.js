const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const ts = require('typescript');

console.log('==================================================');
console.log('         AgentOS Memory Lab Verification Gate');
console.log('==================================================\n');

async function runTypeCheck() {
  console.log('[1/2] Running TypeScript Type Check...');
  
  // Resolve all TS files in the workspace
  const files = [
    path.resolve(__dirname, '../lib/types/index.ts'),
    path.resolve(__dirname, '../lib/db/db.ts'),
    path.resolve(__dirname, '../lib/memory/memfork.ts'),
    path.resolve(__dirname, '../lib/memory/merge.ts'),
    path.resolve(__dirname, '../lib/agents/orchestrator.ts')
  ];

  const tsconfigPath = path.resolve(__dirname, '../tsconfig.json');
  let compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    resolveJsonModule: true
  };

  if (fs.existsSync(tsconfigPath)) {
    try {
      const tsconfigFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(tsconfigFile.config, ts.sys, path.dirname(tsconfigPath));
      compilerOptions = parsed.options;
      // Force noEmit for check-only
      compilerOptions.noEmit = true;
      compilerOptions.incremental = false;
    } catch (err) {
      console.warn(`[Warning] Could not parse tsconfig.json: ${err.message}. Using default check options.`);
    }
  }

  const program = ts.createProgram(files, compilerOptions);
  const emitResult = program.emit();
  const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

  if (allDiagnostics.length > 0) {
    console.error('❌ TypeScript Type Check FAILED:');
    allDiagnostics.forEach(diagnostic => {
      if (diagnostic.file) {
        const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        console.error(`  ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
      } else {
        console.error(`  Error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
      }
    });
    return false;
  }

  console.log('✅ TypeScript Type Check PASSED.\n');
  return true;
}

function runE2ETests() {
  return new Promise((resolve) => {
    console.log('[2/2] Running E2E Test Suite (All Tiers)...');
    
    const runnerPath = path.resolve(__dirname, 'run-e2e.js');
    const child = fork(runnerPath, ['--verbose'], {
      execArgv: ['--test-concurrency=1'],
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ E2E Test Suite PASSED.');
        resolve(true);
      } else {
        console.error(`\n❌ E2E Test Suite FAILED with exit code ${code}.`);
        resolve(false);
      }
    });

    child.on('error', (err) => {
      console.error('\n❌ Failed to start E2E test runner process:', err.message);
      resolve(false);
    });
  });
}

async function main() {
  const typeCheckPassed = await runTypeCheck();
  if (!typeCheckPassed) {
    console.error('\n❌ VERIFICATION FAILED: TypeScript compilation errors found.');
    process.exit(1);
  }

  const e2ePassed = await runE2ETests();
  if (!e2ePassed) {
    console.error('\n❌ VERIFICATION FAILED: E2E tests failed.');
    process.exit(1);
  }

  console.log('\n==================================================');
  console.log('🎉 VERIFICATION SUCCESS: All checks passed!');
  console.log('==================================================');
  process.exit(0);
}

main().catch(err => {
  console.error('Unexpected verification error:', err);
  process.exit(1);
});
