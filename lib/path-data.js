// SVG path data -> subpaths of absolute segments, used to count anchor points.
const TOKEN = /[MmLlHhVvCcSsQqTtZzAa]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

/**
 * Path data -> subpaths of absolute segments.
 * @returns {Array<{ start: number[], segs: Array<{ l: number[] } | { c: number[] }>, closed: boolean }>}
 */
export function parsePathData(d, dx = 0, dy = 0) {
  const tk = d.match(TOKEN) || [];
  const out = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cur = null;
  let lastCtrl = null, lastQ = null; // reflection points for S and T
  const n = () => parseFloat(tk[i++]);
  const isNum = () => i < tk.length && !/^[A-Za-z]$/.test(tk[i]);
  const open = () => {
    if (!cur || cur.closed) { cur = { start: [x + dx, y + dy], segs: [], closed: false }; out.push(cur); sx = x; sy = y; }
  };
  const line = (nx, ny) => { open(); cur.segs.push({ l: [nx + dx, ny + dy] }); x = nx; y = ny; };
  const cubic = (x1, y1, x2, y2, nx, ny) => {
    open();
    cur.segs.push({ c: [x1 + dx, y1 + dy, x2 + dx, y2 + dy, nx + dx, ny + dy] });
    lastCtrl = [x2, y2]; x = nx; y = ny;
  };
  while (i < tk.length) {
    if (!isNum()) cmd = tk[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const bx = rel ? x : 0, by = rel ? y : 0;
    const C = cmd.toUpperCase();
    if (C !== 'C' && C !== 'S') lastCtrl = null;
    if (C !== 'Q' && C !== 'T') lastQ = null;
    switch (C) {
      case 'M': {
        const nx = bx + n(), ny = by + n();
        cur = { start: [nx + dx, ny + dy], segs: [], closed: false };
        out.push(cur);
        x = sx = nx; y = sy = ny;
        cmd = rel ? 'l' : 'L'; // further pairs are implicit line-tos
        break;
      }
      case 'L': line(bx + n(), by + n()); break;
      case 'H': line(bx + n(), y); break;
      case 'V': line(x, by + n()); break;
      case 'C': { const a = [bx + n(), by + n(), bx + n(), by + n(), bx + n(), by + n()]; cubic(...a); break; }
      case 'S': {
        const [rx, ry] = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const a = [bx + n(), by + n(), bx + n(), by + n()];
        cubic(rx, ry, ...a);
        break;
      }
      case 'Q': case 'T': {
        const [qx, qy] = C === 'Q' ? [bx + n(), by + n()] : lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        const nx = bx + n(), ny = by + n();
        const x0 = x, y0 = y;
        cubic(x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny);
        lastQ = [qx, qy];
        lastCtrl = null;
        break;
      }
      case 'A': { // not produced by our tracers: approximate with a straight line
        for (let k = 0; k < 5; k++) n();
        line(bx + n(), by + n());
        break;
      }
      case 'Z':
        if (cur) { cur.closed = true; x = sx; y = sy; }
        cmd = '';
        break;
      default:
        i++;
    }
  }
  return out.filter((s) => s.segs.length);
}
