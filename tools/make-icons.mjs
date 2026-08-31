/**
 * Genera los iconos PNG sin dependencias externas.
 *
 * El motivo: un icono es un fichero binario, y no quiero meter un paquete de
 * imágenes ni pedirte que dibujes nada. Con zlib basta para escribir un PNG
 * válido a mano.
 *
 * El dibujo es un faro visto de frente: fondo violeta oscuro, halo dorado y
 * un punto de luz en el centro. Se lee bien incluso a 16 px.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets')

const GROUND = [0x1b, 0x1a, 0x22, 255]
const GOLD = [0xe9, 0xac, 0x4a, 255]
const GOLD_SOFT = [0xe9, 0xac, 0x4a, 90]

function crc32(buf) {
  let c
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })())
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bits por canal
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filtro: ninguno
    for (let x = 0; x < size; x++) {
      const p = pixels[y * size + x]
      raw[o++] = p[0]
      raw[o++] = p[1]
      raw[o++] = p[2]
      raw[o++] = p[3]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function blend(base, over) {
  const a = over[3] / 255
  return [
    Math.round(base[0] * (1 - a) + over[0] * a),
    Math.round(base[1] * (1 - a) + over[1] * a),
    Math.round(base[2] * (1 - a) + over[2] * a),
    255,
  ]
}

/** Cobertura antialiaseada de un círculo, muestreando 3x3 por píxel. */
function coverage(x, y, cx, cy, r) {
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3
      const py = y + (sy + 0.5) / 3
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) hits++
    }
  }
  return hits / 9
}

function draw(size) {
  const c = size / 2
  const pixels = new Array(size * size)
  const radius = size * 0.46

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let px = [0, 0, 0, 0]

      // Disco de fondo, con las esquinas transparentes.
      const bg = coverage(x, y, c, c, radius)
      if (bg > 0) px = blend(px, [GROUND[0], GROUND[1], GROUND[2], Math.round(255 * bg)])

      // Halo exterior tenue.
      const haloOuter = coverage(x, y, c, c, size * 0.36)
      const haloInner = coverage(x, y, c, c, size * 0.26)
      const ring = Math.max(0, haloOuter - haloInner)
      if (ring > 0) px = blend(px, [GOLD_SOFT[0], GOLD_SOFT[1], GOLD_SOFT[2], Math.round(GOLD_SOFT[3] * ring)])

      // Anillo dorado.
      const rOut = coverage(x, y, c, c, size * 0.3)
      const rIn = coverage(x, y, c, c, size * 0.22)
      const band = Math.max(0, rOut - rIn)
      if (band > 0) px = blend(px, [GOLD[0], GOLD[1], GOLD[2], Math.round(255 * band)])

      // Punto de luz: tiene que quedar claramente encendido, con sólo un hilo
      // oscuro separándolo del anillo.
      const core = coverage(x, y, c, c, size * 0.17)
      if (core > 0) px = blend(px, [GOLD[0], GOLD[1], GOLD[2], Math.round(255 * core)])

      pixels[y * size + x] = px
    }
  }
  return pixels
}

mkdirSync(OUT, { recursive: true })
for (const size of [16, 32, 48, 128]) {
  const file = join(OUT, `icon-${size}.png`)
  writeFileSync(file, png(size, draw(size)))
  console.log('escrito', file)
}
