import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { PrismaService } from './prisma.service';

// Both are exported during the migration off raw SQL: services are being converted to
// PrismaService one at a time, and DatabaseService still backs the ones not yet moved.
@Global()
@Module({
  providers: [DatabaseService, PrismaService],
  exports: [DatabaseService, PrismaService],
})
export class DatabaseModule {}
