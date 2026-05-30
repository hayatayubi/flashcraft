import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const svgPath = path.join(__dirname, 'icon.svg')
const iconsetDir = path.join(__dirname, 'icon.iconset')

await fs.mkdir(iconsetDir, { recursive: true })
const svg = await fs.readFile(svgPath)

const sizes = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
]

for (const { name, size } of sizes) {
  await sharp(svg, { density: Math.max(72, Math.round((size / 1024) * 384)) })
    .resize(size, size)
    .png()
    .toFile(path.join(iconsetDir, name))
  console.log(`rendered ${name}`)
}

await sharp(svg, { density: 384 })
  .resize(1024, 1024)
  .png()
  .toFile(path.join(__dirname, 'icon.png'))
console.log('rendered icon.png (1024)')
