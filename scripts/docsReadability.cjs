#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const helpDir = path.resolve(__dirname, '..', 'apps', 'gui', 'help');
if (!fs.existsSync(helpDir)) {
  console.error(`Help directory missing at ${helpDir}`);
  process.exit(1);
}

const allowAcronyms = new Set(['API', 'HTTP', 'HTTPS', 'URL', 'JSON', 'SQL', 'OK']);

const files = fs
  .readdirSync(helpDir)
  .filter((file) => file.endsWith('.md'))
  .map((file) => path.join(helpDir, file));

if (files.length === 0) {
  console.error('No help markdown files found.');
  process.exit(1);
}

function normaliseWhitespace(text) {
  return text.replace(/\r\n/g, '\n');
}

function stripMarkdown(text) {
  return text
    .replace(/`[^`]*`/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[_*`]/g, ' ')
    .replace(/\[[^\]]+\]\([^\)]+\)/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/>\s*/g, '')
    .replace(/[-+*]\s+/g, '');
}

function splitSentences(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const regex = /[^.!?]+[.!?]?/g;
  const sentences = [];
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    const sentence = match[0].trim();
    if (sentence.length === 0) continue;
    sentences.push({ sentence, start: match.index, end: regex.lastIndex });
  }
  if (sentences.length === 0 && cleaned.length > 0) {
    sentences.push({ sentence: cleaned, start: 0, end: cleaned.length });
  }
  return sentences;
}

function countWords(sentence) {
  return sentence.split(/\s+/).filter((token) => token.trim().length > 0).length;
}

function getGitDate(file) {
  try {
    const output = execSync(`git log -1 --format=%cs -- "${file}"`, { encoding: 'utf8' }).trim();
    return output || null;
  } catch (err) {
    return null;
  }
}

function isDirty(file) {
  try {
    const output = execSync(`git status --porcelain -- "${file}"`, { encoding: 'utf8' }).trim();
    return output.length > 0;
  } catch (err) {
    return false;
  }
}

function checkHeadingLengths(lines, relPath, issues) {
  lines.forEach((line, idx) => {
    if (/^#+\s+/.test(line)) {
      const heading = line.replace(/^#+\s+/, '').trim();
      if (heading.length > 60) {
        issues.push(`${relPath}: heading on line ${idx + 1} exceeds 60 characters`);
      }
    }
  });
}

function checkSentenceLength(sentences, relPath, issues) {
  if (sentences.length === 0) return;
  const totalWords = sentences.reduce((sum, entry) => sum + countWords(entry.sentence), 0);
  const average = totalWords / sentences.length;
  if (average > 20) {
    issues.push(`${relPath}: average sentence length ${average.toFixed(2)} words exceeds limit of 20`);
  }
}

function sentenceForIndex(sentences, index) {
  return sentences.find((entry) => index >= entry.start && index < entry.end) || null;
}

function hasDefinition(sentence, acronym) {
  const patternAfter = new RegExp(`\\b${acronym}\\b\\s*\\(([^)]+)\\)`);
  const patternBefore = new RegExp(`\\(([^)]+)\\)\\s*\\b${acronym}\\b`);
  const matchAfter = sentence.match(patternAfter);
  if (matchAfter && /[a-z]/.test(matchAfter[1])) {
    return true;
  }
  const matchBefore = sentence.match(patternBefore);
  if (matchBefore && /[a-z]/.test(matchBefore[1])) {
    return true;
  }
  const acronymInParens = sentence.indexOf(`(${acronym})`);
  if (acronymInParens !== -1) {
    const before = sentence.slice(0, acronymInParens);
    if (/[a-z]/.test(before)) {
      return true;
    }
  }
  return false;
}

function checkJargon(rawText, sentences, relPath, issues) {
  const regex = /\b([A-Z][A-Z0-9]{1,})\b/g;
  const seen = new Set();
  let match;
  while ((match = regex.exec(rawText)) !== null) {
    const term = match[1];
    if (allowAcronyms.has(term)) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    const sentence = sentenceForIndex(sentences, match.index);
    if (!sentence) continue;
    if (!hasDefinition(sentence.sentence, term)) {
      issues.push(`${relPath}: term "${term}" is not defined on first use`);
    }
  }
}

function checkLastUpdated(lines, relPath, absPath, issues) {
  const line = lines.find((value) => /Last updated:/i.test(value));
  if (!line) {
    issues.push(`${relPath}: missing "Last updated" stamp`);
    return;
  }
  const match = line.match(/Last updated:\s*(\d{4}-\d{2}-\d{2})/i);
  if (!match) {
    issues.push(`${relPath}: could not parse date in "Last updated" stamp`);
    return;
  }
  const gitDate = getGitDate(absPath);
  if (gitDate && !isDirty(absPath) && match[1] !== gitDate) {
    issues.push(`${relPath}: "Last updated" stamp ${match[1]} does not match git date ${gitDate}`);
  }
}

const issues = [];

for (const file of files) {
  const relPath = path.relative(path.resolve(__dirname, '..'), file);
  const content = normaliseWhitespace(fs.readFileSync(file, 'utf8'));
  const lines = content.split('\n');
  checkHeadingLengths(lines, relPath, issues);
  checkLastUpdated(lines, relPath, file, issues);
  const plain = stripMarkdown(content);
  const sentences = splitSentences(plain);
  checkSentenceLength(sentences, relPath, issues);
  checkJargon(plain, sentences, relPath, issues);
}

if (issues.length > 0) {
  console.error('docs:readability failed:');
  for (const issue of issues) {
    console.error(` - ${issue}`);
  }
  process.exit(1);
}

console.log(`docs:readability ✓ (${files.length} pages checked)`);
