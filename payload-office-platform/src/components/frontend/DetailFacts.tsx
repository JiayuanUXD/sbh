import type { FactGroupViewModel } from '@/domain/public-catalog'

type DetailFactsProps = Readonly<{
  groups: readonly FactGroupViewModel[]
}>

type VisibleFact = Readonly<{
  label: string
  value: string
  estimated: boolean
}>

function visibleFacts(group: FactGroupViewModel): readonly VisibleFact[] {
  return group.facts.flatMap((fact) => {
    if (fact.value != null) {
      return [{ label: fact.label, value: fact.value, estimated: fact.estimated }]
    }
    if (fact.critical) {
      return [{ label: fact.label, value: '咨询确认', estimated: false }]
    }
    return []
  })
}

/** Renders facts without inventing ordinary missing values. */
export default function DetailFacts({ groups }: DetailFactsProps) {
  const visibleGroups = groups.map((group) => ({ group, facts: visibleFacts(group) }))
    .filter(({ facts }) => facts.length > 0)

  if (visibleGroups.length === 0) return null

  return (
    <div className="detail-facts">
      {visibleGroups.map(({ group, facts }) => (
        <section key={group.id} className="detail-facts__group" aria-labelledby={`facts-${group.id}`}>
          <h2 id={`facts-${group.id}`}>{group.title}</h2>
          <dl>
            {facts.map((fact) => (
              <div key={fact.label} className="detail-facts__item">
                <dt>{fact.label}</dt>
                <dd>
                  {fact.value}
                  {fact.estimated && <span className="detail-facts__estimated">（估算）</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
