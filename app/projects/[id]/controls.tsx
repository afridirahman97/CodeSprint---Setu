'use client'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { RefreshCw, Trash2, Upload, GitBranch } from 'lucide-react'
import { reindexProject, deleteProject, updateProjectSource } from '@/lib/actions/projects.ts'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'

export function ProjectActions({ projectId, branch, busy, remote }: {
  projectId: number; branch: string; busy: boolean; remote: boolean
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [nextBranch, setNextBranch] = useState(branch)
  const [token, setToken] = useState('')
  const run = (fn: () => Promise<unknown>, then?: () => void) => start(async () => {
    try { await fn(); setError(undefined); then?.() } catch (e) { setError((e as Error).message) }
  })

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending || busy}
                title="Fetch the branch again and rebuild the index — do this after new commits"
                onClick={() => run(() => reindexProject(projectId))}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Re-index
        </Button>
        <Button size="sm" variant="ghost" disabled={pending || busy} onClick={() => setEditing((v) => !v)}>
          <GitBranch className="h-3.5 w-3.5" aria-hidden /> Change branch{remote ? ' / token' : ''}
        </Button>
        {confirmDelete ? (
          <span className="flex items-center gap-2 text-sm">
            Delete this project and all its plans?
            <Button size="sm" variant="destructive" disabled={pending}
                    onClick={() => run(() => deleteProject(projectId))}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
          </Button>
        )}
      </div>
      {editing && (
        <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius)] bg-[var(--color-base-200)] p-3">
          <label className="grid gap-1 text-sm">
            Branch
            <Input value={nextBranch} onChange={(e) => setNextBranch(e.target.value)} className="h-8 w-48" />
          </label>
          {remote && (
            <label className="grid gap-1 text-sm">
              New access token <span className="text-xs opacity-60">blank keeps the current one</span>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="h-8 w-64"
                     autoComplete="off" />
            </label>
          )}
          <Button size="sm" disabled={pending || !nextBranch.trim()}
                  onClick={() => run(() => updateProjectSource(projectId, nextBranch, token ? token : null),
                                     () => { setEditing(false); setToken('') })}>
            Save and re-index
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>}
    </div>
  )
}

export function UploadSrs({ projectId, disabledReason }: { projectId: number; disabledReason?: string }) {
  const router = useRouter()
  const form = useRef<HTMLFormElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  return (
    <form ref={form} className="flex flex-wrap items-center gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!file) return
            setBusy(true); setError(undefined)
            try {
              const res = await fetch(`/api/projects/${projectId}/plans`, { method: 'POST', body: new FormData(e.currentTarget) })
              const body = await res.text()
              let json: any = {}
              try { json = JSON.parse(body) } catch { /* not JSON */ }
              if (!res.ok) { setError(json.error ?? `Upload failed (${res.status}).`); return }
              router.push(`/projects/${projectId}/plans/${json.planId}`)
            } catch {
              setError('Could not reach Setu. Check your connection and try again.')
            } finally { setBusy(false) }
          }}>
      <div className="mr-auto">
        <div className="flex items-center gap-2 font-medium">
          <Upload className="h-4 w-4 opacity-70" aria-hidden /> Upload the final SRS
        </div>
        <p className="text-sm opacity-60">
          {disabledReason ?? 'DOCX, PDF, Markdown or plain text — the version with the client’s answers in it.'}
        </p>
      </div>
      <input type="file" name="file" accept=".docx,.pdf,.md,.txt" required aria-label="Final SRS file"
             disabled={busy || !!disabledReason}
             onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(undefined) }}
             className="file-input file-input-sm file-input-bordered max-w-xs" />
      <Button type="submit" disabled={busy || !file || !!disabledReason}>
        {busy ? 'Uploading…' : 'Analyse against code'}
      </Button>
      {error && <p role="alert" className="w-full text-sm text-[var(--color-error)]">{error}</p>}
    </form>
  )
}
