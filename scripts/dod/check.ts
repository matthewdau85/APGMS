#!/usr/bin/env ts-node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface Requirement {
  id: string;
  description: string;
  changed?: string[];
  anyChanged?: string[];
  evidence?: string[];
  optional?: boolean;
}

interface DoDConfig {
  id: string;
  name?: string;
  labels?: string[];
  requirements: Requirement[];
  source: string;
}

interface RequirementResult {
  config: DoDConfig;
  requirement: Requirement;
  failures: string[];
}

const repoRoot = process.cwd();
const patternCache = new Map<string, RegExp>();
let repoFileCache: string[] | null = null;

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((label) => label.trim())
    .filter(Boolean);
}

function readLabels(): string[] {
  const envOrder = ['DOD_LABELS', 'PR_LABELS', 'GITHUB_LABELS'];
  for (const key of envOrder) {
    const parsed = parseList(process.env[key]);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  const labelFile = process.env.DOD_LABEL_FILE || path.join(repoRoot, '.github', 'pr-labels.txt');
  if (fs.existsSync(labelFile)) {
    const contents = fs.readFileSync(labelFile, 'utf8');
    return parseList(contents);
  }

  return [];
}

function runGit(command: string): string | null {
  try {
    return execSync(command, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    return null;
  }
}

function globToRegExp(pattern: string): RegExp {
  let regex = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      const next = pattern[i + 1];
      if (next === '*') {
        const afterNext = pattern[i + 2];
        if (afterNext === '/') {
          regex += '(?:.*?/)?';
          i += 2;
        } else {
          regex += '.*';
          i += 1;
        }
      } else {
        regex += '[^/]*';
      }
    } else if (char === '?') {
      regex += '[^/]';
    } else if ('\\^$+?.()|{}[]'.includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  regex += '$';
  return new RegExp(regex);
}

function matchesPattern(pattern: string, value: string): boolean {
  if (!patternCache.has(pattern)) {
    patternCache.set(pattern, globToRegExp(pattern));
  }
  const regex = patternCache.get(pattern)!;
  return regex.test(value);
}

function collectRepoFiles(): string[] {
  if (repoFileCache) {
    return repoFileCache;
  }

  const ignore = new Set(['.git', 'node_modules']);
  const results: string[] = [];

  function walk(currentDir: string, prefix: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignore.has(entry.name)) {
        continue;
      }
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else {
        results.push(relative.replace(/\\/g, '/'));
      }
    }
  }

  walk(repoRoot, '');
  repoFileCache = results;
  return results;
}

function addPathToSet(target: Set<string>, relativePath: string) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized) {
    return;
  }

  if (normalized.endsWith('/')) {
    const dirPath = normalized.slice(0, -1);
    const absoluteDir = path.join(repoRoot, dirPath);
    if (!fs.existsSync(absoluteDir)) {
      return;
    }
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const childRelative = `${dirPath}/${entry.name}`;
      if (entry.isDirectory()) {
        addPathToSet(target, `${childRelative}/`);
      } else {
        target.add(childRelative.replace(/\\/g, '/'));
      }
    }
    return;
  }

  target.add(normalized);
}

function getChangedFiles(): string[] {
  const explicitRange = process.env.DOD_DIFF_RANGE;
  const diffFilter = '--diff-filter=ACMRTUXB';
  const baseRef = process.env.DOD_BASE_REF || process.env.GITHUB_BASE_REF || 'origin/main';
  let output: string | null = null;
  const changed = new Set<string>();

  if (explicitRange) {
    output = runGit(`git diff --name-only ${diffFilter} ${explicitRange}`);
  }

  if (!output) {
    const mergeBase = runGit(`git merge-base HEAD ${baseRef}`);
    if (mergeBase) {
      output = runGit(`git diff --name-only ${diffFilter} ${mergeBase}..HEAD`);
    }
  }

  if (!output) {
    output = runGit(`git diff --name-only ${diffFilter} HEAD`);
  }

  if (!output) {
    output = runGit('git diff --name-only');
  }

  if (output) {
    output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => addPathToSet(changed, line));
  }

  const status = runGit('git status --porcelain');
  if (status) {
    status
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const info = line.slice(0, 2);
        if (info === '??') {
          const file = line.slice(3).trim();
          if (file) {
            addPathToSet(changed, file);
          }
        } else {
          const arrowIndex = line.indexOf('->');
          const filePart = arrowIndex >= 0 ? line.slice(arrowIndex + 2) : line.slice(3);
          const file = filePart.trim();
          if (file) {
            addPathToSet(changed, file);
          }
        }
      });
  }

  return Array.from(changed);
}

