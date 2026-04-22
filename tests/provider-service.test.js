const assert = require('assert');

async function testProviderStatusConstants() {
  const { PROVIDER_STATUS } = require('../src/provider-service');

  assert.strictEqual(PROVIDER_STATUS.READY, 'ready');
  assert.strictEqual(PROVIDER_STATUS.AUTH_FAILURE, 'auth_failure');
  assert.strictEqual(PROVIDER_STATUS.CONNECTION_FAILURE, 'connection_failure');
  assert.strictEqual(PROVIDER_STATUS.TIMEOUT, 'timeout');
  assert.strictEqual(PROVIDER_STATUS.MODEL_NOT_FOUND, 'model_not_found');
  assert.strictEqual(PROVIDER_STATUS.MALFORMED_RESPONSE, 'malformed_response');
  assert.strictEqual(PROVIDER_STATUS.BAD_REQUEST, 'bad_request');
}

async function testCheckProviderStatusInvalidConfig() {
  const { checkProviderStatus } = require('../src/provider-service');

  // Null config
  let result = await checkProviderStatus(null);
  assert.strictEqual(result.ready, false);
  assert.strictEqual(result.status, 'bad_request');
  assert.ok(result.error.includes('object'));

  // Missing type
  result = await checkProviderStatus({ baseUrl: 'http://localhost:8000/v1', model: 'test' });
  assert.strictEqual(result.ready, false);
  assert.strictEqual(result.status, 'bad_request');

  // Missing baseUrl
  result = await checkProviderStatus({ type: 'openai-compatible', model: 'test' });
  assert.strictEqual(result.ready, false);
  assert.strictEqual(result.status, 'bad_request');

  // Missing model
  result = await checkProviderStatus({ type: 'openai-compatible', baseUrl: 'http://localhost:8000/v1' });
  assert.strictEqual(result.ready, false);
  assert.strictEqual(result.status, 'bad_request');
}

async function testCheckProviderStatusInvalidUrl() {
  const { checkProviderStatus } = require('../src/provider-service');

  const result = await checkProviderStatus({
    type: 'openai-compatible',
    baseUrl: 'not-a-valid-url',
    model: 'test-model'
  });

  assert.strictEqual(result.ready, false);
  assert.strictEqual(result.status, 'connection_failure');
}

async function testCheckMultipleProviderStatus() {
  const { checkMultipleProviderStatus } = require('../src/provider-service');

  // Empty providers
  let result = await checkMultipleProviderStatus({});
  assert.deepStrictEqual(result, {});

  // Null providers
  result = await checkMultipleProviderStatus(null);
  assert.deepStrictEqual(result, {});

  // Multiple invalid providers
  result = await checkMultipleProviderStatus({
    'provider-1': { type: 'openai-compatible', baseUrl: 'bad-url', model: 'test' },
    'provider-2': { type: 'unknown', baseUrl: 'http://localhost:8000', model: 'test' }
  });

  assert.strictEqual(Object.keys(result).length, 2);
  assert.ok('provider-1' in result);
  assert.ok('provider-2' in result);
  assert.strictEqual(result['provider-1'].status, 'connection_failure');
  assert.strictEqual(result['provider-2'].status, 'bad_request');
}

async function testGetProviderDisplayStatus() {
  const { getProviderDisplayStatus } = require('../src/provider-service');

  const display = await getProviderDisplayStatus('test-provider', {
    type: 'openai-compatible',
    baseUrl: 'not-valid-url',
    model: 'test-model'
  });

  assert.strictEqual(display.id, 'test-provider');
  assert.strictEqual(display.type, 'openai-compatible');
  assert.strictEqual(display.baseUrl, 'not-valid-url');
  assert.strictEqual(display.model, 'test-model');
  assert.strictEqual(display.ready, false);
  assert.strictEqual(display.hasError, true);
  assert.ok(display.errorMessage);
  assert.ok('capabilities' in display);
}

async function testGetAllProviderDisplayStatus() {
  const { getAllProviderDisplayStatus } = require('../src/provider-service');

  const result = await getAllProviderDisplayStatus({
    'provider-1': { type: 'openai-compatible', baseUrl: 'bad-url', model: 'test' },
    'provider-2': { type: 'openai-compatible', baseUrl: 'bad-url-2', model: 'test' }
  });

  assert.strictEqual(Object.keys(result).length, 2);
  assert.strictEqual(result['provider-1'].id, 'provider-1');
  assert.strictEqual(result['provider-2'].id, 'provider-2');
}

async function testHasAnyReadyProvider() {
  const { hasAnyReadyProvider } = require('../src/provider-service');

  // Empty providers
  let result = await hasAnyReadyProvider({});
  assert.strictEqual(result, false);

  // Null providers
  result = await hasAnyReadyProvider(null);
  assert.strictEqual(result, false);

  // Invalid providers only
  result = await hasAnyReadyProvider({
    'provider-1': { type: 'openai-compatible', baseUrl: 'bad-url', model: 'test' }
  });
  assert.strictEqual(result, false);
}

async function main() {
  console.log('provider-service: running tests...');

  await testProviderStatusConstants();
  console.log('  [PASS] PROVIDER_STATUS constants are defined');

  await testCheckProviderStatusInvalidConfig();
  console.log('  [PASS] checkProviderStatus validates required fields');

  await testCheckProviderStatusInvalidUrl();
  console.log('  [PASS] checkProviderStatus handles invalid URLs');

  await testCheckMultipleProviderStatus();
  console.log('  [PASS] checkMultipleProviderStatus handles multiple providers');

  await testGetProviderDisplayStatus();
  console.log('  [PASS] getProviderDisplayStatus returns display-friendly status');

  await testGetAllProviderDisplayStatus();
  console.log('  [PASS] getAllProviderDisplayStatus returns all display statuses');

  await testHasAnyReadyProvider();
  console.log('  [PASS] hasAnyReadyProvider correctly reports no ready providers');

  console.log('provider-service: all tests passed');
}

main();
