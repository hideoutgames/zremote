// Stage-3 E2E report: per-step pass/fail + timings + JSON snapshots, written
// to .e2e/report.md even when the run aborts on the first failure.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface StepRecord {
  name: string;
  pass: boolean;
  ms: number;
  detail: string;
}

export class Report {
  private steps: StepRecord[] = [];
  private sections: { title: string; body: string }[] = [];
  private fixes: string[] = [];
  readonly startedAt = new Date();

  get failed(): boolean {
    return this.steps.some(s => !s.pass);
  }

  record(name: string, pass: boolean, ms: number, detail: string): void {
    this.steps.push({ name, pass, ms, detail });
    const mark = pass ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${name} (${ms}ms) — ${detail.split('\n')[0]}`);
  }

  section(title: string, body: unknown): void {
    this.sections.push({
      title,
      body: typeof body === 'string' ? body : JSON.stringify(body, null, 2),
    });
  }

  noteFix(fix: string): void {
    this.fixes.push(fix);
  }

  /** Run one scenario step: time it, record pass/fail, rethrow on failure
   * so the orchestrator stops at the first failure. */
  async step(name: string, fn: () => Promise<string>): Promise<void> {
    const t0 = Date.now();
    try {
      const detail = await fn();
      this.record(name, true, Date.now() - t0, detail);
    } catch (e) {
      this.record(name, false, Date.now() - t0, String(e));
      throw e;
    }
  }

  write(path: string, logTails: { label: string; tail: string }[]): void {
    const lines: string[] = [];
    lines.push(`# Zeron Windows E2E report`);
    lines.push('');
    lines.push(`Started: ${this.startedAt.toISOString()}`);
    lines.push(`Finished: ${new Date().toISOString()}`);
    lines.push('');
    const passed = this.steps.filter(s => s.pass).length;
    lines.push(
      `## Summary: ${passed}/${this.steps.length} steps passed` +
        (passed === this.steps.length ? '' : ' (stopped on first failure)'),
    );
    lines.push('');
    lines.push('| Step | Result | ms | Detail |');
    lines.push('|---|---|---|---|');
    for (const s of this.steps) {
      lines.push(
        `| ${s.name} | ${s.pass ? 'PASS' : 'FAIL'} | ${s.ms} | ${s.detail
          .replaceAll('|', '\\|')
          .replaceAll('\n', '<br>')} |`,
      );
    }
    if (this.fixes.length > 0) {
      lines.push('', '## Transport/document fixes made during the run', '');
      for (const f of this.fixes) lines.push(`- ${f}`);
    }
    for (const sec of this.sections) {
      lines.push('', `## ${sec.title}`, '', '```json', sec.body, '```');
    }
    for (const t of logTails) {
      lines.push('', `## Log tail: ${t.label}`, '', '```', t.tail, '```');
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, lines.join('\n'));
  }
}
