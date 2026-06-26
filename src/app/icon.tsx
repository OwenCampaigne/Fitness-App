import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: 32,
        height: 32,
        background: '#0a0a0a',
        borderRadius: 7,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      {/* EKG pulse bars (7 bars, varying heights) */}
      {([3, 3, 18, 2, 10, 3, 3] as number[]).map((h, i) => (
        <div
          key={i}
          style={{
            width: 2,
            height: h,
            background: i === 2 ? '#4ade80' : 'rgba(74,222,128,0.55)',
            borderRadius: 1,
          }}
        />
      ))}
    </div>,
    size,
  );
}
