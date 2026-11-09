import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.resolve(root, process.argv[2] || 'pages-artifact')
const outputRelativePath = path.relative(root, outputDirectory)
const frontendFiles = [
  'index.html',
  'styles.css',
  'game-engine.js',
  'leaderboard-api.js',
  'run-session.js',
  'functions.js',
  'assets/fonts/aldrich-latin-400-normal.woff2',
  'assets/fonts/OFL.txt'
]

function configuredApiOrigin(value, nodeEnv) {
  if (!value) {
    throw new Error('Set PRIME_SWIPE_API_BASE_URL to the Prime Swipe HTTPS API origin.')
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('PRIME_SWIPE_API_BASE_URL must be an origin without a path.')
  }

  const isLocalDevelopment = nodeEnv === 'development' &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
    url.origin === value
  if (!isLocalDevelopment && (url.protocol !== 'https:' || url.origin !== value)) {
    throw new Error('PRIME_SWIPE_API_BASE_URL must be an HTTPS origin without a path or trailing slash.')
  }
  return value
}

if (!outputRelativePath || outputRelativePath === '..' ||
  outputRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(outputRelativePath)) {
  throw new Error('The Pages output directory must be inside the repository.')
}

const apiOrigin = configuredApiOrigin(
  process.env.PRIME_SWIPE_API_BASE_URL,
  process.env.NODE_ENV
)
fs.mkdirSync(outputDirectory, { recursive: true })
if (fs.readdirSync(outputDirectory).length > 0) {
  throw new Error('The Pages output directory must be empty.')
}

for (const file of frontendFiles) {
  const sourcePath = path.join(root, file)
  const destinationPath = path.join(outputDirectory, file)
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  if (file === 'index.html') {
    let contents = fs.readFileSync(sourcePath, 'utf8')
    const metaTag = /<meta name="prime-swipe-api-base" content="[^"]*">/g
    const matches = contents.match(metaTag)
    if (matches?.length !== 1) {
      throw new Error('Expected exactly one prime-swipe-api-base meta tag in index.html.')
    }
    contents = contents.replace(
      metaTag,
      `<meta name="prime-swipe-api-base" content="${apiOrigin}">`
    )
    fs.writeFileSync(destinationPath, contents)
  } else {
    fs.copyFileSync(sourcePath, destinationPath)
  }
}

console.log(`Prepared frontend-only Prime Swipe artifact at ${outputDirectory}`)
