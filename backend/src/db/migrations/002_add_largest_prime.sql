ALTER TABLE scores
ADD COLUMN largest_prime INTEGER NOT NULL DEFAULT 0 CHECK (largest_prime >= 0);
