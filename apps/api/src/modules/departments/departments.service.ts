import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class DepartmentsService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    const r = await this.db.query(
      `SELECT d.id, d.name, d.description, d.created_at AS "createdAt",
              COUNT(u.id)::int AS "memberCount"
       FROM departments d
       LEFT JOIN users u ON u.department = d.name
       GROUP BY d.id ORDER BY d.name`,
    );
    return { departments: r.rows };
  }

  async create(name: string, description?: string) {
    const r = await this.db.query(
      `INSERT INTO departments (name, description) VALUES ($1, $2)
       RETURNING id, name, description, created_at AS "createdAt"`,
      [name, description ?? null],
    );
    return { department: r.rows[0] };
  }

  async update(id: string, fields: { name?: string; description?: string | null }) {
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (fields.name !== undefined) { updates.push(`name = $${idx++}`); values.push(fields.name); }
    if ('description' in fields) { updates.push(`description = $${idx++}`); values.push(fields.description ?? null); }
    if (!updates.length) return;
    values.push(id);
    const r = await this.db.query(
      `UPDATE departments SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, name, description, created_at AS "createdAt"`,
      values,
    );
    if (!r.rows[0]) throw new NotFoundException('Department not found');
    return { department: r.rows[0] };
  }

  async delete(id: string) {
    await this.db.query('DELETE FROM departments WHERE id = $1', [id]);
    return {};
  }
}
