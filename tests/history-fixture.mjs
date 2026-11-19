import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const audience = 'test.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test' };
const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');

export function token(sub, extra = {}) {
  const body = `${encode({ alg: 'RS256', kid: 'test' })}.${encode({
    sub, aud: audience, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 60,
    ...extra,
  })}`;
  return `${body}.${sign('sha256', Buffer.from(body), privateKey).toString('base64url')}`;
}

export function testDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../cloudflare/history-schema.sql', import.meta.url), 'utf8'));
  const prepare = (sql) => ({
    bind(...args) {
      const run = () => {
        const values = [];
        let next = 0;
        const statement = db.prepare(sql.replace(/\?(\d*)/g, (_, index) => {
          values.push(args[index ? Number(index) - 1 : next++]);
          return '?';
        }));
        return statement.columns().length
          ? { results: statement.all(...values) }
          : { results: [], meta: statement.run(...values) };
      };
      return { run, first: () => run().results[0] ?? null };
    },
  });
  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.run());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
}
