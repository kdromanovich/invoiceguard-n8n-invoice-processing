# Setup

## Prerequisites

- n8n compatible with the included node versions, Variables, and Gmail **Send and Wait for Response**
- public HTTPS n8n callback URL
- Mistral API key
- OpenRouter API key
- ERP adapter with context and bill-draft endpoints
- Gmail OAuth2 credential
- Telegram bot credential and controlled finance chat
- a high-entropy secret for intake Header Auth

Official references:

- n8n [workflow import](https://docs.n8n.io/workflows/export-import/), [Variables](https://docs.n8n.io/code/variables/), [Webhook authentication](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), and [Gmail message operations](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/message-operations/)
- Mistral [OCR processor](https://docs.mistral.ai/studio/document-processing/basic_ocr) and [`POST /v1/ocr`](https://docs.mistral.ai/api/endpoint/ocr)
- OpenRouter [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

## 1. Import and run the demo

1. Import `workflows/invoiceguard-ai-invoice-processing.json`.
2. Confirm the workflow is inactive.
3. Leave all credentials unassigned.
4. Keep `INVOICEGUARD_DEMO_MODE` unset or `true`.
5. Click **Run Demo**.
6. Confirm `status: demo_draft_created`, `risk.score: 0`, and `policy_decision: human_review`.

The manual demo does not execute the authenticated webhook or any provider node.

## 2. Configure n8n Variables

| Variable | Live requirement | Default / purpose |
| --- | --- | --- |
| `INVOICEGUARD_DEMO_MODE` | Required decision | Defaults to `true`; use `false` only after staging |
| `INVOICEGUARD_ERP_BASE_URL` | Required | No live default; must be valid HTTPS |
| `INVOICEGUARD_APPROVAL_EMAIL` | Required | Finance approval mailbox |
| `INVOICEGUARD_TELEGRAM_CHAT_ID` | Required | Finance alert destination |
| `INVOICEGUARD_ARCHIVE_FOLDER` | Optional | `Processed/Invoices`; descriptive target only |
| `INVOICEGUARD_OCR_MODEL` | Optional | `mistral-ocr-latest` |
| `INVOICEGUARD_OPENROUTER_MODEL` | Optional | `openai/gpt-5.1` |
| `INVOICEGUARD_MAX_FILE_SIZE_BYTES` | Optional | `15728640` (15 MiB), clamped to 1–100 MiB |
| `INVOICEGUARD_FINGERPRINT_TTL_HOURS` | Optional | `72`, clamped to 1–720 |
| `INVOICEGUARD_PROCESSING_LOCK_MINUTES` | Optional | `30`, clamped to 1–1,440 |
| `INVOICEGUARD_AMOUNT_TOLERANCE` | Optional | `0.02`, absolute currency-unit tolerance |
| `INVOICEGUARD_AUTO_APPROVE_LIMIT` | Optional | `5000` |
| `INVOICEGUARD_REVIEW_RISK_THRESHOLD` | Optional | `25` |
| `INVOICEGUARD_BLOCK_RISK_THRESHOLD` | Optional | `70`; cannot be below review threshold |
| `INVOICEGUARD_FUZZY_DUPLICATE_DAYS` | Optional | `120` |

Variables are non-secret configuration. Keep all API keys in n8n credentials.

## 3. Assign credentials

### Intake webhook Header Auth

Create an n8n Header Auth credential with a dedicated header, for example:

| Field | Example |
| --- | --- |
| Name | `X-InvoiceGuard-Key` |
| Value | A random secret of at least 32 bytes |

Assign it to **Invoice Intake Webhook** and send the same header from the trusted upstream service. Rotate and separate test/production values.

### Mistral OCR

Create HTTP Header Auth:

| Field | Value |
| --- | --- |
| Name | `Authorization` |
| Value | `Bearer <MISTRAL_API_KEY>` |

Assign it to **Mistral: Extract OCR Text**.

### OpenRouter

Create separate HTTP Header Auth with `Authorization: Bearer <OPENROUTER_API_KEY>` and assign it to **OpenRouter: Extract Invoice**. The OpenRouter request uses this repository URL in `HTTP-Referer`; replace it with your application URL if needed.

### ERP adapter

Create a least-privileged Header Auth credential appropriate to your adapter and assign it to:

- **ERP: Fetch PO and Receipt**
- **ERP: Create Bill Draft**

The credential should allow read-only context retrieval and draft creation, not payment execution. If possible, use separate credentials for read and draft-write operations.

### Gmail

Assign a controlled Gmail OAuth2 credential to **Gmail: Request Finance Approval**. Configure an externally reachable HTTPS `WEBHOOK_URL` and reverse proxy correctly so resume links work. Approval is limited to 72 hours.

### Telegram

Assign a dedicated Telegram API credential to **Telegram: Alert Finance** and test with a non-production finance chat.

## 4. Provide document access safely

Mistral must be able to fetch the document URL. For private invoices, use a single-object signed HTTPS URL that:

- expires shortly after expected OCR retrieval;
- permits read only;
- cannot list a bucket or neighboring documents;
- does not embed long-lived credentials;
- is not written into broad application logs;
- is revoked or naturally expires after processing.

Confirm your data-processing and regional requirements before sending financial documents to Mistral and OCR text to OpenRouter.

## 5. Implement the ERP adapter

Use [DATA_CONTRACTS.md](DATA_CONTRACTS.md) for exact requests and responses. Before live mode:

1. Return vendor, PO, and receipt under the documented schema.
2. Ensure missing objects return null rather than fabricated matches.
3. Accept only `status: draft` on the bill endpoint.
4. Return an immutable `id` or `bill_id` after successful creation.
5. Make the create endpoint idempotent using the invoice/file identity.
6. Prevent this service account from posting bills or initiating payments.

## 6. Stage the live matrix

1. Use a sandbox ERP and test provider accounts.
2. Configure all Variables except live mode.
3. Assign every credential.
4. Set `INVOICEGUARD_DEMO_MODE=false` while the workflow remains inactive.
5. Execute controlled payloads from the editor.
6. Test valid, invalid, duplicate, OCR failure, extraction failure, missing PO, missing receipt, changed bank account, finance approval/rejection/timeout, ERP failure, and missing bill ID.
7. Compare the processing result with the expected decision for each test document.
8. Return to demo mode if any branch is ambiguous.

## 7. Activate

Activate only after staging and use the production webhook URL. The caller receives an immediate acknowledgement, not the final accounting decision. Persist the returned result externally if operators or upstream systems need status retrieval.
