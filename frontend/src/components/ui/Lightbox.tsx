/**
 * Lightbox — fullscreen image viewer.
 *
 * Click any image → fills viewport with the image, click or Esc to close.
 * No dependencies, pure CSS + React state.
 */

import React, { useEffect } from 'react';
import './Lightbox.css';

export function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}): React.ReactElement | null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="biof3-lightbox" onClick={onClose}>
      <img src={src} alt={alt || ''} className="biof3-lightbox__img" />
      <button className="biof3-lightbox__close" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
}

export default Lightbox;
