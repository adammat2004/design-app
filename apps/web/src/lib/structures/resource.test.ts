import { describe, expect, it, vi } from 'vitest';
import { absentResource, createResource } from './resource';

describe('createResource', () => {
  it('is null until the load settles, then holds the value and tells its subscribers once', async () => {
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((done) => (resolve = done)));
    const resource = createResource(load);
    const listener = vi.fn();
    resource.subscribe(listener);

    expect(resource.status()).toBe('idle');
    expect(load).not.toHaveBeenCalled();
    const first = resource.start();
    const second = resource.start();
    expect(load).toHaveBeenCalledTimes(1);
    expect(resource.status()).toBe('loading');
    expect(resource.get()).toBeNull();

    resolve('sky');
    await expect(first).resolves.toBe('sky');
    await expect(second).resolves.toBe('sky');
    expect(resource.get()).toBe('sky');
    expect(resource.status()).toBe('ready');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a failed load is a supported state: null, "failed", and no rejection escapes', async () => {
    const resource = createResource(() => Promise.reject(new Error('404')));
    await expect(resource.start()).resolves.toBeNull();
    expect(resource.get()).toBeNull();
    expect(resource.status()).toBe('failed');
  });

  it('an absent resource fetches nothing and reports failed', async () => {
    const resource = absentResource<string>();
    await expect(resource.start()).resolves.toBeNull();
    expect(resource.status()).toBe('failed');
  });
});
