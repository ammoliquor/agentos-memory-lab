const fs = require('fs');
const path = require('path');

const DEFAULT_TEST_DB_PATH = path.resolve(process.cwd(), '.memfork/db.test.json');

function getDbPath() {
  return process.env.MEMFORK_DB_PATH || DEFAULT_TEST_DB_PATH;
}

function setupSandbox() {
  process.env.NODE_ENV = 'test';
  if (!process.env.MEMFORK_DB_PATH) {
    process.env.MEMFORK_DB_PATH = DEFAULT_TEST_DB_PATH;
  }
  
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Create fresh DB
  const initialData = { branches: [], commits: [], messages: [] };
  fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2), 'utf8');
}

function resetSandbox() {
  const dbPath = getDbPath();
  const seedData = {
    branches: [
      {
        id: 'main',
        name: 'main',
        parentBranchId: null,
        active: true,
        timestamp: new Date().toISOString()
      }
    ],
    commits: [],
    messages: [],
    currentBranchId: 'main'
  };
  fs.writeFileSync(dbPath, JSON.stringify(seedData, null, 2), 'utf8');
}

function teardownSandbox() {
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
    } catch (e) {
      // ignore
    }
  }
  
  // Also clean up any corrupted database files if created
  const corruptedPath = dbPath.endsWith('.json') 
    ? dbPath.slice(0, -5) + '.corrupted.json' 
    : dbPath + '.corrupted.json';
  if (fs.existsSync(corruptedPath)) {
    try {
      fs.unlinkSync(corruptedPath);
    } catch (e) {
      // ignore
    }
  }
  
  // Also clean up temporary files if any exist
  const tmpPath = dbPath + '.tmp';
  if (fs.existsSync(tmpPath)) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {
      // ignore
    }
  }
}

function readDb() {
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
  return null;
}

function writeDb(data) {
  const dbPath = getDbPath();
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  getDbPath,
  setupSandbox,
  resetSandbox,
  teardownSandbox,
  readDb,
  writeDb
};
