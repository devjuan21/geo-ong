-- Idempotency indexes for automatic Incident Resolved community notifications
-- Ensures at most one 'incident_resolved' notification per resolved incident
-- and prevents duplicate recipient rows per notification.

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_incident_resolved
  ON notifications (related_entity_type, related_entity_id)
  WHERE related_entity_type = 'incident_resolved' AND related_entity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_recipients_pair
  ON notification_recipients (notification_id, user_id);
