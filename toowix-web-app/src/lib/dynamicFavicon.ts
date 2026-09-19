export type FaviconMode = 'default' | 'recording' | 'camera' | 'speaker';

const DEFAULT_HREF = '/assets/toowix-logo.svg';
const SIZE = 64;

function getLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');

  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }

  return link;
}

function draw(mode: FaviconMode, frame: number): string {
  const canvas = document.createElement('canvas');

  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return DEFAULT_HREF;
  }

  if (mode === 'recording') {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#D93025';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(32, 32, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#D93025';
    ctx.beginPath();
    ctx.arc(32, 32, 13, 0, Math.PI * 2);
    ctx.fill();
  } else if (mode === 'camera') {
    ctx.fillStyle = '#34C759';
    ctx.beginPath();
    ctx.roundRect(4, 14, 40, 36, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(46, 27);
    ctx.lineTo(60, 17);
    ctx.lineTo(60, 47);
    ctx.lineTo(46, 37);
    ctx.closePath();
    ctx.fill();
  } else {
    // Speaker body plus three sound waves that light up in sequence.
    ctx.fillStyle = '#4C6EF5';
    ctx.beginPath();
    ctx.moveTo(8, 24);
    ctx.lineTo(20, 24);
    ctx.lineTo(34, 12);
    ctx.lineTo(34, 52);
    ctx.lineTo(20, 40);
    ctx.lineTo(8, 40);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i < frame ? '#4C6EF5' : 'rgba(76,110,245,0.2)';
      ctx.beginPath();
      ctx.arc(34, 32, 10 + i * 9, -Math.PI / 4, Math.PI / 4);
      ctx.stroke();
    }
  }

  return canvas.toDataURL('image/png');
}

// Returns a cleanup that stops animation and restores the default icon.
export function applyFavicon(mode: FaviconMode): () => void {
  if (typeof document === 'undefined') {
    return () => { };
  }
  const link = getLink();
  let timer: number | undefined;

  link.type = mode === 'default' ? 'image/svg+xml' : 'image/png';
  if (mode === 'default') {
    link.href = DEFAULT_HREF;
  } else if (mode === 'speaker') {
    const frames = [ 0, 1, 2, 3 ].map((f) => draw('speaker', f));
    let frame = 0;
    const tick = () => {
      link.href = frames[frame % 4];
      frame++;
    };

    tick();
    timer = window.setInterval(tick, 450);
  } else {
    link.href = draw(mode, 0);
  }

  return () => {
    if (timer !== undefined) {
      window.clearInterval(timer);
    }
    link.type = 'image/svg+xml';
    link.href = DEFAULT_HREF;
  };
}
