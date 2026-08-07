import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
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
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
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
})
export class AppModule {}
