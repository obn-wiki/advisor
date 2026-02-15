/**
 * ConfigScanner — reads openclaw.json and detects which patterns are applied,
 * which are missing, and what config changes are recommended.
 */

import { readFile } from 'node:fs/promises';
import type { PatternEntry } from './pattern-index.js';

export interface ConfigUpdate {
  patternTitle: string;
  patternSlug: string;
  reason: string;
  configDiff: string;
}

interface AppliedPattern {
  title: string;
  slug: string;
  detectedVia: string;
}

export class ConfigScanner {
  private configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  async load(): Promise<Record<string, unknown>> {
    try {
      const content = await readFile(this.configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /** Detect which OBN patterns are reflected in the current config */
  detectAppliedPatterns(
    config: Record<string, unknown>,
    patterns: PatternEntry[],
  ): AppliedPattern[] {
    const applied: AppliedPattern[] = [];

    // Detection rules — map config keys to patterns
    const detectionRules: Array<{
      check: (config: Record<string, unknown>) => boolean;
      patternSlug: string;
      detectedVia: string;
    }> = [
      {
        check: (c) => this.hasNestedKey(c, 'gateway.host') && this.getNestedValue(c, 'gateway.host') !== '0.0.0.0',
        patternSlug: 'gateway-hardening',
        detectedVia: 'gateway.host is not 0.0.0.0',
      },
      {
        check: (c) => this.hasNestedKey(c, 'gateway.files.urlAllowlist'),
        patternSlug: 'ssrf-defense',
        detectedVia: 'gateway.files.urlAllowlist configured',
      },
      {
        check: (c) => this.hasNestedKey(c, 'hooks.allowRequestSessionKey') &&
          this.getNestedValue(c, 'hooks.allowRequestSessionKey') === false,
        patternSlug: 'hook-security',
        detectedVia: 'hooks.allowRequestSessionKey is false',
      },
      {
        check: (c) => {
          const jobs = this.getNestedValue(c, 'cron.jobs') as Record<string, unknown> | undefined;
          if (!jobs) return false;
          return Object.values(jobs).some((j: any) => j.isolated === true);
        },
        patternSlug: 'cron-reliability-hardening',
        detectedVia: 'cron jobs have isolated: true',
      },
      {
        check: (c) => this.hasNestedKey(c, 'agents.defaults.guardrails.enabled') &&
          this.getNestedValue(c, 'agents.defaults.guardrails.enabled') === true,
        patternSlug: 'native-guardrails-integration',
        detectedVia: 'agents.defaults.guardrails.enabled is true',
      },
    ];

    for (const rule of detectionRules) {
      if (rule.check(config)) {
        const pattern = patterns.find((p) => p.slug === rule.patternSlug);
        if (pattern) {
          applied.push({
            title: pattern.title,
            slug: rule.patternSlug,
            detectedVia: rule.detectedVia,
          });
        }
      }
    }

    return applied;
  }

  /** Find patterns that should be applied but aren't */
  findAvailableUpdates(
    config: Record<string, unknown>,
    patterns: PatternEntry[],
    version: string,
  ): ConfigUpdate[] {
    const updates: ConfigUpdate[] = [];

    // Check: SSRF defense (v2026.2.12+)
    if (this.isVersionAtLeast(version, '2026.2.12') && !this.hasNestedKey(config, 'gateway.files.urlAllowlist')) {
      updates.push({
        patternTitle: 'SSRF Defense',
        patternSlug: 'ssrf-defense',
        reason: 'v2026.2.12 adds SSRF deny policy — you should configure urlAllowlist',
        configDiff: `+ "gateway": {
+   "files": {
+     "urlAllowlist": ["your-cdn.example.com"]
+   },
+   "images": {
+     "urlAllowlist": ["i.imgur.com"]
+   }
+ }`,
      });
    }

    // Check: Hook security (v2026.2.12+)
    if (this.isVersionAtLeast(version, '2026.2.12') &&
        this.hasNestedKey(config, 'hooks') &&
        !this.hasNestedKey(config, 'hooks.defaultSessionKey')) {
      updates.push({
        patternTitle: 'Hook Security',
        patternSlug: 'hook-security',
        reason: 'v2026.2.12 rejects sessionKey overrides by default — configure defaultSessionKey',
        configDiff: `+ "hooks": {
+   "defaultSessionKey": "hooks:incoming",
+   "allowedSessionKeyPrefixes": ["hook:"],
+   "allowRequestSessionKey": false
+ }`,
      });
    }

    // Check: Cron isolation
    const jobs = this.getNestedValue(config, 'cron.jobs') as Record<string, any> | undefined;
    if (jobs) {
      const nonIsolated = Object.entries(jobs).filter(([, j]) => j.isolated !== true);
      if (nonIsolated.length > 0) {
        updates.push({
          patternTitle: 'Cron Reliability Hardening',
          patternSlug: 'cron-reliability-hardening',
          reason: `${nonIsolated.length} cron job(s) missing isolated: true — errors can cascade`,
          configDiff: nonIsolated.map(([name]) =>
            `  "${name}": {\n+   "isolated": true\n  }`
          ).join('\n'),
        });
      }
    }

    // Check: Gateway binding
    if (this.getNestedValue(config, 'gateway.host') === '0.0.0.0') {
      updates.push({
        patternTitle: 'Gateway Hardening',
        patternSlug: 'gateway-hardening',
        reason: 'Gateway is bound to 0.0.0.0 (all interfaces) — should be 127.0.0.1 or Tailscale IP',
        configDiff: `- "gateway": { "host": "0.0.0.0" }
+ "gateway": { "host": "127.0.0.1" }`,
      });
    }

    return updates;
  }

  private hasNestedKey(obj: Record<string, unknown>, path: string): boolean {
    const keys = path.split('.');
    let current: unknown = obj;
    for (const key of keys) {
      if (current === null || current === undefined || typeof current !== 'object') return false;
      current = (current as Record<string, unknown>)[key];
    }
    return current !== undefined;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.');
    let current: unknown = obj;
    for (const key of keys) {
      if (current === null || current === undefined || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }

  private isVersionAtLeast(installed: string, required: string): boolean {
    const a = installed.split('.').map(Number);
    const b = required.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) > (b[i] || 0)) return true;
      if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return true;
  }
}
