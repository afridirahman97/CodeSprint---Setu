'use client'
import { useTransition, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { startGeneration, approveBacklog, acceptPendingForStory } from '@/lib/actions/backlog.ts'
import { Button } from '@/components/ui/button.tsx'

export function GenerateButton({ runId, label }: { runId: number; label: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  return (
    <>
      <Button disabled={pending} onClick={() => start(async () => {
        try { await startGeneration(runId) } catch (e) { setError((e as Error).message) }
      })}>
        <Sparkles className="h-4 w-4" aria-hidden /> {pending ? 'Starting…' : label}
      </Button>
      {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{error}</p>}
    </>
  )
}

export function ApproveBacklog({ runId, pendingCount }: { runId: number; pendingCount: number }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={pending || pendingCount > 0}
              title={pendingCount > 0 ? 'Every item needs a decision first' : undefined}
              onClick={() => start(async () => {
                try { await approveBacklog(runId) } catch (e) { setError((e as Error).message) }
              })}>Approve backlog</Button>
      {pendingCount > 0 && <span className="text-sm opacity-60">{pendingCount} item{pendingCount === 1 ? '' : 's'} undecided</span>}
      {error && <p role="alert" className="w-full text-sm text-[var(--color-error)]">{error}</p>}
    </div>
  )
}

/** One click for the items a reviewer has read and has no objection to. */
export function AcceptRemaining({ storyId, kinds, count }: {
  storyId: number; kinds: ('stories' | 'tasks' | 'test_scenarios')[]; count: number
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  if (count === 0) return null
  return (
    <>
      <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs" disabled={pending}
              title="Accept every undecided item in this story. Items you already decided are kept."
              onClick={() => start(async () => {
                try { await acceptPendingForStory(storyId, kinds); setError(undefined) }
                catch (e) { setError((e as Error).message) }
              })}>
        <Check className="h-3 w-3" aria-hidden />
        {pending ? 'Accepting…' : `Accept remaining ${count}`}
      </Button>
      {error && <span role="alert" className="text-xs text-[var(--color-error)]">{error}</span>}
    </>
  )
}
