import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getFilesRecursively(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath));
    } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      results.push(filePath);
    }
  }
  return results;
}

describe('Architectural Dependency Boundary Rules', () => {
  it('ENFORCES that platform engines (src/platform/**) NEVER import business domain modules (src/modules/**)', () => {
    const platformDir = path.resolve(__dirname, '../src/platform');
    const platformFiles = getFilesRecursively(platformDir);

    const violations: { file: string; line: string }[] = [];

    for (const file of platformFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Match import statements referencing modules
        if (
          (line.includes('from') || line.includes('import(')) &&
          (line.includes('/modules/') || line.includes('../modules'))
        ) {
          violations.push({
            file: path.relative(__dirname, file),
            line: `L${index + 1}: ${line.trim()}`
          });
        }
      });
    }

    if (violations.length > 0) {
      console.error('❌ Architectural Dependency Violations Found:', violations);
    }

    expect(violations).toEqual([]);
  });
});
