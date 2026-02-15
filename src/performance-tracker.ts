/**
 * PerformanceTracker — collects metrics on how applied patterns are performing.
 *
 * Reads from OpenClaw's logs and config to measure:
 * - Heartbeat reliability (cron)
 * - Token spend (cost)
 * - Security events (injections blocked)
 * - Context health (compaction losses)
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface PerformanceMetrics {
  /** Percentage of expected heartbeat runs that actually executed */
  heartbeatReliability: number;
  /** Number of heartbeat runs in the period */
  heartbeatRuns: number;
  /** Expected number of heartbeat runs based on schedule */
  heartbeatExpected: number;
  /** Average daily token spend in USD */
  dailyTokenSpend: number;
  /** Number of prompt injection attempts blocked */
  blockedInjections: number;
  /** Number of context compactions */
  compactions: number;
  /** Number of critical state losses after compaction */
  contextLosses: number;
  /** Number of skipped cron jobs */
  cronSkips: number;
  /** Number of duplicate cron fires */
  cronDuplicates: number;
}

export class PerformanceTracker {
  private configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  async collect(): Promise<PerformanceMetrics> {
    const logDir = join(dirname(this.configPath), 'logs');

    const [heartbeat, tokens, security, context, cron] = await Promise.all([
      this.collectHeartbeatMetrics(logDir),
      this.collectTokenMetrics(logDir),
      this.collectSecurityMetrics(logDir),
      this.collectContextMetrics(logDir),
      this.collectCronMetrics(logDir),
    ]);

    return {
      ...heartbeat,
      ...tokens,
      ...security,
      ...context,
      ...cron,
    };
  }

  private async collectHeartbeatMetrics(logDir: string): Promise<Pick<PerformanceMetrics, 'heartbeatReliability' | 'heartbeatRuns' | 'heartbeatExpected'>> {
    try {
      const logContent = await readFile(join(logDir, 'cron.log'), 'utf-8');
      const lines = logContent.split('\n').filter((l) => l.includes('heartbeat'));

      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentRuns = lines.filter((l) => {
        const match = l.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        if (!match) return false;
        return new Date(match[0]).getTime() > sevenDaysAgo;
      });

      // Assume 30-min interval = 336 expected runs per week
      const expected = 336;
      const runs = recentRuns.length;

      return {
        heartbeatRuns: runs,
        heartbeatExpected: expected,
        heartbeatReliability: Math.round((runs / expected) * 100),
      };
    } catch {
      return { heartbeatRuns: 0, heartbeatExpected: 0, heartbeatReliability: 0 };
    }
  }

  private async collectTokenMetrics(logDir: string): Promise<Pick<PerformanceMetrics, 'dailyTokenSpend'>> {
    try {
      const logContent = await readFile(join(logDir, 'usage.log'), 'utf-8');
      const lines = logContent.split('\n').filter((l) => l.includes('tokens'));

      // Parse token usage and estimate cost
      let totalTokens = 0;
      for (const line of lines.slice(-168)) { // Last 7 days worth
        const match = line.match(/tokens:\s*(\d+)/);
        if (match) totalTokens += parseInt(match[1], 10);
      }

      // Rough estimate: $0.25 per 1M input tokens (Haiku average)
      const estimatedCost = (totalTokens / 1_000_000) * 0.25;
      const dailyCost = estimatedCost / 7;

      return { dailyTokenSpend: dailyCost };
    } catch {
      return { dailyTokenSpend: 0 };
    }
  }

  private async collectSecurityMetrics(logDir: string): Promise<Pick<PerformanceMetrics, 'blockedInjections'>> {
    try {
      const logContent = await readFile(join(logDir, 'security.log'), 'utf-8');
      const blocked = logContent.split('\n').filter((l) =>
        l.includes('injection_blocked') || l.includes('guardrail_triggered'),
      );
      return { blockedInjections: blocked.length };
    } catch {
      return { blockedInjections: 0 };
    }
  }

  private async collectContextMetrics(logDir: string): Promise<Pick<PerformanceMetrics, 'compactions' | 'contextLosses'>> {
    try {
      const logContent = await readFile(join(logDir, 'agent.log'), 'utf-8');
      const compactions = logContent.split('\n').filter((l) => l.includes('compaction')).length;
      const losses = logContent.split('\n').filter((l) =>
        l.includes('context_loss') || l.includes('state_not_found'),
      ).length;
      return { compactions, contextLosses: losses };
    } catch {
      return { compactions: 0, contextLosses: 0 };
    }
  }

  private async collectCronMetrics(logDir: string): Promise<Pick<PerformanceMetrics, 'cronSkips' | 'cronDuplicates'>> {
    try {
      const logContent = await readFile(join(logDir, 'cron.log'), 'utf-8');
      const skips = logContent.split('\n').filter((l) => l.includes('job_skipped')).length;
      const duplicates = logContent.split('\n').filter((l) => l.includes('duplicate_fire')).length;
      return { cronSkips: skips, cronDuplicates: duplicates };
    } catch {
      return { cronSkips: 0, cronDuplicates: 0 };
    }
  }
}
