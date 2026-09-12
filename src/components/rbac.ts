export type Role = 'admin' | 'manager' | 'operator' | 'viewer'

/**
 * Rang de chaque rôle pour la hiérarchie d'héritage :
 * admin > manager > operator > viewer. Un rôle supérieur hérite
 * des permissions des rôles inférieurs (miroir de convex/orgContext.ts).
 */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  manager: 2,
  admin: 3,
}

/**
 * Vérifie que le rôle courant est au moins `minRole`.
 * Un rôle `undefined` (non connecté / rôle absent) ne peut rien faire.
 */
export function can(role: Role | undefined, minRole: Role): boolean {
  if (!role) return false
  return ROLE_RANK[role] >= ROLE_RANK[minRole]
}

/** Libellé français du rôle, pour l'affichage. */
export function roleLabel(role: Role | undefined): string {
  switch (role) {
    case 'admin':
      return 'Administrateur'
    case 'manager':
      return 'Manager'
    case 'operator':
      return 'Opérateur'
    case 'viewer':
      return 'Lecteur'
    default:
      return '—'
  }
}