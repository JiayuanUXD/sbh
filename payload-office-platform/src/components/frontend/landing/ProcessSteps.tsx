import React from 'react'

export type ProcessIconKey = 'form' | 'advisor' | 'plan' | 'sign' | 'survey' | 'promote' | 'submit'
export type ProcessStep = Readonly<{ label: string; icon: ProcessIconKey }>

type ProcessStepsProps = {
  steps: readonly ProcessStep[]
  size?: 'card' | 'compact'
}

// 每步图标语义各异：手机=留电、人像=顾问、地图=方案、勾单=签约、
// 上传单=提交房源、勘板=实勘、喇叭=推广。避免多卡共用同款文档形图标。
const ICON_PATHS: Record<ProcessIconKey, string> = {
  form: 'M9 2h6a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2',
  advisor: 'M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 20a7 7 0 0 1 14 0',
  plan: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  sign: 'M6 3h12v18H6zM9 12l2 2 4-5',
  survey: 'M4 5h16v12H4zM8 21h8M12 17v4',
  promote: 'M3 10h4l7-5v14l-7-5H3zM18 9a4 4 0 0 1 0 6',
  submit: 'M6 3h12v18H6zM12 16v-6M9.5 12.5 12 10l2.5 2.5',
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
