const fs = require('fs');
const path = require('path');

// Register TS loader
require.extensions['.ts'] = function (module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  const ts = require('typescript');
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

const { branch, commit, recall } = require('../lib/memory/memfork.ts');
const { resetDb } = require('../lib/db/db.ts');

const seedMain = { id: 'main', name: 'main', parentBranchId: null };

async function testHyphenFact() {
  console.log('--- Testing fact starting with hyphen ---');
  const testDbPath = path.resolve('.memfork/db.arg-test.json');
  process.env.MEMFORK_DB_PATH = testDbPath;
  process.env.MEMFORK_CLI_PATH = path.resolve('scripts/mock-memfork.js');
  
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch (_) {}
  
  await resetDb([seedMain]);
  
  await branch('feature-a', 'main');
  const c = await commit('feature-a', 'Commit Msg', ['- Use PostgreSQL', 'Normal Fact']);
  console.log('Committed facts:', c.facts);
  
  const recalled = await recall('feature-a');
  console.log('Recalled facts:', recalled);
  
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch (_) {}
}

async function testBranchNameCollision() {
  console.log('--- Testing branch name "-m" collision ---');
  const testDbPath = path.resolve('.memfork/db.arg-test.json');
  process.env.MEMFORK_DB_PATH = testDbPath;
  process.env.MEMFORK_CLI_PATH = path.resolve('scripts/mock-memfork.js');
  
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch (_) {}
  
  await resetDb([seedMain]);
  
  await branch('-m', 'main');
  try {
    const c = await commit('-m', 'My real message', ['Fact 1']);
    console.log('Committed message:', c.message);
    console.log('Committed facts:', c.facts);
  } catch (err) {
    console.error('Failed to commit on branch -m:', err.message);
  }
  
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch (_) {}
}

async function run() {
  await testHyphenFact();
  await testBranchNameCollision();
}

run().catch(console.error);
