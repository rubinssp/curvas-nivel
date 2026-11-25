/* Curvas de Nível — núcleo de cálculo (sem dependências)
 * Marching squares + recorte no polígono + encadeamento + simplificação + UTM.
 * Funciona no navegador (window.Curvas) e no Node (module.exports).
 */
(function (root) {
  'use strict';
  var TILE = 256;

  // ---------- Web Mercator ----------
  function worldSize(z) { return TILE * Math.pow(2, z); }
  function lonToPx(lon, z) { return (lon + 180) / 360 * worldSize(z); }
  function latToPx(lat, z) {
    var s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize(z);
  }
  function pxToLon(x, z) { return x / worldSize(z) * 360 - 180; }
  function pxToLat(y, z) {
    var n = Math.PI - 2 * Math.PI * y / worldSize(z);
    return 180 / Math.PI * Math.atan(Math.sinh(n));
  }

  // Terrarium (AWS Terrain Tiles): elev = R*256 + G + B/256 - 32768
  function terrarium(r, g, b) { return r * 256 + g + b / 256 - 32768; }

  // ---------- Suavização (filtro [1 2 1]/4 separável) ----------
  function suavizar(grid, w, h, passes) {
    var a = Float32Array.from(grid), b = new Float32Array(w * h), x, y, i;
    for (var p = 0; p < passes; p++) {
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        b[i] = (a[x > 0 ? i - 1 : i] + 2 * a[i] + a[x < w - 1 ? i + 1 : i]) / 4;
      }
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        a[i] = (b[y > 0 ? i - w : i] + 2 * b[i] + b[y < h - 1 ? i + w : i]) / 4;
      }
    }
    return a;
  }

  // ---------- Marching squares (segmentos de uma cota) ----------
  // Cantos: tl=(x,y) tr=(x+1,y) br=(x+1,y+1) bl=(x,y+1). Bits tl=8 tr=4 br=2 bl=1.
  // Bordas sempre interpoladas na mesma orientação => pontos idênticos entre células vizinhas.
  function isolinha(grid, w, h, L) {
    var segs = [];
    function ip(xa, ya, va, xb, yb, vb) {
      var t = (L - va) / (vb - va);
      return [xa + t * (xb - xa), ya + t * (yb - ya)];
    }
    for (var y = 0; y < h - 1; y++) {
      for (var x = 0; x < w - 1; x++) {
        var v0 = grid[y * w + x], v1 = grid[y * w + x + 1],
            v2 = grid[(y + 1) * w + x + 1], v3 = grid[(y + 1) * w + x];
        var c = (v0 >= L ? 8 : 0) | (v1 >= L ? 4 : 0) | (v2 >= L ? 2 : 0) | (v3 >= L ? 1 : 0);
        if (c === 0 || c === 15) continue;
        var T = function () { return ip(x, y, v0, x + 1, y, v1); };
        var R = function () { return ip(x + 1, y, v1, x + 1, y + 1, v2); };
        var B = function () { return ip(x, y + 1, v3, x + 1, y + 1, v2); };
        var Lf = function () { return ip(x, y, v0, x, y + 1, v3); };
        var centroAlto;
        switch (c) {
          case 1: case 14: segs.push([Lf(), B()]); break;
          case 2: case 13: segs.push([B(), R()]); break;
          case 3: case 12: segs.push([Lf(), R()]); break;
          case 4: case 11: segs.push([T(), R()]); break;
          case 6: case 9: segs.push([T(), B()]); break;
          case 7: case 8: segs.push([T(), Lf()]); break;
          case 5: // tr e bl acima
            centroAlto = (v0 + v1 + v2 + v3) / 4 >= L;
            if (centroAlto) { segs.push([T(), Lf()]); segs.push([B(), R()]); }
            else { segs.push([T(), R()]); segs.push([Lf(), B()]); }
            break;
          case 10: // tl e br acima
            centroAlto = (v0 + v1 + v2 + v3) / 4 >= L;
            if (centroAlto) { segs.push([T(), R()]); segs.push([Lf(), B()]); }
            else { segs.push([T(), Lf()]); segs.push([B(), R()]); }
            break;
        }
      }
    }
    return segs;
  }

  // ---------- Polígono ----------
  function dentro(pt, poly) {
    var x = pt[0], y = pt[1], ins = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins;
    }
    return ins;
  }

  // Recorta um segmento p-q no polígono; devolve lista de sub-segmentos internos.
  function recortarSegmento(p, q, poly, bb) {
    if (Math.max(p[0], q[0]) < bb[0] || Math.min(p[0], q[0]) > bb[2] ||
        Math.max(p[1], q[1]) < bb[1] || Math.min(p[1], q[1]) > bb[3]) return [];
    var ts = [0, 1], dx = q[0] - p[0], dy = q[1] - p[1];
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var ax = poly[j][0], ay = poly[j][1], ex = poly[i][0] - ax, ey = poly[i][1] - ay;
      var den = dx * ey - dy * ex;
      if (den === 0) continue;
      var t = ((ax - p[0]) * ey - (ay - p[1]) * ex) / den;
      var u = ((ax - p[0]) * dy - (ay - p[1]) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    if (ts.length === 2) return dentro([p[0] + dx / 2, p[1] + dy / 2], poly) ? [[p, q]] : [];
    ts.sort(function (a, b) { return a - b; });
    var out = [];
    for (var k = 0; k < ts.length - 1; k++) {
      var t0 = ts[k], t1 = ts[k + 1];
      if (t1 - t0 < 1e-12) continue;
      var tm = (t0 + t1) / 2;
      if (dentro([p[0] + dx * tm, p[1] + dy * tm], poly)) {
        out.push([t0 === 0 ? p : [p[0] + dx * t0, p[1] + dy * t0], t1 === 1 ? q : [p[0] + dx * t1, p[1] + dy * t1]]);
      }
    }
    return out;
  }

  // ---------- Encadear segmentos em polilinhas ----------
  function encadear(segs) {
    var mapa = new Map(), usados = new Uint8Array(segs.length), linhas = [];
    function k(p) { return p[0] + ',' + p[1]; }
    function add(key, idx) { var a = mapa.get(key); if (a) a.push(idx); else mapa.set(key, [idx]); }
    segs.forEach(function (s, i) { add(k(s[0]), i); add(k(s[1]), i); });
    function proximo(pt) {
      var lst = mapa.get(k(pt));
      if (!lst) return -1;
      for (var i = 0; i < lst.length; i++) if (!usados[lst[i]]) return lst[i];
      return -1;
    }
    for (var i = 0; i < segs.length; i++) {
      if (usados[i]) continue;
      usados[i] = 1;
      var linha = [segs[i][0], segs[i][1]], n, s, fim;
      // para frente
      while ((n = proximo(fim = linha[linha.length - 1])) >= 0) {
        usados[n] = 1; s = segs[n];
        linha.push(k(s[0]) === k(fim) ? s[1] : s[0]);
      }
      // para trás
      while ((n = proximo(fim = linha[0])) >= 0) {
        usados[n] = 1; s = segs[n];
        linha.unshift(k(s[0]) === k(fim) ? s[1] : s[0]);
      }
      linhas.push(linha);
    }
    return linhas;
  }

  // ---------- Douglas-Peucker ----------
  function simplificar(pts, tol) {
    if (pts.length < 3 || tol <= 0) return pts;
    var t2 = tol * tol, keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
    keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
      var r = stack.pop(), a = r[0], b = r[1], maxD = 0, idx = -1;
      var ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
      var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      for (var i = a + 1; i < b; i++) {
        var px = pts[i][0] - ax, py = pts[i][1] - ay, d;
        if (L2 === 0) d = px * px + py * py;
        else {
          var t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
          var ex = px - t * dx, ey = py - t * dy; d = ex * ex + ey * ey;
        }
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > t2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter(function (_, i) { return keep[i]; });
  }

  // ---------- Pipeline ----------
  // grid em coordenadas de índice (x = coluna, y = linha); poly no mesmo espaço.
  function gerar(opts) {
    var grid = opts.grid, w = opts.w, h = opts.h, poly = opts.poly,
        eq = opts.equidistancia, mestraCada = opts.mestraCada || 5, tol = opts.tolerancia == null ? 0.25 : opts.tolerancia;
    var bb = [Infinity, Infinity, -Infinity, -Infinity];
    poly.forEach(function (p) { bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[2] = Math.max(bb[2], p[0]); bb[3] = Math.max(bb[3], p[1]); });

    // estatísticas dentro do polígono (centros dos pixels)
    var mn = Infinity, mx = -Infinity, soma = 0, n = 0;
    for (var y = Math.max(0, Math.floor(bb[1])); y <= Math.min(h - 1, Math.ceil(bb[3])); y++) {
      for (var x = Math.max(0, Math.floor(bb[0])); x <= Math.min(w - 1, Math.ceil(bb[2])); x++) {
        if (!dentro([x, y], poly)) continue;
        var v = grid[y * w + x]; if (v < mn) mn = v; if (v > mx) mx = v; soma += v; n++;
      }
    }
    // inclui valores interpolados nas bordas: varre a faixa do bbox do grid também
    var gmn = Infinity, gmx = -Infinity;
    for (var yy = Math.max(0, Math.floor(bb[1]) - 1); yy <= Math.min(h - 1, Math.ceil(bb[3]) + 1); yy++)
      for (var xx = Math.max(0, Math.floor(bb[0]) - 1); xx <= Math.min(w - 1, Math.ceil(bb[2]) + 1); xx++) {
        var vv = grid[yy * w + xx]; if (vv < gmn) gmn = vv; if (vv > gmx) gmx = vv;
      }
    var resultado = [];
    var nivelMestra = eq * mestraCada;
    for (var L = Math.ceil(gmn / eq) * eq; L <= gmx + 1e-9; L = Math.round((L + eq) * 1e6) / 1e6) {
      // desloca a cota 0,1 mm para nunca coincidir com um nó do grid (evita segmentos degenerados)
      var segs = isolinha(grid, w, h, L + 1e-4), cortados = [];
      for (var s = 0; s < segs.length; s++) {
        var r = recortarSegmento(segs[s][0], segs[s][1], poly, bb);
        for (var t = 0; t < r.length; t++) cortados.push(r[t]);
      }
      if (!cortados.length) continue;
      var linhas = encadear(cortados).map(function (l) { return simplificar(l, tol); })
        .filter(function (l) { return l.length >= 2; });
      if (!linhas.length) continue;
      var mestra = Math.abs(L / nivelMestra - Math.round(L / nivelMestra)) < 1e-6;
      resultado.push({ cota: L, mestra: mestra, linhas: linhas });
    }
    return { curvas: resultado, min: n ? mn : NaN, max: n ? mx : NaN, media: n ? soma / n : NaN, amostras: n };
  }

  // ---------- UTM (SIRGAS 2000 / GRS80) ----------
  function utm(lat, lon, fuso) {
    var a = 6378137, f = 1 / 298.257222101, k0 = 0.9996;
    var e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    var lon0 = (fuso * 6 - 183) * Math.PI / 180;
    var phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
    var N = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
    var T = Math.tan(phi) * Math.tan(phi), C = ep2 * Math.cos(phi) * Math.cos(phi);
    var A = Math.cos(phi) * (lam - lon0);
    var e4 = e2 * e2, e6 = e4 * e2;
    var M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
      - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
      - (35 * e6 / 3072) * Math.sin(6 * phi));
    var E = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120) + 500000;
    var Nn = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
    if (lat < 0) Nn += 10000000;
    return [E, Nn];
  }
  function fusoDe(lon) { return Math.floor((lon + 180) / 6) + 1; }
  function epsgSirgas(fuso, sul) {
    if (sul && fuso >= 17 && fuso <= 25) return 31960 + fuso;
    return null;
  }
  function areaPlana(pts) {
    var s = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return Math.abs(s / 2);
  }

  var api = {
    TILE: TILE, lonToPx: lonToPx, latToPx: latToPx, pxToLon: pxToLon, pxToLat: pxToLat,
    terrarium: terrarium, suavizar: suavizar, isolinha: isolinha, dentro: dentro,
    recortarSegmento: recortarSegmento, encadear: encadear, simplificar: simplificar,
    gerar: gerar, utm: utm, fusoDe: fusoDe, epsgSirgas: epsgSirgas, areaPlana: areaPlana
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Curvas = api;
})(this);
