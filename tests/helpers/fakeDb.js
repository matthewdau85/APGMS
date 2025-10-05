import { randomUUID } from 'node:crypto';

function parseStatements(sql) {
  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === ';' && !inSingle && !inDouble) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
    } else {
      current += ch;
    }
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function parseDefault(token) {
  if (!token) return undefined;
  const lower = token.toLowerCase();
  if (lower === 'now()') return () => new Date().toISOString();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^'-?\d+'$/.test(token) || /^\d+$/.test(token)) return Number(token.replace(/'/g, ''));
  if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1);
  return token;
}

function parseColumnDefinition(line) {
  const trimmed = line.trim().replace(/,$/, '');
  if (!trimmed || trimmed.startsWith('--')) return undefined;
  if (/^(unique|primary|constraint|foreign)/i.test(trimmed)) return undefined;
  const parts = trimmed.split(/\s+/);
  const name = parts.shift();
  if (!name) return undefined;
  const typeTokens = [];
  while (parts.length) {
    const next = parts[0].toLowerCase();
    if (['default', 'not', 'primary', 'unique', 'references', 'check'].includes(next)) break;
    typeTokens.push(parts.shift());
  }
  const type = typeTokens.join(' ');
  let notNull = false;
  let defaultValue;
  while (parts.length) {
    const token = parts.shift();
    switch (token?.toLowerCase()) {
      case 'not':
        if (parts[0]?.toLowerCase() === 'null') parts.shift();
        notNull = true;
        break;
      case 'default':
        defaultValue = parseDefault(parts.shift());
        break;
      case 'primary':
        if (parts[0]?.toLowerCase() === 'key') parts.shift();
        break;
      case 'unique':
        break;
      case 'references':
        parts.shift();
        break;
      case 'check':
        while (parts.length && !parts[0].includes(')')) parts.shift();
        if (parts.length) parts.shift();
        break;
      default:
        break;
    }
  }
  return {
    name,
    type,
    notNull,
    defaultValue,
    autoIncrement: /serial/i.test(type),
  };
}

const globalStoreKey = Symbol.for('apgms.fakeDbStore');
const globalStore = globalThis[globalStoreKey] ?? (globalThis[globalStoreKey] = {});

class FakeDatabase {
  constructor() {
    this.tables = new Map();
  }

  reset() {
    this.tables.clear();
  }

  applySql(sql) {
    const cleanedSql = sql.replace(/--.*$/gm, '');
    for (const statement of parseStatements(cleanedSql)) {
      const lower = statement.toLowerCase();
      if (lower.startsWith('create table')) {
        this.applyCreateTable(statement);
      } else if (lower.startsWith('alter table')) {
        this.applyAlterTable(statement);
      } else if (lower.startsWith('update owa_ledger')) {
        this.applyUpdate(statement);
      } else if (lower.startsWith('insert into')) {
        this.applyInsert(statement);
      }
    }
  }

  ensureTable(name) {
    const table = this.tables.get(name);
    if (!table) {
      const existing = Array.from(this.tables.keys());
      throw new Error(`Table ${name} does not exist (have: ${existing.join(', ')})`);
    }
    return table;
  }

  applyCreateTable(statement) {
    const match = statement.match(/create table if not exists\s+(\w+)\s*\(([^]*)\)/i);
    if (!match) return;
    const [, name, body] = match;
    const lines = body.split(/\n/).map((line) => line.trim()).filter(Boolean);
    const columns = [];
    for (const line of lines) {
      const col = parseColumnDefinition(line);
      if (col) columns.push(col);
    }
    this.tables.set(name, { name, columns, rows: [], sequences: {} });
  }

  applyAlterTable(statement) {
    const match = statement.match(/alter table\s+(\w+)\s+([\s\S]+)/i);
    if (!match) return;
    const [, tableName, rest] = match;
    const table = this.ensureTable(tableName);
    const addParts = rest.split(/add column/ig).slice(1);
    for (const part of addParts) {
      const cleaned = part.trim().replace(/^if not exists/i, '').trim().replace(/,$/, '');
      const col = parseColumnDefinition(cleaned);
      if (!col) continue;
      const existing = table.columns.find((c) => c.name === col.name);
      if (existing) {
        existing.notNull = existing.notNull || col.notNull;
        if (col.defaultValue !== undefined) existing.defaultValue = col.defaultValue;
        continue;
      }
      table.columns.push(col);
      for (const row of table.rows) {
        let value = col.defaultValue;
        if (typeof value === 'function') value = value();
        if (value === undefined) value = null;
        if (col.notNull && value === null) {
          value = col.type.toLowerCase() === 'boolean' ? false : value;
        }
        row[col.name] = value;
      }
    }
  }

  applyUpdate(statement) {
    const table = this.ensureTable('owa_ledger');
    const lower = statement.toLowerCase();
    if (lower.includes('set rpt_verified') && lower.includes('amount_cents < 0')) {
      for (const row of table.rows) {
        if (Number(row.amount_cents) < 0 && (row.rpt_verified === null || row.rpt_verified === undefined || row.rpt_verified === false)) {
          row.rpt_verified = true;
        }
      }
      return;
    }
    if (lower.includes('set release_uuid') && lower.includes('amount_cents < 0')) {
      for (const row of table.rows) {
        if (Number(row.amount_cents) < 0 && (row.release_uuid === null || row.release_uuid === undefined)) {
          row.release_uuid = randomUUID();
        }
      }
    }
  }

