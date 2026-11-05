import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components';
import { editorialArt } from '@/ui/editorialArt';
import { ConfirmDialog, GlassButton, GlassCard, GlassScreen, ListGroup, Pill, Row, StatusBadge, StatusNote, UnavailableState } from '@/ui/glass';
import { radius, space } from '@/ui/tokens';

import { SyntheticBanner, useBackTo } from '../components/FamilyChrome';
import { FamilyUnconnected, ResourceGate } from '../components/ResourceGate';
import { FamilyCommandError, type EventChild, type EventDetail, type FamilyEvent } from '../data/repositories';
import { useFamily } from '../FamilyContext';
import { CommandLatches, rsvpKey } from '../domain/commandLatch';
import { eventWhen, instantStamp } from '../domain/format';
import { routeId } from '../domain/progress';
import { rsvpAction, rsvpFailure } from '../domain/rsvp';
import { useFamilyResource } from '../hooks';
import { EVENT_COPY } from '../strings';

type Feedback = { tone: 'success' | 'danger' | 'info'; message: string; retry?: () => void } | null;

/**
 * FA-10 Event detail & RSVP (`/family/events/[eventId]`) with FA-11 Cancel RSVP as a dialog. Per-child attendance;
 * "Going" appears only after the server confirms (no optimistic seat). A retry after a network failure resends the SAME
 * operation id, so a lost response can never book twice. No waitlist, no list of other families.
 */
export function EventDetailScreen() {
  const params = useLocalSearchParams<{ eventId?: string }>();
  const eventId = routeId(params.eventId);
  const back = useBackTo('/family/community');
  const { repos } = useFamily();
  return (
    <GlassScreen header={{ onBack: back, title: EVENT_COPY.title }} testID="family-event">
      {!repos ? <FamilyUnconnected testID="event" /> : eventId ? <EventLoader eventId={eventId} /> : <EventNotFound />}
    </GlassScreen>
  );
}

function EventNotFound() {
  const router = useRouter();
  return (
    <GlassCard>
      <UnavailableState title={EVENT_COPY.notFoundTitle} message={EVENT_COPY.notFound} testID="event-not-found" />
      <GlassButton variant="secondary" icon="calendar-outline" label="Go to Community" onPress={() => router.replace('/family/community')} />
    </GlassCard>
  );
}

function EventLoader({ eventId }: { eventId: string }) {
  const { scope, repos } = useFamily();
  const res = useFamilyResource(['event', eventId], (r) => r.events.detail(scope, eventId));
  const [latches] = useState(() => new CommandLatches());
  const [shown, setShown] = useState<EventDetail | null>(null);
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmFor, setConfirmFor] = useState<EventChild | null>(null);
  if (res.status === 'ready' && res.data !== shown) setShown(res.data);

  const run = async (action: 'rsvp' | 'cancel', child: EventChild) => {
    if (!repos) return;
    const key = rsvpKey(eventId, child.childId, action);
    const operationId = latches.idFor(key);
    setInFlight(child.childId);
    setFeedback(null);
    try {
      const cmd = { eventId, childId: child.childId, operationId };
      const r = action === 'rsvp' ? await repos.events.rsvp(scope, cmd) : await repos.events.cancel(scope, cmd);
      latches.settle(key, 'acknowledged');
      setFeedback({
        tone: 'success',
        message: action === 'rsvp' ? (r.already ? EVENT_COPY.alreadyReserved(child.firstName) : EVENT_COPY.reserved(child.firstName)) : EVENT_COPY.released(child.firstName),
      });
      res.retry(); // read the current state (a replay returns the answer as it was then)
    } catch (e) {
      const err = e instanceof FamilyCommandError ? e : new FamilyCommandError('unexpected', '');
      latches.settle(key, err.kind === 'network' ? 'network' : 'refused');
      const f = rsvpFailure(err.kind, err.serverMessage);
      setFeedback({ tone: 'danger', message: f.text, retry: f.retry ? () => void run(action, child) : undefined });
      if (f.refresh) res.retry();
    } finally {
      setInFlight(null);
    }
  };

  const dialog = (
    <ConfirmDialog
      visible={confirmFor !== null}
      title={EVENT_COPY.cancelTitle(confirmFor?.firstName ?? '')}
      message={EVENT_COPY.cancelMessage}
      confirmLabel={EVENT_COPY.cancelConfirm}
      cancelLabel={EVENT_COPY.keep}
      destructiveIcon="close-circle-outline"
      onConfirm={async () => {
        const child = confirmFor;
        if (child) await run('cancel', child);
        setConfirmFor(null);
      }}
      onCancel={() => setConfirmFor(null)}
      testID="cancel-rsvp-dialog"
    />
  );
  const body = (detail: EventDetail, refreshing: boolean) => (
    <EventBody detail={detail} inFlight={inFlight} feedback={feedback} onRsvp={(c) => void run('rsvp', c)} onCancel={setConfirmFor} refreshing={refreshing} />
  );
  return (
    <>
      {/* While refreshing after a command, keep the last confirmed state on screen instead of a skeleton. */}
      {res.status === 'loading' && shown ? (
        body(shown, true)
      ) : (
        <ResourceGate resource={res} loadingLabel={EVENT_COPY.loading} rows={3} notFound={<EventNotFound />} testID="event">
          {(detail) => body(detail, false)}
        </ResourceGate>
      )}
      {dialog}
    </>
  );
}

