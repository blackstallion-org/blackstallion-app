/**
 * TODO (post-D05): implement with Expo Push API or equivalent.
 *
 * The sender reads notification_outbox rows where sent_at IS NULL,
 * joins device_tokens for each recipient, calls the push provider,
 * and stamps sent_at + error on each row.
 *
 * Candidate: Supabase Edge Function on a cron, or a standalone service.
 * No provider signup needed until D05 is lifted.
 */
export interface NotificationSender {
  processOutbox(): Promise<{ sent: number; failed: number }>;
}
