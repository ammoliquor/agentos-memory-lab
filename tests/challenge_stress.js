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

const { branch } = require('../lib/memory/memfork.ts');
const { readDb, resetDb } = require('../lib/db/db.ts');

const seedMain = { id: 'main', name: 'main', parentBranchId: null };

async function testDbConcurrency() {
  console.log('--- Testing lib/db/db.ts concurrency ---');
  const testDbPath = path.resolve('.memfork/db.stress-db.json');
  process.env.MEMFORK_DB_PATH = testDbPath;
  
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch (_) {}
  
  await resetDb([seedMain]);
  
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push((async () => {
      const db = await readDb();
      db.branches.push({ id: `branch-${i}`, name: `branch-${i}`, parentBranchId: null });
      // Simulate some slight delay to ensure asynchronous interleaving
      await new Promise(r => setTimeout(r, Math.random() * 10));
      const { writeDb } = require('../lib/db/db.ts');
      await writeDb(db);
    })());
  }
  
  await Promise.all(promises);
  
  const finalDb = await readDb();
  console.log(`Expected branches in DB: 101`);
  console.log(`Actual branches in DB: ${finalDb.branches.length}`);
  
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch (_) {}
}

async function testCliConcurrency() {
  console.log('--- Testing lib/memory/memfork.ts (CLI) concurrency ---');
  const testDbPath = path.resolve('.memfork/db.stress-cli.json');
  process.env.MEMFORK_DB_PATH = testDbPath;
  process.env.MEMFORK_CLI_PATH = path.resolve('scripts/mock-memfork.js');
  
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch (_) {}
  
  await resetDb([seedMain]);
  
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(branch(`branch-${i}`, 'main'));
  }
  
  try {
    await Promise.all(promises);
    const finalDb = await readDb();
    console.log(`Expected branches via CLI: 11`);
    console.log(`Actual branches via CLI: ${finalDb.branches.length}`);
  } catch (err) {
    console.log(`CLI concurrency failed with error: ${err.message}`);
  }
  
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch (_) {}
}

async function run() {
  await testDbConcurrency();
  await testCliConcurrency();
}

run().catch(console.error);
