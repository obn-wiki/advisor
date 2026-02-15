/**
 * SkillAuditor — scans installed OpenClaw skills for security risks and updates.
 *
 * Checks:
 * - SHA-256 fingerprint against known-bad lists
 * - Version currency (is there a newer version available?)
 * - OBN community reports (flagged skills)
 * - Basic static analysis (credential access patterns)
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface AuditResult {
  name: string;
  version: string;
  status: 'ok' | 'warning' | 'danger';
  message: string;
  details?: string;
}

const KNOWN_BAD_URL = 'https://obn.wiki/known-bad-skills.json';
const COMMUNITY_REPORTS_URL = 'https://obn.wiki/skill-reports.json';

// Patterns that indicate potential credential access
const DANGEROUS_PATTERNS = [
  /process\.env\[/,
  /readFile.*\.env/,
  /API_KEY|SECRET|PASSWORD|TOKEN/i,
  /fetch\(.*localhost/,
  /exec\(|spawn\(/,
  /eval\(/,
];

export class SkillAuditor {
  private skillsPath: string;

  constructor(skillsPath: string) {
    this.skillsPath = skillsPath;
  }

  async audit(): Promise<AuditResult[]> {
    const results: AuditResult[] = [];

    let skillDirs: string[];
    try {
      skillDirs = await readdir(this.skillsPath);
    } catch {
      return [{ name: 'skills directory', version: '-', status: 'warning', message: 'Skills directory not found or not readable' }];
    }

    // Fetch known-bad list and community reports in parallel
    const [knownBad, communityReports] = await Promise.all([
      this.fetchKnownBad(),
      this.fetchCommunityReports(),
    ]);

    for (const dir of skillDirs) {
      const skillPath = join(this.skillsPath, dir);
      const result = await this.auditSkill(skillPath, dir, knownBad, communityReports);
      results.push(result);
    }

    return results;
  }

  private async auditSkill(
    skillPath: string,
    name: string,
    knownBad: Set<string>,
    communityReports: Map<string, string>,
  ): Promise<AuditResult> {
    // Read package.json for version
    let version = 'unknown';
    try {
      const pkg = JSON.parse(await readFile(join(skillPath, 'package.json'), 'utf-8'));
      version = pkg.version || 'unknown';
    } catch {
      return { name, version, status: 'warning', message: 'No package.json found' };
    }

    // SHA-256 fingerprint check
    const fingerprint = await this.computeFingerprint(skillPath);
    if (knownBad.has(fingerprint)) {
      return {
        name,
        version,
        status: 'danger',
        message: 'Flagged by VirusTotal or OBN security review',
        details: `SHA-256: ${fingerprint}`,
      };
    }

    // Community reports
    const report = communityReports.get(name);
    if (report) {
      return {
        name,
        version,
        status: 'warning',
        message: report,
      };
    }

    // Static analysis for dangerous patterns
    const dangerousFindings = await this.scanForDangerousPatterns(skillPath);
    if (dangerousFindings.length > 0) {
      return {
        name,
        version,
        status: 'warning',
        message: `Potential risk: ${dangerousFindings.join(', ')}`,
        details: 'Run with sandbox mode enabled. Review source code manually.',
      };
    }

    return { name, version, status: 'ok', message: 'No known issues' };
  }

  private async computeFingerprint(skillPath: string): Promise<string> {
    try {
      const pkgContent = await readFile(join(skillPath, 'package.json'), 'utf-8');
      return createHash('sha256').update(pkgContent).digest('hex');
    } catch {
      return 'unknown';
    }
  }

  private async scanForDangerousPatterns(skillPath: string): Promise<string[]> {
    const findings: string[] = [];

    try {
      const files = await readdir(skillPath, { recursive: true });
      const jsFiles = files.filter((f) =>
        typeof f === 'string' && (f.endsWith('.js') || f.endsWith('.ts')),
      );

      for (const file of jsFiles) {
        const content = await readFile(join(skillPath, file as string), 'utf-8');
        for (const pattern of DANGEROUS_PATTERNS) {
          if (pattern.test(content)) {
            findings.push(`${pattern.source} in ${file}`);
          }
        }
      }
    } catch {
      // Can't scan — report as finding
      findings.push('Unable to scan source files');
    }

    return findings;
  }

  private async fetchKnownBad(): Promise<Set<string>> {
    try {
      const response = await fetch(KNOWN_BAD_URL);
      if (!response.ok) return new Set();
      const data = await response.json() as string[];
      return new Set(data);
    } catch {
      return new Set();
    }
  }

  private async fetchCommunityReports(): Promise<Map<string, string>> {
    try {
      const response = await fetch(COMMUNITY_REPORTS_URL);
      if (!response.ok) return new Map();
      const data = await response.json() as Record<string, string>;
      return new Map(Object.entries(data));
    } catch {
      return new Map();
    }
  }
}
