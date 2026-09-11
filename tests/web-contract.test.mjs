import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

async function loadBundled(entry, name) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dgs-web-test-'));
  const output = path.join(directory, `${name}.mjs`);
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: output });
  return import(`${pathToFileURL(output).href}?${Date.now()}`);
}

test('BLE distance reference adapter calculates and persists learning state', async () => {
  const { createJavaScriptDistanceAdapter } = await loadBundled('src/lib/bleWasm.ts', 'ble');
  const adapter = createJavaScriptDistanceAdapter();
  assert.equal(adapter.runtime, 'javascript');
  assert.ok(Math.abs(adapter.calculate_distance(-65, -59) - 2) < 0.01);
  assert.throws(() => adapter.calculate_distance_env(-65, -59, 0), /greater than zero/);
  const learned = adapter.learn_from_feedback(-59, 1, -71, 4);
  assert.equal(adapter.get_learned_n(), learned);
  assert.ok(learned >= 1.5 && learned <= 6);
});

test('enterprise HTTP validation accepts only successful responses', async () => {
  const { ENTERPRISE_NODES, validateNodeEndpoint } = await loadBundled('src/config/enterprise-nodes.ts', 'enterprise');
  const original = ENTERPRISE_NODES.API.endpointUrl;
  const originalFetch = globalThis.fetch;
  ENTERPRISE_NODES.API.endpointUrl = 'https://health.example.test/status';
  try {
    globalThis.fetch = async () => new Response(null, { status: 204 });
    assert.equal(await validateNodeEndpoint('API'), true);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    assert.equal(await validateNodeEndpoint('API'), false);
  } finally {
    ENTERPRISE_NODES.API.endpointUrl = original;
    globalThis.fetch = originalFetch;
  }
});

test('Rosetta converter sends real transport envelopes and filters SSE metadata', async () => {
  const { RosettaConverter } = await loadBundled('src/lib/rosetta/rosettaConverter.ts', 'rosetta');
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    if (requests.length === 1) return new Response(JSON.stringify({ result: { answer: 'backend answer' } }), { status: 200 });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: message\ndata: {"id":"one","delta":{"content":"stream body"}}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
  try {
    const converter = new RosettaConverter('net-analysis');
    const result = await converter.request({ route: 'net-analysis', payload: { observed: true } });
    assert.deepEqual(result.result, { answer: 'backend answer' });
    assert.deepEqual(requests[0], { url: '/rosetta-ai/v1/chat/agnes', body: { route: 'net-analysis', payload: { observed: true }, stream: false } });
    const chunks = [];
    const streamed = await converter.stream({ route: 'net-analysis', payload: { observed: true } }, (chunk) => chunks.push(chunk));
    assert.equal(streamed.streamChunk, true);
    assert.equal(chunks[0].data, 'stream body');
    assert.equal(chunks.some((chunk) => chunk.data.includes('event:')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
