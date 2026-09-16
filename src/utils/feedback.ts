import { auth } from '../lib/firebase';
import { CURRENT_BUILD } from './appUpdate';

/**
 * Send a feedback message.
 *
 * The screen the person was looking at is attached automatically. That is the
 * entire reason this exists rather than a survey link: "I got stuck" is worth
 * little without "…on the vault screen", and nobody remembers which screen it
 * was by the time they'd have filled in a form.
 *
 * Throws with a message safe to show, so the caller can just display it.
 */
export async function sendFeedback(message: string, screen: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in first.');

  const token = await user.getIdToken();
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, screen, appVersion: CURRENT_BUILD }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Couldn’t send that — please try again.');
}
