/**
 * PatternIndex — fetches and caches the OBN pattern index from obn.wiki
 */

export interface PatternEntry {
  title: string;
  category: string;
  categoryLabel: string;
  slug: string;
  status: string;
  openclawVersion: string;
  description: string;
  problemStatement: string;
  url: string;
}

export class PatternIndex {
  private indexUrl: string;
  private cache: PatternEntry[] | null = null;
  private cacheTime = 0;
  private cacheTtl = 24 * 60 * 60 * 1000; // 24 hours

  constructor(indexUrl: string) {
    this.indexUrl = indexUrl;
  }

  async fetch(): Promise<PatternEntry[]> {
    const now = Date.now();
    if (this.cache && now - this.cacheTime < this.cacheTtl) {
      return this.cache;
    }

    const response = await fetch(this.indexUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch pattern index: ${response.status}`);
    }

    this.cache = await response.json() as PatternEntry[];
    this.cacheTime = now;
    return this.cache;
  }

  /** Filter patterns compatible with a given OpenClaw version */
  filterByVersion(patterns: PatternEntry[], version: string): PatternEntry[] {
    return patterns.filter((p) => {
      if (!p.openclawVersion || p.openclawVersion === '0.40+') return true;
      return this.isVersionCompatible(version, p.openclawVersion);
    });
  }

  private isVersionCompatible(installed: string, required: string): boolean {
    // Parse "2026.2.12" and "2026.2.12+" format
    const clean = required.replace('+', '');
    const installedParts = installed.split('.').map(Number);
    const requiredParts = clean.split('.').map(Number);

    for (let i = 0; i < Math.max(installedParts.length, requiredParts.length); i++) {
      const a = installedParts[i] || 0;
      const b = requiredParts[i] || 0;
      if (a > b) return true;
      if (a < b) return false;
    }
    return true; // Equal
  }
}
