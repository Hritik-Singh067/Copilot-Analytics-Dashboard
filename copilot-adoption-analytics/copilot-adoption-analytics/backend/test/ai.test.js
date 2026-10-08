const assert = require('node:assert/strict');
const test = require('node:test');
const { createAnalysisHandler, providerFailure, sanitizeAnalytics } = require('../src/routes/ai');

function createResponse() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function createDb(user = { id: 7, role: 'project_manager' }) {
  return {
    async query() {
      return { rows: user ? [user] : [] };
    }
  };
}

test('sanitizes chart context to analytics fields and excludes personal data', () => {
  const sanitized = sanitizeAnalytics({
    period_start: '2026-09-01',
    employee: { name: 'Sam', email: 'sam@example.com', consumed_tokens: 42 },
    model_usage: [{ model: 'gpt-4.1', tokens: 1000, per_token_cost: 0.00001 }],
    data: [{ raw_prompt: 'do not send' }]
  });

  assert.deepEqual(sanitized, {
    period_start: '2026-09-01',
    employee: { name: 'Sam', consumed_tokens: 42 },
    model_usage: [{ model: 'gpt-4.1', tokens: 1000, per_token_cost: 0.00001 }]
  });
});

test('sends the question and sanitized chart context to Gemini', async () => {
  let modelRequest;
  const loggedMessages = [];
  const handler = createAnalysisHandler(createDb(), {
    env: { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model' },
    logger: { info: (...args) => loggedMessages.push(args) },
    client: {
      models: {
        async generateContent(options) {
          modelRequest = options;
          return { text: 'Usage is 42 tokens.' };
        }
      }
    }
  });
  const response = createResponse();

  await handler({
    body: {
      userId: 7,
      question: 'How much usage?',
      month: '2026-09',
      analytics: {
        period_start: '2026-09-01',
        employee: { consumed_tokens: 42, email: 'private@example.com' }
      },
      history: [{ question: 'Prior question', answer: 'Prior answer' }]
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { success: true, answer: 'Usage is 42 tokens.' });
  assert.equal(modelRequest.model, 'test-model');
  assert.match(modelRequest.contents, /"consumed_tokens":42/);
  assert.doesNotMatch(modelRequest.contents, /private@example\.com/);
  assert.equal(modelRequest.config.maxOutputTokens, 4096);
  assert.deepEqual(loggedMessages, [['Gemini analysis response:', 'Usage is 42 tokens.']]);
});

test('returns and logs the entire long Gemini response', async () => {
  const answer = `Complete response. ${'Additional details. '.repeat(180)}`.trim();
  const loggedMessages = [];
  const handler = createAnalysisHandler(createDb(), {
    env: { GEMINI_API_KEY: 'test-key' },
    logger: { info: (...args) => loggedMessages.push(args) },
    client: {
      models: {
        async generateContent() {
          return { text: answer };
        }
      }
    }
  });
  const response = createResponse();

  await handler({
    body: { userId: 7, question: 'Explain the data in detail.', analytics: {} }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.answer, answer);
  assert.deepEqual(loggedMessages, [['Gemini analysis response:', answer]]);
});

test('reports missing Gemini configuration without contacting the model', async () => {
  const handler = createAnalysisHandler(createDb(), { env: {} });
  const response = createResponse();

  await handler({
    body: { userId: 7, question: 'How much usage?', analytics: {} }
  }, response);

  assert.equal(response.statusCode, 503);
  assert.match(response.body.message, /GEMINI_API_KEY/);
});

test('rejects a blank question before attempting database access', async () => {
  const handler = createAnalysisHandler({
    async query() {
      throw new Error('database should not be queried');
    }
  }, { env: { GEMINI_API_KEY: 'test-key' } });
  const response = createResponse();

  await handler({ body: { userId: 7, question: '  ', analytics: {} } }, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /Question must be/);
});

test('explains invalid Gemini credentials and preserves safe request diagnostics', () => {
  const failure = providerFailure({
    status: 400,
    name: 'GoogleGenerativeAIFetchError',
    message: 'API key not valid. x-goog-api-key: secret-value',
    headers: { 'x-goog-request-id': 'req_test123' }
  });

  assert.equal(failure.responseStatus, 502);
  assert.match(failure.userMessage, /rejected the Gemini API key/);
  assert.equal(failure.requestId, 'req_test123');
  assert.doesNotMatch(failure.message, /secret-value/);
});

test('explains an unavailable Gemini model separately from quota limits', () => {
  const modelFailure = providerFailure({ status: 404, message: 'model not found' });
  const rateFailure = providerFailure({ status: 429, message: 'rate limited' });

  assert.match(modelFailure.userMessage, /model was not found/);
  assert.equal(modelFailure.responseStatus, 502);
  assert.match(rateFailure.userMessage, /free-tier quota/);
  assert.equal(rateFailure.responseStatus, 429);
});
