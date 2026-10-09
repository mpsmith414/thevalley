import { afterEach, describe, expect, it, vi } from 'vitest';
import { VALLEY } from '../../src/valley/layout';

/** A stand-in Worker: records what is posted and lets the test fire its events. */
class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: unknown[] = [];
  constructor() { FakeWorker.last = this; }
  postMessage(m: unknown) { this.posted.push(m); }
  terminate() {}
}

describe('ValleyClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects pending requests when a reply cannot be read (messageerror)', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { ValleyClient } = await import('../../src/valley/client');
    const client = new ValleyClient();
    const a = client.generate(VALLEY, 257), b = client.generate(VALLEY, 257);
    FakeWorker.last.onmessageerror!();
    await expect(a).rejects.toThrow(/could not be read/);
    await expect(b).rejects.toThrow(/could not be read/);
  });

  it('rejects pending requests when the worker fails', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { ValleyClient } = await import('../../src/valley/client');
    const client = new ValleyClient();
    const a = client.generate(VALLEY, 257);
    FakeWorker.last.onerror!({ message: 'boom' });
    await expect(a).rejects.toThrow('boom');
  });
});
