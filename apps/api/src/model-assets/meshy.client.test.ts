import { describe, expect, it } from 'vitest';
import { imageTo3dRequest, MeshyClient, MeshyError } from './meshy.client.js';

/*
 * The retry rules, each pinned. No test here reaches Meshy: `fetch` is a script of answers, and
 * `sleep` does not wait.
 */

type Answer = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

function scripted(answers: Answer[]) {
  const calls: { url: string; method: string }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const answer = answers.shift();
    if (!answer) throw new Error('no more scripted answers');
    if (answer instanceof Error) throw answer;
    return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), {
      status: answer.status,
      headers: answer.headers,
    });
  }) as unknown as typeof globalThis.fetch;
  const client = new MeshyClient('msy_test', { fetch, sleep: async () => {} });
  return { client, calls };
}

const request = imageTo3dRequest('data:image/png;base64,AAAA', 'meshy-7.1', 15_000);
const task = { id: 't1', status: 'IN_PROGRESS', progress: 40 };

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MeshyError);
    return (error as MeshyError).failure;
  }
  throw new Error('expected a MeshyError');
}

describe('MeshyClient', () => {
  it('creates a task and reads it back', async () => {
    const { client, calls } = scripted([
      { status: 202, body: { result: 't1' } },
      { status: 200, body: task },
    ]);
    expect(await client.createImageTo3d(request)).toBe('t1');
    expect((await client.getImageTo3d('t1')).progress).toBe(40);
    expect(calls.map((call) => call.method)).toEqual(['POST', 'GET']);
  });

  it('waits out a rate limit that says how long, and tries again', async () => {
    const { client, calls } = scripted([
      { status: 429, body: { message: 'Rate limit exceeded' }, headers: { 'retry-after': '1' } },
      { status: 200, body: task },
    ]);
    expect((await client.getImageTo3d('t1')).id).toBe('t1');
    expect(calls).toHaveLength(2);
  });

  it('reports a full queue rather than waiting on it — it only clears when a task finishes', async () => {
    const { client, calls } = scripted([{ status: 429, body: { message: 'NoMorePendingTasks' } }]);
    expect(await failureOf(client.createImageTo3d(request))).toBe('queue-full');
    expect(calls).toHaveLength(1);
  });

  it('retries a server error or a dropped connection on a read, which costs nothing', async () => {
    const { client, calls } = scripted([
      { status: 503 },
      new TypeError('fetch failed'),
      { status: 200, body: task },
    ]);
    expect((await client.getImageTo3d('t1')).status).toBe('IN_PROGRESS');
    expect(calls).toHaveLength(3);
  });

  it('never retries the POST that creates a task: it may have arrived, and a second would be charged', async () => {
    const dropped = scripted([
      new TypeError('fetch failed'),
      { status: 202, body: { result: 't2' } },
    ]);
    expect(await failureOf(dropped.client.createImageTo3d(request))).toBe('network');
    expect(dropped.calls).toHaveLength(1);

    const failed = scripted([{ status: 502 }, { status: 202, body: { result: 't2' } }]);
    expect(await failureOf(failed.client.createImageTo3d(request))).toBe('server');
    expect(failed.calls).toHaveLength(1);
  });

  it('names the failures asking again cannot fix', async () => {
    expect(await failureOf(scripted([{ status: 402 }]).client.createImageTo3d(request))).toBe(
      'no-credits',
    );
    expect(await failureOf(scripted([{ status: 401 }]).client.balance())).toBe('unauthorised');
    expect(await failureOf(scripted([{ status: 404 }]).client.getImageTo3d('gone'))).toBe(
      'not-found',
    );
    expect(await failureOf(scripted([{ status: 409 }]).client.deleteImageTo3d('busy'))).toBe(
      'conflict',
    );
    expect(
      await failureOf(
        scripted([{ status: 400, body: { message: 'bad image' } }]).client.createImageTo3d(request),
      ),
    ).toBe('rejected');
  });

  it('refuses a download over its ceiling', async () => {
    const big = scripted([{ status: 200, body: 'x'.repeat(100) }]);
    expect(await failureOf(big.client.download('https://assets.meshy.ai/m.glb', 50))).toBe(
      'rejected',
    );
  });
});
