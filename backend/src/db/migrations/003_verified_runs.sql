-- Verified runs.
--
-- A row is verified when the server replayed its move log from a server-issued seed and
-- derived the score itself. Rows written before this migration were whatever the browser
-- claimed, so they cannot be verified: they keep verified = 0, stay in the table, and are
-- excluded from verified-rank qualification. The public leaderboard may display them, labeled
-- unverified, without including them in projected or newly-issued ranks.
--
-- For verified rows, idempotency_key holds 'run:<run id>', so one run can be submitted once.
-- The column predates this migration and is NOT NULL UNIQUE, which is exactly the constraint
-- single-use needs.
ALTER TABLE scores ADD COLUMN verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1));
ALTER TABLE scores ADD COLUMN seed INTEGER;
ALTER TABLE scores ADD COLUMN engine_version TEXT;
ALTER TABLE scores ADD COLUMN move_log TEXT;

CREATE INDEX scores_verified_order_idx ON scores (verified, score DESC, submitted_at ASC, id ASC);
