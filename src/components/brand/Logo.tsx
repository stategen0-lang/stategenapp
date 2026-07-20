import Image from 'next/image'

// The StateGen mark. Two variants of the same artwork, both on a transparent
// background so they sit cleanly on any surface:
//   'white' → for the navy panels (sidebar, mobile bar, auth left panel)
//   'navy'  → for light surfaces
interface LogoProps {
  variant?: 'white' | 'navy'
  size?: number          // rendered height in px
  className?: string
  withWordmark?: boolean // show "StateGen" next to the mark
  priority?: boolean
}

// Intrinsic aspect ratio of the artwork (442 × 716).
const RATIO = 442 / 716

export default function Logo({
  variant = 'white',
  size = 32,
  className = '',
  withWordmark = false,
  priority = false,
}: LogoProps) {
  const mark = (
    <Image
      src={variant === 'white' ? '/logo-white.png' : '/logo.png'}
      alt="StateGen"
      width={Math.round(size * RATIO)}
      height={size}
      priority={priority}
      style={{ height: size, width: 'auto' }}
    />
  )

  if (!withWordmark) return <span className={className}>{mark}</span>

  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      {mark}
      <span
        className="font-bold tracking-tight"
        style={{ color: variant === 'white' ? '#fff' : '#14223F', fontSize: size * 0.55 }}
      >
        StateGen
      </span>
    </span>
  )
}
