#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const workflow = JSON.parse(
  fs.readFileSync(path.join(root, 'workflows', 'invoiceguard-ai-invoice-processing.json'), 'utf8'),
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const staticData = {};

async function executeCode(name, inputJson, lookups = {}, variables = {}) {
  const node = nodes.get(name);
  assert(node, `Missing node: ${name}`);
  assert.equal(node.type, 'n8n-nodes-base.code', `${name} is not a Code node`);
  const inputItems = inputJson === undefined ? [] : [{ json: inputJson }];
  const $input = { first: () => inputItems[0], all: () => inputItems };
  const $getWorkflowStaticData = () => staticData;
  const $ = (nodeName) => ({
    first: () => {
      assert(Object.hasOwn(lookups, nodeName), `Missing mocked lookup for ${nodeName}`);
      return { json: lookups[nodeName] };
    },
  });
  const fn = new AsyncFunction(
    '$input',
    '$vars',
    '$execution',
    '$getWorkflowStaticData',
    '$',
    node.parameters.jsCode,
  );
  const result = await fn($input, variables, { id: 'offline-demo' }, $getWorkflowStaticData, $);
  assert(Array.isArray(result) && result.length === 1, `${name} must return one item`);
  assert(result[0] && typeof result[0].json === 'object', `${name} returned an invalid item`);
  return result[0].json;
}

let data = await executeCode('Load Demo Invoice');
data = await executeCode('Normalize Intake Envelope', data);
data = await executeCode('Runtime Configuration', data);
assert.equal(data.config.demo_mode, true, 'default must be demo mode');
data = await executeCode('Validate Document Intake', data);
assert.equal(data.validation.valid, true, 'demo document must validate');
data = await executeCode('Create File Idempotency Key', data);
assert.match(data.file_identity.fingerprint, /^[a-f0-9]{64}$/);
data = await executeCode('Generate Demo OCR Text', data);
assert.equal(data.ocr.confidence, 0.99);
data = await executeCode('Generate Demo Invoice Data', data);
data = await executeCode('Normalize Extracted Invoice', data);
assert.equal(data.invoice.extraction_confidence, 0.97);
assert.equal(data.extraction_meta.effective_confidence, 0.97);
data = await executeCode('Detect Duplicate Invoice', data);
assert.equal(data.invoice_identity.match_type, 'none');
data = await executeCode('Generate Demo ERP Records', data);
const matchedContext = structuredClone(data);
data = await executeCode('Run Financial and 3-Way Controls', data);
assert.deepEqual(data.controls.flags, []);
data = await executeCode('Calculate Risk and Decision', data);
assert.equal(data.risk.score, 0);
assert.equal(data.decision.status, 'human_review');
assert.equal(data.decision.blocked, false);
data = await executeCode('Simulate Finance Approval', data);
const approvedBase = data;
data = await executeCode('Simulate ERP Bill Draft', data);
data = await executeCode('Write Processing Result and Return', data);
assert.equal(data.success, true);
assert.equal(data.status, 'demo_draft_created');
assert.equal(data.invoice.total, 8532);
assert.equal(data.policy_decision, 'human_review');
assert.equal(data.extraction.ocr_confidence, 0.99);
assert.equal(data.extraction.reported_confidence, 0.97);
assert.equal(data.extraction.effective_confidence, 0.97);
assert.equal(data.approval.approved, true);
assert.equal(data.erp_draft.status, 'draft');

let invalid = {
  document_url: 'http://127.0.0.1/private/invoice.pdf',
  file_name: 'invoice.exe',
  mime_type: 'application/octet-stream',
  file_size_bytes: 0,
  content_sha256: 'not-a-sha256',
};
invalid = await executeCode('Normalize Intake Envelope', invalid);
invalid = await executeCode('Runtime Configuration', invalid);
invalid = await executeCode('Validate Document Intake', invalid);
assert.equal(invalid.validation.valid, false);
assert.deepEqual(invalid.validation.errors, [
  'document_url must be an allowed HTTPS URL',
  'unsupported mime_type: application/octet-stream',
  'file_size_bytes must be greater than zero',
  'content_sha256 must contain 64 hexadecimal characters',
]);

async function validateUrl(url) {
  let item = await executeCode('Normalize Intake Envelope', {
    document_url: url,
    file_name: 'invoice.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: 1024,
  });
  item = await executeCode('Runtime Configuration', item);
  return executeCode('Validate Document Intake', item);
}

assert.equal((await validateUrl('https://example.com/invoice.pdf')).validation.valid, true);
assert.equal((await validateUrl('https://user:pass@example.com/invoice.pdf')).validation.valid, false);
assert.equal((await validateUrl('https://[::1]/invoice.pdf')).validation.valid, false);

await assert.rejects(
  () => executeCode('Runtime Configuration', { request_meta: {} }, {}, { INVOICEGUARD_DEMO_MODE: 'false' }),
  /Missing live configuration/,
);
await assert.rejects(
  () => executeCode('Runtime Configuration', { request_meta: {} }, {}, {
    INVOICEGUARD_DEMO_MODE: 'false',
    INVOICEGUARD_APPROVAL_EMAIL: 'finance@example.com',
    INVOICEGUARD_TELEGRAM_CHAT_ID: '12345',
    INVOICEGUARD_ERP_BASE_URL: 'http://erp.example.com/api',
  }),
  /must use HTTPS/,
);

let critical = structuredClone(matchedContext);
critical.invoice.vendor.bank_account_last4 = '9999';
critical = await executeCode('Run Financial and 3-Way Controls', critical);
assert(critical.controls.flags.some((flag) => flag.code === 'bank_account_changed' && flag.severity === 'critical'));
critical = await executeCode('Calculate Risk and Decision', critical);
assert.equal(critical.risk.score, 60);
assert.equal(critical.risk.level, 'critical');
assert.equal(critical.decision.status, 'blocked');
const blocked = await executeCode(
  'Mark Blocked Outcome',
  { ok: true },
  { 'Calculate Risk and Decision': critical },
);
const blockedResult = await executeCode('Write Processing Result and Return', blocked);
assert.equal(blockedResult.success, false);
assert.equal(blockedResult.status, 'demo_blocked');

const decisionLookup = { 'Calculate Risk and Decision': approvedBase };
const approved = await executeCode('Parse Finance Decision', { approvalStatus: 'approved' }, decisionLookup);
assert.equal(approved.approval.approved, true);
const rejected = await executeCode('Parse Finance Decision', { data: { approvalStatus: 'declined' } }, decisionLookup);
assert.equal(rejected.approval.approved, false);
assert.equal(rejected.approval.raw_status, 'rejected');
const timedOut = await executeCode('Parse Finance Decision', {}, decisionLookup);
assert.equal(timedOut.approval.approved, false);
assert.equal(timedOut.approval.raw_status, 'unrecognized_or_timed_out');

const liveDraft = await executeCode(
  'Capture ERP Draft',
  { id: 'BILL-TEST-1048', status: 'draft' },
  { 'Use Simulated ERP Draft?': approvedBase },
);
assert.equal(liveDraft.outcome.erp_draft.bill_id, 'BILL-TEST-1048');
await assert.rejects(
  () => executeCode('Capture ERP Draft', { status: 'draft' }, { 'Use Simulated ERP Draft?': approvedBase }),
  /did not include a bill identifier/,
);

console.log('PASS: offline demo executed 15 production Code nodes without external calls');
console.log('PASS: matched invoice reached human review and produced demo_draft_created after simulated approval');
console.log('PASS: invalid intake, URL guard, live-config fail-closed behavior, critical bank-change block, approval outcomes, and ERP response guard completed');
