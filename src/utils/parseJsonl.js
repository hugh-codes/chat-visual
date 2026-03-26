/**
 * Parses a JSONL string from a Twitter Spaces / live stream export.
 *
 * Each line is a JSON object with an outer `kind` field:
 *  - kind=1: a stream event whose `payload` field (JSON string) contains
 *            a nested `body` (JSON string) with message data.
 *            body.type=2  → emoji reaction
 *            body.type=40 → session/system event (ignored)
 *  - kind=2: a presence / join event whose `payload` contains sender info.
 *
 * Returns an array of normalised event objects sorted by timestamp.
 */
export function parseJsonl(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  const reactions = [];
  const joins = [];
  let minTimestamp = Infinity;

  for (const line of lines) {
    try {
      const outer = JSON.parse(line);

      if (outer.kind === 1) {
        const payload = JSON.parse(outer.payload);
        const body = JSON.parse(payload.body || '{}');

        if (body.type === 2) {
          const ts = body.timestamp ?? body.ntpForLiveFrame ?? null;

          // Skip reactions with no usable timestamp — storing null would make
          // the JS comparison `null <= now` evaluate to true (null coerces to 0)
          // causing every un-timed reaction to appear the moment the overlay
          // mounts.
          if (ts === null) continue;

          if (ts < minTimestamp) minTimestamp = ts;

          reactions.push({
            id: body.uuid ?? `reaction-${reactions.length}`,
            type: 'reaction',
            emoji: body.body,
            displayName: body.displayName ?? 'Anonymous',
            remoteID: body.remoteID ?? '',
            timestamp: ts,
            programDateTime: body.programDateTime ?? null,
          });
        }
        // type=40 is a session/system event – skip

      } else if (outer.kind === 2) {
        const payload = JSON.parse(outer.payload);
        if (payload.kind === 1 && payload.sender) {
          const s = payload.sender;
          joins.push({
            id: `join-${s.user_id ?? joins.length}`,
            type: 'join',
            displayName: s.display_name ?? s.username ?? 'Unknown',
            username: s.username ?? '',
            profileImage: s.profile_image_url ?? '',
            userId: s.user_id ?? '',
          });
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Assign join events to the very start of the stream
  const baseline = isFinite(minTimestamp) ? minTimestamp : 0;
  const joinEvents = joins.map((j) => ({ ...j, timestamp: baseline }));

  const events = [...reactions, ...joinEvents];
  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

/**
 * Given a sorted array of events, returns [minTs, maxTs] in milliseconds.
 */
export function getTimeRange(events) {
  if (!events.length) return [0, 0];
  const ts = events.map((e) => e.timestamp).filter(Number.isFinite);
  return [Math.min(...ts), Math.max(...ts)];
}
