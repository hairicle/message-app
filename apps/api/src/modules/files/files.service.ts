import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class FilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async getFileMeta(fileId: string) {
    const r = await this.db.query<{
      id: string; file_name: string; mime_type: string; size_bytes: number;
      has_thumbnail: boolean; duration_secs: number | null; created_at: string;
    }>(
      'SELECT id, file_name, mime_type, size_bytes, has_thumbnail, duration_secs, created_at FROM files WHERE id = $1',
      [fileId],
    );
    if (!r.rows[0]) throw new NotFoundException('File not found');
    const row = r.rows[0];
    return {
      id: row.id, fileName: row.file_name, mimeType: row.mime_type,
      sizeBytes: row.size_bytes, hasThumbnail: row.has_thumbnail,
      durationSecs: row.duration_secs, createdAt: row.created_at,
    };
  }
}
