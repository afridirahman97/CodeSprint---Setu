import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card.tsx'

export function DevOnly() {
  return (
    <Card className="mx-auto max-w-xl">
      <CardContent className="pt-5">
        <h1 className="text-lg font-semibold">Projects are for developers</h1>
        <p className="mt-1 text-sm opacity-80">
          Development plans are a developer&apos;s working material, so only developer accounts can
          open them. Sign in with a developer account to use Projects.
        </p>
        <Link href="/runs" className="btn btn-sm btn-outline mt-4">Back to runs</Link>
      </CardContent>
    </Card>
  )
}
