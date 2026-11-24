'use client';
import { useState } from 'react';

export const avatarUrl = (base: string, userId: string, v?: string | number | null) =>
  `${base.replace(/\/$/, '')}/storage/v1/object/public/avatars/${userId}/avatar.jpg${v ? `?v=${v}` : ''}`;

/** Foto de perfil pública con respaldo a la inicial del nombre. */
export default function Avatar({ base, userId, name, size = 40, v, className = '' }: { base: string; userId?: string; name: string; size?: number; v?: string | number | null; className?: string }) {
  const [bad, setBad] = useState(false);
  const initial = name.trim().slice(0, 1).toUpperCase() || '?';
  return (
    <span className={`avatar-img ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {!bad && base && userId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl(base, userId, v)} alt="" width={size} height={size} onError={() => setBad(true)} />
      ) : (
        initial
      )}
    </span>
  );
}

/** Recorta al centro y reduce a un cuadrado JPEG ligero antes de subirlo. */
export async function resizeSquare(file: File, size = 256): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Elige una imagen (JPG, PNG o WebP).');
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo procesar la imagen.');
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  bmp.close?.();
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('No se pudo procesar la imagen.'))), 'image/jpeg', 0.85));
}
