'use client'
import { useState, useTransition } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { decideArtifact } from '@/lib/actions/backlog.ts'
import { Button } from '@/components/ui/button.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { cn } from '@/lib/utils.ts'

type Kind = 'stories' | 'tasks' | 'test_scenarios'
const NOUN: Record<Kind, string> = { stories: 'story', tasks: 'task', test_scenarios: 'test scenario' }

export function Artifact({ kind, id, text, aiOriginal, status, meta, className, locked = false }: {
  kind: Kind; id: number; text: string; aiOriginal: string
  status: string; meta?: React.ReactNode; className?: string; locked?: boolean
}) {
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const [error, setError] = useState<string>()
  const edited = text !== aiOriginal
  const act = (p: Parameters<typeof decideArtifact>[2], then?: () => void) =>
    start(async () => {
      try { await decideArtifact(kind, id, p); setError(undefined); then?.() }
      catch (e) { setError((e as Error).message) }
    })

  if (editing) {
    return (
      <div className="py-1">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
                  aria-label={`Edit ${NOUN[kind]}`} autoFocus />
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={pending || !draft.trim()}
                  onClick={() => act({ status: 'edited', editedText: draft.trim() }, () => setEditing(false))}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending}
                  onClick={() => { setDraft(text); setError(undefined); setEditing(false) }}>Cancel</Button>
        </div>
        {error && <p role="alert" className="mt-1 text-xs text-[var(--color-error)]">{error}</p>}
      </div>
    )
  }

  const on = 'opacity-100 text-[var(--color-primary)] bg-[var(--color-base-200)]'
  return (
    <div className={cn('group flex flex-wrap items-start gap-2 py-1.5', status === 'dismissed' && 'opacity-50', className)}>
      <div className="min-w-0 flex-1">
        <span className={cn(status === 'dismissed' && 'line-through')}>{text}</span>{' '}
        {meta != null && <span className="contents">{meta}</span>}
        {status !== 'proposed' && (
          <Badge variant="outline" className="ml-2">{status === 'dismissed' ? 'dropped' : status}</Badge>
        )}
        {edited && (
          <details className="mt-1 text-xs opacity-70">
            <summary className="cursor-pointer">What the AI originally proposed</summary>
            <p className="mt-1">{aiOriginal}</p>
          </details>
        )}
        {error && <p role="alert" className="mt-1 text-xs font-normal text-[var(--color-error)]">{error}</p>}
      </div>
      {!locked && (
        <div className={cn('flex shrink-0 gap-1 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                           status === 'proposed' ? 'opacity-70' : 'opacity-40')}>
          <Button size="icon" variant="ghost" className={cn('h-7 w-7', status === 'accepted' && on)}
                  title="Accept" aria-label={`Accept ${NOUN[kind]}`} aria-pressed={status === 'accepted'}
                  disabled={pending} onClick={() => act({ status: 'accepted' })}>
            <Check className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button size="icon" variant="ghost" className={cn('h-7 w-7', status === 'edited' && on)}
                  title="Edit" aria-label={`Edit ${NOUN[kind]}`} disabled={pending}
                  onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button size="icon" variant="ghost" className={cn('h-7 w-7', status === 'dismissed' && on)}
                  title="Drop" aria-label={`Drop ${NOUN[kind]}`} aria-pressed={status === 'dismissed'}
                  disabled={pending} onClick={() => act({ status: 'dismissed' })}>
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  )
}
