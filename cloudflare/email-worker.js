/**
 * Cloudflare Email Worker — CommunityEvents calendar reply handler
 *
 * Receives inbound email sent to a community's calendar organizer address when
 * a member taps Accept/Maybe/Decline on a calendar invite, then forwards the raw
 * message to the deployment that sent the invite.
 *
 * Deployed as `communityevents_calendar`. v1's `dinnerbear_calendar` is a
 * separate Worker running v1's copy of this file — do not point this one at
 * dinnerbears.com, and do not edit that one from here.
 *
 * The route list is the access control: this Worker forwards whatever is
 * routed to it. See docs/CUTOVER_PLAN.md, "Inbound mail — calendar replies".
 *
 * Variables (Workers > Settings > Variables & Secrets):
 *   CLOUDFLARE_EMAIL_SECRET  — secret, must match the API container's env
 *   STAGE_API_URL            — https://stage.communityeventsproject.com
 *   API_URL                  — production; deliberately unset until it exists
 *
 * There is no hardcoded fallback host. An address whose deployment has no URL
 * set is dropped with a log line, rather than posted to a guess — v1's copy
 * fell back to the dinnerbears.com apex, which has no A record, so an unset
 * variable failed silently while Cloudflare reported the message as Handled.
 */

export default {
  async email(message, env, ctx) {
    const secret = env.CLOUDFLARE_EMAIL_SECRET ?? '';
    if (!secret) {
      console.error('CLOUDFLARE_EMAIL_SECRET is not set — dropping email');
      return;
    }

    // Route to prod or stage based on which address received the email
    const to = (message.to ?? '').toLowerCase();
    const apiUrl = to.startsWith('calendar-stage@') ? env.STAGE_API_URL : env.API_URL;
    if (!apiUrl) {
      console.error(`No API URL configured for ${to} — dropping email`);
      return;
    }

    let raw;
    try {
      raw = await new Response(message.raw).text();
    } catch (err) {
      console.error('Failed to read raw email:', err);
      return;
    }

    let response;
    try {
      response = await fetch(`${apiUrl}/api/v1/calendar/rsvp-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cloudflare-Secret': secret,
        },
        body: JSON.stringify({ raw }),
      });
    } catch (err) {
      console.error(`Failed to POST to ${apiUrl}/api/v1/calendar/rsvp-reply:`, err);
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      console.error(`rsvp-reply returned ${response.status}: ${text}`);
    }
  },
};
