/*
# Subsidiary company naming convention

## Purpose
UI/UX polish pass: every OPERATING company's display name must explicitly
include the word "Company" so subsidiaries read unambiguously as companies
in the org chart, not just functional department labels. Corporate Office
is intentionally excluded — it is the parent/governing body, not a
subsidiary, and the naming rule only applies to `kind = 'operating'` rows.

## What this does NOT do
- Does not touch `id` values (routing/joins are unaffected).
- Does not touch `kind`, `theme_color`, `icon`, `sort_order`.
- Does not touch any agent, department, or other table.
- Trading Company already satisfied the convention and is unchanged.

Purely a `name` column update — additive/idempotent (safe to re-run).
*/

UPDATE business_units SET name = 'AI Engineering & Technology Company' WHERE id = 'company-engineering';
UPDATE business_units SET name = 'AI Automation Company'                WHERE id = 'company-automation';
UPDATE business_units SET name = 'AI Research & Intelligence Company'   WHERE id = 'company-research';
UPDATE business_units SET name = 'AI Design & Creative Company'         WHERE id = 'company-design';
UPDATE business_units SET name = 'AI Marketing & Content Company'       WHERE id = 'company-marketing';
-- company-trading already named 'Trading Company' — no change needed.
-- corporate-office intentionally excluded — not a subsidiary.
