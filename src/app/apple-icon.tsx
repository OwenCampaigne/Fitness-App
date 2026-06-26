import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: 180,
        height: 180,
        background: 'linear-gradient(145deg, #111111 0%, #080808 100%)',
        borderRadius: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      {/* Watch-ring */}
      <div
        style={{
          position: 'absolute',
          left: 20,
          top: 20,
          width: 140,
          height: 140,
          borderRadius: '50%',
          border: '4px solid #1f1f1f',
          background: '#0d0d0d',
          boxShadow: '0 0 24px rgba(74,222,128,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
        }}
      >
        {/* EKG pulse bars */}
        {([10, 10, 62, 8, 36, 10, 10] as number[]).map((h, i) => (
          <div
            key={i}
            style={{
              width: 9,
              height: h,
              background:
                i === 2
                  ? '#4ade80'
                  : i === 4
                    ? 'rgba(74,222,128,0.75)'
                    : 'rgba(74,222,128,0.4)',
              borderRadius: 4,
              boxShadow: i === 2 ? '0 0 8px rgba(74,222,128,0.6)' : 'none',
            }}
          />
        ))}
      </div>
    </div>,
    size,
  );
}
