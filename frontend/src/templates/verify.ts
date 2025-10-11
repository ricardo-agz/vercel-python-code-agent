// Verification script to check template loading
// Run with: npx tsx src/templates/verify.ts

import { TEMPLATES } from './index';

console.log('=== Template System Verification ===\n');

for (const template of TEMPLATES) {
  const fileCount = Object.keys(template.files).length;
  console.log(`✓ ${template.label} (${template.id})`);
  console.log(`  Files: ${fileCount}`);
  console.log(`  Default: ${template.defaultActiveFile}`);
  
  // Show first few files
  const files = Object.keys(template.files).slice(0, 3);
  files.forEach(f => console.log(`    - ${f}`));
  if (fileCount > 3) {
    console.log(`    ... and ${fileCount - 3} more`);
  }
  console.log();
}

console.log(`Total templates: ${TEMPLATES.length}`);
console.log(`Total files: ${TEMPLATES.reduce((sum, t) => sum + Object.keys(t.files).length, 0)}`);

