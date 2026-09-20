import { FakeClock } from '../../transport/clock';
import { flush } from '../../testing/memDisk';
import { PROJECT_COALESCE_MS, ProjectCoalesce } from '../projectCoalesce';

describe('ProjectCoalesce', () => {
  it('collapses same-tick schedules into one run after flush()', async () => {
    const clock = new FakeClock(1_000);
    let n = 0;
    const c = new ProjectCoalesce(clock, () => {
      n += 1;
    });
    c.schedule();
    c.schedule();
    c.schedule();
    expect(n).toBe(0);
    await flush();
    expect(n).toBe(1);
    c.dispose();
  });

  it('flush runs immediately so callers can read the store', () => {
    const clock = new FakeClock(1_000);
    let n = 0;
    const c = new ProjectCoalesce(clock, () => {
      n += 1;
    });
    c.flush();
    expect(n).toBe(1);
    c.dispose();
  });

  it('a later schedule inside the quiet window waits for the timer', async () => {
    const clock = new FakeClock(1_000);
    let n = 0;
    const c = new ProjectCoalesce(clock, () => {
      n += 1;
    });
    c.schedule();
    await flush();
    expect(n).toBe(1);
    c.schedule();
    await flush();
    expect(n).toBe(1);
    clock.advance(PROJECT_COALESCE_MS);
    expect(n).toBe(2);
    c.dispose();
  });
});
