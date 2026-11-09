'use client'
import { useActionState, useState } from 'react'
import { FolderGit2, Globe, HardDrive } from 'lucide-react'
import { createProject } from '@/lib/actions/projects.ts'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { cn } from '@/lib/utils.ts'

export function NewProject({ localRepos, localRoot }: { localRepos: string[]; localRoot: string }) {
  const [state, action, pending] = useActionState(createProject, undefined)
  const [source, setSource] = useState<'remote' | 'local'>('remote')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderGit2 className="h-4 w-4 opacity-70" aria-hidden /> New project
        </CardTitle>
        <CardDescription>
          Point Setu at a repository and the branch work starts from. It is indexed once and reused
          for every SRS you upload to this project.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <label className="grid gap-1.5 text-sm">
            Project name
            <Input name="name" required placeholder="Orders service" />
          </label>

          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm">Repository</legend>
            <input type="hidden" name="source" value={source} />
            <div className="join" role="radiogroup" aria-label="Repository location">
              {([['remote', 'Remote (GitHub, GitLab, …)', Globe], ['local', 'Local folder', HardDrive]] as const)
                .map(([v, label, Icon]) => (
                  <button key={v} type="button" role="radio" aria-checked={source === v}
                          onClick={() => setSource(v)}
                          className={cn('btn btn-sm join-item gap-1.5', source === v ? 'btn-primary' : 'btn-outline')}>
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                  </button>
                ))}
            </div>

            {source === 'remote' ? (
              <div className="grid gap-3">
                <label className="grid gap-1.5 text-sm">
                  HTTPS URL
                  <Input name="repo_url" required placeholder="https://github.com/acme/orders-service.git" />
                </label>
                <details className="text-sm">
                  <summary className="cursor-pointer opacity-80">Private repository? Add an access token</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5">
                      Access token
                      <Input name="token" type="password" autoComplete="off"
                             placeholder="read-only personal access token" />
                    </label>
                    <label className="grid gap-1.5">
                      Username <span className="text-xs opacity-60">optional — needed for Bitbucket</span>
                      <Input name="username" autoComplete="off" placeholder="oauth2" />
                    </label>
                  </div>
                  <p className="mt-2 text-xs opacity-60">
                    Use a token that can only read repositories (GitHub: fine-grained, Contents: read;
                    GitLab: read_repository). It is encrypted and never shown again.
                  </p>
                </details>
              </div>
            ) : localRepos.length > 0 ? (
              <label className="grid gap-1.5 text-sm">
                Folder
                <select name="local_path" required className="select select-bordered select-sm w-full max-w-md">
                  {localRepos.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <span className="text-xs opacity-60">Git repositories found in the shared folder ({localRoot}).</span>
              </label>
            ) : (
              <div role="status" className="alert text-sm">
                <div>
                  <p className="font-medium">No local repositories are shared with Setu yet.</p>
                  <p className="mt-1 opacity-80">
                    Setu runs in Docker, so it only sees folders you share with it. Set{' '}
                    <code>LOCAL_REPOS_DIR</code> in <code>.env</code> to the folder that holds your
                    repositories (e.g. <code>~/IdeaProjects</code>), then run{' '}
                    <code>docker compose up -d</code>. Each git repository inside it will appear here.
                  </p>
                </div>
              </div>
            )}
          </fieldset>

          <label className="grid gap-1.5 text-sm">
            Branch
            <Input name="branch" required defaultValue="main" className="max-w-xs" />
            <span className="text-xs opacity-60">The branch development starts from, e.g. main or develop.</span>
          </label>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending || (source === 'local' && localRepos.length === 0)}>
              {pending ? 'Creating…' : 'Create and index'}
            </Button>
            {state?.error && <p role="alert" className="text-sm text-[var(--color-error)]">{state.error}</p>}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