  applyInsert(statement) {
    const match = statement.match(/insert into\s+(\w+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/i);
    if (!match) return;
    const [, tableName, cols, values] = match;
    const columnNames = cols.split(',').map((c) => c.trim());
    const rawValues = values.split(',').map((v) => v.trim());
    const row = {};
    rawValues.forEach((value, idx) => {
      let parsed = value;
      if (/^'-?\d+'$/.test(value) || /^\d+$/.test(value)) parsed = Number(value.replace(/'/g, ''));
      if (/^true$/i.test(value)) parsed = true;
      if (/^false$/i.test(value)) parsed = false;
      if (value === 'now()') parsed = new Date().toISOString();
      row[columnNames[idx]] = parsed;
    });
    this.insert(tableName, row);
  }

  insert(tableName, provided) {
    const table = this.ensureTable(tableName);
    const row = {};
    for (const column of table.columns) {
      let value = Object.prototype.hasOwnProperty.call(provided, column.name)
        ? provided[column.name]
        : undefined;
      if (value === undefined) {
        if (column.autoIncrement) {
          const seq = (table.sequences[column.name] ?? 0) + 1;
          table.sequences[column.name] = seq;
          value = seq;
        } else if (column.defaultValue !== undefined) {
          value = typeof column.defaultValue === 'function'
            ? column.defaultValue()
            : column.defaultValue;
        } else {
          value = null;
        }
      }
      if (column.notNull && value === null) {
        throw new Error(`Column ${column.name} on ${tableName} cannot be null`);
      }
      row[column.name] = value;
    }
    table.rows.push(row);
    return row;
  }

  select(tableName, criteria, options = {}) {
    const table = this.ensureTable(tableName);
    let rows = table.rows.filter((row) => {
      return Object.entries(criteria).every(([key, value]) => row[key] === value);
    });
    if (options.order) {
      rows = rows.sort((a, b) => {
        const diff = Number(a.id ?? 0) - Number(b.id ?? 0);
        return options.order === 'ASC' ? diff : -diff;
      });
    }
    if (typeof options.limit === 'number') rows = rows.slice(0, options.limit);
    return rows.map((row) => ({ ...row }));
  }

  selectWhere(predicate, options = {}) {
    const table = this.ensureTable('owa_ledger');
    let rows = table.rows.filter(predicate);
    if (options.order) {
      rows = rows.sort((a, b) => {
        const diff = Number(a.id ?? 0) - Number(b.id ?? 0);
        return options.order === 'ASC' ? diff : -diff;
      });
    }
    if (typeof options.limit === 'number') rows = rows.slice(0, options.limit);
    return rows.map((row) => ({ ...row }));
  }

  getTable(name) {
    return this.ensureTable(name);
  }
}

export const fakeDb = globalStore.fakeDb ?? (globalStore.fakeDb = new FakeDatabase());

function executeQuery(sql, params = []) {
  const lowerRaw = sql.trim().toLowerCase();
  const normalized = lowerRaw.replace(/\s+/g, ' ');
  if (lowerRaw === 'begin' || lowerRaw === 'commit' || lowerRaw === 'rollback') {
    return { rows: [] };
  }
  if (normalized.startsWith('select balance_after_cents from owa_ledger')) {
    const [abn, taxType, periodId] = params;
    const rows = fakeDb
      .selectWhere((row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId, { order: 'DESC', limit: 1 })
      .map((row) => ({ balance_after_cents: row.balance_after_cents }));
    return { rows };
  }
  if (normalized.startsWith('select id, amount_cents')) {
    const [abn, taxType, periodId] = params;
    const rows = fakeDb
      .selectWhere((row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId, { order: 'ASC' })
      .map((row) => ({
        id: row.id,
        amount_cents: row.amount_cents,
        balance_after_cents: row.balance_after_cents,
        rpt_verified: row.rpt_verified ?? false,
        release_uuid: row.release_uuid ?? null,
        bank_receipt_id: row.bank_receipt_id ?? null,
        created_at: row.created_at ?? null,
      }));
    return { rows };
  }
  if (normalized.startsWith('insert into owa_ledger')) {
    const match = sql.match(/insert into\s+owa_ledger\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\)\s*returning\s+([\s\S]+)/i);
    if (!match) throw new Error(`Unsupported INSERT: ${sql}`);
    const [, colsStr, valuesStr, returningStr] = match;
    const columns = colsStr.split(',').map((c) => c.trim());
    const valuesTokens = valuesStr.split(',').map((v) => v.trim());
    const rowData = {};
    valuesTokens.forEach((token, idx) => {
      let value;
      if (/^\$\d+$/.test(token)) {
        const paramIndex = Number(token.slice(1)) - 1;
        value = params[paramIndex];
      } else if (token.toLowerCase() === 'true') {
        value = true;
      } else if (token.toLowerCase() === 'false') {
        value = false;
      } else if (token.toLowerCase() === 'now()') {
        value = new Date().toISOString();
      } else if (/^'-?\d+'$/.test(token) || /^\d+$/.test(token)) {
        value = Number(token.replace(/'/g, ''));
      } else {
        value = token.replace(/^'(.*)'$/, '$1');
      }
      rowData[columns[idx]] = value;
    });
    const inserted = fakeDb.insert('owa_ledger', rowData);
    const returningCols = returningStr.split(',').map((c) => c.trim());
    const rows = [
      returningCols.reduce((acc, col) => {
        acc[col] = inserted[col];
        return acc;
      }, {}),
    ];
    return { rows };
  }
  throw new Error(`Unsupported query: ${sql}`);
}

class FakeClient {
  async query(sql, params) {
    return executeQuery(sql, params);
  }
  release() {}
}

export class FakePool {
  async query(sql, params) {
    return executeQuery(sql, params);
  }
  async connect() {
    return new FakeClient();
  }
}

const defaultExport = { Pool: FakePool };
export default defaultExport;
