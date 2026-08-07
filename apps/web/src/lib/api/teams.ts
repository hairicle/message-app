import { apiFetch } from './client';
import type { Team, TeamMember } from '@messenger/shared';

export function listMyTeams() {
  return apiFetch<{ teams: Team[] }>('/api/teams');
}

export function listTeamMembers(teamId: string) {
  return apiFetch<{ members: TeamMember[] }>(`/api/teams/${teamId}/members`);
}
