export const statusLabels: Record<string, string> = {
  pending: 'En attente',
  loading: 'Chargement',
  in_transit: 'Transit',
  delivered: 'Livré',
  delayed: 'Retard',
  cancelled: 'Annulé',
}

export const statusClasses: Record<string, string> = {
  pending: 'pending',
  loading: 'transit',
  in_transit: 'transit',
  delivered: 'delivered',
  delayed: 'delayed',
  cancelled: 'delayed',
}

export const priorityColors: Record<string, string> = {
  low: '#00d4aa',
  normal: '#3b82f6',
  high: '#f59e0b',
  urgent: '#ef4444',
}

export const incidentTypeLabels: Record<string, string> = {
  breakdown: 'Panne matérielle',
  customs: 'Douane',
  capacity: 'Capacité',
  delay: 'Retard réseau',
  damage: 'Dommage',
  other: 'Autre',
}

export const severityColors: Record<string, string> = {
  low: '#00d4aa',
  medium: '#f59e0b',
  high: '#3b82f6',
  critical: '#ef4444',
}

export const eventColors: Record<string, string> = {
  created: '#6b7a99',
  processed: '#3b82f6',
  in_transit: '#00d4aa',
  delayed: '#f59e0b',
  delivered: '#00d4aa',
  cancelled: '#ef4444',
  custom: '#7048e8',
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(ts: number | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return hours > 0 ? `${hours}h ${mins}min` : `${mins}min`
}