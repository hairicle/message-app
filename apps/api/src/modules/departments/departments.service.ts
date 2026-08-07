import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** The API has always exposed camelCase; the columns are snake_case. */
export interface DepartmentDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

const toDto = (d: { id: string; name: string; description: string | null; created_at: Date }): DepartmentDto => ({
  id: d.id,
  name: d.name,
  description: d.description,
  createdAt: d.created_at,
});

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    // users.department holds the department *name*, not a foreign key, so there is no relation
    // for Prisma to count through. Group the users separately and merge.
    const [departments, counts] = await Promise.all([
      this.prisma.departments.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.users.groupBy({ by: ['department'], _count: { _all: true } }),
    ]);

    const byName = new Map(counts.map((c) => [c.department, c._count._all]));
    return {
      departments: departments.map((d) => ({ ...toDto(d), memberCount: byName.get(d.name) ?? 0 })),
    };
  }

  async create(name: string, description?: string) {
    const department = await this.prisma.departments.create({
      data: { name, description: description ?? null },
    });
    return { department: toDto(department) };
  }

  async update(id: string, fields: { name?: string; description?: string | null }) {
    // Prisma omits undefined keys, so the old hand-rolled SET builder is unnecessary — but
    // `description: null` must still clear the column, which is why 'in' is used rather than
    // an undefined check.
    const data: Prisma.departmentsUpdateInput = {};
    if (fields.name !== undefined) data.name = fields.name;
    if ('description' in fields) data.description = fields.description ?? null;
    if (Object.keys(data).length === 0) return;

    try {
      const department = await this.prisma.departments.update({ where: { id }, data });
      return { department: toDto(department) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('Department not found');
      }
      throw err;
    }
  }

  async delete(id: string) {
    // Matches the previous DELETE, which was a no-op when the row was already gone.
    await this.prisma.departments.deleteMany({ where: { id } });
    return {};
  }
}
