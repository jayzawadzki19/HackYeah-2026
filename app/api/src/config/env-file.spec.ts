import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment, mergeEnvFile, parseEnvFile } from './env-file';

describe('parseEnvFile', () => {
  test('reads keys, skipping comments and blank lines', () => {
    const text = ['# comment', '', 'PORT=3001', '  WEB_ORIGIN = http://localhost:4200  ', '# OTHER=1'].join('\n');

    expect(parseEnvFile(text)).toEqual({ PORT: '3001', WEB_ORIGIN: 'http://localhost:4200' });
  });

  test('strips matching quotes and the export prefix, and keeps "=" inside values', () => {
    const text = ['export A="quoted value"', "B='single'", 'C=whsec_abc==', 'D='].join('\n');

    expect(parseEnvFile(text)).toEqual({ A: 'quoted value', B: 'single', C: 'whsec_abc==', D: '' });
  });

  test('handles CRLF line endings', () => {
    expect(parseEnvFile('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
  });
});

describe('mergeEnvFile', () => {
  test('replaces existing keys in place, keeps comments and appends new keys', () => {
    const existing = ['# api env', 'PORT=3001', 'OW_API_KEY=old', ''].join('\n');

    const merged = mergeEnvFile(existing, { OW_API_KEY: 'new', OW_USER_ID_JAKUB: 'id-1' });

    expect(merged).toBe(['# api env', 'PORT=3001', 'OW_API_KEY=new', 'OW_USER_ID_JAKUB=id-1', ''].join('\n'));
  });

  test('writes a fresh file when there is no existing content', () => {
    expect(mergeEnvFile('', { A: '1', B: '2' })).toBe('A=1\nB=2\n');
  });

  test('quotes values containing spaces or a hash', () => {
    expect(mergeEnvFile('', { A: 'two words', B: 'x#y' })).toBe('A="two words"\nB="x#y"\n');
  });
});

describe('loadEnvironment', () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'headroom-env-'));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  test('merges the file with the process environment, process values winning', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env.local'), 'A=file\nB=file\n');

    expect(loadEnvironment(join(dir, '.env.local'), { B: 'process', C: 'process' })).toEqual({
      A: 'file',
      B: 'process',
      C: 'process',
    });
  });

  test('uses the process environment alone when the file does not exist', () => {
    expect(loadEnvironment(join(tempDir(), '.env.local'), { A: '1' })).toEqual({ A: '1' });
  });
});
