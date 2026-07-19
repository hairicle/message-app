import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class DepartmentsService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    const r = await this.db.query(
      `SELECT d.*, COUNT(u.id)::int AS member_count
       FROM departments d LEFT JOIN users u ON u.department_id = d.id
       GROUP BY d.id ORDER BY d.name`,
    );
    return r.rows;
  }

  async create(name: string, description?: string) {
    const r = await this.db.query<{ id: string }>(
      'INSERT INTO departments (name, description) VALUES ($1, $2) RETURNING id',
      [name, description ?? null],
    );
    return { id: r.rows[0].id };
  }
}
