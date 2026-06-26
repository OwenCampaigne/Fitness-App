import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';

export async function GET() {
  const s = 512;
  const resp = new ImageResponse(
    /* eslint-disable react/jsx-key */
    <div
      style={{
        width: s,
        height: s,
        background: 'linear-gradient(145deg, #111111 0%, #080808 100%)',
        borderRadius: Math.round(s * 0.22),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: s * 0.11,
          top: s * 0.11,
          width: s * 0.78,
          height: s * 0.78,
          borderRadius: '50%',
          border: `${Math.round(s * 0.022)}px solid #1f1f1f`,
          background: '#0d0d0d',
          boxShadow: '0 0 60px rgba(74,222,128,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: s * 0.028,
        }}
      >
        {([0.1, 0.1, 0.65, 0.08, 0.37, 0.1, 0.1] as number[]).map((ratio, i) => (
          <div
            key={i}
            style={{
              width: s * 0.048,
              height: s * ratio * 0.62,
              background:
                i === 2 ? '#4ade80' : i === 4 ? 'rgba(74,222,128,0.75)' : 'rgba(74,222,128,0.4)',
              borderRadius: s * 0.01,
              boxShadow: i === 2 ? '0 0 28px rgba(74,222,128,0.7)' : 'none',
            }}
          />
        ))}
      </div>
    </div>,
    /* eslint-enable react/jsx-key */
    { width: s, height: s },
  );

  const buf = await resp.arrayBuffer();
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
