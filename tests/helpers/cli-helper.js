const { exec } = require('child_process');
const path = require('path');

/**
 * Runs a memfork CLI command and returns the result (stdout, stderr, exitCode).
 * @param {string} args - The arguments string, e.g. "branch feature-a --from main"
 * @param {object} [options] - Exec options
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function execCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    // Resolve CLI target
    let cmd = '';
    if (process.env.MEMFORK_CLI_PATH) {
      cmd = `node "${process.env.MEMFORK_CLI_PATH}"`;
    } else if (process.env.USE_REAL_CLI) {
      cmd = 'memfork';
    } else {
      const mockPath = path.resolve(__dirname, '../../scripts/mock-memfork.js');
      cmd = `node "${mockPath}"`;
    }
    
    const fullCommand = `${cmd} ${args}`;
    
    // Pass along environment variables
    const env = { ...process.env, ...options.env };
    
    const execOptions = {
      env,
      timeout: options.timeout || 5000, // default 5 seconds timeout
      ...options
    };
    
    exec(fullCommand, execOptions, (error, stdout, stderr) => {
      const outStr = stdout ? stdout.toString() : '';
      const errStr = stderr ? stderr.toString() : '';
      
      if (error) {
        if (error.killed && error.signal === 'SIGTERM') {
          // Test Case 2.5.2: "Child process wrapper terminates and rejects with timeout error"
          reject(new Error('CLI execution timeout'));
          return;
        }
        
        // Test Case 2.5.1: Missing executable handling
        const isNotFound = error.code === 'ENOENT' || 
                           error.message.includes('ENOENT') || 
                           error.message.includes('not found') || 
                           error.message.includes('is not recognized');
        if (isNotFound) {
          reject(new Error('memfork executable not found'));
          return;
        }
      }
      
      resolve({
        stdout: outStr,
        stderr: errStr,
        code: error ? (error.code || 1) : 0
      });
    });
  });
}

module.exports = {
  execCli
};
