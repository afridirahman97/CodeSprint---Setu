'use client'
import { useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'

/** Copies the generated prompt straight to the clipboard, for pasting into a coding assistant. */
export function CopyPrompt({ url }: { url: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  return (
    <Button size="sm" variant="outline" disabled={state === 'busy'}
            onClick={async () => {
              setState('busy')
              try {
                const res = await fetch(url)
                if (!res.ok) throw new Error()
                await navigator.clipboard.writeText(await res.text())
                setState('done')
              } catch { setState('failed') }
              setTimeout(() => setState('idle'), 2000)
            }}>
      <Copy className="h-3.5 w-3.5" aria-hidden />
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed — use Download' : 'Copy prompt'}
    </Button>
  )
}
