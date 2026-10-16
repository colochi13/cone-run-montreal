import * as THREE from "three";

// Procedural canvas textures: no external assets, so the game stays a single deployable bundle.

type Rng = () => number;

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d") };
}

function finish(c: HTMLCanvasElement, srgb: boolean, aniso = 8) {
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** Worn Montréal asphalt with tire tracks at the lane centres (road is 5.5 wide, 3 lanes). */
export function asphaltTexture(rng: Rng) {
  const W = 512;
  const H = 512;
  const { c, g } = canvas(W, H);
  if (g) {
    g.fillStyle = "#34322f";
    g.fillRect(0, 0, W, H);
    // tire wear: darker, smoother bands at lane centres
    for (const lx of [-1.8, 0, 1.8]) {
      const u = ((lx + 2.75) / 5.5) * W;
      for (const off of [-0.32, 0.32]) {
        const grad = g.createLinearGradient(u + off * 93 - 22, 0, u + off * 93 + 22, 0);
        grad.addColorStop(0, "rgba(10,10,10,0)");
        grad.addColorStop(0.5, "rgba(10,10,10,0.38)");
        grad.addColorStop(1, "rgba(10,10,10,0)");
        g.fillStyle = grad;
        g.fillRect(u + off * 93 - 22, 0, 44, H);
      }
    }
    // patches (repaired utility cuts) — slightly different darkness
    for (let i = 0; i < 7; i += 1) {
      g.fillStyle = `rgba(${rng() > 0.5 ? "20,20,20" : "70,68,64"},${0.18 + rng() * 0.2})`;
      g.fillRect(rng() * W, rng() * H, 30 + rng() * 120, 18 + rng() * 70);
    }
    // aggregate speckle
    for (let i = 0; i < 16000; i += 1) {
      const v = 40 + rng() * 90;
      g.fillStyle = `rgba(${v},${v - 2},${v - 5},${0.25 + rng() * 0.5})`;
      g.fillRect(rng() * W, rng() * H, 1 + rng() * 1.6, 1 + rng() * 1.6);
    }
    // cracks
    g.strokeStyle = "rgba(8,8,8,0.55)";
    g.lineWidth = 1.2;
    for (let i = 0; i < 9; i += 1) {
      let x = rng() * W;
      let y = rng() * H;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 9; k += 1) {
        x += (rng() - 0.5) * 38;
        y += 8 + rng() * 22;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  return finish(c, true);
}

/** Concrete sidewalk slabs with expansion joints. Plane is 1.7 x 30, tile = 1.7 x 1.7. */
export function sidewalkTexture(rng: Rng) {
  const S = 256;
  const { c, g } = canvas(S, S);
  if (g) {
    g.fillStyle = "#b9b2a7";
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 5000; i += 1) {
      const v = 150 + rng() * 60;
      g.fillStyle = `rgba(${v},${v - 5},${v - 12},0.35)`;
      g.fillRect(rng() * S, rng() * S, 1.5, 1.5);
    }
    for (let i = 0; i < 4; i += 1) {
      g.fillStyle = `rgba(90,84,74,${0.05 + rng() * 0.07})`;
      g.fillRect(rng() * S, rng() * S, 40 + rng() * 90, 30 + rng() * 80);
    }
    g.strokeStyle = "rgba(60,56,50,0.8)";
    g.lineWidth = 3;
    g.strokeRect(1, 1, S - 2, S - 2);
    g.strokeStyle = "rgba(60,56,50,0.5)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(S / 2, 0);
    g.lineTo(S / 2, S);
    g.stroke();
  }
  return finish(c, true);
}

export type FacadeStyle = "brick" | "stone" | "modern";

/**
 * One facade tile = 2 bays wide x 1 floor tall (6m x 3.2m). Windows with stone lintels/sills and
 * iron balconies. Repeats cleanly in both directions.
 */
export function facadeTexture(style: FacadeStyle, base: string, rng: Rng, balcony: boolean) {
  const W = 384;
  const H = 192;
  const { c, g } = canvas(W, H);
  if (g) {
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    if (style === "brick") {
      const bh = 8;
      const bw = 24;
      for (let y = 0; y < H; y += bh) {
        const offs = (y / bh) % 2 ? bw / 2 : 0;
        for (let x = -bw; x < W + bw; x += bw) {
          g.fillStyle = shade(base, (rng() - 0.5) * 28);
          g.fillRect(x + offs + 1, y + 1, bw - 2, bh - 2);
        }
      }
    } else if (style === "stone") {
      for (let y = 0; y < H; y += 24) {
        g.fillStyle = "rgba(0,0,0,0.16)";
        g.fillRect(0, y, W, 2);
        for (let x = (y / 24) % 2 ? 48 : 0; x < W; x += 96) g.fillRect(x, y, 2, 24);
      }
      for (let i = 0; i < 2500; i += 1) {
        g.fillStyle = `rgba(0,0,0,${rng() * 0.07})`;
        g.fillRect(rng() * W, rng() * H, 2, 2);
      }
    }
    const bays = 2;
    const bwid = W / bays;
    for (let b = 0; b < bays; b += 1) {
      const cx = b * bwid + bwid / 2;
      const ww = style === "modern" ? bwid - 26 : 62;
      const wh = style === "modern" ? H - 40 : 108;
      const x = cx - ww / 2;
      const y = (H - wh) / 2 - 2;
      g.fillStyle = style === "modern" ? "#1d2329" : "#e9e1d2";
      g.fillRect(x - 6, y - 6, ww + 12, wh + 12);
      const lit = rng() > 0.82;
      const gl = g.createLinearGradient(0, y, 0, y + wh);
      if (lit) {
        gl.addColorStop(0, "#ffdd94");
        gl.addColorStop(1, "#e0a64b");
      } else {
        gl.addColorStop(0, "#86a6c0");
        gl.addColorStop(0.45, "#2f4152");
        gl.addColorStop(1, "#141b24");
      }
      g.fillStyle = gl;
      g.fillRect(x, y, ww, wh);
      g.fillStyle = style === "modern" ? "#1d2329" : "#f1ebdf";
      g.fillRect(x + ww / 2 - 2, y, 4, wh);
      g.fillRect(x, y + wh * 0.42, ww, 4);
      if (style !== "modern") {
        g.fillStyle = "#d7cdbb";
        g.fillRect(x - 10, y - 14, ww + 20, 8);
        g.fillStyle = "#b9ae9a";
        g.fillRect(x - 8, y + wh + 6, ww + 16, 7);
      }
      if (balcony && style === "brick") {
        g.strokeStyle = "#15181b";
        g.lineWidth = 3;
        g.strokeRect(x - 8, y + wh - 4, ww + 16, 26);
        for (let kk = 0; kk < 8; kk += 1) {
          const px = x - 7 + kk * ((ww + 14) / 7);
          g.beginPath();
          g.moveTo(px, y + wh - 4);
          g.lineTo(px, y + wh + 22);
          g.stroke();
        }
      }
    }
  }
  return finish(c, true);
}

/** Ground-floor shopfronts: dark glass, striped awning, a signboard. Tile = 6m x 3.2m. */
export function shopTexture(rng: Rng) {
  const W = 256;
  const H = 140;
  const { c, g } = canvas(W, H);
  if (g) {
    g.fillStyle = "#3a3430";
    g.fillRect(0, 0, W, H);
    const awnings = ["#a8352a", "#2f5d4a", "#c9902f", "#27455f"];
    for (let b = 0; b < 2; b += 1) {
      const x = b * 128 + 10;
      const gl = g.createLinearGradient(0, 40, 0, H);
      gl.addColorStop(0, "#5c7a91");
      gl.addColorStop(1, "#1b242c");
      g.fillStyle = gl;
      g.fillRect(x, 46, 108, 88);
      const col = awnings[Math.floor(rng() * awnings.length)];
      for (let s = 0; s < 9; s += 1) {
        g.fillStyle = s % 2 ? "#efe8da" : col;
        g.fillRect(x - 4 + s * 13, 22, 13, 24);
      }
      g.fillStyle = "#151515";
      g.fillRect(x + 80, 70, 22, 64);
    }
  }
  return finish(c, true);
}

/** Soft cloud puff used for sprite clouds. */
export function cloudTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  if (g) {
    const blobs: [number, number, number][] = [
      [128, 140, 80],
      [80, 150, 56],
      [180, 150, 58],
      [112, 108, 52],
      [156, 110, 50],
    ];
    for (const [x, y, r] of blobs) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,0.85)");
      gr.addColorStop(0.6, "rgba(255,255,255,0.4)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Glass curtain-wall for the skyline towers. Tile = a few floors; windows are horizontal bands. */
export function glassTexture(tint: string) {
  const W = 128;
  const H = 256;
  const { c, g } = canvas(W, H);
  if (g) {
    const gl = g.createLinearGradient(0, 0, 0, H);
    gl.addColorStop(0, shade(tint, 40));
    gl.addColorStop(1, shade(tint, -30));
    g.fillStyle = gl;
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(10,18,28,0.55)";
    for (let y = 6; y < H; y += 16) g.fillRect(0, y, W, 9);
    g.fillStyle = "rgba(255,255,255,0.18)";
    for (let x = 0; x < W; x += 21) g.fillRect(x, 0, 2, H);
  }
  return finish(c, true);
}
