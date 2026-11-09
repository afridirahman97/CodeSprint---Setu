'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  ClipboardList, Code2, TestTube2, Network, ListChecks, Settings, Activity, Check, Lock, FolderGit2,
} from 'lucide-react'
import { cn } from '@/lib/utils.ts'
import { can, type Role } from '@/lib/auth/roles.ts'

export type PendingCounts = {
  findings: number; stories: number; tasks: number; tests: number
  have: { findings: number; stories: number; tasks: number; tests: number }
}

type Item = {
  href: string
  label: string
  role?: Role
  icon: React.ComponentType<{ className?: string }>
  match: (path: string, view: string | null) => boolean
  pending?: number
  /** How many items the view holds. Zero pending of zero is empty, not finished. */
  have?: number
  /** Generated only after sign-off, so the tab is shown but not yet reachable. */
  gated?: boolean
}

/**
 * The five views are a pipeline, not five unrelated pages: findings are reviewed, the
 * requirements are signed off, then a backlog is drafted from them and traced.
 *
 * Presenting them as a phased stepper says that. It also makes the gate visible — the
 * backlog views exist before approval but produce nothing, which flat tabs implied was a
 * dead link rather than a step not yet reached.
 */
function phases(runId: number, pending?: PendingCounts, approved?: boolean) {
  return [
    {
      name: 'Review',
      items: [
        { href: `/runs/${runId}`, label: 'Findings', role: 'ba' as Role, icon: ClipboardList,
          match: (p: string) => /\/runs\/\d+$/.test(p), pending: pending?.findings, have: pending?.have.findings },
      ],
    },
    {
      name: 'Backlog',
      locked: approved === false,
      items: [
        { href: `/runs/${runId}/backlog`, label: 'Stories', role: 'ba' as Role, icon: ListChecks,
          match: (p: string, v: string | null) => p.endsWith('/backlog') && (v === null || v === 'all'),
          pending: pending?.stories, have: pending?.have.stories, gated: approved === false },
        { href: `/runs/${runId}/backlog?view=tasks`, label: 'Tasks', role: 'dev' as Role, icon: Code2,
          match: (p: string, v: string | null) => p.endsWith('/backlog') && v === 'tasks',
          pending: pending?.tasks, have: pending?.have.tasks, gated: approved === false },
        { href: `/runs/${runId}/backlog?view=tests`, label: 'Tests', role: 'qa' as Role, icon: TestTube2,
          match: (p: string, v: string | null) => p.endsWith('/backlog') && v === 'tests',
          pending: pending?.tests, have: pending?.have.tests, gated: approved === false },
      ],
    },
    {
      name: 'Delivery',
      items: [
        { href: `/runs/${runId}/matrix`, label: 'Traceability', role: 'pm' as Role, icon: Network,
          match: (p: string) => p.endsWith('/matrix') },
      ],
    },
  ]
}

export function RunNav({ runId, role, pending, approved }: {
  runId: number; role: Role; pending?: PendingCounts; approved?: boolean
}) {
  const path = usePathname()
  const view = useSearchParams().get('view')

  return (
    <nav aria-label="Run views" className="mb-5">
      <div className="flex items-stretch gap-1 overflow-x-auto rounded-[var(--radius)]
                      border border-[var(--color-border)] bg-[var(--color-base-100)] p-1.5">
        {phases(runId, pending, approved).map((phase, pi) => (
          <div key={phase.name} className="flex items-stretch gap-1">
            {pi > 0 && <div className="mx-1 w-px shrink-0 self-stretch bg-[var(--color-border)]" aria-hidden />}

            <div className="flex flex-col justify-center px-1">
              <span className="hidden select-none text-[0.65rem] font-medium uppercase tracking-wider opacity-45 lg:block">
                {phase.name}
              </span>
              <div className="flex items-stretch gap-1">
                {phase.items.map((it: Item) => {
                  const active = it.match(path, view)
                  // A tick means "you finished these", so it needs something to have finished.
                  const done = it.pending === 0 && (it.have ?? 0) > 0 && !it.gated
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      aria-current={active ? 'page' : undefined}
                      title={it.gated ? 'Available once the requirements are approved' : undefined}
                      className={cn(
                        'group relative flex items-center gap-2 whitespace-nowrap rounded-[calc(var(--radius)-2px)]',
                        'px-3 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-[var(--color-primary)] text-[var(--color-primary-content)] shadow-sm'
                          : 'hover:bg-[var(--color-base-200)]',
                        it.gated && !active && 'opacity-45',
                      )}
                    >
                      {it.gated
                        ? <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        : <it.icon className="h-4 w-4 shrink-0" aria-hidden />}

                      <span className="font-medium">{it.label}</span>

                      {/* Your role's default view — a dot, not another badge competing for space. */}
                      {it.role === role && (
                        <span
                          aria-label="your view"
                          title="Your role starts here"
                          className={cn('h-1.5 w-1.5 shrink-0 rounded-full',
                            active ? 'bg-[var(--color-primary-content)]' : 'bg-[var(--color-primary)]')}
                        />
                      )}

                      {it.pending !== undefined && it.pending > 0 && (
                        <span
                          title={`${it.pending} still need a decision`}
                          className={cn(
                            'min-w-5 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[0.7rem] font-semibold leading-none',
                            active
                              ? 'bg-[var(--color-primary-content)] text-[var(--color-primary)]'
                              : 'bg-[var(--color-warning)] text-[var(--color-warning-content)]',
                          )}
                        >
                          {it.pending}
                        </span>
                      )}
                      {done && (
                        <Check
                          className={cn('h-3.5 w-3.5 shrink-0',
                            active ? 'opacity-80' : 'text-[var(--color-success)]')}
                          aria-label="all decided"
                        />
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </nav>
  )
}

export function TopNav({ role }: { role: Role }) {
  const path = usePathname()
  const links = [
    { href: '/runs', label: 'Runs', icon: ClipboardList, on: path === '/runs' || /^\/runs\/\d+/.test(path) },
    ...(can(role, 'project:use')
      ? [{ href: '/projects', label: 'Projects', icon: FolderGit2, on: path.startsWith('/projects') }]
      : []),
    { href: '/health', label: 'Health', icon: Activity, on: path === '/health' },
    ...(role === 'superadmin'
      ? [{ href: '/settings/model', label: 'Model', icon: Settings, on: path.startsWith('/settings') }]
      : []),
  ]
  return (
    <nav aria-label="Main" className="hidden sm:block">
      <ul className="menu menu-horizontal gap-1 px-0">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} aria-current={l.on ? 'page' : undefined}
                  className={cn('gap-1.5', l.on && 'menu-active font-medium')}>
              <l.icon className="h-4 w-4" /> {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function MobileNav({ role, runId }: { role: Role; runId?: number }) {
  const items = [
    { href: '/runs', label: 'Runs' },
    ...(runId ? phases(runId).flatMap((p) => p.items.map((i) => ({ href: i.href, label: i.label }))) : []),
    ...(can(role, 'project:use') ? [{ href: '/projects', label: 'Projects' }] : []),
    { href: '/health', label: 'Health' },
    ...(role === 'superadmin' ? [{ href: '/settings/model', label: 'Model settings' }] : []),
  ]
  return (
    <div className="dropdown sm:hidden">
      <button className="btn btn-ghost btn-sm" aria-label="Menu">☰</button>
      <ul className="menu dropdown-content z-40 w-56 rounded-box bg-[var(--color-base-100)] p-2 shadow">
        {items.map((i) => <li key={i.href}><Link href={i.href}>{i.label}</Link></li>)}
      </ul>
    </div>
  )
}
