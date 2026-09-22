'use client'

import { useEffect } from 'react'

function isImageTarget(target: EventTarget | null): target is HTMLImageElement {
  return target instanceof HTMLImageElement
}

export function ImageInteractionGuard() {
  useEffect(() => {
    const preventImageInteraction = (event: Event) => {
      if (isImageTarget(event.target)) event.preventDefault()
    }

    document.addEventListener('contextmenu', preventImageInteraction, true)
    document.addEventListener('dragstart', preventImageInteraction, true)

    return () => {
      document.removeEventListener('contextmenu', preventImageInteraction, true)
      document.removeEventListener('dragstart', preventImageInteraction, true)
    }
  }, [])

  return null
}
