import { Badge } from '@/components/ui/badge.tsx'

const INDEX: Record<string, { v: 'secondary' | 'warning' | 'success' | 'destructive'; label: string }> = {
  pending: { v: 'secondary', label: 'not indexed' },
  queued: { v: 'secondary', label: 'queued' },
  indexing: { v: 'warning', label: 'indexing' },
  ready: { v: 'success', label: 'indexed' },
  failed: { v: 'destructive', label: 'indexing failed' },
}
export function IndexBadge({ status }: { status: string }) {
  const s = INDEX[status] ?? { v: 'secondary' as const, label: status }
  return <Badge variant={s.v}>{s.label}</Badge>
}

const PLAN: Record<string, { v: 'secondary' | 'warning' | 'success' | 'destructive'; label: string }> = {
  queued: { v: 'secondary', label: 'queued' },
  extracting: { v: 'warning', label: 'reading SRS' },
  analyzing: { v: 'warning', label: 'planning' },
  ready: { v: 'success', label: 'ready' },
  failed: { v: 'destructive', label: 'failed' },
}
export function PlanBadge({ status }: { status: string }) {
  const s = PLAN[status] ?? { v: 'secondary' as const, label: status }
  return <Badge variant={s.v}>{s.label}</Badge>
}

const REQ: Record<string, { v: 'secondary' | 'warning' | 'success' | 'destructive' | 'info'; label: string }> = {
  missing: { v: 'info', label: 'to build' },
  partial: { v: 'warning', label: 'to extend' },
  conflict: { v: 'destructive', label: 'conflicts' },
  exists: { v: 'success', label: 'already there' },
  unclear: { v: 'secondary', label: 'unclear' },
}
export function RequirementStatus({ status }: { status: string }) {
  const s = REQ[status] ?? { v: 'secondary' as const, label: status }
  return <Badge variant={s.v}>{s.label}</Badge>
}