function loadConfigFiles(): DoDConfig[] {
  const dodDir = path.join(repoRoot, 'docs', 'dod');
  if (!fs.existsSync(dodDir)) {
    return [];
  }

  const entries = fs
    .readdirSync(dodDir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));

  return entries
    .map((file) => {
      const source = path.join(dodDir, file);
      const raw = fs.readFileSync(source, 'utf8');
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new Error(`Unable to parse DoD file as JSON/YAML: ${source}`);
      }

      const id = typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : file.replace(/\.[^.]+$/, '');
      const requirements = Array.isArray(parsed.requirements) ? (parsed.requirements as Requirement[]) : [];

      return {
        id,
        name: typeof parsed.name === 'string' ? parsed.name : id,
        labels: Array.isArray(parsed.labels) ? (parsed.labels as string[]) : [],
        requirements,
        source,
      } satisfies DoDConfig;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function hasMatch(pattern: string, files: string[]): boolean {
  return files.some((file) => matchesPattern(pattern, file));
}

function ensureEvidence(pattern: string): boolean {
  if (pattern.includes('*') || pattern.includes('?')) {
    const repoFiles = collectRepoFiles();
    return repoFiles.some((file) => matchesPattern(pattern, file));
  }

  const absolute = path.join(repoRoot, pattern);
  return fs.existsSync(absolute);
}

function evaluateRequirement(config: DoDConfig, requirement: Requirement, changedFiles: string[]): RequirementResult | null {
  if (requirement.optional) {
    return null;
  }

  const failures: string[] = [];

  if (requirement.changed && requirement.changed.length > 0) {
    for (const pattern of requirement.changed) {
      if (!hasMatch(pattern, changedFiles)) {
        failures.push(`Expected changes matching pattern "${pattern}"`);
      }
    }
  }

  if (requirement.anyChanged && requirement.anyChanged.length > 0) {
    const matched = requirement.anyChanged.some((pattern) => hasMatch(pattern, changedFiles));
    if (!matched) {
      failures.push(`Expected at least one change matching patterns: ${requirement.anyChanged.join(', ')}`);
    }
  }

  if (requirement.evidence && requirement.evidence.length > 0) {
    for (const pattern of requirement.evidence) {
      if (!ensureEvidence(pattern)) {
        failures.push(`Expected evidence files for pattern "${pattern}"`);
      }
    }
  }

  if (failures.length === 0) {
    return null;
  }

  return { config, requirement, failures };
}

function formatFailure(result: RequirementResult): string {
  const header = `- [${result.config.id}] ${result.requirement.id}: ${result.requirement.description}`;
  const details = result.failures.map((failure) => `    • ${failure}`);
  return [header, ...details].join('\n');
}

function main() {
  const labels = new Set(readLabels());
  const explicitIds = new Set(parseList(process.env.DOD_FILES));
  const configs = loadConfigFiles();
  if (configs.length === 0) {
    console.log('No Definition of Done configurations found.');
    process.exit(0);
  }

  const selected = configs.filter((config) => {
    if (explicitIds.has(config.id)) {
      return true;
    }
    if (config.labels && config.labels.length > 0) {
      return config.labels.some((label) => labels.has(label));
    }
    return false;
  });

  if (selected.length === 0) {
    console.log('No Definition of Done rules selected for this run.');
    process.exit(0);
  }

  const changedFiles = getChangedFiles();
  const failures: RequirementResult[] = [];

  for (const config of selected) {
    if (!Array.isArray(config.requirements) || config.requirements.length === 0) {
      console.warn(`No requirements defined in ${config.source}`);
      continue;
    }

    for (const requirement of config.requirements) {
      const failure = evaluateRequirement(config, requirement, changedFiles);
      if (failure) {
        failures.push(failure);
      }
    }
  }

  if (failures.length > 0) {
    console.error('Definition of Done check failed. Unmet requirements:');
    for (const failure of failures) {
      console.error(formatFailure(failure));
    }
    process.exit(1);
  }

  const applied = selected.map((config) => config.id).join(', ');
  console.log(`Definition of Done check passed for: ${applied}`);
}

main();
