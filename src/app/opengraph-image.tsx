import { ImageResponse } from 'next/og';

export const alt = 'VEYRN Chess — browser chess with private statistics';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', padding: '64px 72px', background: '#07090b',
      color: '#e9e5dc', fontFamily: 'Arial, sans-serif', border: '2px solid #333a40',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-1px' }}>VEYRN CHESS</div>
        <div style={{ fontSize: 16, letterSpacing: '5px', color: '#9ca2a5' }}>LIVE / P2P / LICHESS</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: '690px' }}>
          <div style={{ fontSize: 82, fontWeight: 600, lineHeight: 0.95, letterSpacing: '-5px' }}>
            PLAY. MEASURE. IMPROVE.
          </div>
          <div style={{ marginTop: '28px', fontSize: 25, color: '#a9aca8' }}>
            Precise browser chess and behavioral statistics stored on your device.
          </div>
        </div>
        <div style={{ width: '300px', height: '300px', display: 'flex', flexWrap: 'wrap', transform: 'rotate(7deg)' }}>
          {Array.from({ length: 16 }, (_, index) => (
            <div key={index} style={{ width: '75px', height: '75px', background: (Math.floor(index / 4) + index) % 2 ? '#26333d' : '#9f9b92' }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '26px', fontSize: 15, letterSpacing: '3px', color: '#898f91' }}>
        <span>NO VEYRN ACCOUNT</span><span>PRIVATE ROOMS</span><span>LOCAL LEDGER</span>
      </div>
    </div>,
    size,
  );
}
