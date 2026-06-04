/**
 * Serializer — locations Drizzle-row → API-DTO.
 * timestamps → ISO-string; address jsonb shape stabiel houden.
 */
import type { Location } from '../../db/schema/locations.js';

export interface LocationDto {
  id: string;
  code: string;
  name: string;
  type: string;
  priority: number;
  address: Record<string, unknown> | null;
  active: boolean;
  createdAt: string;
}

export function toLocationDto(l: Location): LocationDto {
  return {
    id: l.id,
    code: l.code,
    name: l.name,
    type: l.type,
    priority: l.priority,
    address: (l.address ?? null) as Record<string, unknown> | null,
    active: l.active,
    createdAt: l.createdAt.toISOString(),
  };
}
