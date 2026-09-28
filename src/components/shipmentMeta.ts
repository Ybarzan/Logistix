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
  low: '#1fe0b8',
  normal: '#5b8cff',
  high: '#ffb547',
  urgent: '#ff5f6d',
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
  low: '#1fe0b8',
  medium: '#ffb547',
  high: '#5b8cff',
  critical: '#ff5f6d',
}

export const eventColors: Record<string, string> = {
  created: '#8591ae',
  processed: '#5b8cff',
  in_transit: '#1fe0b8',
  delayed: '#ffb547',
  delivered: '#1fe0b8',
  cancelled: '#ff5f6d',
  custom: '#9b7bff',
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
/**
 * Valeur pour <input type="datetime-local"> en HEURE LOCALE. (toISOString()
 * donne de l'UTC : réenregistrer le formulaire décalait l'échéance du
 * fuseau horaire, ex. −2 h en été à Paris.)
 */
export function toDatetimeLocal(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
