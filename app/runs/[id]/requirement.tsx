'use client'
import { useState, useTransition } from 'react'
import { editRequirement } from '@/lib/actions/run.ts'
import { Button } from '@/components/ui/button.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'

/** D26: revisions are captured in place — no document versioning. */
export function RequirementText({ id, aiOriginal, editedText, locked }: {
  id: number; aiOriginal: string; editedText: string | null; locked: boolean
}) {
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(editedText ?? aiOriginal)
  const [error, setError] = useState<string>()
  const edited = editedText !== null && editedText !== aiOriginal

  if (editing) {
    return (
      <div className="mb-3">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={pending || !draft.trim()}
                  onClick={() => start(async () => {
                    try { await editRequirement(id, draft); setError(undefined); setEditing(false) }
                    catch (e) { setError((e as Error).message) }
                  })}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending}
                  onClick={() => { setDraft(editedText ?? aiOriginal); setError(undefined); setEditing(false) }}>Cancel</Button>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-[var(--color-error)]">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mb-3">
      <p className="inline">{editedText ?? aiOriginal}</p>
      {!locked && (
        <button className="link link-primary ml-2 text-xs" onClick={() => setEditing(true)}>revise</button>
      )}
      {edited && (
        <details className="mt-1 text-xs opacity-70">
          <summary className="cursor-pointer">As extracted from the document</summary>
          <p className="mt-1">{aiOriginal}</p>
        </details>
      )}
    </div>
  )
}
