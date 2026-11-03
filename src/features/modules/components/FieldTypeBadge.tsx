import { Badge } from '@/components/ui/badge'
import { getFieldTypeDefinition } from '@/features/records/fields/registry'
import type { FieldType } from '@/types/database'

/** Icon plus label of a field type, both read from the registry. */
export function FieldTypeBadge({ type, className }: { type: FieldType; className?: string }) {
  const definition = getFieldTypeDefinition(type)
  const Icon = definition.icon
  return (
    <Badge variant="outline" className={className} data-field-type={type}>
      <Icon aria-hidden="true" />
      {definition.label}
    </Badge>
  )
}
