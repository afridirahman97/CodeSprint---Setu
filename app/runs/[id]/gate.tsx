'use client'
import { useState, useTransition } from 'react'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { approveRun } from '@/lib/actions/run.ts'
import { Button } from '@/components/ui/button.tsx'

export function Gate({ runId, undecided, approved, approvedBy, approvedAt, canApprove }: {
  runId: number; undecided: number; approved: boolean
  approvedBy: string | null; approvedAt: string | null; canApprove: boolean
}) {
  const [pending, start] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string>()

  if (approved) {
    return (
      <div role="status" className="alert alert-success my-4">
        <CheckCircle2 className="h-5 w-5" aria-hidden />
        <div>
          <div className="font-semibold">
            Requirements approved{approvedBy && ` by ${approvedBy}`}
            {approvedAt && ` · ${new Date(approvedAt).toLocaleString()}`}
          </div>
          <div className="text-sm opacity-80">
            The requirement set is fixed. Findings and requirement text can no longer be changed —
            the backlog is generated from exactly what was signed off.
          </div>
        </div>
      </div>
    )
  }

  const blocked = undecided > 0 || !canApprove
  return (
    <div className="alert alert-warning my-4 items-start">
      <ShieldAlert className="h-5 w-5" aria-hidden />
      <div className="flex-1">
        <div className="font-semibold">Awaiting sign-off</div>
        <div className="text-sm opacity-80">
          Nothing is generated, exported or pushed until the requirements are approved.
          {undecided > 0 && <> <strong>{undecided}</strong> finding{undecided === 1 ? '' : 's'} still
            need{undecided === 1 ? 's' : ''} a decision.</>}
          {!canApprove && <> Only a BA can approve.</>}
        </div>

        {confirming ? (
          <div className="mt-3">
            <p className="mb-2 font-medium">
              Approve these requirements? This fixes the requirement set and cannot be undone here.
            </p>
            <Button size="sm" disabled={pending} onClick={() =>
              start(async () => {
                try { await approveRun(runId); setError(undefined) }
                catch (e) { setError((e as Error).message); setConfirming(false) }
              })}>Yes, approve</Button>{' '}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : (
          <Button className="mt-3" size="sm" disabled={blocked}
                  title={!canApprove ? 'Only a BA can approve the requirements'
                    : undecided > 0 ? 'Every finding must be decided first' : undefined}
                  onClick={() => setConfirming(true)}>
            Approve requirements
          </Button>
        )}
        {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
      </div>
    </div>
  )
}
