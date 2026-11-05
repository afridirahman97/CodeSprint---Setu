'use client'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { Upload as UploadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'

const ACCEPT = ['.docx', '.pdf', '.md', '.txt']

/** The server can answer with HTML (a proxy, a crash page) — never assume JSON. */
async function errorFrom(res: Response) {
  const body = await res.text()
  try {
    const j = JSON.parse(body) as { error?: string }
    if (j.error) return j.error
  } catch { /* not JSON */ }
  if (res.status === 413) return 'That file is too large to upload.'
  return `Upload failed (${res.status} ${res.statusText || 'error'}). Please try again.`
}

export function Upload() {
  const router = useRouter()
  const form = useRef<HTMLFormElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [file, setFile] = useState<File | null>(null)

  return (
    <Card className="border-dashed">
      <CardContent className="pt-5">
        <form
          ref={form}
          className="flex flex-wrap items-center gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!file) { setError('Choose a file first.'); return }
            const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
            if (!ACCEPT.includes(ext)) {
              setError(`"${file.name}" is not a supported format. Use DOCX, PDF, Markdown or plain text.`)
              return
            }
            setBusy(true); setError(undefined)
            try {
              const res = await fetch('/api/documents', { method: 'POST', body: new FormData(e.currentTarget) })
              if (!res.ok) { setError(await errorFrom(res)); return }
              const { runId } = (await res.json()) as { runId?: number }
              form.current?.reset(); setFile(null)
              // Straight to the run: its page shows live progress.
              if (runId) router.push(`/runs/${runId}`)
              else router.refresh()
            } catch {
              setError('Could not reach Setu. Check your connection and try again.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="mr-auto">
            <div className="flex items-center gap-2 font-medium">
              <UploadIcon className="h-4 w-4 opacity-70" aria-hidden /> Upload a draft SRS
            </div>
            <p className="text-sm opacity-60">
              DOCX, PDF, Markdown or plain text. Analysis runs in the background — closing this tab is safe.
            </p>
          </div>
          <input type="file" name="file" accept={ACCEPT.join(',')} required disabled={busy}
                 aria-label="Draft SRS file"
                 onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(undefined) }}
                 className="file-input file-input-sm file-input-bordered max-w-xs" />
          <Button type="submit" disabled={busy || !file}>
            {busy ? <><span className="loading loading-spinner loading-xs" aria-hidden /> Uploading…</> : 'Analyse'}
          </Button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{error}</p>}
      </CardContent>
    </Card>
  )
}
