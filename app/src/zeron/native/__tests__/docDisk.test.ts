import {
  DocDisk,
  chatDocPath,
  queuedLocalPath,
  registryPath,
  type DocDiskFs,
} from '../docDisk';

class MemoryFs implements DocDiskFs {
  files = new Map<string, string>();
  writes: string[] = [];
  async readText(path: string) {
    return this.files.get(path);
  }
  async writeText(path: string, contents: string) {
    this.writes.push(path);
    this.files.set(path, contents);
  }
  async move(from: string, to: string) {
    const c = this.files.get(from);
    if (c === undefined) throw new Error('no temp file');
    this.files.delete(from);
    this.files.set(to, c);
  }
  async delete(path: string) {
    for (const k of [...this.files.keys()]) {
      if (k === path || k.startsWith(`${path}/`)) this.files.delete(k);
    }
  }
}

describe('docDisk', () => {
  it('lays out account-scoped paths', () => {
    expect(chatDocPath('/docs', 'org1', 'alice', 'chat9')).toContain(
      'zeron/org1/alice/chats/chat9.chat2',
    );
    expect(registryPath('/docs', 'org1', 'alice')).toContain(
      'zeron/org1/alice/registry.json',
    );
  });

  it('round-trips a chat2 snapshot+cursor atomically', async () => {
    const fs = new MemoryFs();
    const disk = new DocDisk(fs, '/docs');
    await disk.saveChat2('org1', 'alice', 'c1', {
      snapshot: 'AAAA',
      cursor: 41,
    });
    // Temp file was written then moved — no .tmp remains.
    expect(fs.writes[0]).toMatch(/\.tmp$/);
    expect([...fs.files.keys()].some(k => k.endsWith('.tmp'))).toBe(false);
    const loaded = await disk.loadChat2('org1', 'alice', 'c1');
    expect(loaded).toEqual({ snapshot: 'AAAA', cursor: 41 });
  });

  it('returns undefined for missing/corrupt payloads', async () => {
    const fs = new MemoryFs();
    const disk = new DocDisk(fs, '/docs');
    expect(await disk.loadChat2('org1', 'alice', 'nope')).toBeUndefined();
    fs.files.set(chatDocPath('/docs', 'org1', 'alice', 'bad'), '{not json');
    expect(await disk.loadChat2('org1', 'alice', 'bad')).toBeUndefined();
  });

  it('saves/loads/clears the registry blob per account', async () => {
    const fs = new MemoryFs();
    const disk = new DocDisk(fs, '/docs');
    await disk.saveRegistry('org1', 'alice', '{"v":1}');
    expect(await disk.loadRegistry('org1', 'alice')).toBe('{"v":1}');
    expect(await disk.loadRegistry('org2', 'alice')).toBeUndefined();
    await disk.saveChat2('org1', 'alice', 'c1', { snapshot: 'x', cursor: 0 });
    await disk.clearAccount('org1', 'alice');
    expect(await disk.loadRegistry('org1', 'alice')).toBeUndefined();
    expect(await disk.loadChat2('org1', 'alice', 'c1')).toBeUndefined();
  });

  it('round-trips queuedLocal.json per account', async () => {
    const fs = new MemoryFs();
    const disk = new DocDisk(fs, '/docs');
    await disk.saveQueuedLocal('org1', 'alice', {
      c1: [{ id: 'q1', text: 'hi' }],
    });
    expect(queuedLocalPath('/docs', 'org1', 'alice')).toContain(
      'zeron/org1/alice/queuedLocal.json',
    );
    expect(await disk.loadQueuedLocal('org1', 'alice')).toEqual({
      c1: [{ id: 'q1', text: 'hi' }],
    });
    await disk.clearAccount('org1', 'alice');
    expect(await disk.loadQueuedLocal('org1', 'alice')).toBeUndefined();
  });
});
