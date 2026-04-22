const { checkProviderReadiness, PROVIDER_REGISTRY } = require('./adapters');

// ── Provider Status Constants ────────────────────────────────────────────────────

const PROVIDER_STATUS = {
  READY: 'ready',
  AUTH_FAILURE: 'auth_failure',
  CONNECTION_FAILURE: 'connection_failure',
  TIMEOUT: 'timeout',
  MODEL_NOT_FOUND: 'model_not_found',
  MALFORMED_RESPONSE: 'malformed_response',
  BAD_REQUEST: 'bad_request'
};

// ── Provider Readiness Check ─────────────────────────────────────────────────────

/**
 * Checks the readiness of an HTTP provider from raw provider config.
 * This can be called without a full task run.
 *
 * @param {Object} providerConfig - Raw provider configuration
 * @param {string} providerConfig.type - Provider type (e.g., 'openai-compatible')
 * @param {string} providerConfig.baseUrl - Base URL for the provider
 * @param {string} providerConfig.model - Model name to check
 * @param {string} [providerConfig.apiKey] - Optional API key
 * @param {string} [providerConfig.healthEndpoint] - Optional health endpoint
 * @param {Object} [providerConfig.requestDefaults] - Optional request defaults
 * @returns {Promise<Object>} Readiness status object
 */
async function checkProviderStatus(providerConfig) {
  if (!providerConfig || typeof providerConfig !== 'object') {
    return {
      ready: false,
      status: PROVIDER_STATUS.BAD_REQUEST,
      error: 'Provider config must be an object',
      providerId: null,
      failureReason: 'bad_request'
    };
  }

  const { type, baseUrl, model } = providerConfig;

  if (type !== 'openai-compatible') {
    return {
      ready: false,
      status: PROVIDER_STATUS.BAD_REQUEST,
      error: `Unsupported provider type: "${type || 'undefined'}"`,
      providerId: null,
      failureReason: 'bad_request'
    };
  }

  if (!baseUrl || typeof baseUrl !== 'string') {
    return {
      ready: false,
      status: PROVIDER_STATUS.BAD_REQUEST,
      error: 'Provider baseUrl is required',
      providerId: null,
      failureReason: 'bad_request'
    };
  }

  if (!model || typeof model !== 'string') {
    return {
      ready: false,
      status: PROVIDER_STATUS.BAD_REQUEST,
      error: 'Provider model is required',
      providerId: null,
      failureReason: 'bad_request'
    };
  }

  // Use the existing checkProviderReadiness function from adapters
  try {
    const result = await checkProviderReadiness(providerConfig);

    // Map failureReason to our status constants
    const statusMap = {
      auth_failure: PROVIDER_STATUS.AUTH_FAILURE,
      connection_failure: PROVIDER_STATUS.CONNECTION_FAILURE,
      timeout: PROVIDER_STATUS.TIMEOUT,
      model_not_found: PROVIDER_STATUS.MODEL_NOT_FOUND,
      malformed_response: PROVIDER_STATUS.MALFORMED_RESPONSE
    };

    const status = result.ready ? PROVIDER_STATUS.READY : (statusMap[result.failureReason] || PROVIDER_STATUS.BAD_REQUEST);

    return {
      ready: result.ready,
      status,
      error: result.error,
      providerId: result.providerId,
      failureReason: result.failureReason,
      modelConfirmed: result.modelConfirmed,
      rawModels: result.rawModels,
      checkedAt: result.checkedAt
    };
  } catch (error) {
    return {
      ready: false,
      status: PROVIDER_STATUS.BAD_REQUEST,
      error: error.message || String(error),
      providerId: null,
      failureReason: 'bad_request'
    };
  }
}

/**
 * Checks the readiness of multiple providers from a providers map.
 *
 * @param {Object} providers - Map of provider ID to provider config
 * @returns {Promise<Object>} Map of provider ID to status objects
 */
async function checkMultipleProviderStatus(providers) {
  if (!providers || typeof providers !== 'object') {
    return {};
  }

  const entries = Object.entries(providers);
  const results = await Promise.all(
    entries.map(async ([providerId, config]) => {
      const status = await checkProviderStatus(config);
      return [providerId, status];
    })
  );

  return Object.fromEntries(results);
}

/**
 * Gets a UI-friendly display status for a provider.
 *
 * @param {string} providerId - The provider ID
 * @param {Object} providerConfig - The provider configuration
 * @returns {Promise<Object>} UI-friendly status object
 */
async function getProviderDisplayStatus(providerId, providerConfig) {
  const status = await checkProviderStatus(providerConfig);
  const metadata = PROVIDER_REGISTRY['openai-compatible'] || {};

  return {
    id: providerId,
    type: providerConfig?.type,
    baseUrl: providerConfig?.baseUrl,
    model: providerConfig?.model,
    status: status.status,
    ready: status.ready,
    hasError: !status.ready,
    errorMessage: status.error,
    failureReason: status.failureReason,
    modelConfirmed: status.modelConfirmed,
    availableModels: status.rawModels || [],
    checkedAt: status.checkedAt,
    capabilities: {
      supportsChat: metadata.supportsChat,
      supportsWriteAccess: metadata.supportsWriteAccess,
      supportsModelListing: metadata.supportsModelListing,
      supportsHealthChecks: metadata.supportsHealthChecks
    }
  };
}

/**
 * Gets all provider statuses in a UI-friendly format.
 *
 * @param {Object} providers - Map of provider ID to provider config
 * @returns {Promise<Object>} Map of provider ID to UI-friendly status objects
 */
async function getAllProviderDisplayStatus(providers) {
  if (!providers || typeof providers !== 'object') {
    return {};
  }

  const entries = Object.entries(providers);
  const results = await Promise.all(
    entries.map(async ([providerId, config]) => {
      const status = await getProviderDisplayStatus(providerId, config);
      return [providerId, status];
    })
  );

  return Object.fromEntries(results);
}

/**
 * Determines if any provider is ready from a providers map.
 *
 * @param {Object} providers - Map of provider ID to provider config
 * @returns {Promise<boolean>} True if at least one provider is ready
 */
async function hasAnyReadyProvider(providers) {
  if (!providers || typeof providers !== 'object') {
    return false;
  }

  const statuses = await checkMultipleProviderStatus(providers);
  return Object.values(statuses).some(s => s.ready);
}

module.exports = {
  PROVIDER_STATUS,
  checkProviderStatus,
  checkMultipleProviderStatus,
  getProviderDisplayStatus,
  getAllProviderDisplayStatus,
  hasAnyReadyProvider
};
