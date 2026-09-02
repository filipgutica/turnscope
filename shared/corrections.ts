export const correctionCategories = [
  'agent_mistake',
  'unproductive_steering',
  'clarification',
  'new_requirement',
  'product_decision',
  'preference',
  'approval',
  'cancellation',
] as const

export type CorrectionCategory = typeof correctionCategories[number]
