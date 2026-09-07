#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const workflowPath = path.join(root, 'workflows', 'invoiceguard-ai-invoice-processing.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

let checked = 0;
const failures = [];
for (const node of workflow.nodes) {
  if (node.type !== 'n8n-nodes-base.code') continue;
  const code = node.parameters?.jsCode;
  if (typeof code !== 'string') {
    failures.push(`${node.name}: missing jsCode`);
    continue;
  }
  try {
    new AsyncFunction('$input', '$vars', '$execution', '$getWorkflowStaticData', '$', code);
    checked += 1;
  } catch (error) {
    failures.push(`${node.name}: ${error.message}`);
  }
}

if (failures.length) {
  console.error(`FAILED: ${failures.length} Code node(s) did not compile`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PASS: JavaScript syntax compiled for ${checked} Code nodes`);

