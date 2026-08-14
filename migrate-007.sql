-- Adds MSG91 delivery-report correlation to otp_requests, so the async
-- "On Outbound Report Received" webhook can update the real send outcome
-- (sent/delivered/failed/read) that MSG91's synchronous API response never reports.
ALTER TABLE otp_requests ADD COLUMN msg91_request_id   TEXT;
ALTER TABLE otp_requests ADD COLUMN delivery_status     TEXT;
ALTER TABLE otp_requests ADD COLUMN delivery_reason     TEXT;
ALTER TABLE otp_requests ADD COLUMN delivery_updated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_otp_msg91_request_id ON otp_requests(msg91_request_id);
