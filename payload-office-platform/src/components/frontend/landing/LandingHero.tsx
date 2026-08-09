import React from 'react'

type LandingHeroProps = {
  variant: 'split' | 'centered'
  badge?: string
  title: string
  subtitle: string
  children?: React.ReactNode
}

function SkylineDecor() {
  return (
    <svg className="landing-hero__decor" viewBox="0 0 320 200" fill="currentColor" aria-hidden="true" focusable="false">
      <rect x="12" y="96" width="34" height="104" rx="2" opacity="0.28" />
      <rect x="54" y="60" width="42" height="140" rx="2" opacity="0.42" />
      <rect x="104" y="118" width="30" height="82" rx="2" opacity="0.24" />
      <rect x="142" y="34" width="48" height="166" rx="3" opacity="0.55" />
      <rect x="198" y="84" width="38" height="116" rx="2" opacity="0.34" />
      <rect x="244" y="52" width="30" height="148" rx="2" opacity="0.4" />
      <rect x="282" y="110" width="26" height="90" rx="2" opacity="0.22" />
    </svg>
  )
}

export default function LandingHero({ variant, badge, title, subtitle, children }: LandingHeroProps) {
  return (
    <section className={`landing-hero landing-hero--${variant}`}>
      <div className="landing-hero__inner">
        <div className="landing-hero__copy">
          {badge ? <p className="landing-hero__badge">{badge}</p> : null}
          <h1 className="landing-hero__title">{title}</h1>
          <p className="landing-hero__subtitle">{subtitle}</p>
          {children ? <div className="landing-hero__slot">{children}</div> : null}
        </div>
        <div className="landing-hero__art" aria-hidden="true">
          <SkylineDecor />
        </div>
      </div>
    </section>
  )
}
