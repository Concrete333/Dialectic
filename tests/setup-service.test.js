const assert = require('assert');

async function testGetAdapterMetadata() {
  const { getAdapterMetadata } = require('../src/setup-service');

  const claudeMeta = getAdapterMetadata('claude');
  assert.ok(claudeMeta, 'claude metadata exists');
  assert.strictEqual(claudeMeta.id, 'claude');
  assert.strictEqual(claudeMeta.displayName, 'Claude Code');
  assert.strictEqual(claudeMeta.supportsWriteAccess, true);
  assert.ok(claudeMeta.docsUrl);
  assert.ok(claudeMeta.installHint);
  assert.ok(claudeMeta.loginHint);

  const codexMeta = getAdapterMetadata('codex');
  assert.ok(codexMeta, 'codex metadata exists');
  assert.strictEqual(codexMeta.id, 'codex');
  assert.strictEqual(codexMeta.displayName, 'Codex CLI');

  const unknownMeta = getAdapterMetadata('unknown');
  assert.strictEqual(unknownMeta, null, 'unknown adapter returns null');
}

async function testGetAllAdapterMetadata() {
  const { getAllAdapterMetadata } = require('../src/setup-service');

  const allMeta = getAllAdapterMetadata();
  assert.ok(Array.isArray(allMeta));
  assert.ok(allMeta.length > 0, 'returns non-empty array');

  const ids = allMeta.map(m => m.id);
  assert.ok(ids.includes('claude'));
  assert.ok(ids.includes('codex'));
  assert.ok(ids.includes('gemini'));
  assert.ok(ids.includes('kilo'));
  assert.ok(ids.includes('qwen'));
  assert.ok(ids.includes('opencode'));
}

async function testGetSupportedAgentIds() {
  const { getSupportedAgentIds } = require('../src/setup-service');

  const ids = getSupportedAgentIds();
  assert.ok(Array.isArray(ids));
  assert.ok(ids.includes('claude'));
  assert.ok(ids.includes('codex'));
}

async function testStatusConstants() {
  const { STATUS } = require('../src/setup-service');

  assert.strictEqual(STATUS.READY, 'ready');
  assert.strictEqual(STATUS.INSTALLED_BUT_NEEDS_LOGIN, 'installed_but_needs_login');
  assert.strictEqual(STATUS.MISSING, 'missing');
  assert.strictEqual(STATUS.UNUSABLE, 'unusable');
}

async function testFormatPreflightErrorCommandNotFound() {
  const { formatPreflightError } = require('../src/setup-service');

  const error = formatPreflightError('claude', 'command_not_found', null);
  assert.ok(error.includes('command not found'));
  assert.ok(error.includes('install'));
}

async function testFormatPreflightErrorAuthFailure() {
  const { formatPreflightError } = require('../src/setup-service');

  const error = formatPreflightError('codex', 'auth_failure', null);
  assert.ok(error.includes('not authenticated'));
  assert.ok(error.includes('login'));
}

async function testFormatPreflightErrorUnusable() {
  const { formatPreflightError } = require('../src/setup-service');

  const result = {
    exitCode: 1,
    outputText: 'some error'
  };
  const error = formatPreflightError('claude', 'unusable', result);
  assert.ok(error.includes('not usable'));
  assert.ok(error.includes('Exit code 1'));
}

async function testFormatPreflightErrorUnknownAgent() {
  const { formatPreflightError } = require('../src/setup-service');

  const error = formatPreflightError('totally-unknown', 'command_not_found', null);
  assert.ok(error.includes('unknown'));
  assert.ok(error.includes('command not found'));
}

async function testCheckAdapterStatusUnknownAgent() {
  const { checkAdapterStatus } = require('../src/setup-service');

  const status = await checkAdapterStatus('unknown-agent');
  assert.strictEqual(status.ready, false);
  assert.strictEqual(status.status, 'unusable');
  assert.ok(status.error.includes('Unknown agent'));
}

