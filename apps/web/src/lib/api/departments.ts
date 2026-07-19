import { apiFetch } from './client';

export interface Department {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export function listDepartments() {
  return apiFetch<{ departments: Department[] }>('/api/departments');
}

export function createDepartment(name: string, description?: string) {
  return apiFetch<{ department: Department }>('/api/departments', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export function updateDepartment(id: string, fields: { name?: string; description?: string | null }) {
  return apiFetch<{ department: Department }>(`/api/departments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function deleteDepartment(id: string) {
  return apiFetch<void>(`/api/departments/${id}`, { method: 'DELETE' });
}