function EventBody({
  detail,
  inFlight,
  feedback,
  onRsvp,
  onCancel,
  refreshing = false,
}: {
  detail: EventDetail;
  inFlight: string | null;
  feedback: Feedback;
  onRsvp: (c: EventChild) => void;
  onCancel: (c: EventChild) => void;
  refreshing?: boolean;
}) {
  const e = detail.event;
  return (
    <>
      <SyntheticBanner source={detail.source} />
      <GlassCard variant="photo" image={editorialArt.communityEvent} height={220} radius={radius.hero - 4} contentStyle={styles.heroContent} testID="event-hero">
        <View style={styles.row}>
          <Pill label={EVENT_COPY.illustration} icon="color-palette-outline" material="thick" />
        </View>
        <AppText variant="title" tone="onPhoto" header numberOfLines={3} testID="event-title">
          {e.title}
        </AppText>
      </GlassCard>

      {e.status === 'cancelled' ? <StatusNote tone="danger" title={EVENT_COPY.cancelledTitle} message={EVENT_COPY.cancelled} testID="event-cancelled" /> : null}

      <ListGroup testID="event-facts">
        <Row icon="calendar-outline" label={EVENT_COPY.when} value={eventWhen(e.startsAt, e.endsAt)} />
        <Row icon="location-outline" label={EVENT_COPY.where} value={e.venue} />
        <Row icon="people-outline" label={EVENT_COPY.places} value={EVENT_COPY.placesValue(e.seatsLeft, e.capacity)} testID="event-places" />
        {e.rsvpClosesAt ? <Row icon="time-outline" label={EVENT_COPY.repliesClose} value={instantStamp(e.rsvpClosesAt)} /> : null}
      </ListGroup>

      {e.description ? (
        <GlassCard>
          <AppText variant="section" header>
            {EVENT_COPY.about}
          </AppText>
          <AppText>{e.description}</AppText>
        </GlassCard>
      ) : null}

      <GlassCard testID="event-attendance">
        <View style={styles.head}>
          <AppText variant="section" header>
            {EVENT_COPY.attendance}
          </AppText>
          <AppText variant="secondary" tone="muted">
            {EVENT_COPY.attendanceNote}
          </AppText>
        </View>
        {e.children.length === 0 ? <AppText tone="muted">{EVENT_COPY.noChildHere}</AppText> : null}
        {e.children.map((c) => (
          <ChildAttendance key={c.childId} event={e} child={c} busy={inFlight === c.childId} locked={inFlight !== null || refreshing} onRsvp={onRsvp} onCancel={onCancel} />
        ))}
        {e.status === 'published' && e.seatsLeft <= 0 ? <AppText variant="secondary" tone="muted">{EVENT_COPY.noWaitlist}</AppText> : null}
      </GlassCard>

      {feedback ? (
        <View style={styles.feedback}>
          <StatusNote tone={feedback.tone} message={feedback.message} testID="rsvp-feedback" />
          {feedback.retry ? <GlassButton variant="secondary" icon="refresh" label="Try again" onPress={feedback.retry} testID="rsvp-retry" /> : null}
        </View>
      ) : null}
    </>
  );
}

function ChildAttendance({ event, child, busy, locked, onRsvp, onCancel }: { event: FamilyEvent; child: EventChild; busy: boolean; locked: boolean; onRsvp: (c: EventChild) => void; onCancel: (c: EventChild) => void }) {
  const action = rsvpAction(event, child.status, busy);
  const going = child.status === 'confirmed';
  return (
    <View style={styles.child} testID={`attendance-${child.childId}`}>
      <View style={styles.childHead}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {child.firstName}
        </AppText>
        <StatusBadge label={going ? EVENT_COPY.going : EVENT_COPY.notGoing} tone={going ? 'success' : 'neutral'} icon={going ? undefined : null} testID={`attendance-status-${child.childId}`} />
      </View>
      {action.kind === 'rsvp' || (action.kind === 'pending' && !going) ? (
        <GlassButton label={action.kind === 'rsvp' ? action.label : 'Reserve a place'} icon="checkmark-circle-outline" size="regular" loading={busy} disabled={locked && !busy} onPress={() => onRsvp(child)} accessibilityLabel={`Reserve a place for ${child.firstName}`} testID={`rsvp-${child.childId}`} />
      ) : action.kind === 'cancel' || (action.kind === 'pending' && going) ? (
        <GlassButton variant="secondary" label={action.kind === 'cancel' ? action.label : 'Cancel place'} icon="close-circle-outline" loading={busy} disabled={locked && !busy} onPress={() => onCancel(child)} accessibilityLabel={`Cancel ${child.firstName}’s place`} testID={`cancel-${child.childId}`} />
      ) : (
        <AppText variant="secondary" tone="muted" testID={`attendance-note-${child.childId}`}>
          {action.label}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  heroContent: { justifyContent: 'space-between' },
  head: { gap: space.xs },
  child: { gap: space.sm, paddingTop: space.sm },
  childHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  feedback: { gap: space.sm },
});
