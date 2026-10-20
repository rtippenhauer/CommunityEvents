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
 *   FALLBACK_FORWARD_TO      — a VERIFIED destination address (Email Routing >
 *                              Destination addresses), where a message we could
 *                              not hand to the API is sent instead. Optional;
 *                              unset means the old behaviour, a log line only.
 *
 * There is no hardcoded fallback host. An address whose deployment has no URL
 * set is dropped with a log line, rather than posted to a guess — v1's copy
 * fell back to the dinnerbears.com apex, which has no A record, so an unset
 * variable failed silently while Cloudflare reported the message as Handled.
 *
 * ## Why this forwards on failure instead of rejecting (v2-34)
 *
 * Every failure here used to `console.error` and return, and returning normally
 * is what makes Cloudflare mark the message **Handled** — so a message we never
 * processed looked delivered on their side and left nothing on ours. That is
 * how v1's apex misconfiguration went unnoticed.
 *
 * `message.setReject()` would make it visible, but the docs are explicit that it
 * is a *permanent* SMTP error: the member who pressed Accept gets a bounce for
 * an outage that is ours. Forwarding keeps the whole payload, puts it somewhere
 * a human reads, and tells the member nothing — which is right, because from
 * their side the Accept worked and the only person who can act is the operator.
 * This is Cloudflare's own documented fallback order (log, stash, forward,
 * reject last), stopping before the reject.
 *
 * Not built, and noted rather than forgotten: stashing the raw message in KV or
 * R2 and replaying it when the API returns. That is the only option that
 * recovers the RSVP without anybody retyping it, and it is worth having if
 * inbound volume ever makes hand-replay impractical.
 */

/**
 * Hand a message we could not deliver to a human instead.
 *
 * Never throws: it is called from the paths that are already failing, and an
 * exception escaping the email() handler changes how Cloudflare treats the
 * message. `canBeForwarded` is checked because Cloudflare refuses to forward
 * mail that fails SPF/DKIM (since July 2025), so this can legitimately be
 * impossible — in which case the log line is all there is, and it says so.
 */
async function forwardToOperator(message, env, why) {
  const to = env.FALLBACK_FORWARD_TO;
  if (!to) {
    console.error(`${why} — FALLBACK_FORWARD_TO is unset, so the message is lost`);
    return;
  }
  if (message.canBeForwarded === false) {
    console.error(`${why} — and it cannot be forwarded (SPF/DKIM), so the message is lost`);
    return;
  }
  try {
    await message.forward(to);
    console.error(`${why} — forwarded to ${to} for manual handling`);
  } catch (err) {
    console.error(`${why} — and forwarding to ${to} failed, so the message is lost:`, err);
  }
}

export default {
  async email(message, env, ctx) {
    const secret = env.CLOUDFLARE_EMAIL_SECRET ?? '';
    if (!secret) {
      await forwardToOperator(message, env, 'CLOUDFLARE_EMAIL_SECRET is not set');
      return;
    }

    // Route to prod or stage based on which address received the email
    const to = (message.to ?? '').toLowerCase();
    const apiUrl = to.startsWith('calendar-stage@') ? env.STAGE_API_URL : env.API_URL;
    if (!apiUrl) {
      await forwardToOperator(message, env, `No API URL configured for ${to}`);
      return;
    }

    let raw;
    try {
      raw = await new Response(message.raw).text();
    } catch (err) {
      console.error('Failed to read raw email:', err);
      await forwardToOperator(message, env, 'Could not read the raw message');
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
      await forwardToOperator(message, env, `Could not reach ${apiUrl}`);
      return;
    }

    if (response.ok) return;

    const text = await response.text().catch(() => '(no body)');
    console.error(`rsvp-reply returned ${response.status}: ${text}`);

    // **Forward only when nobody has a record of it.** A 4xx is the API
    // answering deliberately — a rejected secret, a malformed body — and as of
    // v2-34 each of those writes a row to the inbound log, which is a better
    // record than a copy in an inbox and is already visible on the screen.
    // A 5xx or a network failure may have happened before any row was written,
    // so those forward: a duplicate notice costs a glance, a lost reply costs
    // a member their seat.
    if (response.status >= 500) {
      await forwardToOperator(message, env, `${apiUrl} answered ${response.status}`);
    }
  },
};
