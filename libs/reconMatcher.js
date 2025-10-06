const crypto = require('crypto');

const DEFAULT_TOLERANCE = 50; // cents

function parseAmount(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const num = Number(v);
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
}

function parseDate(input) {
  if (!input) return null;
  if (input instanceof Date) return input;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hoursBetween(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const diffMs = Math.abs(a.getTime() - b.getTime());
  return diffMs / (1000 * 60 * 60);
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'bank', 'payment', 'transfer', 'invoice',
  'ref', 'reference', 'crn', 'to', 'of', 'a', 'on'
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t.length > 1 && !STOP_WORDS.has(t));
}

function descriptorSimilarity(bank, ledger) {
  const bankText = [
    bank.descriptor,
    bank.description,
    bank.reference,
    bank.memo,
    bank.counterparty,
    bank.payer_name,
  ].filter(Boolean).join(' ');

  const ledgerText = [
    ledger.descriptor,
    ledger.description,
    ledger.reference,
    ledger.memo,
    ledger.counterparty,
    ledger.payer_name,
  ].filter(Boolean).join(' ');

  if (!bankText || !ledgerText) {
    return 0;
  }

  const bankTokens = tokenize(bankText);
  const ledgerTokens = tokenize(ledgerText);
  if (!bankTokens.length || !ledgerTokens.length) return 0;

  const docs = [bankTokens, ledgerTokens];
  const docFreq = new Map();

  docs.forEach((tokens) => {
    const unique = new Set(tokens);
    unique.forEach((tok) => {
      docFreq.set(tok, (docFreq.get(tok) || 0) + 1);
    });
  });

  const tfidfVector = (tokens) => {
    const counts = tokens.reduce((acc, tok) => {
      acc.set(tok, (acc.get(tok) || 0) + 1);
      return acc;
    }, new Map());
    const total = tokens.length;
    const vec = new Map();
    counts.forEach((count, tok) => {
      const tf = count / total;
      const df = docFreq.get(tok) || 1;
      const idf = Math.log((docs.length + 1) / (df + 0.5)) + 1;
      vec.set(tok, tf * idf);
    });
    return vec;
  };

  const v1 = tfidfVector(bankTokens);
  const v2 = tfidfVector(ledgerTokens);

  let dot = 0;
  let norm1 = 0;
  let norm2 = 0;

  v1.forEach((value, tok) => {
    norm1 += value * value;
    if (v2.has(tok)) {
      dot += value * v2.get(tok);
    }
  });
  v2.forEach((value) => {
    norm2 += value * value;
  });

  if (!norm1 || !norm2) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

function extractCRN(entry) {
  const crn = entry.crn || entry.customer_reference || entry.reference || '';
  if (!crn) return null;
  const raw = String(crn);
  const digits = raw.match(/\d{4,}/g);
  if (digits && digits.length) {
    return digits[0];
  }
  const normalized = raw.replace(/[^0-9a-z]/gi, '').toUpperCase();
  return normalized || null;
}

function isValidRouting(entry) {
  const bsb = entry.bsb || entry.bsb_number;
  const acc = entry.account || entry.account_number || entry.acc;
  const bsbValid = bsb ? /^\d{3}-?\d{3}$/.test(String(bsb)) : false;
  const accValid = acc ? /^\d{4,10}$/.test(String(acc).replace(/\s+/g, '')) : false;
  return { bsbValid, accValid };
}

function historyScore(entry) {
  const score = entry.payer_history_score ?? entry.history_score ?? null;
  if (typeof score === 'number' && Number.isFinite(score)) {
    if (score > 1) return Math.min(score / 100, 1);
    if (score < 0) return 0;
    return score;
  }
  const frequency = entry.payer_frequency ?? entry.frequency ?? null;
  if (typeof frequency === 'number' && frequency > 0) {
    return Math.min(Math.log(1 + frequency) / Math.log(1 + 50), 1);
  }
  return 0;
}

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function buildMatchKey(bankId, ledgerId, factors) {
  const hash = crypto.createHash('sha256');
  hash.update(String(bankId));
  hash.update('|');
  hash.update(String(ledgerId));
  hash.update('|');
  hash.update(JSON.stringify(factors));
  return hash.digest('hex');
}

function computePairFeatures(bankLine, ledgerEntry, toleranceCents) {
  const bankAmount = parseAmount(bankLine.amount_cents ?? bankLine.amount);
  const ledgerAmount = parseAmount(ledgerEntry.amount_cents ?? ledgerEntry.amount);
  const amountDiffAbs = Math.abs(bankAmount - ledgerAmount);
  const bankDate = parseDate(bankLine.timestamp || bankLine.posted_at || bankLine.date);
  const ledgerDate = parseDate(ledgerEntry.timestamp || ledgerEntry.posted_at || ledgerEntry.date);
  const dtDiffHours = hoursBetween(bankDate, ledgerDate);
  const bankCRN = extractCRN(bankLine);
  const ledgerCRN = extractCRN(ledgerEntry);
  const crnMatch = bankCRN && ledgerCRN && bankCRN === ledgerCRN ? 1 : 0;
  const descriptorSim = descriptorSimilarity(bankLine, ledgerEntry);
  const routing = isValidRouting({
    bsb: bankLine.bsb ?? ledgerEntry.bsb,
    bsb_number: bankLine.bsb_number ?? ledgerEntry.bsb_number,
    account: bankLine.account ?? ledgerEntry.account,
    account_number: bankLine.account_number ?? ledgerEntry.account_number,
    acc: bankLine.acc ?? ledgerEntry.acc,
  });
  const routingScore = routing.bsbValid && routing.accValid ? 1 : routing.bsbValid || routing.accValid ? 0.5 : 0;
  const payerHistory = Math.max(historyScore(bankLine), historyScore(ledgerEntry));
  const tolerance = Math.max(Number(toleranceCents) || 0, DEFAULT_TOLERANCE);
  const amountScore = clamp(Math.exp(-amountDiffAbs / (tolerance * 1.5)));
  const timeScore = Number.isFinite(dtDiffHours) ? clamp(Math.exp(-dtDiffHours / 24)) : 0;

  const baseWeighted =
    0.4 * amountScore +
    0.2 * timeScore +
    0.2 * descriptorSim +
    0.1 * crnMatch +
    0.075 * payerHistory +
    0.025 * routingScore;

  const confidence = clamp(baseWeighted + (crnMatch && amountDiffAbs <= tolerance ? 0.25 : 0));

  const blockingRule = amountDiffAbs <= tolerance && crnMatch && (routing.bsbValid || routing.accValid);
  const autoConfidence = blockingRule ? Math.max(confidence, 0.99) : confidence;

  const factors = {
    amount_diff_abs: amountDiffAbs,
    amount_score: Number(amountScore.toFixed(4)),
    dt_diff_hours: Number.isFinite(dtDiffHours) ? Number(dtDiffHours.toFixed(4)) : null,
    time_score: Number(timeScore.toFixed(4)),
    crn_match: crnMatch,
    descriptor_similarity: Number(descriptorSim.toFixed(4)),
    routing_score: Number(routingScore.toFixed(4)),
    payer_history_score: Number(payerHistory.toFixed(4)),
    blocking_rule_applied: blockingRule,
  };

  return { confidence: autoConfidence, factors };
}

function suggestMatches(bankLines = [], ledgerEntries = [], toleranceCents = DEFAULT_TOLERANCE) {
  if (!Array.isArray(bankLines) || !Array.isArray(ledgerEntries)) {
    throw new Error('INVALID_PAYLOAD');
  }
  const tolerance = Math.max(Number(toleranceCents) || 0, 0);
  const results = [];

  bankLines.forEach((bank) => {
    const bankId = bank.id ?? bank.bank_id ?? bank.line_id;
    if (bankId == null) {
      return;
    }
    const bankAmount = parseAmount(bank.amount_cents ?? bank.amount);

    ledgerEntries.forEach((ledger) => {
      const ledgerId = ledger.id ?? ledger.ledger_id ?? ledger.entry_id;
      if (ledgerId == null) {
        return;
      }
      const ledgerAmount = parseAmount(ledger.amount_cents ?? ledger.amount);
      const amountDiffAbs = Math.abs(bankAmount - ledgerAmount);
      if (Number.isFinite(tolerance) && tolerance > 0 && amountDiffAbs > tolerance * 20 && amountDiffAbs > Math.abs(bankAmount) * 0.5) {
        return;
      }
      const { confidence, factors } = computePairFeatures(bank, ledger, tolerance);
      if (confidence < 0.05) {
        return;
      }
      const matchKey = buildMatchKey(bankId, ledgerId, factors);
      results.push({
        bank_id: bankId,
        ledger_id: ledgerId,
        confidence: Number(confidence.toFixed(4)),
        factors,
        match_key: matchKey,
      });
    });
  });

  const grouped = new Map();
  results.forEach((match) => {
    const list = grouped.get(match.bank_id) || [];
    list.push(match);
    grouped.set(match.bank_id, list);
  });

  const flattened = [];
  grouped.forEach((list) => {
    list.sort((a, b) => b.confidence - a.confidence);
    list.slice(0, 5).forEach((item) => flattened.push(item));
  });

  flattened.sort((a, b) => b.confidence - a.confidence);
  return flattened;
}

module.exports = {
  suggestMatches,
};

