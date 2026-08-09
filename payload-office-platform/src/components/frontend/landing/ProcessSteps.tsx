import React from 'react'

export type ProcessIconKey = 'form' | 'advisor' | 'plan' | 'sign' | 'survey' | 'promote'
export type ProcessStep = Readonly<{ label: string; icon: ProcessIconKey }>

type ProcessStepsProps = {
  steps: readonly ProcessStep[]
  size?: 'card' | 'compact'
}

const ICON_PATHS: Record<ProcessIconKey, string> = {
  form: 'M4 3h10l4 4v14H4zM14 3v4h4M8 12h6M8 16h6',
  advisor: 'M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 20a7 7 0 0 1 14 0',
  plan: 'M5 3h9l5 5v13H5zM9 13h6M9 17h4',
  sign: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
  survey: 'M4 5h16v12H4zM8 21h8M12 17v4',
  promote: 'M3 10h4l7-5v14l-7-5H3zM18 9a4 4 0 0 1 0 6',
}

function StepIcon({ icon }: { icon: ProcessIconKey }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[icon]} />
    </svg>
  )
}

export default function ProcessSteps({ steps, size = 'card' }: ProcessStepsProps) {
  return (
    <ol className={`process-steps process-steps--${size}`} role="list">
      {steps.map((step, index) => (
        <li key={`${step.icon}-${step.label}`} className="process-steps__item">
          <div className="process-steps__icon">
            <StepIcon icon={step.icon} />
          </div>
          <span className="process-steps__label">
            {size === 'card' ? <span className="process-steps__index" aria-hidden="true">{index + 1}</span> : null}
            {step.label}
          </span>
          {index < steps.length - 1 ? <span className="process-steps__sep" aria-hidden="true">→</span> : null}
        </li>
      ))}
    </ol>
  )
}
