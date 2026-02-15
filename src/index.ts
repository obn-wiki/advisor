/**
 * @obn/advisor — OBN Advisor Skill for OpenClaw
 *
 * Keeps your agent updated with vetted production patterns,
 * audits installed skills, and proposes learnings back to the community.
 *
 * Commands:
 *   @obn status   — show version, applied patterns, available updates
 *   @obn update   — propose config changes from new patterns
 *   @obn skills audit — scan installed skills for risks and updates
 *   @obn report   — performance metrics for applied patterns
 *   @obn propose  — draft a community learning from production observations
 */

import { PatternIndex } from './pattern-index.js';
import { ConfigScanner } from './config-scanner.js';
import { SkillAuditor } from './skill-auditor.js';
import { PerformanceTracker } from './performance-tracker.js';
import { LearningProposer } from './learning-proposer.js';

export interface ObnContext {
  /** OpenClaw version string (e.g., "2026.2.12") */
  openclawVersion: string;
  /** Path to openclaw.json config */
  configPath: string;
  /** Path to skills directory */
  skillsPath: string;
  /** GitHub token (optional, for proposals) */
  githubToken?: string;
}

export interface ObnResult {
  message: string;
  actions?: Array<{
    type: 'update_config' | 'install_skill' | 'remove_skill' | 'submit_pr';
    description: string;
    diff?: string;
    requiresApproval: true;
  }>;
}

const PATTERN_INDEX_URL = 'https://obn.wiki/pattern-index.json';

export async function handleCommand(
  command: string,
  args: string[],
  context: ObnContext,
): Promise<ObnResult> {
  const subcommand = args[0] || 'status';

  switch (subcommand) {
    case 'status':
      return handleStatus(context);
    case 'update':
      return handleUpdate(context);
    case 'skills':
      if (args[1] === 'audit') return handleSkillsAudit(context);
      return { message: 'Usage: @obn skills audit' };
    case 'report':
      return handleReport(context);
    case 'propose':
      return handlePropose(context, args.slice(1).join(' '));
    default:
      return {
        message: [
          '**@obn/advisor commands:**',
          '- `@obn status` — version, patterns, updates available',
          '- `@obn update` — propose config changes',
          '- `@obn skills audit` — scan installed skills for risks',
          '- `@obn report` — pattern performance metrics',
          '- `@obn propose` — submit a learning to OBN',
        ].join('\n'),
      };
  }
}

async function handleStatus(context: ObnContext): Promise<ObnResult> {
  const index = new PatternIndex(PATTERN_INDEX_URL);
  const patterns = await index.fetch();

  const scanner = new ConfigScanner(context.configPath);
  const config = await scanner.load();
  const applied = scanner.detectAppliedPatterns(config, patterns);
  const updates = scanner.findAvailableUpdates(config, patterns, context.openclawVersion);

  const total = patterns.length;
  const appliedCount = applied.length;
  const updateCount = updates.length;

  let message = [
    `**OBN Status**`,
    ``,
    `OpenClaw version: v${context.openclawVersion}`,
    `Patterns applied: ${appliedCount} of ${total}`,
  ].join('\n');

  if (updateCount > 0) {
    message += `\nUpdates available: ${updateCount}\n`;
    for (const update of updates) {
      message += `  - **${update.patternTitle}**: ${update.reason}\n`;
    }
    message += `\nRun \`@obn update\` to see proposed changes.`;
  } else {
    message += `\n✅ All applicable patterns are up to date.`;
  }

  return { message };
}

async function handleUpdate(context: ObnContext): Promise<ObnResult> {
  const index = new PatternIndex(PATTERN_INDEX_URL);
  const patterns = await index.fetch();

  const scanner = new ConfigScanner(context.configPath);
  const config = await scanner.load();
  const updates = scanner.findAvailableUpdates(config, patterns, context.openclawVersion);

  if (updates.length === 0) {
    return { message: '✅ No updates available. Your config matches all applicable patterns.' };
  }

  const actions = updates.map((update) => ({
    type: 'update_config' as const,
    description: `${update.patternTitle}: ${update.reason}`,
    diff: update.configDiff,
    requiresApproval: true as const,
  }));

  return {
    message: `**${updates.length} update(s) available:**\n\n` +
      updates.map((u) => `### ${u.patternTitle}\n${u.reason}\n\`\`\`diff\n${u.configDiff}\n\`\`\``).join('\n\n'),
    actions,
  };
}

async function handleSkillsAudit(context: ObnContext): Promise<ObnResult> {
  const auditor = new SkillAuditor(context.skillsPath);
  const results = await auditor.audit();

  const lines = [`**Installed skills: ${results.length}**\n`];

  for (const result of results) {
    const icon = result.status === 'ok' ? '✅' :
                 result.status === 'warning' ? '⚠️' : '❌';
    lines.push(`${icon} **${result.name}** v${result.version} — ${result.message}`);
  }

  const risky = results.filter((r) => r.status === 'danger');
  const outdated = results.filter((r) => r.status === 'warning');

  if (risky.length > 0) {
    lines.push(`\n**⚠️ ${risky.length} skill(s) flagged as dangerous.** Remove or replace immediately.`);
  }
  if (outdated.length > 0) {
    lines.push(`\n**${outdated.length} skill(s) have updates available.** Run \`openclaw skills update <name>\` to update.`);
  }

  const actions = risky.map((r) => ({
    type: 'remove_skill' as const,
    description: `Remove ${r.name}: ${r.message}`,
    requiresApproval: true as const,
  }));

  return { message: lines.join('\n'), actions: actions.length > 0 ? actions : undefined };
}

async function handleReport(context: ObnContext): Promise<ObnResult> {
  const tracker = new PerformanceTracker(context.configPath);
  const metrics = await tracker.collect();

  const message = [
    `**OBN Performance Report — Last 7 days**\n`,
    `Heartbeat: ${metrics.heartbeatReliability}% reliability (${metrics.heartbeatRuns}/${metrics.heartbeatExpected} runs)`,
    `Token spend: $${metrics.dailyTokenSpend.toFixed(2)}/day avg`,
    `Security: ${metrics.blockedInjections} injection attempts blocked`,
    `Context: ${metrics.compactions} compactions, ${metrics.contextLosses} critical state losses`,
    `Cron: ${metrics.cronSkips} skipped jobs, ${metrics.cronDuplicates} duplicate fires`,
  ].join('\n');

  return { message };
}

async function handlePropose(context: ObnContext, description: string): Promise<ObnResult> {
  if (!description) {
    return {
      message: [
        '**How to propose a learning:**',
        '',
        'Describe what you observed:',
        '`@obn propose After applying cron reliability, first run after restart still uses wrong model`',
        '',
        'The skill will draft a structured proposal for your review before submitting.',
      ].join('\n'),
    };
  }

  const proposer = new LearningProposer(context.githubToken);
  const draft = await proposer.draft(description);

  return {
    message: [
      `**Draft Proposal:**\n`,
      `Pattern: ${draft.targetPattern}`,
      `Type: ${draft.type}`,
      ``,
      draft.content,
      ``,
      `Submit this as a PR to obn-wiki/patterns?`,
    ].join('\n'),
    actions: [{
      type: 'submit_pr',
      description: `Submit learning to OBN: ${draft.title}`,
      diff: draft.diff,
      requiresApproval: true,
    }],
  };
}
