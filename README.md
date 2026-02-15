# @obn/advisor

**The OBN Advisor skill for OpenClaw.** Keeps your agent updated with vetted production patterns, audits installed skills, and proposes learnings back to the community.

## Install

```bash
openclaw skills install @obn/advisor
```

## Commands

| Command | What it does |
|---------|-------------|
| `@obn status` | Scan your config, check version, show what's applicable |
| `@obn update` | Propose config changes with diffs |
| `@obn skills audit` | Scan installed skills for risks and updates |
| `@obn report` | Pattern performance metrics (last 7 days) |
| `@obn propose` | Submit a learning back to OBN (with your approval) |

## How it works

**Consume** — Fetches the OBN pattern index from obn.wiki. Compares against your OpenClaw version and config. Recommends what to apply or update.

**Observe** — Tracks how patterns perform: heartbeat reliability, token spend, security events, context health, cron stability.

**Propose** — When you discover something noteworthy (new failure mode, config tweak, edge case), the skill drafts a structured proposal. You review and approve. It opens a PR on obn-wiki/patterns.

## Privacy

- **No telemetry.** Runs locally. No data sent anywhere.
- **No API keys needed.** Fetches the public pattern index.
- **Proposals are opt-in and anonymized.** You review every proposal. Config values, domains, and PII are stripped.
- **Open source.** Audit the code yourself.

## Requirements

- OpenClaw v2026.2.6+
- Internet access (to fetch pattern index)
- GitHub account (only for proposals)

## Contributing

PRs welcome. See [obn.wiki/contributing](https://obn.wiki/contributing/) for guidelines.

## License

Apache 2.0
