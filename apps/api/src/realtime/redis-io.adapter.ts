import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions, Server } from 'socket.io';
import { RedisService } from '../redis/redis.service';

/**
 * Lets more than one API instance share its socket rooms.
 *
 * Rooms live in the memory of the process that created them. With a single instance that is
 * invisible; with two, everything still *looks* right — both are healthy, both accept connections,
 * messages are written and read — while two people who happen to land on different instances never
 * see each other's messages. Nothing errors. That silence is what made this worth fixing before
 * anyone scaled the service rather than after.
 *
 * The adapter puts every room broadcast onto Redis pub/sub, so an instance relays to its own
 * sockets and publishes for the others.
 *
 * It degrades rather than fails. If Redis is unreachable at startup the server still runs and
 * still delivers within its own process — which is exactly correct on a single instance, and no
 * worse than before on several — and picks the others up when Redis returns, because both
 * connections carry the same retry strategy as the rest of the app.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext, private readonly redis: RedisService) {
    super(app);
  }

  connect(): void {
    // Two connections, not one: a client in subscribe mode may not issue ordinary commands, so the
    // subscriber cannot be reused for anything else.
    const pubClient = this.redis.duplicate('socket-pub');
    const subClient = this.redis.duplicate('socket-sub');
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Socket.IO rooms are shared through Redis');
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
