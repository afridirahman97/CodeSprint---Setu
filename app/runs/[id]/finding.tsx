'use client'
import { useState, useTransition } from 'react'
import { Check, Pencil, X, MessageSquare, FileCode2 } from 'lucide-react'
import { decideFinding } from '@/lib/actions/findings.ts'
import { Button } from '@/components/ui/button.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { cn } from '@/lib/utils.ts'

export type FindingView = {
  id: number
  gap_class: string
  merged_classes: string[]
  severity: 'high' | 'medium' | 'low'
  ai_original: string
  edited_text: string | null
  question: string
  status: 'proposed' | 'accepted' | 'edited' | 'dismissed'
  ba_verdict: 'valid' | 'invalid' | null
  resolution_note: string | null
  decided_by_name: string | null
  decided_at: string | null
  evidence: { id: string; ref: string; kind: string; text: string }[]
}

const SEV = {
  high: { cls: 'sev-high', badge: 'destructive', bar: 'var(--color-error)' },
  medium: { cls: 'sev-medium', badge: 'warning', bar: 'var(--color-warning)' },
  low: { cls: 'sev-low', badge: 'secondary', bar: 'var(--color-base-300)' },
} as const

export function Finding({ f, canDismiss, locked }: {
  f: FindingView; canDismiss: boolean; locked: boolean
}) {
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(f.edited_text ?? f.ai_original)
  const [note, setNote] = useState(f.resolution_note ?? '')
  const [error, setError] = useState<string>()

  const act = (d: Parameters<typeof decideFinding>[0], then?: () => void) =>
    start(async () => {
      try { await decideFinding(d); setError(undefined); then?.() }
      catch (e) { setError((e as Error).message) }
    })

  const sev = SEV[f.severity]
  const edited = f.edited_text !== null && f.edited_text !== f.ai_original

  return (
    <div
      className={cn('rounded-[var(--radius)] border border-l-4 border-[var(--color-border)] bg-[var(--color-base-100)] p-4',
        f.status === 'dismissed' && 'opacity-55')}
      style={{ borderLeftColor: sev.bar }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant={sev.badge}>{f.severity}</Badge>
        <span className="text-xs opacity-60">
          {(f.merged_classes?.length ? f.merged_classes : [f.gap_class]).join(' + ').replace(/_/g, ' ')}
        </span>
        {f.status !== 'proposed' && (
          <Badge variant="outline">
            {f.status}{f.decided_by_name ? ` · ${f.decided_by_name}` : ''}
          </Badge>
        )}
      </div>

      {editing ? (
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} className="mb-2" />
      ) : (
        <p className="mb-2">{f.edited_text ?? f.ai_original}</p>
      )}

      {/* D14: what the AI proposed stays visible after a human changes it. */}
      {edited && !editing && (
        <details className="mb-2 text-xs opacity-70">
          <summary className="cursor-pointer">What the AI originally proposed</summary>
          <p className="mt-1">{f.ai_original}</p>
        </details>
      )}

      <p className="mb-3 border-l-2 border-[var(--color-primary)] pl-3 italic">{f.question}</p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {f.evidence.map((e) => (
          <details key={e.id} className="group">
            <summary className="badge badge-outline cursor-pointer gap-1 font-mono text-xs">
              <FileCode2 className="h-3 w-3" aria-hidden />{e.ref}
            </summary>
            <pre className="mt-2 max-h-64 max-w-3xl overflow-auto whitespace-pre-wrap rounded-[var(--radius)] bg-[var(--color-base-200)] p-3 text-xs">
              {e.text}
            </pre>
          </details>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {locked ? (
          <span className="text-xs opacity-60">Approved — decisions are fixed.</span>
        ) : editing ? (
          <>
            <Button size="sm" disabled={pending || !draft.trim()}
                    onClick={() => act({ findingId: f.id, status: 'edited', editedText: draft.trim() },
                                       () => setEditing(false))}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending}
                    onClick={() => { setDraft(f.edited_text ?? f.ai_original); setEditing(false) }}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant={f.status === 'accepted' ? 'default' : 'outline'} disabled={pending}
                    aria-pressed={f.status === 'accepted'}
                    onClick={() => act({ findingId: f.id, status: 'accepted' })}>
              <Check className="h-3.5 w-3.5" aria-hidden /> {f.status === 'accepted' ? 'Accepted' : 'Accept'}
            </Button>
            <Button size="sm" variant={f.status === 'edited' ? 'secondary' : 'ghost'} disabled={pending}
                    aria-pressed={f.status === 'edited'} onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
            </Button>
            <Button size="sm" variant={f.status === 'dismissed' ? 'secondary' : 'ghost'}
                    disabled={pending || !canDismiss} aria-pressed={f.status === 'dismissed'}
                    title={canDismiss ? undefined : 'Only a BA can dismiss a finding'}
                    onClick={() => act({ findingId: f.id, status: 'dismissed' })}>
              <X className="h-3.5 w-3.5" aria-hidden /> Dismiss
            </Button>
          </>
        )}

        {/* D24: asked separately — dismissed does not mean invalid, and precision comes from here. */}
        <div className="ml-auto flex items-center gap-1.5 text-xs">
          <span className="opacity-70">Worth asking the client?</span>
          <div className="join">
            <button className={cn('btn btn-xs join-item', f.ba_verdict === 'valid' && 'btn-success')}
                    disabled={pending || locked} aria-pressed={f.ba_verdict === 'valid'}
                    onClick={() => act({ findingId: f.id, baVerdict: f.ba_verdict === 'valid' ? null : 'valid' })}>
              Yes
            </button>
            <button className={cn('btn btn-xs join-item', f.ba_verdict === 'invalid' && 'btn-error')}
                    disabled={pending || locked} aria-pressed={f.ba_verdict === 'invalid'}
                    onClick={() => act({ findingId: f.id, baVerdict: f.ba_verdict === 'invalid' ? null : 'invalid' })}>
              No
            </button>
          </div>
        </div>
      </div>

      {locked ? (
        f.resolution_note && (
          <div className="mt-3 text-sm">
            <div className="flex items-center gap-1.5 text-xs opacity-70">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden /> What the client said
            </div>
            <p className="mt-1 whitespace-pre-wrap">{f.resolution_note}</p>
          </div>
        )
      ) : (
        <details className="mt-3 text-sm">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs opacity-70">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            What the client said{f.resolution_note ? ' ✓' : ''}
          </summary>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-2"
                    placeholder="Record the answer, then revise the requirement text above." />
          <Button size="sm" variant="secondary" className="mt-2"
                  disabled={pending || note === (f.resolution_note ?? '')}
                  onClick={() => act({ findingId: f.id, resolutionNote: note.trim() || null })}>
            Save note
          </Button>
        </details>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-[var(--color-error)]">{error}</p>}
    </div>
  )
}
