const fs = require('fs');
const path = require('path');

function scanNonAscii(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f === 'node_modules' || f === '.git' || f === 'dist' || f === 'scratch' || f === '.user_uploaded') continue;
    const fullPath = path.join(dir, f);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanNonAscii(fullPath);
    } else if (f.endsWith('.html') || f.endsWith('.js')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // match non-ascii characters
        const nonAscii = line.match(/[^\x00-\x7F]/g);
        if (nonAscii) {
          console.log(`${fullPath}:${idx + 1} [${nonAscii.join('')}]: ${line.trim()}`);
        }
      });
    }
  }
}

scanNonAscii('.');
