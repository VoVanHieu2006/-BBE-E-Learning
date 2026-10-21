BEGIN;
ALTER TABLE transfer_seasons ADD COLUMN reward_boundary_at timestamptz(3);
CREATE UNIQUE INDEX transfer_seasons_reward_boundary_at_key ON transfer_seasons(reward_boundary_at);
ALTER TABLE transfer_seasons ADD CONSTRAINT reward_boundary_is_vietnam_half_year CHECK (
  reward_boundary_at IS NULL OR (
    EXTRACT(MONTH FROM reward_boundary_at AT TIME ZONE 'Asia/Ho_Chi_Minh') IN (4,10)
    AND EXTRACT(DAY FROM reward_boundary_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = 1
    AND (reward_boundary_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time = time '00:00:00'
    AND starts_at <= reward_boundary_at AND reward_boundary_at < ends_at
  )
);
ALTER TABLE monthly_video_replays ADD COLUMN reward_suppressed_at timestamptz(3);
COMMIT;
