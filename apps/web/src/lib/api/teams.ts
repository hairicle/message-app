import { apiFetch } from './client';
import type { Team, TeamMember } from '@messenger/shared';

export function listMyTeams() {
  return apiFetch<{ teams: Team[] }>('/api/teams');
}

export function createTeam(input: { name: string; description?: string }) {
  return apiFetch<{ team: Team }>('/api/teams', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getTeam(id: string) {
  return apiFetch<{ team: Team }>(`/api/teams/${id}`);
}

export function listTeamMembers(teamId: string) {
  return apiFetch<{ members: TeamMember[] }>(`/api/teams/${teamId}/members`);
}

export function addTeamMember(teamId: string, userId: string, role: 'admin' | 'member' = 'member') {
  return apiFetch<void>(`/api/teams/${teamId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId, role }),
  });
}

export function removeTeamMember(teamId: string, userId: string) {
  return apiFetch<void>(`/api/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
}
