import React from 'react'

type LandingHeroProps = {
  variant: 'split' | 'centered'
  backgroundImage?: {
    src: string
  }
  badge?: string
  title: string
  subtitle: string
  children?: React.ReactNode
}

function SkylineDecor() {
  return (
    <svg className="landing-hero__decor" viewBox="0 0 320 200" fill="currentColor" aria-hidden="true" focusable="false">
      {/* 远景低层，衬出纵深 */}
      <rect x="6" y="116" width="30" height="84" opacity="0.16" />
      <rect x="104" y="122" width="30" height="78" opacity="0.2" />
      <rect x="284" y="104" width="30" height="96" opacity="0.18" />
      {/* 阶梯顶塔楼 */}
      <path d="M46 200V66h14V52h18v14h14v134Z" opacity="0.36" />
      {/* 坡顶主塔 + 天线 */}
      <path d="M142 200V42l24-12 24 12v158Z" opacity="0.52" />
      <rect x="164" y="14" width="3" height="17" opacity="0.52" />
      {/* 主塔楼层线 */}
      <g stroke="currentColor" strokeWidth="2" opacity="0.22">
        <line x1="150" y1="70" x2="182" y2="70" />
        <line x1="150" y1="96" x2="182" y2="96" />
        <line x1="150" y1="122" x2="182" y2="122" />
        <line x1="150" y1="148" x2="182" y2="148" />
        <line x1="150" y1="174" x2="182" y2="174" />
      </g>
      {/* 平屋顶中塔 + 屋顶机房 */}
      <rect x="198" y="86" width="38" height="114" opacity="0.3" />
      <rect x="206" y="74" width="14" height="12" opacity="0.3" />
      {/* 高塔 + 退台 */}
      <path d="M244 200V64h12V52h18v148Z" opacity="0.42" />
      <g stroke="currentColor" strokeWidth="2" opacity="0.18">
        <line x1="250" y1="92" x2="268" y2="92" />
        <line x1="250" y1="120" x2="268" y2="120" />
        <line x1="250" y1="148" x2="268" y2="148" />
      </g>
      {/* 地面基线 */}
      <rect x="0" y="198" width="320" height="2" opacity="0.28" />
    </svg>
  )
}

export default function LandingHero({
  variant,
  backgroundImage,
  badge,
  title,
  subtitle,
  children,
}: LandingHeroProps) {
  const className = `landing-hero landing-hero--${variant}${backgroundImage ? ' landing-hero--with-background' : ''}`

  return (
    <section className={className}>
      {backgroundImage ? (
        <>
          <div className="landing-hero__background" aria-hidden="true">
            <img
              className="landing-hero__background-image"
              src={backgroundImage.src}
              alt=""
              decoding="async"
              fetchPriority="high"
            />
          </div>
          <div className="landing-hero__scrim" aria-hidden="true" />
        </>
      ) : null}
      <div className="landing-hero__inner">
        <div className="landing-hero__copy">
          {badge ? <p className="landing-hero__badge">{badge}</p> : null}
          <h1 className="landing-hero__title">{title}</h1>
          <p className="landing-hero__subtitle">{subtitle}</p>
          {children ? <div className="landing-hero__slot">{children}</div> : null}
        </div>
        {backgroundImage ? null : (
          <div className="landing-hero__art" aria-hidden="true">
            <SkylineDecor />
          </div>
        )}
      </div>
    </section>
  )
}
