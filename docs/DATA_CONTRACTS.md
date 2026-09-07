# Data contracts

## Document intake

The webhook accepts a JSON object in the request body after n8n Header Auth succeeds.

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `document_url` | string | Yes | Externally reachable HTTPS URL; no embedded user/password; max 1,500 characters |
| `file_name` | string | No | Alias: `filename`; default `invoice-document`; max 240 |
| `mime_type` | string | Yes | Alias: `content_type`; PDF, JPEG, PNG, or WebP |
| `file_size_bytes` | number | Yes | Alias: `size_bytes`; positive; default maximum 15 MiB |
| `content_sha256` | string | No | Exactly 64 lowercase/uppercase hexadecimal characters after normalization |
| `source` | string | No | Defaults to `webhook`; max 100 |
| `submitted_by` | string | No | Alias: `sender`; max 180 |

These are caller assertions. The workflow validates their format but does not download the bytes to prove the MIME type, size, or hash.

## Request metadata

```json
{
  "request_meta": {
    "request_id": "invreq_<timestamp>_<random-suffix>",
    "received_at": "ISO-8601 timestamp",
    "received_via": "webhook | manual_demo"
  }
}
```

## File identity

If `content_sha256` is provided, it becomes the preferred file fingerprint. Otherwise the workflow removes URL query/hash values and hashes:

```text
stable_document_url | lowercase_file_name | declared_size_bytes
```

The fallback is a compact 32-bit FNV-1a-style identifier `file_<8 hex>`. It is for replay reduction, not cryptographic identity.

## OCR contract

```json
{
  "ocr": {
    "provider": "mistral | demo_ocr",
    "model": "mistral-ocr-latest | demo",
    "status": "success | failed",
    "page_count": 1,
    "confidence": 0.99,
    "text": "bounded Markdown text",
    "error": null
  }
}
```

Live text is limited to 60,000 characters. `confidence` is the mean of valid Mistral page confidence values when available.

## Normalized invoice

| Field | Contract |
| --- | --- |
| `vendor.name` | String, max 240 |
| `vendor.tax_id` | Uppercase string, max 100 |
| `vendor.email` | Lowercase string, max 180 |
| `vendor.bank_account_last4` | String, max 4 |
| `invoice_number` | Uppercase string, max 120 |
| `invoice_date` | Strict `YYYY-MM-DD` or empty |
| `due_date` | Strict `YYYY-MM-DD` or empty |
| `currency` | Uppercase string, max 3 |
| `po_number` | Uppercase string, max 120 |
| `payment_terms` | String, max 200 |
| `subtotal`, `tax`, `total` | Finite numbers rounded to 2 decimals; fallback 0 |
| `line_items` | Up to 100 items |
| `line_items[].description` | String, max 300 |
| `line_items[].sku` | String, max 100 |
| `line_items[].quantity` | Finite number; fallback 0 |
| `line_items[].unit_price`, `line_total` | Finite money values rounded to 2 decimals |
| `extraction_confidence` | Effective value clamped to `0..1` |

Critical fields are vendor name, invoice number, invoice date, currency, and a positive total.

## Confidence model

The extraction object exposes:

```json
{
  "extraction": {
    "provider": "deterministic_demo | openrouter | failed_fallback",
    "effective_confidence": 0.97,
    "reported_confidence": 0.97,
    "ocr_provider": "demo_ocr | mistral",
    "ocr_confidence": 0.99
  }
}
```

When OCR confidence is present, effective confidence is no greater than either usable signal. Missing/parsing-fallback critical fields still hard-block independently.

## Business duplicate identity

Exact duplicate:

- same normalized vendor tax ID or vendor name; and
- same normalized invoice number.

Near duplicate:

- same vendor and currency;
- absolute total difference within `amount_tolerance` (default `$0.02` in the invoice currency);
- invoice date inside `fuzzy_duplicate_days` (default 120); and
- normalized invoice-number edit distance ≤ 1.

## ERP context adapter

The workflow performs:

```http
GET {INVOICEGUARD_ERP_BASE_URL}/invoice-context
    ?po_number=<encoded>
    &vendor_tax_id=<encoded>
```

Expected body, directly or under `data`:

```json
{
  "vendor": {
    "vendor_id": "VEN-0042",
    "name": "ASTERLINE INDUSTRIAL SUPPLY LLC",
    "tax_id": "US-94-5550123",
    "approved": true,
    "bank_account_last4": "4821"
  },
  "purchase_order": {
    "number": "PO-2026-441",
    "status": "open",
    "vendor_tax_id": "US-94-5550123",
    "currency": "USD",
    "total": 8532,
    "line_items": []
  },
  "goods_receipt": {
    "number": "GR-2026-771",
    "received_at": "2026-09-01",
    "line_items": [
      { "sku": "GW-200", "received_quantity": 2 }
    ]
  }
}
```

All three objects may be null. Missing records become an explicit control flag.

## ERP draft adapter

After approval, the workflow sends:

```http
POST {INVOICEGUARD_ERP_BASE_URL}/bills
```

The body includes `status: draft`, source URL, normalized invoice/vendor/line items, risk flags, and approval metadata. A successful response must contain `id` or `bill_id`; otherwise the workflow throws and refuses to report success.

## Terminal statuses

| Status | Meaning |
| --- | --- |
| `rejected_invalid_document` | Intake declaration failed before OCR |
| `ignored_duplicate_file` | Same file fingerprint is processing or recently completed |
| `ocr_failed` | Live OCR returned no usable text |
| `blocked` / `demo_blocked` | Policy hard-stop; no ERP draft |
| `rejected_by_human` / `demo_rejected_by_human` | Review did not approve; no ERP draft |
| `draft_created` / `demo_draft_created` | ERP or simulated draft exists |

The webhook acknowledges immediately, so these are execution results rather than synchronous webhook bodies.
