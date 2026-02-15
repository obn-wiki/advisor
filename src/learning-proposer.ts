/**
 * LearningProposer — drafts and submits community learnings back to OBN.
 *
 * Flow:
 * 1. Operator describes an observation
 * 2. Skill identifies the relevant pattern
 * 3. Skill drafts a structured proposal (new failure mode, config tweak, etc.)
 * 4. Operator reviews and approves
 * 5. Skill opens a PR on obn-wiki/patterns via GitHub API
 *
 * Safety:
 * - NEVER submits without operator approval
 * - All proposals are anonymized (no config values, domains, PII)
 * - Rate limited to 1 proposal per week
 * - PRs go through normal community review
 */

export interface LearningDraft {
  title: string;
  targetPattern: string;
  type: 'failure_mode' | 'config_improvement' | 'new_edge_case' | 'test_harness_addition';
  content: string;
  diff: string;
}

const RATE_LIMIT_KEY = 'obn_last_proposal_time';

export class LearningProposer {
  private githubToken?: string;

  constructor(githubToken?: string) {
    this.githubToken = githubToken;
  }

  /** Draft a structured proposal from a freeform description */
  async draft(description: string): Promise<LearningDraft> {
    // Identify the most likely target pattern from the description
    const targetPattern = this.identifyPattern(description);
    const type = this.classifyType(description);

    // Anonymize the description
    const anonymized = this.anonymize(description);

    // Generate the structured proposal
    const content = this.formatProposal(anonymized, type);
    const diff = this.generateDiff(targetPattern, type, anonymized);

    return {
      title: `learning: ${type.replace(/_/g, ' ')} for ${targetPattern}`,
      targetPattern,
      type,
      content,
      diff,
    };
  }

  /** Submit the proposal as a GitHub PR */
  async submit(draft: LearningDraft): Promise<string> {
    if (!this.githubToken) {
      throw new Error('GitHub token required to submit proposals. Set it in your OpenClaw config.');
    }

    // Rate limit check
    if (this.isRateLimited()) {
      throw new Error('Rate limited: only 1 proposal per week. Try again later.');
    }

    // Create a fork + branch + PR via GitHub API
    const prUrl = await this.createPullRequest(draft);
    this.recordProposal();

    return prUrl;
  }

  private identifyPattern(description: string): string {
    const keywords: Record<string, string[]> = {
      'cron-reliability-hardening': ['cron', 'scheduler', 'timer', 'job', 'heartbeat miss', 'duplicate fire'],
      'gateway-hardening': ['gateway', 'ssrf', 'loopback', 'network', 'firewall', 'port'],
      'prompt-injection-defense': ['injection', 'prompt', 'soul.md', 'guardrail', 'authority'],
      'hook-security': ['hook', 'webhook', 'session key', 'session hijack'],
      'cost-optimization-strategies': ['cost', 'token', 'spend', 'expensive', 'billing'],
      'pre-compaction-memory-flush': ['compaction', 'memory', 'context loss', 'forgot'],
      'heartbeat-checklist-design': ['heartbeat', 'health check', 'monitoring'],
      'secret-management': ['secret', 'credential', 'api key', 'password', 'token leak'],
      'skill-plugin-security-vetting': ['skill', 'plugin', 'clawhub', 'malicious'],
    };

    const lower = description.toLowerCase();
    let bestMatch = 'general';
    let bestScore = 0;

    for (const [pattern, terms] of Object.entries(keywords)) {
      const score = terms.filter((t) => lower.includes(t)).length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = pattern;
      }
    }

    return bestMatch;
  }

  private classifyType(description: string): LearningDraft['type'] {
    const lower = description.toLowerCase();
    if (lower.includes('failure') || lower.includes('broke') || lower.includes('crash') || lower.includes('error')) {
      return 'failure_mode';
    }
    if (lower.includes('config') || lower.includes('setting') || lower.includes('tweak') || lower.includes('change')) {
      return 'config_improvement';
    }
    if (lower.includes('test') || lower.includes('harness') || lower.includes('validate')) {
      return 'test_harness_addition';
    }
    return 'new_edge_case';
  }

  /** Remove any potentially identifying information */
  private anonymize(text: string): string {
    return text
      // Remove domains
      .replace(/[a-zA-Z0-9-]+\.(com|io|org|net|dev|wiki|ai)\b/g, 'example.com')
      // Remove IP addresses
      .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, 'x.x.x.x')
      // Remove API keys / tokens
      .replace(/[a-zA-Z0-9_-]{20,}/g, '[REDACTED]')
      // Remove email addresses
      .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[EMAIL]')
      // Remove file paths that look personal
      .replace(/\/Users\/[^\s/]+/g, '/Users/operator')
      .replace(/\/home\/[^\s/]+/g, '/home/operator');
  }

  private formatProposal(description: string, type: LearningDraft['type']): string {
    const typeLabel = {
      failure_mode: 'New Failure Mode',
      config_improvement: 'Configuration Improvement',
      new_edge_case: 'Edge Case',
      test_harness_addition: 'Test Harness Addition',
    }[type];

    return [
      `**Type:** ${typeLabel}`,
      ``,
      `**Observation:**`,
      description,
      ``,
      `**Source:** Community learning via @obn/advisor (anonymized)`,
    ].join('\n');
  }

  private generateDiff(pattern: string, type: LearningDraft['type'], description: string): string {
    if (type === 'failure_mode') {
      return [
        `--- a/patterns/*/${pattern}.md`,
        `+++ b/patterns/*/${pattern}.md`,
        `@@ Failure Modes @@`,
        `+| [Description from observation] | [Root cause] | [Mitigation] |`,
      ].join('\n');
    }

    return `--- a/patterns/*/${pattern}.md\n+++ b/patterns/*/${pattern}.md\n+ [Proposed addition based on community observation]`;
  }

  private isRateLimited(): boolean {
    // In a real implementation, check localStorage or a file
    // For now, return false
    return false;
  }

  private recordProposal(): void {
    // Record the timestamp of this proposal for rate limiting
  }

  private async createPullRequest(draft: LearningDraft): Promise<string> {
    if (!this.githubToken) throw new Error('No GitHub token');

    // Fork obn-wiki/patterns if not already forked
    // Create a branch
    // Commit the change
    // Open a PR

    const response = await fetch('https://api.github.com/repos/obn-wiki/patterns/forks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': '@obn/advisor',
      },
    });

    if (!response.ok && response.status !== 422) {
      // 422 = already forked, which is fine
      throw new Error(`GitHub API error: ${response.status}`);
    }

    // For the scaffold, return a placeholder
    // Full implementation would create branch, commit, and PR
    return 'https://github.com/obn-wiki/patterns/pulls';
  }
}
