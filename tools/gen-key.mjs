/**
 * Genera el par de claves que fija el ID de la extensión.
 *
 * Chrome deriva el ID del `key` del manifest: SHA-256 del DER de la clave
 * pública, primeros 16 bytes, y cada dígito hexadecimal mapeado 0-9a-f -> a-p.
 * Fijar el ID importa porque `opencode serve --cors chrome-extension://<id>`
 * necesita un origen literal y estable.
 *
 *   node tools/gen-key.mjs            imprime la clave y el ID
 *   node tools/gen-key.mjs --write    además la escribe en manifest.json
 */
import { generateKeyPairSync, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function idFromPublicKeyDer(der) {
  const hash = createHash('sha256').update(der).digest('hex').slice(0, 32)
  return hash.replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'[parseInt(c, 16)])
}

export function generate() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return {
    key: der.toString('base64'),
    id: idFromPublicKeyDer(der),
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }
}

if (process.argv[1] && process.argv[1].endsWith('gen-key.mjs')) {
  const { key, id, pem } = generate()
  console.log('extension id : ' + id)
  console.log('cors origin  : chrome-extension://' + id)
  console.log('manifest key : ' + key.slice(0, 60) + '...')

  if (process.argv.includes('--write')) {
    const p = join(ROOT, 'manifest.json')
    const manifest = JSON.parse(readFileSync(p, 'utf8'))
    manifest.key = key
    writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n')
    writeFileSync(join(ROOT, '.extension-key.pem'), pem)
    console.log('\nmanifest.json actualizado. Clave privada en .extension-key.pem (no la subas a git).')
  }
}
