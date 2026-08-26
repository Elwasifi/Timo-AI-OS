-- M1-02: the internal tenant (Amro's own operation) must have a configured
-- budget ceiling too, not unlimited by default just because it's internal
-- (docs/BACKLOG-M1.md M1-02 acceptance criteria). The `budgets` table was
-- completely empty for every tenant before this migration — checkBudget()
-- treats "no row" as unlimited, so nothing was ever gated.
--
-- $50/month is a placeholder default, not a considered financial decision —
-- Amro should review and adjust it (directly in this table, or via a future
-- Settings UI once M1-02's actual UI ticket, if any, exists). During
-- development all providers are free-tier (docs/GOVERNANCE.md Section 5),
-- so this ceiling has no real-world cost impact right now; its purpose here
-- is to prove the hard-gate mechanism has a non-null default to enforce.

INSERT INTO budgets (tenant_id, monthly_limit_usd, alert_threshold_pct)
VALUES ('00000000-0000-0000-0000-000000000001', 50.00, 80)
ON CONFLICT (tenant_id) DO NOTHING;
