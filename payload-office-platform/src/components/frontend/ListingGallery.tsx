'use client'
import React, { useState } from 'react'

type Image = { url: string; alt?: string }
type Props = { images: Image[] }

export default function ListingGallery({ images }: Props) {
  const [active, setActive] = useState(0)
  if (!images.length) return <div className="gallery__main gallery__empty" />
  const current = images[active] ?? images[0]
  return (
    <div className="gallery">
      <div className="gallery__main">
        <img src={current.url} alt={current.alt || ''} />
      </div>
      {images.length > 1 && (
        <div className="gallery__thumbs">
          {images.map((img, i) => (
            <button
              key={i}
              className={`gallery__thumb ${i === active ? 'gallery__thumb--active' : ''}`}
              onClick={() => setActive(i)}
              type="button"
            >
              <img src={img.url} alt={img.alt || ''} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
