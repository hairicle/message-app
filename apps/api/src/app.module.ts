import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/guards/throttler.guard';
import envConfig from './config/env.config';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AccountStatusModule } from './common/account-status.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { FilesModule } from './modules/files/files.module';
import { CallsModule } from './modules/calls/calls.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TeamsModule } from './modules/teams/teams.module';
import { AdminModule } from './modules/admin/admin.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [envConfig] }),
    // 300 a minute, not the 100 this was configured with. The limit was never enforced, so the
    // number had never met real traffic: opening a conversation fetches every visible attachment
    // individually, and a media gallery of a hundred photos is a hundred requests in a few
    // seconds. Enforcing 100 would have rate-limited ordinary scrolling. 300 leaves the app room
    // and still stops a script, which is what the routes that need a tight budget say for
    // themselves — see the @Throttle decorators on the login endpoints.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    AccountStatusModule,
    DatabaseModule,
    RedisModule,
    AuthModule,
    UsersModule,
    ConversationsModule,
    MessagesModule,
    FilesModule,
    CallsModule,
    MeetingsModule,
    TasksModule,
    TeamsModule,
    AdminModule,
    DepartmentsModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
  // The guard the ThrottlerModule above was always meant to have. Without this binding the module
  // is configuration nobody reads.
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