async function testRunPreflightCheckReturnsStructuredUnusableWhenRunProcessThrows() {
  const { __test } = require('../src/setup-service');

  const spawnError = new Error('Access is denied.');
  spawnError.code = 'EPERM';

  const result = await __test.runPreflightCheck({
    getAdapter() {
      return {
        buildPreflightInvocation() {
          return {
            command: 'node',
            args: ['--help'],
            cwd: process.cwd(),
            timeoutMs: 1000
          };
        }
      };
    },
    __test: {
      runProcess: async () => {
        throw spawnError;
      },
      annotatePreflightResult() {
        throw new Error('annotatePreflightResult should not run when runProcess throws');
      }
    }
  }, 'claude', 'C:\\fake\\claude.exe', {
    timeoutMs: 1000,
    cwd: process.cwd()
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.readinessKind, 'unusable');
  assert.strictEqual(result.exitCode, null);
  assert.strictEqual(result.error, spawnError);
}

async function testGetAdapterDisplayStatus() {
  const { getAdapterDisplayStatus } = require('../src/setup-service');

  const display = await getAdapterDisplayStatus('unknown-agent', {
    checkAdapterStatus: async () => ({
      agentId: 'unknown-agent',
      metadata: null,
      status: 'unusable',
      ready: false,
      error: 'Unknown agent "unknown-agent".',
      nextAction: null,
      resolvedPath: null
    })
  });
  assert.strictEqual(display.id, 'unknown-agent');
  assert.strictEqual(display.ready, false);
  assert.strictEqual(display.hasError, true);
  assert.ok(display.errorMessage);
}

async function testGetAllAdapterDisplayStatus() {
  const { getAllAdapterDisplayStatus } = require('../src/setup-service');

  const allStatus = await getAllAdapterDisplayStatus({
    checkAdapterStatus: async (agentName) => ({
      agentId: agentName,
      metadata: {
        displayName: agentName === 'claude' ? 'Claude Code' : agentName,
        docsUrl: 'https://example.test',
        envOverride: null
      },
      status: 'ready',
      ready: true,
      error: null,
      nextAction: null,
      resolvedPath: `C:\\fake\\${agentName}`
    })
  });
  assert.ok(Array.isArray(allStatus));
  assert.ok(allStatus.length > 0);

  const claudeStatus = allStatus.find(s => s.id === 'claude');
  assert.ok(claudeStatus, 'claude status is included');
  assert.strictEqual(claudeStatus.displayName, 'Claude Code');
  assert.ok('status' in claudeStatus);
  assert.ok('ready' in claudeStatus);
}

async function main() {
  console.log('setup-service: running tests...');

  await testGetAdapterMetadata();
  console.log('  [PASS] getAdapterMetadata returns correct metadata');

  await testGetAllAdapterMetadata();
  console.log('  [PASS] getAllAdapterMetadata returns all adapters');

  await testGetSupportedAgentIds();
  console.log('  [PASS] getSupportedAgentIds returns supported agent IDs');

  await testStatusConstants();
  console.log('  [PASS] STATUS constants are defined correctly');

  await testFormatPreflightErrorCommandNotFound();
  console.log('  [PASS] formatPreflightError handles command_not_found');

  await testFormatPreflightErrorAuthFailure();
  console.log('  [PASS] formatPreflightError handles auth_failure');

  await testFormatPreflightErrorUnusable();
  console.log('  [PASS] formatPreflightError handles unusable');

  await testFormatPreflightErrorUnknownAgent();
  console.log('  [PASS] formatPreflightError handles unknown agents');

  await testCheckAdapterStatusUnknownAgent();
  console.log('  [PASS] checkAdapterStatus handles unknown agents');

  await testRunPreflightCheckReturnsStructuredUnusableWhenRunProcessThrows();
  console.log('  [PASS] runPreflightCheck returns structured unusable result when process spawning fails');

  await testGetAdapterDisplayStatus();
  console.log('  [PASS] getAdapterDisplayStatus returns display-friendly status');

  await testGetAllAdapterDisplayStatus();
  console.log('  [PASS] getAllAdapterDisplayStatus returns all display statuses');

  console.log('setup-service: all tests passed');
}

main();
