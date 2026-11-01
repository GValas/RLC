// @ts-check
// Algèbre linéaire minimale : LU à pivot partiel et valeurs propres (QR de Hessenberg).
// Toutes les matrices sont des Float64Array stockées ligne par ligne (A[i*n+j]).
(function (RLC) {
  'use strict';

  /**
   * Factorise A (en place) en PA = LU.
   * @param {Float64Array} A matrice n×n, écrasée par ses facteurs
   * @param {number} n
   * @returns {{lu: Float64Array, piv: Int32Array, n: number}}
   */
  function luFactor(A, n) {
    const piv = new Int32Array(n);
    for (let k = 0; k < n; k++) {
      let p = k;
      let best = Math.abs(A[k * n + k]);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(A[i * n + k]);
        if (v > best) { best = v; p = i; }
      }
      piv[k] = p;
      if (p !== k) {
        for (let j = 0; j < n; j++) {
          const t = A[k * n + j];
          A[k * n + j] = A[p * n + j];
          A[p * n + j] = t;
        }
      }
      const d = A[k * n + k];
      if (d === 0) continue; // pivot nul : la résolution donnera Inf/NaN, détecté plus haut
      for (let i = k + 1; i < n; i++) {
        const m = A[i * n + k] / d;
        A[i * n + k] = m;
        if (m !== 0) {
          for (let j = k + 1; j < n; j++) A[i * n + j] -= m * A[k * n + j];
        }
      }
    }
    return { lu: A, piv, n };
  }

  /**
   * Résout LUx = Pb. Le vecteur b est écrasé par la solution.
   * @param {{lu: Float64Array, piv: Int32Array, n: number}} f
   * @param {Float64Array} b
   */
  function luSolve(f, b) {
    const { lu, piv, n } = f;
    // Les lignes de L ont été permutées avec le reste : toutes les permutations d'abord.
    for (let k = 0; k < n; k++) {
      const p = piv[k];
      if (p !== k) { const t = b[k]; b[k] = b[p]; b[p] = t; }
    }
    for (let k = 0; k < n; k++) {
      const bk = b[k];
      if (bk !== 0) for (let i = k + 1; i < n; i++) b[i] -= lu[i * n + k] * bk;
    }
    for (let k = n - 1; k >= 0; k--) {
      let s = b[k];
      for (let j = k + 1; j < n; j++) s -= lu[k * n + j] * b[j];
      b[k] = s / lu[k * n + k];
    }
    return b;
  }

  /**
   * Valeurs propres d'une matrice réelle quelconque.
   * @param {Float64Array} M matrice n×n (non modifiée)
   * @param {number} n
   * @returns {{re: number, im: number}[]}
   */
  function eigenvalues(M, n) {
    if (n === 0) return [];
    /** @type {Float64Array[]} */
    const a = [];
    for (let i = 0; i < n; i++) a.push(M.slice(i * n, (i + 1) * n));
    // Réduction à la forme de Hessenberg par élimination
    for (let m = 1; m < n - 1; m++) {
      let x = 0, i = m;
      for (let j = m; j < n; j++) if (Math.abs(a[j][m - 1]) > Math.abs(x)) { x = a[j][m - 1]; i = j; }
      if (i !== m) {
        for (let j = m - 1; j < n; j++) { const t = a[i][j]; a[i][j] = a[m][j]; a[m][j] = t; }
        for (let j = 0; j < n; j++) { const t = a[j][i]; a[j][i] = a[j][m]; a[j][m] = t; }
      }
      if (x !== 0) {
        for (let r = m + 1; r < n; r++) {
          let y = a[r][m - 1];
          if (y !== 0) {
            y /= x;
            a[r][m - 1] = y;
            for (let j = m; j < n; j++) a[r][j] -= y * a[m][j];
            for (let j = 0; j < n; j++) a[j][m] += y * a[j][r];
          }
        }
      }
    }
    for (let i = 2; i < n; i++) for (let j = 0; j < i - 1; j++) a[i][j] = 0;

    // Algorithme QR à double décalage
    const wr = new Float64Array(n), wi = new Float64Array(n);
    let anorm = 0;
    for (let i = 0; i < n; i++) for (let j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(a[i][j]);
    const sign = (/** @type {number} */ v, /** @type {number} */ s) => (s >= 0 ? Math.abs(v) : -Math.abs(v));
    let nn = n - 1, t = 0;
    let p = 0, q = 0, r = 0, s = 0, x = 0, y = 0, z = 0, w = 0;
    while (nn >= 0) {
      let its = 0, l;
      do {
        for (l = nn; l >= 1; l--) {
          s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
          if (s === 0) s = anorm;
          if (Math.abs(a[l][l - 1]) + s === s) { a[l][l - 1] = 0; break; }
        }
        x = a[nn][nn];
        if (l === nn) {
          wr[nn] = x + t; wi[nn] = 0; nn--;
        } else {
          y = a[nn - 1][nn - 1];
          w = a[nn][nn - 1] * a[nn - 1][nn];
          if (l === nn - 1) {
            p = 0.5 * (y - x);
            q = p * p + w;
            z = Math.sqrt(Math.abs(q));
            x += t;
            if (q >= 0) {
              z = p + sign(z, p);
              wr[nn - 1] = wr[nn] = x + z;
              if (z !== 0) wr[nn] = x - w / z;
              wi[nn - 1] = wi[nn] = 0;
            } else {
              wr[nn - 1] = wr[nn] = x + p;
              wi[nn] = z;
              wi[nn - 1] = -z;
            }
            nn -= 2;
          } else {
            if (its >= 60) { // non-convergence : on rend ce qu'on a sur la diagonale
              for (let i = 0; i <= nn; i++) { wr[i] = a[i][i] + t; wi[i] = 0; }
              nn = -1;
              break;
            }
            if (its === 10 || its === 20) {
              t += x;
              for (let i = 0; i <= nn; i++) a[i][i] -= x;
              s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
              y = x = 0.75 * s;
              w = -0.4375 * s * s;
            }
            its++;
            let m;
            for (m = nn - 2; m >= l; m--) {
              z = a[m][m];
              r = x - z;
              s = y - z;
              p = (r * s - w) / a[m + 1][m] + a[m][m + 1];
              q = a[m + 1][m + 1] - z - r - s;
              r = a[m + 2][m + 1];
              s = Math.abs(p) + Math.abs(q) + Math.abs(r);
              p /= s; q /= s; r /= s;
              if (m === l) break;
              const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
              const v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
              if (u + v === v) break;
            }
            for (let i = m + 2; i <= nn; i++) {
              a[i][i - 2] = 0;
              if (i !== m + 2) a[i][i - 3] = 0;
            }
            for (let k = m; k <= nn - 1; k++) {
              if (k !== m) {
                p = a[k][k - 1];
                q = a[k + 1][k - 1];
                r = 0;
                if (k !== nn - 1) r = a[k + 2][k - 1];
                x = Math.abs(p) + Math.abs(q) + Math.abs(r);
                if (x !== 0) { p /= x; q /= x; r /= x; }
              }
              s = sign(Math.sqrt(p * p + q * q + r * r), p);
              if (s !== 0) {
                if (k === m) {
                  if (l !== m) a[k][k - 1] = -a[k][k - 1];
                } else {
                  a[k][k - 1] = -s * x;
                }
                p += s;
                x = p / s;
                y = q / s;
                z = r / s;
                q /= p;
                r /= p;
                for (let j = k; j <= nn; j++) {
                  p = a[k][j] + q * a[k + 1][j];
                  if (k !== nn - 1) { p += r * a[k + 2][j]; a[k + 2][j] -= p * z; }
                  a[k + 1][j] -= p * y;
                  a[k][j] -= p * x;
                }
                const mmin = nn < k + 3 ? nn : k + 3;
                for (let i = l; i <= mmin; i++) {
                  p = x * a[i][k] + y * a[i][k + 1];
                  if (k !== nn - 1) { p += z * a[i][k + 2]; a[i][k + 2] -= p * r; }
                  a[i][k + 1] -= p * q;
                  a[i][k] -= p;
                }
              }
            }
          }
        }
      } while (nn >= 0 && l < nn - 1);
    }
    const out = [];
    for (let i = 0; i < n; i++) out.push({ re: wr[i], im: wi[i] });
    return out;
  }

  RLC.linalg = { luFactor, luSolve, eigenvalues };
})(/** @type {any} */ (globalThis).RLC ??= {});
