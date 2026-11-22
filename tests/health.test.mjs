import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/health.ts';

test('health endpoint reports unconfigured integrations honestly', async () => {
  const response = await onRequestGet({ env: {}, request: new Request('https://quantum.example/api/health') });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.service, 'quantum-api');
  assert.equal(body.status, 'online');
  assert.equal(body.inference, 'not-configured');
  assert.equal(body.integrations.database, false);
});
