export default function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-slate-600">{note}</p>
      <div className="mt-4 rounded-lg border bg-white p-4 text-sm">
        Wired to Firestore + Cloud Functions in staging. Demo shows layout, RBAC gating, and empty/offline states.
      </div>
    </div>
  )
}
