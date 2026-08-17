import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { pushPayload, pushTargets, type PushTarget } from './push-recipients';

/**
 * Sends a notification to a phone when a message arrives.
 *
 * The reason an app exists at all rather than a browser icon: a socket cannot survive the operating
 * system suspending the app, so once the phone is in a pocket, push is the only way anything gets
 * through.
 *
 * ## It does nothing until it is configured
 *
 * Firebase credentials are optional. Without them this warns once at startup and every send is a
 * no-op — the API runs exactly as it did before, which is what should happen on a developer's
 * machine and in any deployment that has not set it up yet. It is not fail-closed because a
 * missing notification is not worth refusing to start over.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  /** The firebase-admin messaging handle, or null when unconfigured. */
  private messaging: { sendEachForMulticast: (m: unknown) => Promise<unknown> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly messages: MessagesService,
  ) {}

  async onModuleInit() {
    await this.initialiseFirebase();

    // The same emitter the gateway relays from, rather than a second delivery path. A message
    // created over HTTP, over the socket or by a forward all pass through here — which is exactly
    // why that emitter exists: an earlier attempt at a second path notified nobody.
    this.messages.events.on('message:new', (message: {
      id: string; conversationId: string; senderId: string | null; type: string;
    }) => {
      // Never awaited by the sender. A push that is slow, or a Firebase outage, must not delay or
      // fail the message it is about.
      this.notify(message).catch((err) => {
        this.logger.warn(`Push for message ${message.id} failed: ${err instanceof Error ? err.message : err}`);
      });
    });
  }

  private async initialiseFirebase() {
    const raw = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (!raw) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON is not set — push notifications are disabled');
      return;
    }

    try {
      // Imported here rather than at the top so the dependency is only loaded when it is used, and
      // an unconfigured deployment pays nothing for it.
      //
      // `.default ?? module`: firebase-admin is CommonJS, so a dynamic import wraps it in a
      // namespace object whose members live under `default`. The fallback keeps this working if
      // that ever changes.
      const imported = await import('firebase-admin');
      const admin = ((imported as unknown as { default?: FirebaseAdmin }).default
        ?? (imported as unknown as FirebaseAdmin));
      const credential = JSON.parse(
        raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'),
      );
      const app = admin.apps.length
        ? admin.app()
        : admin.initializeApp({ credential: admin.credential.cert(credential) });
      this.messaging = admin.messaging(app) as never;
      this.logger.log('Push notifications enabled');
    } catch (err) {
      // A malformed key is a deployment mistake, not a reason to refuse to serve messages.
      this.logger.error(`Firebase credentials could not be read — push disabled: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Whether a send would do anything. Public so the health of the feature is observable. */
  get enabled(): boolean {
    return this.messaging !== null;
  }

  /**
   * Register the token this device should be reached on.
   *
   * Scoped to the device the caller is authenticated as, so one session cannot redirect another's
   * notifications. A token can move between devices when an app is reinstalled, so it is cleared
   * from any other row first — otherwise one phone would receive another's messages.
   */
  async registerToken(deviceId: string, token: string): Promise<void> {
    await this.prisma.user_devices.updateMany({
      where: { push_token: token, id: { not: deviceId } },
      data: { push_token: null },
    });
    await this.prisma.user_devices.update({
      where: { id: deviceId },
      data: { push_token: token, last_active_at: new Date() },
    });
  }

  /** Stop sending to this device. Called on sign-out. */
  async clearToken(deviceId: string): Promise<void> {
    await this.prisma.user_devices
      .update({ where: { id: deviceId }, data: { push_token: null } })
      .catch(() => undefined);
  }

  /**
   * Work out who should hear about a message, and tell them.
   *
   * The membership, mute state and preferences are read in one query per concern rather than per
   * member, because a group of fifty would otherwise be fifty round trips for one message.
   */
  private async notify(message: {
    id: string; conversationId: string; senderId: string | null; type: string;
  }): Promise<void> {
    if (!this.messaging) return;

    const [conversation, members] = await Promise.all([
      this.prisma.conversations.findUnique({
        where: { id: message.conversationId },
        select: { name: true, type: true },
      }),
      this.prisma.conversation_members.findMany({
        where: { conversation_id: message.conversationId },
        select: {
          user_id: true,
          muted_until: true,
          users: {
            select: {
              display_name: true,
              notification_preferences: { select: { push_enabled: true } },
              user_devices: {
                where: { push_token: { not: null } },
                select: { id: true, push_token: true },
              },
            },
          },
        },
      }),
    ]);

    const sender = members.find((m) => m.user_id === message.senderId);
    const targets = pushTargets(
      members.flatMap((m) => m.users.user_devices.map((d) => ({
        userId: m.user_id, deviceId: d.id, pushToken: d.push_token!,
      }))),
      members.map((m) => ({
        userId: m.user_id,
        mutedUntil: m.muted_until,
        pushEnabled: m.users.notification_preferences?.push_enabled ?? null,
      })),
      message.senderId,
    );
    if (targets.length === 0) return;

    const payload = pushPayload({
      senderName: sender?.users.display_name ?? 'Someone',
      conversationId: message.conversationId,
      // A direct conversation has no name of its own — its title is the other person, which differs
      // per reader, so the sender's name is the only thing that means the same to everyone.
      conversationName: conversation?.type === 'direct' ? null : conversation?.name ?? null,
      messageId: message.id,
      type: message.type,
    });

    await this.deliver(targets, payload);
  }

  private async deliver(
    targets: PushTarget[],
    payload: { title: string; body: string; data: Record<string, string> },
  ): Promise<void> {
    const response = await this.messaging!.sendEachForMulticast({
      tokens: targets.map((t) => t.pushToken),
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      android: { priority: 'high', collapseKey: payload.data.conversationId },
    }) as { responses?: { success: boolean; error?: { code?: string } }[] };

    // A token stops being valid when the app is uninstalled or the token is rotated, and Firebase
    // says so. Clearing it stops every future message paying for a device that will never answer.
    const dead = (response.responses ?? [])
      .map((r, i) => (!r.success && isDeadToken(r.error?.code) ? targets[i].deviceId : null))
      .filter((id): id is string => id !== null);

    if (dead.length > 0) {
      await this.prisma.user_devices.updateMany({
        where: { id: { in: dead } },
        data: { push_token: null },
      });
      this.logger.log(`Cleared ${dead.length} push token(s) Firebase reported as no longer valid`);
    }
  }
}

/**
 * The parts of firebase-admin this uses.
 *
 * Declared rather than imported as a type: the package is loaded dynamically so an unconfigured
 * deployment never pays for it, and a top-level `import type` would tie the build to it being
 * present. Narrow on purpose — a wrong shape here shows up at startup, where the initialisation is
 * already wrapped and reported.
 */
interface FirebaseAdmin {
  apps: unknown[];
  app(): unknown;
  initializeApp(options: { credential: unknown }): unknown;
  credential: { cert(serviceAccount: unknown): unknown };
  messaging(app?: unknown): { sendEachForMulticast: (m: unknown) => Promise<unknown> };
}

/** The two Firebase codes that mean "this token will never work again". */
function isDeadToken(code: string | undefined): boolean {
  return code === 'messaging/registration-token-not-registered'
    || code === 'messaging/invalid-registration-token';
}
