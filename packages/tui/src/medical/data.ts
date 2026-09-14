export type MedicalPatient = {
  name: string
  sex: string | null
  age: number | null
  weightKg: number | null
  allergies: string[]
  comorbidities: string[]
}

export type MedicalNode = {
  key: string
  title: string
  seq: number
  status: string
  stale: boolean
  missing: string[]
  draft: string | null
  final: string | null
}

export type MedicalEpisode = {
  episode: {
    id: string
    title: string
    status: string
    currentNode: string | null
  }
  patient: MedicalPatient
  nodes: MedicalNode[]
}

export type ClinicalEvidence = {
  id: string
  kind: string
  label: string
  status: string
  source: string | null
  collectedAt: number
  negative: boolean
  payload: Record<string, unknown>
}

export type AuditEvidence = {
  id: string
  actor: string
  action: string
  target: string | null
  time: number
}

export type RevisionEvidence = {
  id: string
  node: string
  revision: number
  actor: string
  action: string
  reason: string | null
  time: number
}

export type MedicalEvidence = {
  clinical: ClinicalEvidence[]
  audit: AuditEvidence[]
  revisions: RevisionEvidence[]
}

export function nodeGlyph(node: MedicalNode): string {
  if (node.stale) return "⚠"
  if (node.status === "completed") return "✓"
  if (node.status === "ready_for_review") return "●"
  if (node.status === "gathering") return "◐"
  return "○"
}
