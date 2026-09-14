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

export function nodeGlyph(node: MedicalNode): string {
  if (node.stale) return "⚠"
  if (node.status === "completed") return "✓"
  if (node.status === "ready_for_review") return "●"
  if (node.status === "gathering") return "◐"
  return "○"
}
